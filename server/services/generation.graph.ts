// /server/services/generation.graph.ts

import { StateGraph, END } from "@langchain/langgraph";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { GenerationRequest } from "~/types";
import { getModel, ModelProvider } from "./langchain.service";
import { ContentValidator, StructuredValidationResult } from "~/server/utils/content-validator";
import { intelligentTruncate } from "~/server/utils/text-trimmer";

const validator = new ContentValidator();
const MAX_ATTEMPTS = 5;
const MAX_CONTENT_LENGTH = 2000;

// --- 1. ОПРЕДЕЛЕНИЕ СОСТОЯНИЯ ГРАФА ---
interface AgentState {
  generationRequest: GenerationRequest;
  generatedContent: string;
  validationResult: StructuredValidationResult | null;
  attempts: number;
  title: string;
}

// --- 2. ОПРЕДЕЛЕНИЕ УЗЛОВ-СПЕЦИАЛИСТОВ ---

// Узел для первоначальной генерации
const generateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Initial generation with streaming...`);
  const { generationRequest } = state;
  
  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { 
    temperature: 0.7,
    maxOutputTokens: 530 // Генерируем с запасом
  });
  
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
       - 1-ый абзац: общее впечатление, позиционирование, основные ключи. В этом абзаце постарайся уместить как можно больше ключей. 
       - 2-ой абзац: функции и технологии. В этом абзаце постарайся уместить большую часть ключей, не попавших в первый абзац.
       - 3-ий абзац: отличия от аналогов, УТП, отзывы. В этом абзаце постарайся уместить оставшиеся ключи.
       - 4-ый абзац: кому подойдёт и как упростит жизнь. В этом абзаце, если все еще остались неиспользованные ключи, добавь их в первое предложение.
    ВЫЖНО: Абзацы должны быть короткими, легкочитаемыми и связанными между собой логически.
    5. Запрет: без списков, подзаголовков, маркировок — только цельный текст.
    
    Верни ответ в формате:
    ===ЗАГОЛОВОК===
    [заголовок]
    ===ОПИСАНИЕ===
    [текст]
      `);
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const stream = await chain.stream({
      productName: generationRequest.productName,
      reviews: generationRequest.reviews,
      usp: generationRequest.usp.join(', '),
      requiredKeywords: JSON.stringify(generationRequest.requiredKeywords),
      optionalKeywords: JSON.stringify(generationRequest.optionalKeywords),
  });

  let responseText = "";
  // Стримим до тех пор, пока не превысим МАКСИМАЛЬНУЮ длину
  for await (const chunk of stream) {
    responseText += chunk;
    if (responseText.length > MAX_CONTENT_LENGTH) {
      console.log(`[Streaming Node] Max length exceeded. Breaking stream.`);
      break; 
    }
  }

  const titleMatch = responseText.match(/===ЗАГОЛОВОК===\s*([\s\S]*?)\s*===ОПИСАНИЕ===/);
  const descriptionMatch = responseText.match(/===ОПИСАНИЕ===\s*([\s\S]*)/);
  const title = titleMatch ? titleMatch[1].trim() : generationRequest.productName;
  const content = descriptionMatch ? descriptionMatch[1].trim() : responseText;
  
  // ИСПРАВЛЕНО: Узел НЕ вызывает обрезку. Он возвращает "сырой" результат.
  console.log(`[generateNode] Raw content generated. Length: ${content.length}`);
  return { generatedContent: content, title: title, attempts: 1 };
};

// Программный узел для сокращения текста
const truncateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Truncating text programmatically...`);
  const { generatedContent } = state;
  
  // Этот узел теперь ЕДИНСТВЕННЫЙ, кто отвечает за обрезку
  const { newContent } = intelligentTruncate(generatedContent, MAX_CONTENT_LENGTH);
  
  console.log(`[Trimmer] Truncated text from ${generatedContent.length} to ${newContent.length}.`);
  
  return { generatedContent: newContent, attempts: state.attempts + 1 };
};

// Узел для расширения текста
const extendNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Extending text...`);
  const { generationRequest, generatedContent } = state;
  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.7, maxOutputTokens: 580 });
  
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
2.  Добавь **один** новый, логически связанный абзац (2-4 предложения), раскрывающий одно из УТП или преимуществ.
3.  **КРИТИЧЕСКИ ВАЖНО:** В новом абзаце старайся **не использовать** обязательные ключевые слова, чтобы не увеличивать их плотность.

Верни ТОЛЬКО полный текст с новым абзацем. Без комментариев.
  `);
  
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const newParagraph = await chain.invoke({ 
      text: generatedContent,
      currentLength: generatedContent.length,
      usp: generationRequest.usp.join(', '),
      reviews: generationRequest.reviews,
  });

  // ИСПРАВЛЕНО: Узел НЕ вызывает обрезку. Он просто добавляет новый абзац.
  // Если результат станет слишком длинным, это обнаружит `validateNode`.
  const newContent = `${generatedContent}\n\n${newParagraph}`;
  
  return { generatedContent: newContent, attempts: state.attempts + 1 };
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
- Найди наиболее логичные места для вставки в первых двух-трех абзацах. Не вставляй ключи в последний абзац.
- Слегка перепиши те предложения, куда планируешь вставить ключи, чтобы они выглядели органично.
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

// --- 3. "УМНЫЙ ДИСПЕТЧЕР" (Маршрутизатор) (без изменений) ---
const routeAfterValidation = (state: AgentState): "truncate" | "extend" | "fix" | "__end__" => {
  const status = state.validationResult?.status;
  const issues = state.validationResult?.issues || [];
  console.log(`[Router] Status: ${status}, Attempts: ${state.attempts}`);

  if (state.attempts >= MAX_ATTEMPTS || status === "OK") {
    return "__end__";
  }

  const hasMissingKeys = issues.some(issue => issue.includes("Отсутствует обязательный ключ"));
  
  if (hasMissingKeys) {
      return "fix";
  }
  
  if (status === "TOO_LONG") {
      return "truncate";
  }
  
  if (status === "TOO_SHORT") {
      return "extend";
  }

  return "__end__";
};

// --- 4. СБОРКА ГРАФА (без изменений) ---
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
  .addNode("truncate", truncateNode)
  .addNode("extend", extendNode)
  .addNode("fix", fixKeysNode)
  // ИСПРАВЛЕННЫЕ РЕБРА
  .addEdge("__start__", "generate")
  .addEdge("generate", "truncate") // После генерации ВСЕГДА на обрезку
  .addEdge("extend", "truncate")   // После расширения ВСЕГДА на обрезку
  .addEdge("fix", "truncate")      // После исправления ключей ВСЕГДА на обрезку
  .addEdge("truncate", "validate") // И только после обрезки - на валидацию
  .addConditionalEdges("validate", routeAfterValidation)
  .compile();

export { generativeAgent };