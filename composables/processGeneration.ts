// /server/composables/processGeneration.ts

import { GoogleGenAI, HarmCategory, HarmBlockThreshold, type GoogleRpcStatus } from "@google/genai";
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

// --- ИНИЦИАЛИЗАЦИЯ ---
const { geminiApiKey } = useRuntimeConfig();
if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
const validator = new ContentValidator();
const MAX_CONTENT_LENGTH = 2000;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// function handleGoogleAIError(error: any): string {
//   // Проверяем, содержит ли ошибка структурированные детали от Google API
//   const rpcStatus = error.cause as GoogleRpcStatus;

//   if (rpcStatus && rpcStatus.code) {
//     switch (rpcStatus.code) {
//       // gRPC code 14: UNAVAILABLE
//       case 14:
//         return "Серверы модели временно недоступны или перегружены. Пожалуйста, попробуйте снова через несколько минут.";
//       // gRPC code 8: RESOURCE_EXHAUSTED
//       case 8:
//         return "Превышен лимит запросов (квота). Пожалуйста, проверьте ваш тарифный план или попробуйте позже.";
//       // gRPC code 3: INVALID_ARGUMENT
//       case 3:
//         return `Некорректный аргумент в запросе к модели: ${rpcStatus.message}`;
//       default:
//         return `Произошла ошибка API (код: ${rpcStatus.code}): ${rpcStatus.message}`;
//     }
//   }

//   // Фоллбэк на случай, если структура ошибки другая (как на вашем скриншоте)
//   if (error.message && error.message.includes('503')) {
//       return "Серверы модели временно недоступны или перегружены. Пожалуйста, попробуйте снова через несколько минут.";
//   }

//   // Самый общий фоллбэк
//   return error.message || "Неизвестная ошибка при обращении к AI модели.";
// }


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
        // const errorMessage =
        //   error.message || "Неизвестная критическая ошибка при генерации.";
        // await updateTask(task.id, {
        //   status: "error",
        //   result: {
        //     content: errorMessage,
        //     success: false,
        //     attempts: 0,
        //     title: "",
        //     description: "",
        //   },
        // });
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

  const systemPrompt = `Ты — высокоточный редактор. Твоя задача — взять текст и запрос на изменение, а затем ВНЕСТИ ТОЛЬКО запрошенное изменение, НЕ НАРУШАЯ исходных правил и не переписывая текст заново, если пользователь не просил этого. Соблюдение правил — твой главный приоритет.`;

  const userPromptForLLM = `
ЗАДАЧА: Аккуратно отредактируй ИСХОДНЫЙ ТЕКСТ в соответствии с ЗАПРОСОМ ПОЛЬЗОВАТЕЛЯ, при этом СТРОГО СОБЛЮДАЯ все КРИТИЧЕСКИЕ ПРАВИЛА.

--- ИСХОДНЫЙ ТЕКСТ ---
${originalContent}

--- ЗАПРОС ПОЛЬЗОВАТЕЛЯ НА ИЗМЕНЕНИЕ ---
"${userPrompt}"

--- КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА (ДОЛЖНЫ СОБЛЮДАТЬСЯ БЕЗУСЛОВНО) ---
1.  **ОБЪЕМ ТЕКСТА:** Итоговый текст должен быть объемом СТРОГО от 1800 до 2000 символов.
2.  **КЛЮЧЕВЫЕ СЛОВА:** Все обязательные ключи должны остаться в тексте.

Верни ТОЛЬКО полный, исправленный текст описания без заголовков и комментариев. Если пользователь добавил новые ключевые слова, то выдели их жирным шрифтом.
`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: userPromptForLLM }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 800,
        systemInstruction: { parts: [{ text: systemPrompt }] },
      },
    });
    const refinedContent =
      result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (refinedContent) {
      console.log(`[Refiner] Successfully generated refined text.`);
      return refinedContent;
    }
    return originalContent;
  } catch (error: any) {
    console.error(`[Refiner] FAILED: API error during user refinement.`, error);
    const { statusCode, statusMessage } = handleGoogleAIError(error);
    throw createError({ statusCode, statusMessage });
  }
}

// --- НОВАЯ АРХИТЕКТУРА "ГИБКИЙ КАРКАС" ---

function parseLLMResponse(responseText: string): { title: string; content: string } {
    const contentParts = responseText.split("===");
    let title = "", description = "";
    for (let i = 0; i < contentParts.length; i++) {
        if (contentParts[i].includes("ЗАГОЛОВОК") && i + 1 < contentParts.length) {
            title = contentParts[i + 1].trim();
        } else if (contentParts[i].includes("ОПИСАНИЕ") && i + 1 < contentParts.length) {
            description = contentParts[i + 1].trim();
        }
    }
    if (!title && !description) {
        console.warn("[Generator] Could not parse LLM response. Using fallback.");
        const lines = responseText.trim().split("\n");
        title = lines[0] || "Заголовок не был сгенерирован";
        description = lines.slice(1).join("\n").trim() || responseText;
    }
    return { title, content: description };
}

// ЭТАП 1: Генерация избыточной базы без ключей
async function generateOverSizedBaseContent(data: GenerationRequest): Promise<{ title: string; content: string }> {
  console.log("[Generator Stage 1] Generating oversized base content (2200-2400 chars).");
  const systemPrompt = `Ты — опытный копирайтер. Твоя задача — написать "живой" и убедительный текст для карточки товара, основываясь на его преимуществах. ЗАБУДЬ О SEO И КЛЮЧЕВЫХ СЛОВАХ. Сосредоточься на качестве, пользе для клиента и соблюдении объема.`;
  
  const userPrompt = `
ЗАДАЧА: Напиши подробный, качественный текст для товара "${data.productName}", разделенный на 5-7 логических абзацев.
ЦЕЛЕВОЙ ОБЪЕМ: Сгенерируй текст объемом примерно 2000-2400 символов.

ВХОДНЫЕ ДАННЫЕ:
- Отзывы конкурентов (закрой эти боли): ${data.reviews}
- УТП (раскрой все, говоря о выгоде): ${data.usp.join(', ')}

ФОРМАТ ОТВЕТА:
===ЗАГОЛОВОК===
[яркий, привлекательный заголовок]
===ОПИСАНИЕ===
[текст объемом 2200-2400 символов]
`;
try {
  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 1500,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    },
  });
  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseLLMResponse(responseText);
} catch (error) {
  console.error("[Generator Stage 1] FAILED:", error);
  throw new Error(handleGoogleAIError(error).statusMessage);
}
}

// ЭТАП 2: Хирургическое внедрение ключей
async function injectKeywords(baseContent: string, data: GenerationRequest): Promise<string> {
  console.log("[Generator Stage 2] Injecting keywords into base content.");
  const systemPrompt = `Ты — SEO-редактор. Твоя задача — взять готовый текст и АККУРАТНО внедрить в него все ключевые слова из списка. Сохраняй стиль и смысл исходного текста. Не добавляй много новой информации. Твоя цель — чтобы текст после твоих правок прошел SEO-валидацию. Абзацы не должны начинаться с ключевых слов.`;

  const userPrompt = `
ОТРЕДАКТИРУЙ ЭТОТ ТЕКСТ:
---
${baseContent}
---

ОБЯЗАТЕЛЬНО ВНЕДРИ В НЕГО:
1.  **Все обязательные ключи:** ${data.requiredKeywords.join(', ')}. Обязательно следуй тому, чтобы каждое ключевое слово встречалось 1-2 раза. Не используй их больше, чем необходимо. Если несколько ключей используются в качестве названия товара, не используй их в одном предложении и чередуй их между абзацами.
2.  **Используй как можно больше дополнительных ключей:** ${data.optionalKeywords.join(', ')}.

ВАЖНО: Итоговый текст должен быть не сильно длиннее исходного. Постарайся уложиться в 2000 символов.

Верни ТОЛЬКО полный, исправленный текст описания без заголовков и комментариев. Выдели ключевые слова жирным шрифтом.
`;

  try {
    const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    },
  });
  return result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || baseContent;
} catch (error) {
  console.error("[Generator Stage 2] FAILED:", error);
    throw new Error(handleGoogleAIError(error).statusMessage);
}
}


// --- НОВАЯ ГЛАВНАЯ ЛОГИКА ---
async function runGenerationWithValidation(
  data: GenerationRequest
): Promise<GenerationResult> {
  console.log(`[Generator] Starting 'Flexible Frame' generation process...`);
  
  // 1. Генерируем избыточную базу
  const { title, content: oversizedBaseContent } = await generateOverSizedBaseContent(data);

  // 2. "Умная" обрезка каркаса до идеального размера для внедрения
  const BASE_CONTENT_TARGET_LENGTH = 1800;
  const { newContent: baseContentFrame } = intelligentTruncate(oversizedBaseContent, BASE_CONTENT_TARGET_LENGTH, []);
  
  // 3. Внедряем ключи в идеально подогнанный каркас
  let contentWithKeywords = await injectKeywords(baseContentFrame, data);
  
  // 4. Финальная "косметическая" обрезка
  let processingLog: { added: string[], removed: string[] } = { added: [], removed: [] };
  if (contentWithKeywords.length > MAX_CONTENT_LENGTH) {
    const allKeywords = [...data.requiredKeywords, ...data.optionalKeywords];
    const truncationResult = intelligentTruncate(contentWithKeywords, MAX_CONTENT_LENGTH, allKeywords);
    contentWithKeywords = truncationResult.newContent;
    processingLog.removed.push(...truncationResult.removedSentences);
  }

  // 5. Финальная валидация
  console.log("[Generator] Performing final validation...");
  const validationResult = await validator.validate(
    contentWithKeywords,
    data.requiredKeywords,
    data.optionalKeywords
  );
  
  const isSuccess = validationResult.isValid;
  if (isSuccess) {
    console.log("[Generator] Final validation successful.");
  } else {
    console.warn("[Generator] Final validation failed with issues:", validationResult.issues);
  }

  const additionalChecks = checkAdditionalRequirements(contentWithKeywords, data);
  return prepareFinalResult(title, contentWithKeywords, validationResult, additionalChecks, 1, isSuccess, processingLog);
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