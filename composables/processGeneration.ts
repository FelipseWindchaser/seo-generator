// /server/composables/processGeneration.ts

import type {
  Task,
  GenerationRequest,
  GenerationResult,
  ValidationResult,
  KeywordDetail,
  AnalysisDetail,
  TextVariation, // <-- Импортируем новый тип
} from "~/types";
import { ContentValidator } from "~/server/utils/content-validator";
import { handleGoogleAIError } from "~/server/utils/_error-handler";
import { getQueuedTasks, updateTask } from "~/server/utils/redis";
import { generativeAgent } from "~/server/services/generation.graph";
import {
  refinementChain,
  ModelProvider,
} from "~/server/services/langchain.service";

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
  const queuedTasks = await getQueuedTasks();
  if (queuedTasks.length === 0) {
    return;
  }

  const taskToProcess = queuedTasks[0];
  console.log(
    `[ProcessTask] Found task ${taskToProcess.id}, attempting to lock...`
  );

  try {
    await updateTask(taskToProcess.id, { status: "processing" });
    console.log(
      `[ProcessTask] Task ${taskToProcess.id} locked. Starting generation...`
    );

    if (!taskToProcess.request) {
      throw new Error("Task request data is missing.");
    }
    const result = await runGenerationWithValidation(taskToProcess.request);

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

    // ИСПРАВЛЕНО: Формируем корректный объект ошибки
    const errorResult: GenerationResult = {
        success: false,
        title: "Ошибка генерации",
        attempts: 1,
        variations: [{
            description: errorMessage,
            metrics: {} as any, // Заполняем пустыми, но существующими объектами
            analysis: { utpAnalysis: [], painPointAnalysis: [] }
        }]
    };

    await updateTask(taskToProcess.id, {
      status: "error",
      result: errorResult,
    });
  }
}

// --- ФУНКЦИЯ РУЧНОЙ КОРРЕКЦИИ ---
export async function runUserRefinement(
  originalContent: string,
  userPrompt: string,
  data: GenerationRequest
): Promise<string> {
  console.log(
    `[Refiner] Starting LangChain refinement with model: ${
      data.modelProvider || "default"
    }...`
  );

  try {
    const refinedContent = await refinementChain.invoke({
      originalContent,
      userPrompt,
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

// --- ГЛАВНАЯ ЛОГИКА ---
async function runGenerationWithValidation(
  data: GenerationRequest
): Promise<GenerationResult> {
  const modelToUse = data.modelProvider || ModelProvider.GEMINI;
  console.log(
    `[Generator] Starting Multi-Tool Agent process with model: ${modelToUse}...`
  );

  try {
    const finalState = await generativeAgent.invoke(
      {
        generationRequest: data,
        // Инициализируем остальные поля null или пустыми значениями
        generatedContent: "",
        validationResult: null,
        analysisResult: null,
        textVariations: null,
        title: "",
        attempts: 0,
      },
      {
        configurable: {
          modelProvider: modelToUse,
        }
      }
    );

    // Граф теперь возвращает полностью готовый массив `TextVariation[]`
    const finalVariations = finalState.textVariations;
    const title = finalState.title;
 
    if (!finalVariations || finalVariations.length === 0) {
        throw new Error("Generation process finished without producing text variations.");
    }

    return prepareFinalResult(
      title,
      finalVariations,
      finalState.attempts,
      true // Если мы дошли досюда, процесс успешен
    );
   } catch (error: any) {
    console.error(`[Generator] LangGraph process failed:`, error);
    const errorMessage = handleGoogleAIError(error).statusMessage;
    
    // ИСПРАВЛЕНО: Формируем корректный объект ошибки
    const errorResult: GenerationResult = {
      success: false,
      title: "Ошибка генерации",
      attempts: 1,
      variations: [{
          description: errorMessage,
          metrics: {} as any,
          analysis: { utpAnalysis: [], painPointAnalysis: [] }
      }]
    };
    return errorResult;
  }
}

// --- ФУНКЦИЯ ПОДГОТОВКИ РЕЗУЛЬТАТА ---
export function prepareFinalResult(
  title: string,
  variations: TextVariation[], 
  attempts: number,
  success: boolean,
  processingLog: { added: string[]; removed: string[] } = {
    added: [],
    removed: [],
  }
): GenerationResult {

  // ИСПРАВЛЕНО: Добавляем `boldKeywordsCount` к метрикам каждой вариации
  const enrichedVariations = variations.map(variation => {
    // Убеждаемся, что metrics существует, прежде чем добавлять в него свойство
    const metrics = variation.metrics || {} as any;
    
    return {
      ...variation,
      metrics: {
        ...metrics,
        boldKeywordsCount: (variation.description.match(/\*\*/g) || []).length / 2,
      }
    };
  });

  const result: GenerationResult = {
    success,
    title,
    variations: enrichedVariations, // Используем обогащенный массив
    attempts,
    processingLog,
  };

  return result;
}