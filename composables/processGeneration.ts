// /server/composables/processGeneration.ts

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import type {
  Task,
  GenerationRequest,
  GenerationResult,
  ValidationResult,
  KeywordDetail,
  KeywordInstruction,
} from "~/types";
import { ContentValidator } from "~/server/utils/content-validator";

// --- ИНИЦИАЛИЗАЦИЯ ---
const { geminiApiKey } = useRuntimeConfig();
if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
const validator = new ContentValidator();
const MAX_CONTENT_LENGTH = 2000;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (БЕЗ ИЗМЕНЕНИЙ) ---
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

// --- ЛОГИКА ФОНОВОГО ПРОЦЕССА (БЕЗ ИЗМЕНЕНИЙ) ---
export const repeatFunction = () => {
  const interval = 10000;
  const execute = () => {
    processTask();
    setTimeout(execute, interval);
  };
  setTimeout(execute, interval);
};

// --- ОПТИМИЗИРОВАННАЯ ФУНКЦИЯ РУЧНОЙ КОРРЕКЦИИ ---
export async function runUserRefinement(
  originalContent: string,
  userPrompt: string,
  data: GenerationRequest // Этот объект уже содержит primaryKeywords и secondaryKeywords
): Promise<string> {
  console.log(
    "[Refiner] Starting user refinement step with new rule system..."
  );

  const systemPrompt = `Ты — высокоточный редактор. Твоя задача — взять текст и запрос на изменение, а затем ВНЕСти ТОЛЬКО запрошенное изменение, НЕ НАРУШАЯ исходных правил. Соблюдение правил — твой главный приоритет. Не переписывай весь текст, если этого не просят.`;

  const primaryKeywordInstructions = calculateKeywordInstructions(
    data.primaryKeywords
  );

  // ИСПРАВЛЕНО: Промпт теперь содержит все исходные правила, как при первой генерации
  const userPromptForLLM = `
ЗАДАЧА: Аккуратно отредактируй ИСХОДНЫЙ ТЕКСТ в соответствии с ЗАПРОСОМ ПОЛЬЗОВАТЕЛЯ, при этом СТРОГО СОБЛЮДАЯ все КРИТИЧЕСКИЕ ПРАВИЛА.

--- ИСХОДНЫЙ ТЕКСТ ---
${originalContent}

--- ЗАПРОС ПОЛЬЗОВАТЕЛЯ НА ИЗМЕНЕНИЕ ---
"${userPrompt}"

--- КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА (ДОЛЖНЫ СОБЛЮДАТЬСЯ БЕЗУСЛОВНО) ---

ПРАВИЛО №1: ОБЪЕМ ТЕКСТА
Итоговый текст должен быть объемом СТРОГО от 1800 до 2000 символов. Если запрос пользователя (например, "удали абзац") выводит текст из этих рамок, скорректируй другой "водянистый" текст без ключевых и вводных слов (например, помимо того, благодаря чему и т.п.), чтобы вернуться в диапазон.

ПРАВИЛО №2: КЛЮЧЕВЫЕ СЛОВА
Все ключевые слова из исходного текста должны остаться в финальном тексте.
- Основные ключи:
${primaryKeywordInstructions
  .map((instr) => `- "${instr.keyword}" (должно быть ~${instr.count} раз)`)
  .join("\n")}
- Дополнительные ключи:
${data.secondaryKeywords.map((k) => `- "${k}" (должен быть 1 раз)`).join("\n")}

--- ИНСТРУКЦИЯ ПО ВЫПОЛНЕНИЮ ---
1. Прочитай ИСХОДНЫЙ ТЕКСТ.
2. Прочитай ЗАПРОС ПОЛЬЗОВАТЕЛЯ.
3. Внеси запрошенное изменение.
4. ПРОВЕРЬ, что результат соответствует ПРАВИЛУ №1 и ПРАВИЛУ №2.
5. Верни ТОЛЬКО полный, исправленный текст описания без заголовков и комментариев.

=== ПРОВЕРЬ СЕБЯ ПЕРЕД ВОЗВРАТОМ ===
Проверь: 1) объем текста 1800–2000 символов; 2) все ключевые слова на месте в нужной плотности. Если есть отклонения — исправь перед возвратом результата.
`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash", // или более мощная модель для сложных правок
      contents: [{ role: "user", parts: [{ text: userPromptForLLM }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 768,
        systemInstruction: { parts: [{ text: systemPrompt }] },
      },
    });
    const refinedContent =
      result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (refinedContent) {
      console.log(`[Refiner] Successfully generated refined text.`);
      return refinedContent;
    }
    console.warn(
      `[Refiner] Refinement step generated empty content. Returning original.`
    );
    return originalContent;
  } catch (error) {
    console.error(`[Refiner] FAILED: API error during user refinement.`, error);
    return originalContent;
  }
}

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
        const errorMessage =
          error.message || "Неизвестная критическая ошибка при генерации.";
        await updateTask(task.id, {
          status: "error",
          result: {
            content: errorMessage,
            success: false,
            attempts: 0,
            title: "",
            description: "",
          },
        });
      }
    }
  } catch (error) {
    console.error(
      "[ProcessTask] Failed to fetch or process tasks queue:",
      error
    );
  }
};

export function calculateKeywordInstructions(
  primaryKeywords: string[]
): KeywordInstruction[] {
  const TARGET_DENSITY_CHARS = 1900 * 0.04; // 4% от 1900 символов = 76 символов
  if (primaryKeywords.length === 0) return [];

  const charsPerKeyword = TARGET_DENSITY_CHARS / primaryKeywords.length;

  return primaryKeywords.map((keyword) => {
    const count = Math.max(1, Math.round(charsPerKeyword / keyword.length));
    return { keyword, count };
  });
}

async function generateFinalText(
  data: GenerationRequest
): Promise<{ title: string; content: string }> {
  // ИЗМЕНЕНО: Системный промпт теперь более сфокусирован
  const systemPrompt = `Ты — высокоточный SEO-копирайтер. Твоя главная задача — СТРОГО СЛЕДОВАТЬ ВСЕМ ПРАВИЛАМ И ОГРАНИЧЕНИЯМ, предоставленным пользователем. Несоблюдение правил недопустимо. Твоя цель — сгенерировать текст, который на 100% пройдет валидацию по заданным критериям.`;

  const primaryKeywordInstructions = calculateKeywordInstructions(
    data.primaryKeywords
  );
  const userPrompt = `
  ВНИМАНИЕ: ТЫ ДОЛЖЕН СТРОГО СОБЛЮДАТЬ ВСЕ ПРАВИЛА.

--- ГЛАВНОЕ ПРАВИЛО: ОБЪЕМ ТЕКСТА ---
Текст ОПИСАНИЯ должен быть объемом СТРОГО от 1800 до 2000 символов.

--- ПРАВИЛО №2: ИСПОЛЬЗОВАНИЕ КЛЮЧЕВЫХ СЛОВ ---
Ты должен использовать все ключевые слова. МОЖНО ИЗМЕНЯТЬ ИХ ПАДЕЖ И ФОРМУ, чтобы они гармонично вписывались в текст.

  2.1. ОСНОВНЫЕ КЛЮЧЕВЫЕ СЛОВА:
  ${primaryKeywordInstructions
    .map(
      (instr) =>
        `- Фраза "${instr.keyword}" должна встретиться в тексте не менее **${instr.count} раз(а)**.`
    )
    .join("\n")}

  2.2. ДОПОЛНИТЕЛЬНЫЕ КЛЮЧЕВЫЕ СЛОВА:
  Используй КАЖДУЮ из следующих фраз не менее **ОДНОГО раза**:
  ${data.secondaryKeywords.map((k) => `- "${k}"`).join("\n")}
  
  --- ПРАВИЛО №3: СТИЛЬ ---
  - Пиши "живым" языком, говори о пользе для клиента.
  - Разбей текст на логические абзацы.
  - НЕ начинай предложения с ключевых слов.
  
  --- ИСХОДНЫЕ ДАННЫЕ ДЛЯ ТЕКСТА ---
  - URL товара: ${data.productUrl}
  - Отзывы конкурентов (закрой эти боли и возражения):
  ${data.reviews}
  - УТП (раскрой все, говоря о выгоде для клиента):
  ${data.usp.map((u, i) => `${i + 1}. ${u}`).join("\n")}
  
  --- ФОРМАТ ОТВЕТА (строго соблюдай) ---
  ===ЗАГОЛОВОК===
  [яркий, привлекательный заголовок до 60 символов]
  ===ОПИСАНИЕ===
  [готовый текст описания, соответствующий ВСЕМ правилам]
  
  === ПРОВЕРЬ СЕБЯ ПЕРЕД ВОЗВРАТОМ ===
Проверь: 1) объем текста 1800–2000 символов; 2) все ключевые слова на месте в нужной плотности. Если есть отклонения — исправь перед возвратом результата.
  `;
  // ИЗМЕНЕНО: Промпт стал более директивным и структурированным
  //   const userPrompt = `
  // ЗАДАЧА: Напиши единый, цельный, убедительный и стилистически грамотный текст для товара, СТРОГО СОБЛЮДАЯ ВСЕ ПРАВИЛА НИЖЕ.

  // --- КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА ---

  // ПРАВИЛО №1: ОБЪЕМ ТЕКСТА
  // Итоговый текст ОПИСАНИЯ должен быть объемом СТРОГО от 1800 до 2000 символов. Это самое важное правило. Не генерируй текст короче 1800 или длиннее 2000 символов.

  // ПРАВИЛО №2: ИСПОЛЬЗОВАНИЕ КЛЮЧЕВЫХ СЛОВ
  // Ты должен использовать ключевые слова ТОЧНО так, как указано. Это означает ДОСЛОВНО, БЕЗ ИЗМЕНЕНИЯ ПАДЕЖЕЙ, СЛОВ ИЛИ ПОРЯДКА СЛОВ.

  //   2.1. ОСНОВНЫЕ КЛЮЧЕВЫЕ СЛОВА (для плотности):
  //   Используй следующие фразы ТОЧНОЕ количество раз:
  //   ${primaryKeywordInstructions
  //     .map(
  //       (instr) =>
  //         `- Фраза "${instr.keyword}" должна встретиться в тексте ровно **${instr.count} раз(а)**.`
  //     )
  //     .join("\n")}

  //   2.2. ДОПОЛНИТЕЛЬНЫЕ КЛЮЧЕВЫЕ СЛОВА (для охвата):
  //   Используй КАЖДУЮ из следующих фраз ровно **ОДИН раз**:
  //   ${data.secondaryKeywords.map((k) => `- "${k}"`).join("\n")}

  // ПРАВИЛО №3: СТИЛЬ И ФОРМАТИРОВАНИЕ
  // - Пиши "живым" языком, говори о пользе для клиента.
  // - Разбей текст на логические абзацы.
  // - НЕ начинай предложения с ключевых слов.
  // - Важные для покупателя моменты (не обязательно ключи) выделяй жирным шрифтом (**вот так**).

  // --- ИСХОДНЫЕ ДАННЫЕ ДЛЯ ТЕКСТА ---
  // - URL товара: ${data.productUrl}
  // - Отзывы конкурентов (закрой эти боли и возражения):
  // ${data.reviews}
  // - УТП (раскрой все, говоря о выгоде для клиента):
  // ${data.usp.map((u, i) => `${i + 1}. ${u}`).join("\n")}
  // - Реклама планируется: ${
  //     data.adsPlanned ? "ДА - закончи текст сильным призывом к действию" : "НЕТ"
  //   }

  // --- ФОРМАТ ОТВЕТА (строго соблюдай) ---
  // ===ЗАГОЛОВОК===
  // [яркий, привлекательный заголовок до 60 символов]
  // ===ОПИСАНИЕ===
  // [готовый текст описания, соответствующий ВСЕМ правилам]
  // `;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 768,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    },
  });

  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

  const contentParts = responseText.split("===");
  let title = "";
  let description = "";

  for (let i = 0; i < contentParts.length; i++) {
    if (contentParts[i].includes("ЗАГОЛОВОК") && i + 1 < contentParts.length) {
      title = contentParts[i + 1].trim();
    } else if (
      contentParts[i].includes("ОПИСАНИЕ") &&
      i + 1 < contentParts.length
    ) {
      description = contentParts[i + 1].trim();
    }
  }

  if (!title || !description) {
    console.warn(
      "[Generator] Could not parse LLM response using '===' separators. Using fallback."
    );
    const lines = responseText.trim().split("\n");
    title = lines[0] || "Заголовок не был сгенерирован";
    description = lines.slice(1).join("\n").trim() || responseText;
  }

  return { title, content: description };
}

// --- ФУНКЦИЯ КОРРЕКЦИИ (ПОПЫТКА 2) С ОПТИМИЗИРОВАННЫМ ПРОМПТОМ ---
async function runCorrection(
  originalContent: string,
  issues: string[],
  data: GenerationRequest
): Promise<string> {
  console.log("[Corrector] Starting correction step with optimized prompts...");
  const systemPrompt = `Ты — редактор-эксперт. Твоя задача — взять текст, список КОНКРЕТНЫХ ошибок и набор КОНКРЕТНЫХ правил, а затем аккуратно переписать текст, исправляя ТОЛЬКО указанные ошибки и не нарушая правил. Сохраняй стиль и смысл.`;

  // ИЗМЕНЕНО: Передаем те же самые четкие инструкции и в корректор
  const primaryKeywordInstructions = calculateKeywordInstructions(
    data.primaryKeywords
  );

  const userPrompt = `ИСПРАВЬ ЭТОТ ТЕКСТ:

=== ИСХОДНЫЙ ТЕКСТ ===
${originalContent}

=== КОНКРЕТНЫЕ ОШИБКИ, КОТОРЫЕ НУЖНО ИСПРАВИТЬ ===
${issues.join("\n")}

=== КЛЮЧЕВЫЕ ПРАВИЛА, КОТОРЫЕ ДОЛЖНЫ СОБЛЮДАТЬСЯ В ИТОГОВОМ ТЕКСТЕ ===
1.  **ОБЪЕМ:** СТРОГО от 1800 до 2000 символов. Если текст слишком короткий - дополни его, сохраняя смысл. Если слишком длинный - аккуратно сократи, не теряя ключевые фразы.
2.  **ОСНОВНЫЕ КЛЮЧИ:**
  ${primaryKeywordInstructions
    .map(
      (instr) =>
        `- "${instr.keyword}": должно быть использовано **${instr.count} раз(а)**.`
    )
    .join("\n")}
3.  **ДОПОЛНИТЕЛЬНЫЕ КЛЮЧИ:**
  Каждая из этих фраз должна присутствовать в тексте **ровно 1 раз**:
  ${data.secondaryKeywords.map((k) => `- "${k}"`).join("\n")}

=== ЗАДАЧА ===
Перепиши исходный текст, чтобы исправить ошибки и выполнить ВСЕ правила. Верни ТОЛЬКО исправленный текст описания без заголовков.

=== ПРОВЕРЬ СЕБЯ ПЕРЕД ВОЗВРАТОМ ===
Проверь: 1) объем текста 1800–2000 символов; 2) все ключевые слова на месте в нужной плотности. Если есть отклонения — исправь перед возвратом результата.`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        temperature: 0.5,
        maxOutputTokens: 768,
        systemInstruction: { parts: [{ text: systemPrompt }] },
      },
    });
    const correctedContent =
      result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (correctedContent) {
      console.log(`[Corrector] Successfully generated corrected text.`);
      return correctedContent;
    }
    console.warn(
      `[Corrector] Correction step generated empty content. Returning original.`
    );
    return originalContent;
  } catch (error) {
    console.error(`[Corrector] FAILED: API error during correction.`, error);
    return originalContent;
  }
}

// --- ОБНОВЛЕННАЯ ГЛАВНАЯ ЛОГИКА С ДВУХСТУПЕНЧАТЫМ КОНВЕЙЕРОМ (БЕЗ ИЗМЕНЕНИЙ) ---
async function runGenerationWithValidation(
  data: GenerationRequest
): Promise<GenerationResult> {
  console.log(`[Generator] Starting unified generation process...`);

  console.log("[Generator] Attempt 1: Generating initial text.");
  const { title, content } = await generateFinalText(data);
  const validationInstructions = calculateKeywordInstructions(
    data.primaryKeywords
  );
  const firstValidationResult = await validator.validate(
    content,
    validationInstructions,
    data.secondaryKeywords
  );

  if (firstValidationResult.isValid) {
    console.log("[Generator] Attempt 1 SUCCEEDED. Validation passed.");
    const additionalChecks = checkAdditionalRequirements(content, data);
    return prepareFinalResult(
      title,
      content,
      firstValidationResult,
      additionalChecks,
      1,
      true
    );
  }

  console.warn(
    `[Generator] Attempt 1 FAILED. Issues:`,
    firstValidationResult.issues
  );
  console.log("[Generator] Attempt 2: Starting correction process.");

  const correctedContent = await runCorrection(
    content,
    firstValidationResult.issues,
    data
  );
  const secondValidationResult = await validator.validate(
    correctedContent,
    validationInstructions,
    data.secondaryKeywords
  );

  const isSuccess = secondValidationResult.isValid;
  if (isSuccess) {
    console.log("[Generator] Attempt 2 SUCCEEDED. Correction was successful.");
  } else {
    console.warn(
      "[Generator] Attempt 2 FAILED. Text still has issues after correction:",
      secondValidationResult.issues
    );
  }

  const additionalChecks = checkAdditionalRequirements(correctedContent, data);
  return prepareFinalResult(
    title,
    correctedContent,
    secondValidationResult,
    additionalChecks,
    2,
    isSuccess
  );
}

// --- ФУНКЦИЯ ПОДГОТОВКИ РЕЗУЛЬТАТА (БЕЗ ИЗМЕНЕНИЙ) ---
// --- ФУНКЦИЯ ПОДГОТОВКИ РЕЗУЛЬТАТА (ИСПРАВЛЕНА) ---
export function prepareFinalResult(
  title: string,
  content: string,
  validation: ValidationResult,
  additionalChecks: { issues: string[]; checks: any },
  attempts: number,
  success: boolean,
  processingLog: { added: string[]; removed: string[] } = {
    added: [],
    removed: [],
  }
): GenerationResult {
  // 1. Вычисляем keywordDetails, как и раньше
  const keywordDetails: KeywordDetail[] = [];
  const keywordUsage = validation.metrics.keywordUsageDetails || {};

  for (const [keyword, details] of Object.entries(keywordUsage)) {
    // @ts-ignore
    const count = details.count || 0;
    const example = findKeywordExample(content, keyword); // findKeywordExample должна быть доступна в этой области видимости
    keywordDetails.push({ keyword, count, example });
  }

  const finalContent = `**${title}**\n\n${content}`;

  // 2. ИСПРАВЛЕНО: Создаем объект GenerationResult с правильной структурой метрик
  const result: GenerationResult = {
    success,
    content: finalContent,
    title,
    description: content,
    // Метрики теперь включают ВСЕ необходимые поля, как того требует Zod-схема
    metrics: {
      ...validation.metrics, // Сначала копируем все базовые метрики из валидатора
      keywordDetails: keywordDetails, // Добавляем keywordDetails ВНУТРЬ metrics
      boldKeywordsCount: additionalChecks.checks.boldKeywords, // Добавляем boldKeywordsCount ВНУТРЬ metrics
      utpCovered: additionalChecks.checks.utpCovered,
      painPointsAddressed: additionalChecks.checks.painPointsAddressed,
      trustTriggers: additionalChecks.checks.trustTriggers,
    },
    attempts,
    processingLog,
  };

  if (!success) {
    result.warnings = validation.issues;
  }

  return result;
}
