// /server/services/generation.graph.ts

import { StateGraph, END } from "@langchain/langgraph";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import type { GenerationRequest, AnalysisDetail } from "~/types";
import { getModel, ModelProvider } from "./langchain.service";
import { ContentValidator, StructuredValidationResult } from "~/server/utils/content-validator";
import { intelligentTruncate } from "~/server/utils/text-trimmer";

const validator = new ContentValidator();
const MAX_ATTEMPTS = 8; // Увеличиваем лимит, так как добавились новые шаги
const MAX_CONTENT_LENGTH = 2000;

// --- 1. РАСШИРЕНИЕ СОСТОЯНИЯ ГРАФА ---

/**
 * @description Структура для хранения результатов анализа контента.
 */
interface ContentAnalysisResult {
  utpAnalysis: AnalysisDetail[];
  painPointAnalysis: AnalysisDetail[];
  uncoveredUtps: string[];
  uncoveredPainPoints: string[];
  isFullyCovered: boolean;
}

/**
 * @description Обновленное состояние графа, включающее результаты анализа.
 */
interface AgentState {
  generationRequest: GenerationRequest;
  generatedContent: string;
  validationResult: StructuredValidationResult | null;
  analysisResult: ContentAnalysisResult | null; // НОВОЕ ПОЛЕ
  attempts: number;
  title: string;
}

// --- 2. ОПРЕДЕЛЕНИЕ УЗЛОВ-СПЕЦИАЛИСТОВ ---

// Узлы generateNode, truncateNode, extendNode, fixKeysNode, validateNode остаются без изменений.
// ... (код этих узлов)
const generateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Initial generation with streaming...`);
  const { generationRequest } = state;
  
  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { 
    temperature: 0.7,
    maxOutputTokens: 530 
  });
  
  const prompt = ChatPromptTemplate.fromTemplate(`
    Ты — опытный маркетолог и SEO-копирайтер. Напиши продающий и SEO-оптимизированный текст-описание для товара, размещаемого на маркетплейсе Wildberries.
    
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
    ВЫЖНО: Абзацы должны быть КОРОТКИМИ, легкочитаемыми и связанными между собой логически.
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
  
  console.log(`[generateNode] Raw content generated. Length: ${content.length}`);
  return { generatedContent: content, title: title, attempts: 1 };
};

const truncateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Truncating text programmatically...`);
  const { generatedContent } = state;
  const { newContent } = intelligentTruncate(generatedContent, MAX_CONTENT_LENGTH);
  console.log(`[Trimmer] Truncated text from ${generatedContent.length} to ${newContent.length}.`);
  return { generatedContent: newContent, attempts: state.attempts + 1 };
};

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
  const newContent = `${generatedContent}\n\n${newParagraph}`;
  return { generatedContent: newContent, attempts: state.attempts + 1 };
};

const fixKeysNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Fixing missing keywords...`);
  const { generationRequest, generatedContent, validationResult } = state;
  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.2 });
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

const validateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log("[Graph] Validation node...");
  const { generatedContent, generationRequest } = state;
  const result = await validator.validate(generatedContent, generationRequest.requiredKeywords, generationRequest.optionalKeywords);
  return { validationResult: result };
};


// --- НОВЫЕ УЗЛЫ ДЛЯ АНАЛИЗА И КОРРЕКЦИИ КОНТЕНТА ---

/**
 * @description Zod-схема для парсинга ответа от LLM-анализатора.
 */
const analysisSchema = z.object({
  utpAnalysis: z.array(z.object({
    point: z.string().describe("Исходный текст УТП"),
    isCovered: z.boolean().describe("Раскрыто ли УТП в тексте"),
    evidence: z.string().describe("Цитата из текста, доказывающая раскрытие, или пустая строка"),
  })),
  painPointAnalysis: z.array(z.object({
    point: z.string().describe("Исходная 'боль' из отзыва"),
    isCovered: z.boolean().describe("Отработана ли 'боль' в тексте"),
    evidence: z.string().describe("Цитата из текста, доказывающая отработку, или пустая строка"),
  })),
});

// ИЗМЕНЕНО: Создаем тип TypeScript из Zod-схемы
type AnalysisResponseType = z.infer<typeof analysisSchema>;

/**
 * @description Узел-анализатор. Проверяет, раскрыты ли УТП и "боли" в тексте.
 */
const analyzeContentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Analyzing content coverage...`);
  const { generationRequest, generatedContent } = state;
  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.0 });

  const prompt = ChatPromptTemplate.fromTemplate(`
    Ты — беспристрастный аналитик контента. Твоя задача — проверить, раскрывает ли предоставленный ТЕКСТ каждый пункт из списков УТП и БОЛЕЙ.

    --- ТЕКСТ ДЛЯ АНАЛИЗА ---
    {text}

    --- СПИСОК УТП (Уникальные Торговые Преимущества) ---
    {usp}

    --- СПИСОК БОЛЕЙ (Проблемы из отзывов, которые нужно отработать) ---
    {reviews}

    --- ЗАДАЧА ---
    Для КАЖДОГО пункта из УТП и БОЛЕЙ дай бинарный ответ (true/false) и найди одно предложение-доказательство в тексте.
    - isCovered: true, если идея пункта ЯВНО и ОДНОЗНАЧНО раскрыта в тексте.
    - isCovered: false, если идея не раскрыта, либо упомянута косвенно.
    - evidence: Если isCovered: true, приведи точную цитату (одно предложение) из текста. Если false, оставь пустую строку.

    КРИТИЧЕСКИ ВАЖНО: Верни ответ ТОЛЬКО в формате JSON, соответствующем схеме.
  `);

  const chain = prompt.pipe(model.withStructuredOutput(analysisSchema));
  const response = await chain.invoke({
    text: generatedContent,
    usp: JSON.stringify(generationRequest.usp),
    reviews: generationRequest.reviews,
  }) as AnalysisResponseType;

  // ИЗМЕНЕНО: Явно типизируем `item`, чтобы TypeScript был спокоен
  const uncoveredUtps = response.utpAnalysis
    .filter((item: { isCovered: boolean }) => !item.isCovered)
    .map((item: { point: string }) => item.point);
    
  const uncoveredPainPoints = response.painPointAnalysis
    .filter((item: { isCovered: boolean }) => !item.isCovered)
    .map((item: { point: string }) => item.point);

  const analysisResult: ContentAnalysisResult = {
    ...response,
    uncoveredUtps,
    uncoveredPainPoints,
    isFullyCovered: uncoveredUtps.length === 0 && uncoveredPainPoints.length === 0,
  };

  return { analysisResult, attempts: state.attempts + 1 };
};

/**
 * @description Узел-корректор. Встраивает недостающие УТП и "боли" в текст.
 */
const fixContentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Fixing content coverage...`);
  const { generationRequest, generatedContent, analysisResult } = state;
  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.5 });

  const prompt = ChatPromptTemplate.fromTemplate(`
    Ты — талантливый редактор. Твоя задача — аккуратно доработать текст, чтобы он раскрывал недостающие маркетинговые тезисы.

    --- ИСХОДНЫЙ ТЕКСТ ---
    {text}

    --- НЕДОСТАЮЩИЕ ТЕЗИСЫ (нужно интегрировать в текст) ---
    - Нераскрытые УТП: {uncoveredUtps}
    - Неотработанные "боли": {uncoveredPainPoints}

    --- ПРАВИЛА РЕДАКТИРОВАНИЯ ---
    1.  **Интегрируй, а не добавляй:** Найди в тексте наиболее подходящие по смыслу места и перепиши существующие предложения, чтобы включить в них идеи из "недостающих тезисов".
    2.  **Не создавай новые абзацы.**
    3.  **Сохраняй объем:** Старайся не увеличивать общую длину текста. Если нужно что-то добавить, сократи другое, менее важное предложение.
    4.  **Не трогай SEO-ключи:** Постарайся сохранить все обязательные ключевые слова, которые уже есть в тексте.

    Верни ТОЛЬКО полный, исправленный текст. Без комментариев.
  `);

  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const newContent = await chain.invoke({
    text: generatedContent,
    uncoveredUtps: JSON.stringify(analysisResult?.uncoveredUtps || []),
    uncoveredPainPoints: JSON.stringify(analysisResult?.uncoveredPainPoints || []),
  });

  return { generatedContent: newContent, attempts: state.attempts + 1 };
};


// --- 3. ОБНОВЛЕННЫЙ МАРШРУТИЗАТОР ---

const routeAfterValidation = (state: AgentState): "truncate" | "extend" | "fix_keys" | "analyze_content" | "__end__" => {
  const seoStatus = state.validationResult?.status;
  console.log(`[Router] SEO Status: ${seoStatus}, Attempts: ${state.attempts}`);

  if (state.attempts >= MAX_ATTEMPTS) {
    console.log('[Router] Max attempts reached. Ending.');
    return "__end__";
  }

  // Сначала решаем все SEO-проблемы
  if (seoStatus === "MISSING_KEYS") return "fix_keys";
  if (seoStatus === "TOO_LONG") return "truncate";
  if (seoStatus === "TOO_SHORT") return "extend";

  // Если с SEO все в порядке, переходим к анализу контента
  if (seoStatus === "OK" || seoStatus === "NON_CRITICAL_ERRORS") {
    return "analyze_content";
  }

  // Если статус неизвестен, но попытки не исчерпаны - завершаем
  return "__end__";
};

/**
 * @description Маршрутизатор после анализа контента.
 */
const routeAfterAnalysis = (state: AgentState): "fix_content" | "__end__" => {
  const isCovered = state.analysisResult?.isFullyCovered;
  console.log(`[Router] Content coverage: ${isCovered ? 'OK' : 'Needs fixing'}`);

  if (isCovered || state.attempts >= MAX_ATTEMPTS) {
    return "__end__";
  } else {
    return "fix_content";
  }
};


// --- 4. ОБНОВЛЕННАЯ СБОРКА ГРАФА ---

const generativeAgent = new StateGraph<AgentState>({
  channels: {
    generationRequest: { value: (x, y) => y ?? x },
    generatedContent: { value: (x, y) => y ?? x },
    validationResult: { value: (x, y) => y ?? x },
    analysisResult: { value: (x, y) => y ?? x }, // НОВОЕ ПОЛЕ
    attempts: { value: (x, y) => y ?? x, default: () => 0 },
    title: { value: (x, y) => y ?? x },
  },
})
  .addNode("generate", generateNode)
  .addNode("truncate", truncateNode)
  .addNode("extend", extendNode)
  .addNode("fix_keys", fixKeysNode)
  .addNode("validate", validateNode)
  .addNode("analyze_content", analyzeContentNode) // НОВЫЙ УЗЕЛ
  .addNode("fix_content", fixContentNode)       // НОВЫЙ УЗЕЛ

  .addEdge("__start__", "generate")
  .addEdge("generate", "truncate")
  .addEdge("extend", "truncate")
  .addEdge("fix_keys", "truncate")
  .addEdge("truncate", "validate")
  
  // После исправления контента мы снова идем на обрезку и валидацию,
  // чтобы убедиться, что SEO не сломалось окончательно.
  .addEdge("fix_content", "truncate")

  // Условные переходы
  .addConditionalEdges("validate", routeAfterValidation, {
    "fix_keys": "fix_keys",
    "truncate": "truncate",
    "extend": "extend",
    "analyze_content": "analyze_content",
    "__end__": END,
  })
  .addConditionalEdges("analyze_content", routeAfterAnalysis, {
    "fix_content": "fix_content",
    "__end__": END,
  })
  .compile();

export { generativeAgent };