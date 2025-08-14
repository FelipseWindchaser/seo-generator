// /server/services/generation.graph.ts

import { StateGraph, END } from "@langchain/langgraph";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { GenerationRequest } from "~/types";
import { getModel, ModelProvider } from "./langchain.service";
import { ContentValidator, StructuredValidationResult } from "~/server/utils/content-validator";

const validator = new ContentValidator();
const MAX_ATTEMPTS = 5; // 1 генерация + 4 попытки исправления

// --- 1. ОПРЕДЕЛЕНИЕ СОСТОЯНИЯ ГРАФА ---
interface AgentState {
  generationRequest: GenerationRequest;
  generatedContent: string;
  validationResult: StructuredValidationResult | null;
  attempts: number;
  title: string;
}

// --- 2. ОПРЕДЕЛЕНИЕ УЗЛОВ-СПЕЦИАЛИСТОВ С УЛУЧШЕННЫМИ ПРОМПТАМИ ---

// Узел для первоначальной генерации
const generateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Initial generation...`);
  const { generationRequest } = state;
  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.7, maxOutputTokens: 700 });
  
  const prompt = ChatPromptTemplate.fromTemplate(`
Ты — опытный маркетолог и SEO-копирайтер. Напиши продающий и SEO-оптимизированный текст для товара.

--- ДАННЫЕ ---
- Название товара: {productName}
- УТП (раскрой через выгоды для клиента): {usp}
- Отзывы конкурентов (преврати проблемы в преимущества): {reviews}
- Обязательные ключи: {requiredKeywords}
- Необязательные ключи: {optionalKeywords}

--- ПРАВИЛА ---
1. Объём: Постарайся сгенерировать текст объемом 1800–2000 символов.
2. Ключи: Используй все обязательные ключи и как можно больше необязательных.
3. Стиль: Говори о выгодах, избегай повторов, используй синонимы, не пиши «воду».
4. Структура:
   - 1 абзац: общее впечатление, позиционирование, основные ключи.
   - 2 абзац: функции и технологии.
   - 3 абзац: отличия от аналогов, УТП, отзывы.
   - 4 абзац: кому подойдёт и как упростит жизнь.
5. Запрет: без списков, подзаголовков, маркировок — только цельный текст.

Верни ответ в формате:
===ЗАГОЛОВОК===
[заголовок]
===ОПИСАНИЕ===
[текст]
  `);
  
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const responseText = await chain.invoke({
      productName: generationRequest.productName,
      reviews: generationRequest.reviews,
      usp: generationRequest.usp.join(', '),
      requiredKeywords: JSON.stringify(generationRequest.requiredKeywords),
      optionalKeywords: JSON.stringify(generationRequest.optionalKeywords),
  });

  const titleMatch = responseText.match(/===ЗАГОЛОВОК===\s*([\s\S]*?)\s*===ОПИСАНИЕ===/);
  const descriptionMatch = responseText.match(/===ОПИСАНИЕ===\s*([\s\S]*)/);
  const title = titleMatch ? titleMatch[1].trim() : generationRequest.productName;
  const content = descriptionMatch ? descriptionMatch[1].trim() : responseText;
  
  return { generatedContent: content, title: title, attempts: 1 };
};

// Узел для сокращения текста
const trimNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Trimming text...`);
  const { generationRequest, generatedContent } = state;
  const model = getModel(ModelProvider.GEMINI, { temperature: 0.1 }); // Низкая температура для точности
  
  const prompt = ChatPromptTemplate.fromTemplate(`
Ты — редактор-хирург. Твоя задача — аккуратно сократить текст, чтобы его объем попал в диапазон 1800–2000 символов.

--- ИСХОДНЫЙ ТЕКСТ ---
{text}

--- КОНТЕКСТ ---
- Текущая длина: {currentLength} символов.
- Целевая длина: 1800-2000 символов.
- Обязательные ключи (их нельзя удалять): {requiredKeywords}

--- ЗАДАЧА ---
1.  Определи предложения или фразы, которые являются "водой" (повторяют смысл, не несут новой информации).
2.  Аккуратно удали или перефразируй их, чтобы сократить общий объем текста.
3.  **КРИТИЧЕСКИ ВАЖНО:** Не удаляй предложения, содержащие **последнее** вхождение обязательного ключевого слова.

Верни ТОЛЬКО сокращенный текст. Без комментариев.
  `);
  
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const content = await chain.invoke({ 
      text: generatedContent,
      currentLength: generatedContent.length,
      requiredKeywords: JSON.stringify(generationRequest.requiredKeywords),
  });
  return { generatedContent: content, attempts: state.attempts + 1 };
};

// Узел для расширения текста
const extendNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Extending text...`);
  const { generationRequest, generatedContent } = state;
  const model = getModel(ModelProvider.GEMINI, { temperature: 0.7, maxOutputTokens: 700 }); // Более высокая температура для креативности
  
  const prompt = ChatPromptTemplate.fromTemplate(`
Ты — креативный копирайтер. Твоя задача — органично расширить текст, чтобы его объем попал в диапазон 1800–2000 символов.

--- ИСХОДНЫЙ ТЕКСТ ---
{text}

--- КОНТЕКСТ ---
- Текущая длина: {currentLength} символов.
- Целевая длина: 1800-2000 символов.
- УТП, которые можно раскрыть подробнее: {usp}
- Проблемы из отзывов, которые можно обыграть как преимущества: {reviews}

--- ЗАДАЧА ---
1.  Проанализируй исходный текст и данные.
2.  Добавь **один** новый, логически связанный абзац (3-4 предложения), раскрывающий одно из УТП или преимуществ.
3.  **КРИТИЧЕСКИ ВАЖНО:** В новом абзаце старайся **не использовать** обязательные ключевые слова, чтобы не увеличивать их плотность.

Верни ТОЛЬКО полный текст с новым абзацем. Без комментариев.
  `);
  
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const content = await chain.invoke({ 
      text: generatedContent,
      currentLength: generatedContent.length,
      usp: generationRequest.usp.join(', '),
      reviews: generationRequest.reviews,
  });
  return { generatedContent: content, attempts: state.attempts + 1 };
};

// Узел-специалист по вставке пропущенных ключей
const fixKeysNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    console.log(`[Graph] Fixing missing keywords...`);
    const { generationRequest, generatedContent, validationResult } = state;
    const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.2 }); // Низкая температура для точности
    
    const prompt = ChatPromptTemplate.fromTemplate(`
Ты — редактор-хирург. Твоя задача — взять текст и список недостающих ключевых слов, а затем вернуть ПОЛНЫЙ текст, в который эти слова аккуратно интегрированы.

--- ИСХОДНЫЙ ТЕКСТ ---
{text}

--- НЕДОСТАЮЩИЕ КЛЮЧИ (вставь каждый по одному разу) ---
{missingKeywords}

--- ЗАДАЧА ---
Аккуратно интегрируй "НЕДОСТАЮЩИЕ КЛЮЧИ" в "ИСХОДНЫЙ ТЕКСТ".
- Найди наиболее логичные места для вставки.
- Слегка перепиши существующие предложения, чтобы ключи выглядели органично.
- **КРИТИЧЕСКИ ВАЖНО:** Не добавляй новые абзацы и не удаляй важную информацию. Твоя цель — минимальные, точечные изменения.

Верни ПОЛНЫЙ И ИСПРАВЛЕННЫЙ ТЕКСТ. Не пиши ничего, кроме самого текста.
    `);
    
    const chain = prompt.pipe(model).pipe(new StringOutputParser());
    const content = await chain.invoke({ 
        text: generatedContent, 
        missingKeywords: JSON.stringify(validationResult?.metrics.missingKeywords || []),
    });
    return { generatedContent: content, attempts: state.attempts + 1 };
};

// Узел валидации
const validateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log("[Graph] Validation node...");
  const { generatedContent, generationRequest } = state;
  const result = await validator.validate(generatedContent, generationRequest.requiredKeywords, generationRequest.optionalKeywords);
  return { validationResult: result };
};

// --- 3. "УМНЫЙ ДИСПЕТЧЕР" (Маршрутизатор) ---
const routeAfterValidation = (state: AgentState): "trim" | "extend" | "fix" | "__end__" => {
  const status = state.validationResult?.status;
  const issues = state.validationResult?.issues || [];
  console.log(`[Router] Status: ${status}, Attempts: ${state.attempts}`);

  if (state.attempts >= MAX_ATTEMPTS) {
    console.log("[Router] Max attempts reached. Ending.");
    return "__end__";
  }

  if (status === "OK") {
    return "__end__";
  }

  // Приоритетная логика
  const hasMissingKeys = issues.some(issue => issue.includes("Отсутствует обязательный ключ"));
  
  // Приоритет №1: Если не хватает ключей, всегда отправляем в fixKeysNode
  if (hasMissingKeys) {
      console.log("[Router] Missing required keywords. Routing to 'fix'.");
      return "fix";
  }
  
  // Приоритет №2: Если с ключами все в порядке, разбираемся с объемом
  if (status === "TOO_LONG") {
      console.log("[Router] Text is too long. Routing to 'trim'.");
      return "trim";
  }
  
  if (status === "TOO_SHORT") {
      console.log("[Router] Text is too short. Routing to 'extend'.");
      return "extend";
  }

  // Если остались только некритичные ошибки (плотность, стиль), завершаем работу.
  console.warn(`[Router] Unfixable non-critical errors detected. Ending.`);
  return "__end__";
};

// --- 4. СБОРКА ГРАФА ---
const generativeAgent = new StateGraph<AgentState>({
  channels: {
    generationRequest: { value: (x, y) => y ?? x },
    generatedContent: { value: (x, y) => y ?? x },
    validationResult: { value: (x, y) => y ?? x },
    attempts: { value: (x, y) => y ?? x, default: () => 0 },
    title: { value: (x, y) => y ?? x },
  },
})
  .addNode("generate", generateNode)
  .addNode("validate", validateNode)
  .addNode("trim", trimNode)
  .addNode("extend", extendNode)
  .addNode("fix", fixKeysNode)
  .addEdge("__start__", "generate")
  .addEdge("generate", "validate")
  .addEdge("trim", "validate")
  .addEdge("extend", "validate")
  .addEdge("fix", "validate")
  .addConditionalEdges("validate", routeAfterValidation)
  .compile();

export { generativeAgent };