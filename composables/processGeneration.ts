// /server/composables/processGeneration.ts

import type {
  Task,
  GenerationRequest,
  GenerationResult,
  ValidationResult,
  KeywordDetail,
  AnalysisDetail,
} from "~/types";
import { ContentValidator } from "~/server/utils/content-validator";
import { intelligentTruncate } from "~/server/utils/text-trimmer";
import { handleGoogleAIError } from "~/server/utils/error-handler";
import { getQueuedTasks, updateTask } from "~/server/utils/redis";
import { generativeAgent } from "~/server/services/generation.graph";
import {
  refinementChain,
  ModelProvider,
} from "~/server/services/langchain.service";
import { concat } from "@langchain/core/utils/stream";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";

// --- ИНИЦИАЛИЗАЦИЯ ---
const validator = new ContentValidator();
const MAX_CONTENT_LENGTH = 2000;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findKeywordExample(content: string, keyword: string): string {
  const contentLower = content.toLowerCase();
  const searchKeyword = keyword.split(" ")[0];
  const pos = contentLower.indexOf(searchKeyword.toLowerCase());
  if (pos === -1) return "Пример не найден";
  const start = Math.max(0, pos - 30);
  const end = Math.min(content.length, pos + keyword.length + 30);
  let example = content.slice(start, end);
  if (start > 0) example = "..." + example;
  if (end < content.length) example = example + "...";
  return example.replace(
    new RegExp(escapeRegex(keyword), "ig"),
    (match) => `<strong>${match}</strong>`
  );
}

export function checkAdditionalRequirements(
  content: string,
  data: GenerationRequest
): { issues: string[]; checks: any } {
  return {
    issues: [],
    checks: {
      boldKeywords: (content.match(/\*\*/g) || []).length / 2,
      utpCovered: 0,
      painPointsAddressed: 0,
      trustTriggers: 0,
    },
  };
}

// --- ЛОГИКА ФОНОВОГО ПРОЦЕССА ---
export const repeatFunction = () => {
  const interval = 5000;
  const execute = () => {
    processNextTaskInQueue().catch((err) =>
      console.error("[ProcessTask] Unhandled error in worker:", err)
    );
    setTimeout(execute, interval);
  };
  setTimeout(execute, interval);
};

async function processNextTaskInQueue() {
  // 1. Ищем ОДНУ задачу в очереди со статусом 'queued'
  // getQueuedTasks должна возвращать задачи в порядке их создания
  const queuedTasks = await getQueuedTasks();
  if (queuedTasks.length === 0) {
    // Очередь пуста, это нормальное состояние, выходим
    return;
  }

  const taskToProcess = queuedTasks[0];
  console.log(
    `[ProcessTask] Found task ${taskToProcess.id}, attempting to lock...`
  );

  try {
    // 2. НЕМЕДЛЕННО БЛОКИРУЕМ ЗАДАЧУ, меняя ее статус на 'running'
    // После этого другой воркер ее уже не увидит
    await updateTask(taskToProcess.id, { status: "processing" });
    console.log(
      `[ProcessTask] Task ${taskToProcess.id} locked. Starting generation...`
    );

    // 3. Теперь, когда задача заблокирована, безопасно запускаем долгий процесс
    if (!taskToProcess.request) {
      throw new Error("Task request data is missing.");
    }
    const result = await runGenerationWithValidation(taskToProcess.request);

    // 4. Сохраняем финальный результат и помечаем задачу как 'completed'
    await updateTask(taskToProcess.id, { status: "completed", result });
    console.log(
      `[ProcessTask] Task ${taskToProcess.id} completed successfully.`
    );
  } catch (error: any) {
    console.error(
      `[ProcessTask] CRITICAL ERROR during processing task ${taskToProcess.id}:`,
      error
    );
    const errorMessage =
      error instanceof Error && error.message.includes("Google")
        ? handleGoogleAIError(error).statusMessage
        : error.message || "Неизвестная критическая ошибка.";

    // 5. В случае ошибки, помечаем задачу как 'error', чтобы она не обрабатывалась снова
    await updateTask(taskToProcess.id, {
      status: "error",
      result: {
        content: errorMessage,
        success: false,
        attempts: 0,
        title: "",
        descriptions: [errorMessage],
      },
    });
  }
}

// --- ФУНКЦИЯ РУЧНОЙ КОРРЕКЦИИ ---
export async function runUserRefinement(
  originalContent: string,
  userPrompt: string,
  data: GenerationRequest // Объект `data` содержит все исходные правила, включая modelProvider
): Promise<string> {
  console.log(
    `[Refiner] Starting LangChain refinement with model: ${
      data.modelProvider || "default"
    }...`
  );

  try {
    // ИСПРАВЛЕНО: Передаем modelProvider из объекта `data`
    const refinedContent = await refinementChain.invoke({
      originalContent,
      userPrompt,
      // Устанавливаем провайдера модели, используя данные из исходного запроса,
      // или Gemini по умолчанию, если он не был указан.
      modelProvider: data.modelProvider || ModelProvider.GEMINI,
    });
    return refinedContent || originalContent;
  } catch (error: any) {
    console.error(
      `[Refiner] FAILED: LangChain error during user refinement.`,
      error
    );
    const { statusCode, statusMessage } = handleGoogleAIError(error);
    throw createError({ statusCode, statusMessage });
  }
}

async function runGenerationWithValidation(
  data: GenerationRequest
): Promise<GenerationResult> {
  const modelToUse = data.modelProvider || ModelProvider.GEMINI;
  console.log(
    `[Generator] Starting Multi-Tool Agent process with model: ${modelToUse}...`
  );

  try {
    // ЗАПУСКАЕМ АГЕНТА, передавая начальное состояние
    const finalState = await generativeAgent.invoke(
      {
        generationRequest: data,
        // Остальные поля будут инициализированы значениями по умолчанию
      },
      {
        configurable: {
          modelProvider: modelToUse, // Передаем модель через config
        }
      }
    );

    const finalVariations = finalState.textVariations || [finalState.generatedContent];
    const title = finalState.title;
    const validationResult = finalState.validationResult!;
    const analysisResult = finalState.analysisResult;
     // checkAdditionalRequirements теперь не нужна, так как анализ делает граф
     // const additionalChecks = checkAdditionalRequirements(finalContent, data);
 
     return prepareFinalResult(
      title,
      finalVariations, // <-- Передаем массив
      validationResult,
      analysisResult,
      finalState.attempts,
      validationResult.isValid
    );
   } catch (error: any) {
    console.error(`[Generator] LangGraph process failed:`, error);
    const errorMessage = handleGoogleAIError(error).statusMessage;
    const errorResult: GenerationResult = {
      success: false,
      content: errorMessage,
      title: "Ошибка генерации",
      descriptions: [errorMessage],
      attempts: 1,
    };
    return errorResult;
  }
}

// --- ФУНКЦИЯ ПОДГОТОВКИ РЕЗУЛЬТАТА ---
export function prepareFinalResult(
  title: string,
  descriptions: string[], 
  validation: ValidationResult,
  analysis: { utpAnalysis: AnalysisDetail[], painPointAnalysis: AnalysisDetail[] } | null,
  attempts: number,
  success: boolean,
  processingLog: { added: string[]; removed: string[] } = {
    added: [],
    removed: [],
  }
): GenerationResult {
  const keywordDetails: KeywordDetail[] = [];
  const keywordUsage = validation.metrics.keywordUsageDetails || {};

  const allKeywords = [
    ...(validation.metrics.missingKeywords || []),
    ...(validation.metrics.keywordsFound || []),
  ];
  const baseContent = descriptions[0]; // Берем первую вариацию как основу для метрик
  for (const keyword of allKeywords) {
    const count = keywordUsage[keyword]?.count || 0;
    const example = findKeywordExample(baseContent, keyword);
    keywordDetails.push({ keyword, count, example });
  }

  const result: GenerationResult = {
    success,
    // ИСПРАВЛЕНО: Поле 'content' теперь содержит чистый текст, как и 'descriptions[0]'
    content: baseContent,
    title,
    descriptions: descriptions, // Массив с вариациями
    metrics: {
      ...validation.metrics,
      keywordDetails: keywordDetails,
      boldKeywordsCount: (baseContent.match(/\*\*/g) || []).length / 2,
    },
    analysis: analysis || undefined,
    attempts,
    processingLog,
    warnings: validation.issues,
  };

  return result;
}
