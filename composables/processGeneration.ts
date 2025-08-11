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
import { getQueuedTasks, updateTask } from "~/server/utils/redis";
import { generativeAgent } from "~/server/services/generation.graph";
import { refinementChain, ModelProvider } from "~/server/services/langchain.service";
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
    processNextTaskInQueue().catch(err => console.error("[ProcessTask] Unhandled error in worker:", err));
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
  console.log(`[ProcessTask] Found task ${taskToProcess.id}, attempting to lock...`);

  try {
    // 2. НЕМЕДЛЕННО БЛОКИРУЕМ ЗАДАЧУ, меняя ее статус на 'running'
    // После этого другой воркер ее уже не увидит
    await updateTask(taskToProcess.id, { status: 'processing' });
    console.log(`[ProcessTask] Task ${taskToProcess.id} locked. Starting generation...`);

    // 3. Теперь, когда задача заблокирована, безопасно запускаем долгий процесс
    if (!taskToProcess.request) {
        throw new Error("Task request data is missing.");
    }
    const result = await runGenerationWithValidation(taskToProcess.request);
    
    // 4. Сохраняем финальный результат и помечаем задачу как 'completed'
    await updateTask(taskToProcess.id, { status: "completed", result });
    console.log(`[ProcessTask] Task ${taskToProcess.id} completed successfully.`);

  } catch (error: any) {
    console.error(`[ProcessTask] CRITICAL ERROR during processing task ${taskToProcess.id}:`, error);
    const errorMessage = (error instanceof Error && error.message.includes("Google")) 
        ? handleGoogleAIError(error).statusMessage 
        : error.message || "Неизвестная критическая ошибка.";
        
    // 5. В случае ошибки, помечаем задачу как 'error', чтобы она не обрабатывалась снова
    await updateTask(taskToProcess.id, { 
        status: "error", 
        result: { content: errorMessage, success: false, attempts: 0, title: "", description: "" } 
    });
  }
}

// --- ФУНКЦИЯ РУЧНОЙ КОРРЕКЦИИ ---
export async function runUserRefinement(
  originalContent: string,
  userPrompt: string,
  data: GenerationRequest // Объект `data` содержит все исходные правила, включая modelProvider
): Promise<string> {
  console.log(`[Refiner] Starting LangChain refinement with model: ${data.modelProvider || 'default'}...`);

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
    console.error(`[Refiner] FAILED: LangChain error during user refinement.`, error);
    const { statusCode, statusMessage } = handleGoogleAIError(error);
    throw createError({ statusCode, statusMessage });
  }
}
 

// // --- ГЛАВНАЯ ЛОГИКА (ИСПОЛЬЗУЕТ LANGGRAPH) ---
// async function runGenerationWithValidation(data: GenerationRequest): Promise<GenerationResult> {
//   console.log(`[Generator] Starting LangGraph self-correcting process...`);
  
//   try {
//     // 1. ЗАПУСКАЕМ ГРАФ, передавая начальное состояние
//     // Граф сам выполнит все шаги: генерацию, валидацию и до 3-х попыток исправления.
//     const finalState = await selfCorrectingChain.invoke({
//       originalRequest: data,
//       // Устанавливаем начальные значения для других полей состояния
//       attempts: 0,
//       generatedContent: "",
//       validationIssues: [],
//       finalTitle: "",
//     });

//     // 2. Берем финальные данные из состояния графа
//     const title = finalState.finalTitle || data.productName;
//     let finalContent = finalState.generatedContent;
//     const attempts = finalState.attempts;

//     // 3. Финальная "косметическая" обрезка (как защитный механизм)
//     let processingLog: { added: string[], removed: string[] } = { added: [], removed: [] };
//     if (finalContent.length > MAX_CONTENT_LENGTH) {
//       console.log(`[Trimmer] Final trim from ${finalContent.length} to ${MAX_CONTENT_LENGTH} chars.`);
//       const allKeywords = [...data.requiredKeywords, ...data.optionalKeywords];
//       const truncationResult = intelligentTruncate(finalContent, MAX_CONTENT_LENGTH, allKeywords);
//       finalContent = truncationResult.newContent;
//       processingLog.removed.push(...truncationResult.removedSentences);
//     }

//     // 4. Финальная валидация для получения полных метрик для отчета
//     console.log("[Generator] Performing final validation for metrics report...");
//     const validationResult = await validator.validate(
//       finalContent,
//       data.requiredKeywords,
//       data.optionalKeywords
//     );
    
//     const isSuccess = validationResult.isValid;
//     if (isSuccess) {
//       console.log("[Generator] Final process successful.");
//     } else {
//       console.warn("[Generator] Process finished, but final content has issues:", validationResult.issues);
//     }

//     const additionalChecks = checkAdditionalRequirements(finalContent, data);
//     return prepareFinalResult(title, finalContent, validationResult, additionalChecks, attempts, isSuccess, processingLog);

//   } catch (error: any) {
//       console.error(`[Generator] LangGraph process failed:`, error);
//       const errorMessage = handleGoogleAIError(error).statusMessage;
//       const errorResult: GenerationResult = {
//           success: false,
//           content: errorMessage,
//           title: "Ошибка генерации",
//           description: errorMessage,
//           attempts: 0, // или можно передать количество попыток до сбоя
//       };
//       return errorResult;
//   }
// }


// --- ГЛАВНАЯ ЛОГИКА (ТЕПЕРЬ ИСПОЛЬЗУЕТ АГЕНТА) ---
async function runGenerationWithValidation(data: GenerationRequest): Promise<GenerationResult> {
  const modelToUse = data.modelProvider || ModelProvider.GEMINI;
  console.log(`[Generator] Starting Generative Agent process with model: ${modelToUse}...`);
  
  try {
    // 1. СОЗДАЕМ ПЕРВОНАЧАЛЬНУЮ ИНСТРУКЦИЮ ДЛЯ АГЕНТА
    const initialPrompt = `
Привет! Мне нужно, чтобы ты написал SEO-текст. Вот все правила и данные, которые ты должен использовать.

--- ДАННЫЕ ДЛЯ ЗАДАЧИ ---
- Название товара: ${data.productName}
- ОБЪЕМ ТЕКСТА: СТРОГО от 1800 до 2000 символов.
- ОБЯЗАТЕЛЬНЫЕ КЛЮЧИ: ${JSON.stringify(data.requiredKeywords)}
- НЕОБЯЗАТЕЛЬНЫЕ КЛЮЧИ: ${JSON.stringify(data.optionalKeywords)}
- УТП: ${data.usp.join(', ')}
- Отзывы конкурентов: ${data.reviews}

--- ТВОЙ ПЛАН ДЕЙСТВИЙ ---
1.  Напиши черновик текста, который соответствует всем правилам.
2.  Когда черновик будет готов, вызови инструмент 'validateSeoText', чтобы проверить свою работу. ВАЖНО: В вызов инструмента ты должен передать JSON-строку, содержащую ВСЕ три ключа: "textToValidate" (твой сгенерированный текст), "requiredKeywords" (список обязательных ключей) и "optionalKeywords" (список необязательных ключей).
3. Проанализируй результат.
4. **ЕСЛИ ТЫ ПОЛУЧИЛ ОШИБКУ ПРО JSON:** Внимательно проверь синтаксис своего последнего вызова инструмента. Убедись, что все символы новой строки (\\n) и кавычки (\\") внутри поля "textToValidate" правильно экранированы. Исправь JSON и вызови инструмент снова.
5.  **ЕСЛИ ТЫ ПОЛУЧИЛ СПИСОК ОШИБОК ВАЛИДАЦИИ:** Исправь текст в соответствии с ошибками и снова вызови валидатор.
6.  Повторяй, пока валидатор не вернет "Валидация пройдена успешно".
7.  Когда валидация будет пройдена, верни мне финальный текст в качестве своего ответа.
`;

    // 2. ЗАПУСКАЕМ АГЕНТА
    const finalState = await generativeAgent.invoke(
      { 
        messages: [new HumanMessage(initialPrompt)],
        // Добавляем начальное значение для нового счетчика
        toolInvocations: 0, 
      },
      { 
        configurable: { 
          modelProvider: modelToUse,
        } 
      }
    );

    // 3. ИЗВЛЕКАЕМ ФИНАЛЬНЫЙ РЕЗУЛЬТАТ
    const lastAiMessage = finalState.messages.filter((m: BaseMessage) => m instanceof AIMessage && (!m.tool_calls || m.tool_calls.length === 0)).pop() as AIMessage | undefined;
    let finalContent = lastAiMessage?.content.toString() || "Модель не вернула финальный текстовый ответ.";
    const title = data.productName;

    // 4. Финальная "косметическая" обрезка (на всякий случай)
    let processingLog: { added: string[], removed: string[] } = { added: [], removed: [] };
    if (finalContent.length > MAX_CONTENT_LENGTH) {
      console.log(`[Trimmer] Final trim from ${finalContent.length} to ${MAX_CONTENT_LENGTH} chars.`);
      const allKeywords = [...data.requiredKeywords, ...data.optionalKeywords];
      const truncationResult = intelligentTruncate(finalContent, MAX_CONTENT_LENGTH, allKeywords);
      finalContent = truncationResult.newContent;
      processingLog.removed.push(...truncationResult.removedSentences);
    }

    // 5. Финальная валидация для отчета
    console.log("[Generator] Performing final validation for metrics report...");
    const validationResult = await validator.validate(
      finalContent,
      data.requiredKeywords,
      data.optionalKeywords
    );
    
    // ИСПРАВЛЕНО: Процесс генерации считается успешным, так как агент вернул результат.
    // Качество этого результата будет отражено в `validationResult.issues` (которые попадут в `warnings`).
    const isSuccess = true; 

    if (!validationResult.isValid) {
      console.warn("[Generator] Agent process finished. The final content has issues:", validationResult.issues);
    } else {
      console.log("[Generator] Agent process finished. Final validation successful.");
    }

    const additionalChecks = checkAdditionalRequirements(finalContent, data);
    // Мы передаем `isSuccess = true`, а `validationResult` содержит все недочеты.
    return prepareFinalResult(title, finalContent, validationResult, additionalChecks, 1, isSuccess, processingLog);

  } catch (error: any) {
      console.error(`[Generator] LangGraph process failed:`, error);
      const errorMessage = handleGoogleAIError(error).statusMessage;
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