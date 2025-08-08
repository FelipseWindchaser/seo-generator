// /server/services/generation.graph.ts

import { StateGraph, END } from "@langchain/langgraph";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { GenerationRequest } from "~/types";
import { getModel, ModelProvider } from "./langchain.service";
import { ContentValidator } from "~/server/utils/content-validator";
import { z } from "zod";

const validator = new ContentValidator();
const MAX_ATTEMPTS = 3;

// --- 1. РАСШИРЕННОЕ СОСТОЯНИЕ ГРАФА (без изменений) ---
const GraphStateSchema = z.object({
  originalRequest: z.custom<GenerationRequest>(),
  generatedContent: z.string(),
  validationIssues: z.array(z.string()),
  attempts: z.number(),
  finalTitle: z.string(),
  plan: z.string().optional(),
});
type GraphState = z.infer<typeof GraphStateSchema>;


// --- 2. ОПРЕДЕЛЕНИЕ УЗЛОВ ГРАФА (NODES) ---

const generateNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log(`[Graph] Initial generation attempt...`);
    const { originalRequest } = state;
    const model = getModel(originalRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.7 });
  
    // ИСПРАВЛЕНО: Правильно создаем ChatPromptTemplate
    const templateString = `ЗАДАЧА: Напиши качественный, подробный текст для товара "{productName}".
  
  ПРАВИЛА:
  1. ОБЪЕМ: СТРОГО от 1800 до 2000 символов.
  2. КЛЮЧИ: Используй все обязательные ключи: {requiredKeywords}. Распредели по тексту дополнительные: {optionalKeywords}.
  3. СТИЛЬ: Концентрируй ключи в первом абзаце.
  
  ВХОДНЫЕ ДАННЫЕ:
  - Отзывы: {reviews}
  - УТП: {usp}
  
  Верни ответ в формате:
  ===ЗАГОЛОВОК===
  [заголовок]
  ===ОПИСАНИЕ===
  [текст]
  `;
    const userPrompt = ChatPromptTemplate.fromTemplate(templateString);
  
    const chain = userPrompt.pipe(model).pipe(new StringOutputParser());
    const responseText = await chain.invoke({
      productName: originalRequest.productName,
      reviews: originalRequest.reviews,
      usp: originalRequest.usp.join(', '),
      requiredKeywords: originalRequest.requiredKeywords.join(', '),
      optionalKeywords: originalRequest.optionalKeywords.join(', '),
      validationIssues: '', // На первом шаге ошибок нет
    });
  
    const titleMatch = responseText.match(/===ЗАГОЛОВОК===\s*([\s\S]*?)\s*===ОПИСАНИЕ===/);
    const descriptionMatch = responseText.match(/===ОПИСАНИЕ===\s*([\s\S]*)/);
    const title = titleMatch ? titleMatch[1].trim() : originalRequest.productName;
    const content = descriptionMatch ? descriptionMatch[1].trim() : responseText;
  
    return {
      generatedContent: content,
      finalTitle: title,
      attempts: 1,
    };
  };

  const planNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log(`[Graph] Planning how to fix ${state.validationIssues.length} issues...`);
    const { validationIssues } = state;
    const model = getModel(state.originalRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.0 });

    // ИСПРАВЛЕНО: Правильно создаем ChatPromptTemplate
    const templateString = `Ты — редактор-планировщик. Твоя задача — проанализировать список ошибок в SEO-тексте и составить четкий, пошаговый план по их исправлению.

ОШИБКИ В ТЕКСТЕ:
{issues}

ЗАДАЧА:
Напиши краткий, нумерованный список КОНКРЕТНЫХ действий, которые нужно предпринять, чтобы исправить ВСЕ эти ошибки. Например:
1.  Увеличить объем текста примерно на 200 символов, добавив детали о материалах.
2.  Вставить в первый абзац ключ "шнек".
3.  Заменить два длинных предложения в конце на три более коротких.

Верни ТОЛЬКО этот нумерованный список.
`;
    const plannerPrompt = ChatPromptTemplate.fromTemplate(templateString);

    const chain = plannerPrompt.pipe(model).pipe(new StringOutputParser());
    const plan = await chain.invoke({ issues: validationIssues.join('\n') });
    console.log(`[Graph] Generated Plan:`, plan);
    return { plan };
};

const refineWithPlanNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log(`[Graph] Refining content based on the plan (Attempt ${state.attempts + 1})...`);
    const { originalRequest, generatedContent, plan } = state;
    const model = getModel(originalRequest.modelProvider || ModelProvider.GEMINI, { temperature: 0.5 });

    // ИСПРАВЛЕНО: Правильно создаем ChatPromptTemplate
    const templateString = `Ты — SEO-редактор. Твоя задача — взять текст, план по его исправлению, и вернуть улучшенную версию текста, которая соответствует всем правилам.

ИСХОДНЫЙ ТЕКСТ:
---
{content}
---

ПЛАН ИСПРАВЛЕНИЙ (ты должен выполнить все пункты):
---
{plan}
---

КЛЮЧЕВЫЕ ПРАВИЛА, КОТОРЫЕ ДОЛЖНЫ СОБЛЮДАТЬСЯ В ИТОГЕ:
1.  ОБЪЕМ: СТРОГО от 1800 до 2000 символов.
2.  КЛЮЧИ: Все обязательные ключи ({requiredKeywords}) должны присутствовать.

Верни ТОЛЬКО полный, исправленный текст описания. Не включай заголовок.
`;
    const refinerPrompt = ChatPromptTemplate.fromTemplate(templateString);

    const chain = refinerPrompt.pipe(model).pipe(new StringOutputParser());
    const refinedContent = await chain.invoke({
        content: generatedContent,
        plan: plan,
        requiredKeywords: originalRequest.requiredKeywords.join(', '),
    });

    return { generatedContent: refinedContent, attempts: state.attempts + 1 };
};

const validateNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  console.log("[Graph] Validation node...");
  const { generatedContent, originalRequest } = state;
  const result = await validator.validate(
    generatedContent,
    originalRequest.requiredKeywords,
    originalRequest.optionalKeywords
  );
  console.log(`[Graph] Validation isValid: ${result.isValid}. Issues:`, result.issues);
  return { validationIssues: result.issues };
};


// --- 3. ОПРЕДЕЛЕНИЕ ЛОГИКИ МАРШРУТИЗАЦИИ (EDGES) ---

const shouldContinue = (state: GraphState): "planner" | "__end__" => {
    // Если есть ошибки И мы еще не исчерпали попытки, идем на планирование.
    if (state.validationIssues.length > 0 && state.attempts < MAX_ATTEMPTS) {
      console.log(`[Graph Router] Validation failed with ${state.validationIssues.length} issues. Attempts left: ${MAX_ATTEMPTS - state.attempts}. Moving to planning stage.`);
      return "planner";
    }
    
    // Во ВСЕХ ОСТАЛЬНЫХ случаях (нет ошибок ИЛИ закончились попытки) - завершаем.
    console.log("[Graph Router] Validation successful or max attempts reached. Ending.");
    return "__end__";
  };


// --- 4. СБОРКА ГРАФА (ИСПРАВЛЕНО: используется builder pattern) ---

const selfCorrectingChain = new StateGraph({
  state: GraphStateSchema,
})
  // Добавляем все узлы
  .addNode("generate", generateNode)
  .addNode("validate", validateNode)
  .addNode("planner", planNode)
  .addNode("refine", refineWithPlanNode)
  // Устанавливаем точку входа
  .addEdge("__start__", "generate")
  // Определяем маршруты
  .addEdge("generate", "validate")
  .addEdge("planner", "refine")
  .addEdge("refine", "validate") // После исправления снова на проверку
  // Условное ребро решает, что делать после валидации
  .addConditionalEdges("validate", shouldContinue, {
      "planner": "planner",
      "__end__": END,
  })
  // Компилируем
  .compile();

// Экспортируем готовую цепочку
export { selfCorrectingChain };