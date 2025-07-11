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


const { geminiApiKey } = useRuntimeConfig();
if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
const validator = new ContentValidator();
const MAX_CONTENT_LENGTH = 2000;


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


export const repeatFunction = () => {
  const interval = 10000;
  const execute = () => {
    processTask();
    setTimeout(execute, interval);
  };
  setTimeout(execute, interval);
};


export async function runUserRefinement(
  originalContent: string,
  userPrompt: string,
  data: GenerationRequest
): Promise<string> {
  console.log(
    "[Refiner] Starting user refinement step with new rule system..."
  );

  const systemPrompt = `Ты — высокоточный редактор. Твоя задача — взять текст и запрос на изменение, а затем ВНЕСти ТОЛЬКО запрошенное изменение, НЕ НАРУШАЯ исходных правил. Соблюдение правил — твой главный приоритет. Не переписывай весь текст, если этого не просят.`;

  const primaryKeywordInstructions = calculateKeywordInstructions(
    data.primaryKeywords
  );


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
      model: "gemini-2.0-flash",
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
  const systemPrompt = `Ты — высокоточный SEO-копирайтер. Твоя главная задача — СТРОГО СЛЕДОВАТЬ ВСЕМ ПРАВИЛАМ И ОГРАНИЧЕНИЯМ, предоставленным пользователем. Несоблюдение правил недопустимо. Твоя цель — сгенерировать текст, который на 100% пройдет валидацию по заданным критериям.`;

  const primaryKeywordInstructions = calculateKeywordInstructions(
    data.primaryKeywords
  );
  const userPrompt = `
=== ВАЖНО ===
Соблюдай ВСЕ ПРАВИЛА без исключений. Нарушение даже одного из них считается ошибкой.

=== ПРАВИЛО №1: ОБЪЕМ ===
Напиши текст от 1800 до 2000 символов (включая пробелы). Не считай символы вручную — просто следи, чтобы он не был слишком коротким или слишком длинным. При необходимости сократи или дополни «водой», не затрагивая ключевые слова.

Структура:
- Ровно **6 абзацев**
- Каждый абзац по **2–4 предложения**
- Предложения должны быть разной длины

=== ПРАВИЛО №2: КЛЮЧЕВЫЕ СЛОВА ===
В тексте ОБЯЗАНЫ присутствовать все ключевые слова.

**Основные ключевые фразы** (в нужной плотности):
${primaryKeywordInstructions
  .map((instr) => `- "${instr.keyword}" — не менее ${instr.count} раз`).join("\n")}

**Дополнительные ключи** (каждый — ровно 1 раз):
${data.secondaryKeywords.map((k) => `- "${k}"`).join("\n")}

Можно изменять падежи и формы, но нельзя убирать фразы полностью.

=== ПРАВИЛО №3: СТИЛЬ ===
- Пиши живым, убедительным языком
- Используй простой и ясный стиль
- НЕ начинай предложения с ключевых фраз
- Показывай выгоды для клиента
- Не повторяй одни и те же конструкции

=== ВХОДНЫЕ ДАННЫЕ ===
- URL товара: ${data.productUrl}
- Отзывы конкурентов (учти и закрой боли):
${data.reviews}
- Уникальные торговые предложения (раскрой их через пользу для клиента):
${data.usp.map((u, i) => `${i + 1}. ${u}`).join("\n")}

=== ФОРМАТ ОТВЕТА ===
===ЗАГОЛОВОК===
[Краткий, привлекательный заголовок до 60 символов]
===ОПИСАНИЕ===
[Текст, строго соблюдающий ВСЕ правила]

=== ПРОВЕРКА ПЕРЕД ВОЗВРАТОМ ===
Проверь: 
1. Объем 1800–2000 символов
2. Есть все ключевые слова с нужной частотой
3. Ровно 6 абзацев
4. Абзацы читаются естественно
5. Стиль соответствует инструкциям
`;

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


async function runCorrection(
  originalContent: string,
  issues: string[],
  data: GenerationRequest
): Promise<string> {
  console.log("[Corrector] Starting correction step with optimized prompts...");
  const systemPrompt = `Ты — редактор-эксперт. Твоя задача — взять текст, список КОНКРЕТНЫХ ошибок и набор КОНКРЕТНЫХ правил, а затем аккуратно переписать текст, исправляя ТОЛЬКО указанные ошибки и не нарушая правил. Сохраняй стиль и смысл.`;


  const primaryKeywordInstructions = calculateKeywordInstructions(
    data.primaryKeywords
  );

  const userPrompt = `
=== ЗАДАЧА ===
Перепиши ИСХОДНЫЙ ТЕКСТ, исправив ТОЛЬКО указанные ошибки. Не меняй остальное. Соблюдай правила и стиль.

=== ИСХОДНЫЙ ТЕКСТ ===
${originalContent}

=== КОНКРЕТНЫЕ ОШИБКИ, КОТОРЫЕ НУЖНО ИСПРАВИТЬ ===
${issues.join("\n")}

=== ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ===

1. **ОБЪЕМ**
- Текст должен быть от 1800 до 2000 символов
- Ровно 6 абзацев
- Каждый абзац — 2–4 предложения
- Естественный ритм и разнообразная длина предложений
- При необходимости дополни или сократи "водой", не убирая ключей

2. **КЛЮЧЕВЫЕ СЛОВА**

**Основные ключи**:
${primaryKeywordInstructions
  .map((instr) => `- "${instr.keyword}" — не менее ${instr.count} раз`).join("\n")}

**Дополнительные ключи**:
${data.secondaryKeywords.map((k) => `- "${k}" — ровно 1 раз`).join("\n")}

Разрешено менять падежи и формы.

3. **СТИЛЬ**
- Язык — живой и убедительный
- Избегай сухих, канцелярских фраз
- Не начинай предложения с ключей
- Не повторяй одни и те же конструкции

=== ВАЖНО ===
Нельзя переписывать весь текст, если это не требуется. Правь только то, что указано в списке ошибок.

=== ПРОВЕРКА ПЕРЕД ВОЗВРАТОМ ===
Проверь:
1. Объем в допустимых границах
2. Все ключи присутствуют в нужной плотности
3. Ровно 6 абзацев, 2–4 предложения каждый
4. Текст читается естественно
5. Стиль соответствует требованиям
`;

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
  const keywordDetails: KeywordDetail[] = [];
  const keywordUsage = validation.metrics.keywordUsageDetails || {};

  for (const [keyword, details] of Object.entries(keywordUsage)) {
    const count = details.count || 0;
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
  };

  if (!success) {
    result.warnings = validation.issues;
  }

  return result;
}
