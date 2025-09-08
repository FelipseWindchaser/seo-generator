// /server/services/generation.graph.ts

import { StateGraph, END } from "@langchain/langgraph";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import type { GenerationRequest, AnalysisDetail } from "~/types";
import { getModel, ModelProvider } from "./langchain.service";
import { ContentValidator, StructuredValidationResult } from "~/server/utils/content-validator";
import { intelligentTruncate } from "~/server/utils/text-trimmer";
import { ContentAnalyzer } from "~/server/utils/content-analyzer";

const validator = new ContentValidator();
const MAX_ATTEMPTS = 8;
const MAX_CONTENT_LENGTH = 2000;

// --- 1. УПРОЩЕННОЕ СОСТОЯНИЕ ГРАФА ---

interface ContentAnalysisResult {
  utpAnalysis: AnalysisDetail[];
  painPointAnalysis: AnalysisDetail[];
  uncoveredUtps: string[];
  uncoveredPainPoints: string[];
  isFullyCovered: boolean;
}

interface AgentState {
  generationRequest: GenerationRequest;
  generatedContent: string;
  validationResult: StructuredValidationResult | null;
  analysisResult: ContentAnalysisResult | null;
  // УДАЛЕНО: textVariations больше не является частью этого графа
  attempts: number;
}

// --- 2. ОПРЕДЕЛЕНИЕ УЗЛОВ-СПЕЦИАЛИСТОВ ---

const generateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Initial generation with streaming...`);
  const { generationRequest } = state;
  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { 
    temperature: 0.7,
    maxOutputTokens: 630 
  });
  const prompt = ChatPromptTemplate.fromTemplate(`
    Ты — опытный маркетолог и SEO-копирайтер. Напиши продающий и SEO-оптимизированный текст-описание для товара, размещаемого на маркетплейсе Wildberries, в пределах 1800-2000 символов.
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
    ВЫЖНО: Абзацы должны быть КОРОТКИМИ (3-5 небольших предложения), легкочитаемыми и связанными между собой логически.
    5. Запрет: без списков, подзаголовков, маркировок — только цельный текст.
    6. **КРИТИЧЕСКИ ВАЖНОЕ ПРАВИЛО ВЫДЕЛЕНИЯ**: Каждое ключевое слово из списков "Обязательные ключи" и "Необязательные ключи" ОБЯЗАТЕЛЬНО выделяй жирным шрифтом с помощью двух звездочек. Пример: Наша **соковыжималка** поможет вам...
    
    Верни ТОЛЬКО сгенерированный текст-описание. Без заголовков, без лишних маркеров.
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
      const content = responseText.trim();
      console.log(`[generateNode] Raw content generated. Length: ${content.length}`);
      
      // ИЗМЕНЕНИЕ: Возвращаем объект без title
      return { generatedContent: content, attempts: 1 };
    };

const truncateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Truncating text programmatically...`);
  const { generatedContent } = state;
  const { newContent } = intelligentTruncate(generatedContent, MAX_CONTENT_LENGTH);
  console.log(`[Trimmer] Truncated text from ${generatedContent.length} to ${newContent.length}.`);
  return { generatedContent: newContent, attempts: state.attempts + 1 };
};

const extendNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Extending text surgically...`);
  const { generationRequest, generatedContent } = state;

  // --- ШАГ 1: ТОЧНЫЙ РАСЧЕТ ДЕФИЦИТА И ЦЕЛИ ---
  const cleanCurrentLength = generatedContent.replace(/\*\*/g, "").length;
  const targetLength = 1900; // Целимся в середину диапазона 1800-2000
  const deficit = targetLength - cleanCurrentLength;

  // Рассчитываем, сколько предложений нужно добавить.
  // Если не хватает > 250 символов, просим 2 предложения. Иначе - одно.
  // Это предотвратит слишком большие "скачки" длины.
  const sentencesNeeded = deficit > 250 ? 2 : 1;
  
  console.log(`[Extend Node] Current clean length: ${cleanCurrentLength}. Deficit: ${deficit}. Sentences needed: ${sentencesNeeded}`);

  // --- ШАГ 2: АНАЛИЗ НЕРАСКРЫТЫХ ТЕЗИСОВ (логика остается) ---
  const analyzer = new ContentAnalyzer();
  const analysis = await analyzer.analyze(generatedContent, generationRequest);
  const uncoveredUtps = analysis.utpAnalysis
    .filter(item => !item.isCovered)
    .map(item => item.point);
  const uncoveredPainPoints = analysis.painPointAnalysis
    .filter(item => !item.isCovered)
    .map(item => item.point);
  
  let topicsToExtend = [...uncoveredUtps, ...uncoveredPainPoints];

  if (topicsToExtend.length === 0) {
    console.log('[Extend Node] All topics are covered. Falling back to a creative extension.');
    topicsToExtend.push("опиши дополнительный сценарий использования товара или его преимущество для конкретной аудитории (например, для большой семьи или для спортсменов)");
  }

  const model = getModel(generationRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.7, maxOutputTokens: 580 });
  
  // ИЗМЕНЕНИЕ: Промпт полностью переработан. Он теперь "хирургический".
  const prompt = ChatPromptTemplate.fromTemplate(`
    Ты — редактор-хирург. Твоя задача — очень точно и лаконично дополнить текст, чтобы он попал в заданный объем.
    --- ИСХОДНЫЙ ТЕКСТ (для контекста) ---
    {text}
    --- КОНТЕКСТ ЗАДАЧИ ---
    - Текущая "чистая" длина текста: {currentLength} символов.
    - Целевая длина: ~1900 символов.
    - **Необходимо добавить примерно: {deficit} символов.**
    --- ТЕЗИСЫ, КОТОРЫЕ ЕЩЕ НЕ РАСКРЫТЫ В ТЕКСТЕ ---
    {topicsToExtend}
    --- ЗАДАЧА ---
    1.  **КРИТИЧЕСКИ ВАЖНО:** Твоя цель — добавить ровно **{sentencesNeeded}** предложение(й). Не больше и не меньше.
    2.  Выбери ОДИН тезис из списка "ТЕЗИСЫ, КОТОРЫЕ ЕЩЕ НЕ РАСКРЫТЫ" и раскрой его в этих {sentencesNeeded} предложениях.
    3.  Будь лаконичен. Старайся, чтобы объем твоего дополнения был близок к {deficit} символам.
    4.  НЕ ПОВТОРЯЙ то, о чем уже сказано в исходном тексте.
    5.  В новом тексте старайся **не использовать** обязательные ключевые слова. Если используешь необязательные, выделяй их **звездочками**.

    Верни ТОЛЬКО НОВЫЙ ТЕКСТ ({sentencesNeeded} предложение/я). Ничего больше. Без комментариев, без повторения исходного текста.
      `);
      
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  
  const newContentFragment = await chain.invoke({ 
    text: generatedContent,
    currentLength: cleanCurrentLength,
    deficit: deficit,
    sentencesNeeded: sentencesNeeded,
    topicsToExtend: JSON.stringify(topicsToExtend), 
  });
  
  // Добавляем новый фрагмент в конец существующего текста.
  // Если в тексте уже есть абзацы, добавляем через два переноса строки.
  // Если нет, то через один, чтобы не создавать лишний отступ.
  const separator = generatedContent.includes('\n\n') ? '\n\n' : '\n';
  const newContent = `${generatedContent}${separator}${newContentFragment.trim()}`;
  
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
    **ПРАВИЛО ВЫДЕЛЕНИЯ**: Каждый вставленный тобой ключ ОБЯЗАТЕЛЬНО выдели жирным шрифтом с помощью двух звездочек. Пример: ...наша новая **соковыжималка**...
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

const analysisSchema = z.object({
  utpAnalysis: z.array(z.object({ point: z.string(), isCovered: z.boolean(), evidence: z.string() })),
  painPointAnalysis: z.array(z.object({ point: z.string(), isCovered: z.boolean(), evidence: z.string() })),
});
type AnalysisResponseType = z.infer<typeof analysisSchema>;


const analyzeContentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`[Graph] Analyzing base content coverage...`);
  const analyzer = new ContentAnalyzer();
  const response = await analyzer.analyze(state.generatedContent, state.generationRequest);
  const uncoveredUtps = response.utpAnalysis.filter(item => !item.isCovered).map(item => item.point);
  const uncoveredPainPoints = response.painPointAnalysis.filter(item => !item.isCovered).map(item => item.point);
  const analysisResult: ContentAnalysisResult = {
    ...response,
    uncoveredUtps,
    uncoveredPainPoints,
    isFullyCovered: uncoveredUtps.length === 0 && uncoveredPainPoints.length === 0,
  };
  return { analysisResult, attempts: state.attempts + 1 };
};

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

// --- МАРШРУТИЗАТОРЫ ---

const routeAfterValidation = (state: AgentState): "truncate" | "extend" | "fix_keys" | "analyze_content" | "__end__" => {
  const seoStatus = state.validationResult?.status;
  console.log(`[Router] SEO Status: ${seoStatus}, Attempts: ${state.attempts}`);
  
  if (state.attempts >= MAX_ATTEMPTS) {
    console.log('[Router] Max attempts reached on SEO cycle. Moving to content analysis.');
    return "analyze_content";
  }

  // ИЗМЕНЕНИЕ: Меняем порядок проверок в маршрутизаторе, чтобы он соответствовал
  // новой логике приоритетов из валидатора.
  if (seoStatus === "TOO_LONG") return "truncate";
  if (seoStatus === "TOO_SHORT") return "extend";
  if (seoStatus === "MISSING_KEYS") return "fix_keys";
  
  if (seoStatus === "OK" || seoStatus === "NON_CRITICAL_ERRORS") {
    return "analyze_content";
  }

  // Если статус неизвестен, завершаем, чтобы избежать бесконечного цикла.
  return "__end__";
};

const routeAfterAnalysis = (state: AgentState): "fix_content" | "__end__" => {
  const isCovered = state.analysisResult?.isFullyCovered;
  console.log(`[Router] Content coverage: ${isCovered ? 'OK' : 'Needs fixing'}`);
  if (state.attempts >= MAX_ATTEMPTS) {
      console.log('[Router] Max attempts reached. Skipping content fix, finishing.');
      return "__end__";
  }
  if (isCovered) {
    return "__end__";
  } else {
    return "fix_content";
  }
};

// --- СБОРКА ГРАФА ---

const generativeAgent = new StateGraph<AgentState>({
  channels: {
    generationRequest: { value: (x, y) => y ?? x },
    generatedContent: { value: (x, y) => y ?? x },
    validationResult: { value: (x, y) => y ?? x },
    analysisResult: { value: (x, y) => y ?? x },
    attempts: { value: (x, y) => y ?? x, default: () => 0 },
  },
})
  .addNode("generate", generateNode)
  .addNode("truncate", truncateNode)
  .addNode("extend", extendNode)
  .addNode("fix_keys", fixKeysNode)
  .addNode("validate", validateNode)
  .addNode("analyze_content", analyzeContentNode)
  .addNode("fix_content", fixContentNode)

  .addEdge("__start__", "generate")
  .addEdge("generate", "truncate")
  .addEdge("extend", "truncate")
  .addEdge("fix_keys", "truncate")
  .addEdge("truncate", "validate")
  .addEdge("fix_content", "truncate")

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