// /server/composables/processGeneration.ts

import type {
  Task,
  GenerationRequest,
  GenerationResult,
  ValidationResult,
  KeywordDetail,
} from "~/types";
import { ContentValidator } from "~/server/utils/content-validator";
import { intelligentTruncate } from "~/server/utils/text-trimmer";
import { handleGoogleAIError } from "~/server/utils/error-handler";

import { seoGeneratorChain, refinementChain } from "~/server/services/langchain.service";

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
  const interval = 10000;
  const execute = () => {
    processTask();
    setTimeout(execute, interval);
  };
  setTimeout(execute, interval);
};

const processTask = async () => {
  console.log(
    `[ProcessTask] Checking for new tasks at ${new Date().toLocaleTimeString()}`
  );
  try {
    const tasks: Task[] = await getProcessingTasks();
    if (tasks.length === 0) return;
    console.log(`[ProcessTask] Found ${tasks.length} tasks to process.`);
    for await (const task of tasks) {
      if (!task.request) {
        await updateTask(task.id, {
          status: "error",
          result: {
            content: "Ошибка: отсутствуют данные для запроса.",
            success: false,
            attempts: 0,
            title: "",
            description: "",
          },
        });
        continue;
      }
      try {
        const result = await runGenerationWithValidation(task.request);
        await updateTask(task.id, { status: "completed", result });
      } catch (error: any) {
        console.error(
          `[ProcessTask] CRITICAL ERROR during generation for task ${task.id}:`,
          error
        );
        const errorMessage = handleGoogleAIError(error).statusMessage;
        await updateTask(task.id, {
          status: "error",
          result: { content: errorMessage, success: false, attempts: 0, title: "", description: "" },
        });
      }
    }
  } catch (error) {
    console.error("[ProcessTask] Failed to fetch or process tasks queue:", error);
  }
};

// --- ФУНКЦИЯ РУЧНОЙ КОРРЕКЦИИ ---
export async function runUserRefinement(
  originalContent: string,
  userPrompt: string,
  data: GenerationRequest
): Promise<string> {
  console.log(
    "[Refiner] Starting user refinement step..."
  );

  try {
    // Вызываем нашу новую цепочку для доработки
    const refinedContent = await refinementChain.invoke({
        originalContent,
        userPrompt,
    });
    return refinedContent || originalContent;
  } catch (error: any) {
    console.error(`[Refiner] FAILED: LangChain error during user refinement.`, error);
    const { statusCode, statusMessage } = handleGoogleAIError(error);
    throw createError({ statusCode, statusMessage });
  }
}
 

// --- ГЛАВНАЯ ЛОГИКА (ИСПОЛЬЗУЕТ LANGCHAIN) ---
async function runGenerationWithValidation(data: GenerationRequest): Promise<GenerationResult> {
  console.log(`[Generator] Starting LangChain 'Flexible Frame' generation process...`);
  
  try {
    // 1. ВЫЗЫВАЕМ ВСЮ ЦЕПОЧКУ ОДНОЙ КОМАНДОЙ
    // Мы передаем `data` через `configurable`, чтобы она была доступна на всех шагах.
    // ВАЖНО: LangChain пока не возвращает заголовок, используем заглушку.
    const contentWithKeywords = await seoGeneratorChain.invoke(
      data, 
      { configurable: { originalRequest: data } }
    );
    const title = data.productName; // Используем имя продукта как временный заголовок

    // 2. Финальная "косметическая" обрезка
    let finalContent = contentWithKeywords;
    let processingLog: { added: string[], removed: string[] } = { added: [], removed: [] };
    if (finalContent.length > MAX_CONTENT_LENGTH) {
      const allKeywords = [...data.requiredKeywords, ...data.optionalKeywords];
      const truncationResult = intelligentTruncate(finalContent, MAX_CONTENT_LENGTH, allKeywords);
      finalContent = truncationResult.newContent;
      processingLog.removed.push(...truncationResult.removedSentences);
    }

    // 3. Финальная валидация
    console.log("[Generator] Performing final validation...");
    const validationResult = await validator.validate(
      finalContent,
      data.requiredKeywords,
      data.optionalKeywords
    );
    
    const isSuccess = validationResult.isValid;
    if (isSuccess) {
      console.log("[Generator] Final validation successful.");
    } else {
      console.warn("[Generator] Final validation failed with issues:", validationResult.issues);
    }

    const additionalChecks = checkAdditionalRequirements(finalContent, data);
    return prepareFinalResult(title, finalContent, validationResult, additionalChecks, 1, isSuccess, processingLog);

  } catch (error: any) {
      console.error(`[Generator] LangChain process failed:`, error);
      const errorMessage = handleGoogleAIError(error).statusMessage;
      // Возвращаем объект GenerationResult с ошибкой
      const errorResult: GenerationResult = {
          success: false,
          content: errorMessage,
          title: "Ошибка генерации",
          description: errorMessage,
          attempts: 1,
      };
      return errorResult;
  }
}


// --- ФУНКЦИЯ ПОДГОТОВКИ РЕЗУЛЬТАТА ---
export function prepareFinalResult(
  title: string,
  content: string,
  validation: ValidationResult,
  additionalChecks: { issues: string[]; checks: any },
  attempts: number,
  success: boolean,
  processingLog: { added: string[], removed: string[] } = {
    added: [],
    removed: [],
  }
): GenerationResult {
  const keywordDetails: KeywordDetail[] = [];
  const keywordUsage = validation.metrics.keywordUsageDetails || {};

  const allKeywords = [
    ...(validation.metrics.missingKeywords || []), 
    ...(validation.metrics.keywordsFound || [])
  ];

  for (const keyword of allKeywords) {
    const count = keywordUsage[keyword]?.count || 0;
    const example = findKeywordExample(content, keyword);
    keywordDetails.push({ keyword, count, example });
  }

  const finalContent = `**${title}**\n\n${content}`;

  const result: GenerationResult = {
    success,
    content: finalContent,
    title,
    description: content,
    metrics: {
      ...validation.metrics,
      keywordDetails: keywordDetails,
      boldKeywordsCount: additionalChecks.checks.boldKeywords,
      utpCovered: additionalChecks.checks.utpCovered,
      painPointsAddressed: additionalChecks.checks.painPointsAddressed,
      trustTriggers: additionalChecks.checks.trustTriggers,
    },
    attempts,
    processingLog,
    warnings: validation.issues,
  };

  return result;
}