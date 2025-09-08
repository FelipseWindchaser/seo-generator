// /server/composables/processGeneration.ts

import type {
  Task,
  GenerationRequest,
  GenerationResult,
  ValidationResult,
  KeywordDetail,
  AnalysisDetail,
  TextVariation,
} from "~/types";
import { ContentValidator } from "~/server/utils/content-validator";
// import { handleGoogleAIError } from "~/server/utils/error-handler";
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

    const errorResult: GenerationResult = {
        success: false,
        attempts: 1,
        variations: [{
            description: errorMessage,
            metrics: {} as any,
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
    // ИЗМЕНЕНИЕ: Убрано поле title из начального состояния
    const finalState = await generativeAgent.invoke(
      {
        generationRequest: data,
        generatedContent: "",
        validationResult: null,
        analysisResult: null,
        // title: "", // УДАЛЕНО
        attempts: 0,
      },
      {
        configurable: {
          modelProvider: modelToUse,
        }
      }
    );

    if (!finalState.generatedContent || !finalState.validationResult || !finalState.analysisResult) {
        throw new Error("Core generation process failed to produce a complete result.");
    }

    const baseVariation: TextVariation = {
        description: finalState.generatedContent,
        metrics: {
            ...finalState.validationResult.metrics,
            boldKeywordsCount: (finalState.generatedContent.match(/\*\*/g) || []).length / 2,
        },
        analysis: {
            utpAnalysis: finalState.analysisResult.utpAnalysis,
            painPointAnalysis: finalState.analysisResult.painPointAnalysis,
        }
    };
 
    // ИЗМЕНЕНИЕ: Убран title из вызова функции
    return prepareFinalResult(
      [baseVariation],
      finalState.attempts,
      true
    );
   } catch (error: any) {
    console.error(`[Generator] LangGraph process failed:`, error);
    const errorMessage = error.message || handleGoogleAIError(error).statusMessage;
    
    // ИЗМЕНЕНИЕ: Убрано поле title
    const errorResult: GenerationResult = {
      success: false,
      // title: "Ошибка генерации", // УДАЛЕНО
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
  variations: TextVariation[], 
  attempts: number,
  success: boolean,
  processingLog: { added: string[]; removed: string[] } = {
    added: [],
    removed: [],
  }
): GenerationResult {
  
  // ИЗМЕНЕНИЕ: Убрано поле title из объекта
  const result: GenerationResult = {
    success,
    // title, // УДАЛЕНО
    variations: variations,
    attempts,
    processingLog,
  };

  return result;
}