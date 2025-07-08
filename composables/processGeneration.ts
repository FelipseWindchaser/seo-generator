// /server/composables/processGeneration.ts

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import type { Task, GenerationRequest, GenerationResult, ValidationResult, KeywordDetail } from '~/types';
import { ContentValidator } from '~/server/utils/content-validator';
import { createHash } from 'crypto';

// --- ИНИЦИАЛИЗАЦИЯ ---
const { geminiApiKey } = useRuntimeConfig();
if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not set');
const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
const validator = new ContentValidator();
const MAX_CONTENT_LENGTH = 2000;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (БЕЗ ИЗМЕНЕНИЙ) ---
function escapeRegex(string: string): string { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function findKeywordExample(content: string, keyword: string): string {
  const contentLower = content.toLowerCase();
  const searchKeyword = keyword.split(' ')[0];
  const pos = contentLower.indexOf(searchKeyword.toLowerCase());
  if (pos === -1) return "Пример не найден";
  const start = Math.max(0, pos - 30);
  const end = Math.min(content.length, pos + keyword.length + 30);
  let example = content.slice(start, end);
  if (start > 0) example = "..." + example;
  if (end < content.length) example = example + "...";
  return example.replace(new RegExp(escapeRegex(keyword), 'ig'), (match) => `<strong>${match}</strong>`);
}

function checkAdditionalRequirements(content: string, data: GenerationRequest): { issues: string[]; checks: any } {
  return { issues: [], checks: { boldKeywords: (content.match(/\*\*/g) || []).length / 2, utpCovered: 0, painPointsAddressed: 0, trustTriggers: 0 } };
}

// --- ЛОГИКА ФОНОВОГО ПРОЦЕССА (БЕЗ ИЗМЕНЕНИЙ) ---
export const repeatFunction = () => {
  const interval = 30000;
  const execute = () => { processTask(); setTimeout(execute, interval); };
  setTimeout(execute, interval);
};

export async function runUserRefinement(
  originalContent: string, 
  userPrompt: string, 
  data: GenerationRequest
): Promise<string> {
    console.log('[Refiner] Starting user refinement step...');
    const systemPrompt = `Ты — редактор-эксперт и лингвист. Твоя задача — взять готовый текст, запрос пользователя на изменение и полный набор исходных SEO-правил, а затем аккуратно переписать текст, чтобы он удовлетворял запросу пользователя, но при этом продолжал соответствовать ВСЕМ исходным правилам.
- Сохраняй основной смысл и стиль исходного текста, если пользователь не просит иного.
- Твоя цель — идеальный текст, который понравится пользователю и пройдет валидацию.`;

    const userPromptForLLM = `ИСПРАВЬ ЭТОТ ТЕКСТ:

=== ИСХОДНЫЙ ТЕКСТ ===
${originalContent}

=== ЗАПРОС ПОЛЬЗОВАТЕЛЯ НА ИЗМЕНЕНИЕ ===
"${userPrompt}"

=== КЛЮЧЕВЫЕ ПРАВИЛА, КОТОРЫЕ ДОЛЖНЫ СОБЛЮДАТЬСЯ В ИТОГОВОМ ТЕКСТЕ ===
1.  **ПОЛНЫЙ СПИСОК КЛЮЧЕВЫХ СЛОВ (используй все):**
${data.keywords.map(k => `- "${k}"`).join('\n')}
2.  КРИТИЧЕСКИ ВАЖНО!!! **ОБЪЕМ ТЕКСТА (соблюдай строго):** от 1800 до 2000 символов.
3.  **ПЛОТНОСТЬ КЛЮЧЕВЫХ СЛОВ (соблюдай строго):** от 3% до 5%.
4.  **СТИЛЬ:** Избегай начинать предложения с ключевых слов, пиши естественно. Ключевые слова должны гармонично вписываться в текст и не выделяться кавычками или другими символами.
5. **КЛЮЧЕВЫЕ СЛОВА:** Не используй ключевые слова в кавычках, не используй слова, похожие на предмет описания. Например, если речь идет о соковыжималке, не используй слово "блендер". Обязательно используй все ключевые слова.

=== ЗАДАЧА ===
Аккуратно перепиши исходный текст, чтобы он соответствовал запросу пользователя и при этом не нарушал НИ ОДНОГО из ключевых правил. Верни ТОЛЬКО полный, исправленный текст описания без заголовков и комментариев.`;

    try {
        const result = await genAI.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ text: userPromptForLLM }] }],
            config: {
                temperature: 0.6, // Чуть ниже температура для более предсказуемого редактирования
                maxOutputTokens: 4096,
                systemInstruction: { parts: [{ text: systemPrompt }] }
            },
        });
        const refinedContent = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (refinedContent) {
            console.log(`[Refiner] Successfully generated refined text.`);
            return refinedContent;
        }
        console.warn(`[Refiner] Refinement step generated empty content. Returning original.`);
        return originalContent;
    } catch (error) {
        console.error(`[Refiner] FAILED: API error during user refinement.`, error);
        return originalContent;
    }
}

const processTask = async () => {
  console.log(`[ProcessTask] Checking for new tasks at ${new Date().toLocaleTimeString()}`);
  try {
    const tasks: Task[] = await getProcessingTasks();
    if (tasks.length === 0) return;
    console.log(`[ProcessTask] Found ${tasks.length} tasks to process.`);
    for await (const task of tasks) {
      if (!task.request) {
        await updateTask(task.id, { status: "error", result: { content: "Ошибка: отсутствуют данные для запроса.", success: false, attempts: 0, title: '', description: '' } });
        continue;
      }
      try {
        const result = await runGenerationWithValidation(task.request);
        await updateTask(task.id, { status: "completed", result });
      } catch (error: any) {
        console.error(`[ProcessTask] CRITICAL ERROR during generation for task ${task.id}:`, error);
        const errorMessage = error.message || "Неизвестная критическая ошибка при генерации.";
        await updateTask(task.id, { status: "error", result: { content: errorMessage, success: false, attempts: 0, title: '', description: '' } });
      }
    }
  } catch (error) {
    console.error('[ProcessTask] Failed to fetch or process tasks queue:', error);
  }
};

// --- ОСНОВНАЯ ГЕНЕРАЦИЯ (ПОПЫТКА 1) С УЛУЧШЕННЫМ ПРОМПТОМ ---
async function generateFinalText(data: GenerationRequest): Promise<{ title: string; content: string }> {
  const systemPrompt = `Ты - опытный SEO-копирайтер и лингвист. Твоя задача — написать "живой", естественный и полностью оптимизированный текст для карточки товара.
Твои принципы:
- Польза, а не фичи: Говори о том, что товар ДАЕТ покупателю, а не просто о том, что в нем ЕСТЬ.
- Структура: Текст должен быть разбит на логические абзацы для удобства чтения.
- **Разнообразие конструкций:** Избегай начинать предложения с ключевых слов. Не используй их как подлежащее (кто? что?), а вплетай в другие части предложения, чтобы избежать тавтологии и сделать текст естественным.
- Выделение: Самые важные ключевые фразы или их части выделяй жирным шрифтом (**вот так**).
- ВАЖНО: Речь идет о товаре, доступном по ссылке ${data.productUrl}, а не о каком-либо другом. Не используй смежные слова, похожие на продукт из ключевых слов. Например, если речь идет о соковыжималке, не используй слово "блендер".
НЕЛЬЗЯ генерировать текст, который будет меньше 1800 символов или больше 2000 символов и НЕЛЬЗЯ упускать уникальные ключевые слова.
- КРИТИЧЕСКИ ВАЖНО: Ты всегда строго соблюдаешь заданные ограничения по объему и плотности, при этом объем текста приоритетнее плотности.`;

  const userPrompt = `Создай продающее описание для товара по ссылке ${data.productUrl}.

ЗАДАЧА: Напиши единый, цельный, убедительный и стилистически грамотный текст.

ВХОДНЫЕ ДАННЫЕ:
- URL товара: ${data.productUrl}
- Отзывы конкурентов (закрой эти боли и возражения):
${data.reviews}
- УТП (раскрой все, говоря о выгоде для клиента):
${data.usp.map((u, i) => `${i + 1}. ${u}`).join('\n')}
- Реклама планируется: ${data.adsPlanned ? 'ДА - закончи текст сильным призывом к действию' : 'НЕТ'}

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ (ВЫПОЛНИТЬ СТРОГО):
1.  **КЛЮЧЕВЫЕ СЛОВА:** Обязательно используй в тексте ВСЕ следующие ключевые фразы ЦЕЛИКОМ, БЕЗ ИЗМЕНЕНИЙ И В ТОЧНОЙ ФОРМУЛИРОВКЕ.
${data.keywords.map(k => `- "${k}"`).join('\n')}
2.  **ОБЪЕМ:** КРИТИЧЕСКИ ВАЖНО! Итоговый текст ОПИСАНИЯ должен быть объемом СТРОГО от 1800 до 2000 символов.
3.  **ПЛОТНОСТЬ КЛЮЧЕВЫХ СЛОВ:** Итоговая плотность ключевых слов должна быть в диапазоне 3-5%.

ФОРМАТ ОТВЕТА (строго соблюдай):
===ЗАГОЛОВОК===
[яркий, привлекательный заголовок до 60 символов]
===ОПИСАНИЕ===
[готовый текст описания, соответствующий всем требованиям по ключам, объему и плотности]`;
  
  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      safetySettings: [ { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }, { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE }, { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }, { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }, ],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    },
  });

  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  const contentParts = responseText.split('===');
  let title = "";
  let description = "";
  
  for (let i = 0; i < contentParts.length; i++) {
      if (contentParts[i].includes('ЗАГОЛОВОК') && i + 1 < contentParts.length) {
          title = contentParts[i + 1].trim();
      } else if (contentParts[i].includes('ОПИСАНИЕ') && i + 1 < contentParts.length) {
          description = contentParts[i + 1].trim();
      }
  }
  
  if (!title || !description) {
      console.warn("[Generator] Could not parse LLM response using '===' separators. Using fallback.");
      const lines = responseText.trim().split('\n');
      title = lines[0] || "Заголовок не был сгенерирован";
      description = lines.slice(1).join('\n').trim() || responseText;
  }
  
  return { title, content: description };
}

// --- ОБНОВЛЕННАЯ ФУНКЦИЯ КОРРЕКЦИИ (ПОПЫТКА 2) С УЛУЧШЕННЫМ ПРОМПТОМ ---
async function runCorrection(originalContent: string, issues: string[], data: GenerationRequest): Promise<string> {
    console.log('[Corrector] Starting correction step with full context...');
    const systemPrompt = `Ты — редактор-эксперт и лингвист. Твоя задача — взять готовый текст, список ошибок и полный набор исходных правил, а затем аккуратно переписать текст, чтобы он соответствовал ВСЕМ правилам, исправляя указанные ошибки.
- Сохраняй основной смысл и стиль исходного текста.
- **Разнообразие конструкций:** Избегай начинать предложения с ключевых слов. Не используй их как подлежащее (кто? что?), а вплетай в другие части предложения, чтобы избежать тавтологии и сделать текст естественным.
- Твоя цель — сделать текст полностью соответствующим требованиям.`;

    const userPrompt = `ИСПРАВЬ ЭТОТ ТЕКСТ:

=== ИСХОДНЫЙ ТЕКСТ ===
${originalContent}

=== ОШИБКИ, КОТОРЫЕ НУЖНО ИСПРАВИТЬ ===
${issues.join('\n')}

=== КЛЮЧЕВЫЕ ПРАВИЛА, КОТОРЫЕ ДОЛЖНЫ СОБЛЮДАТЬСЯ В ИТОГОВОМ ТЕКСТЕ ===
1.  **ПОЛНЫЙ СПИСОК КЛЮЧЕВЫХ СЛОВ (используй все):**
${data.keywords.map(k => `- "${k}"`).join('\n')}
2.  КРИТИЧЕСКИ ВАЖНО!!! **ОБЪЕМ ТЕКСТА (соблюдай строго):** от 1800 до 2000 символов.
Если объем текста меньше, то добавь текст, чтобы он был оказался в диапазоне от 1800 до 2000 символов. Если объем текста больше, то удали текст, чтобы он оказался в диапазоне от 1800 до 2000 символов, сохраняя ключевые слова. Можно удалить ключевые слова, если они уже повторяются в тексте и конечное количество ключевых слов останется равным 10.
3.  **ПЛОТНОСТЬ КЛЮЧЕВЫХ СЛОВ (соблюдай строго):** от 3% до 5%.

=== ЗАДАЧА ===
Аккуратно перепиши исходный текст так, чтобы он больше не содержал перечисленных ошибок и при этом соответствовал ВСЕМ ключевым правилам, включая стилистические. Верни ТОЛЬКО полный, исправленный текст описания без заголовков и комментариев.`;

    try {
        const result = await genAI.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                temperature: 0.5,
                maxOutputTokens: 4096,
                systemInstruction: { parts: [{ text: systemPrompt }]
              }
            },
        });
        const correctedContent = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (correctedContent) {
            console.log(`[Corrector] Successfully generated corrected text.`);
            return correctedContent;
        }
        console.warn(`[Corrector] Correction step generated empty content. Returning original.`);
        return originalContent;
    } catch (error) {
        console.error(`[Corrector] FAILED: API error during correction.`, error);
        return originalContent;
    }
}

// --- ОБНОВЛЕННАЯ ГЛАВНАЯ ЛОГИКА С ДВУХСТУПЕНЧАТЫМ КОНВЕЙЕРОМ (БЕЗ ИЗМЕНЕНИЙ) ---
async function runGenerationWithValidation(data: GenerationRequest): Promise<GenerationResult> {
  console.log(`[Generator] Starting unified generation process...`);
  
  console.log('[Generator] Attempt 1: Generating initial text.');
  const { title, content } = await generateFinalText(data);
  const firstValidationResult = await validator.validate(content, data.keywords);

  if (firstValidationResult.isValid) {
    console.log('[Generator] Attempt 1 SUCCEEDED. Validation passed.');
    const additionalChecks = checkAdditionalRequirements(content, data);
    return prepareFinalResult(title, content, firstValidationResult, additionalChecks, 1, true);
  }

  console.warn(`[Generator] Attempt 1 FAILED. Issues:`, firstValidationResult.issues);
  console.log('[Generator] Attempt 2: Starting correction process.');
  
  const correctedContent = await runCorrection(content, firstValidationResult.issues, data);
  const secondValidationResult = await validator.validate(correctedContent, data.keywords);
  
  const isSuccess = secondValidationResult.isValid;
  if (isSuccess) {
    console.log('[Generator] Attempt 2 SUCCEEDED. Correction was successful.');
  } else {
    console.warn('[Generator] Attempt 2 FAILED. Text still has issues after correction:', secondValidationResult.issues);
  }

  const additionalChecks = checkAdditionalRequirements(correctedContent, data);
  return prepareFinalResult(title, correctedContent, secondValidationResult, additionalChecks, 2, isSuccess);
}


// --- ФУНКЦИЯ ПОДГОТОВКИ РЕЗУЛЬТАТА (БЕЗ ИЗМЕНЕНИЙ) ---
function prepareFinalResult(
  title: string,
  content: string,
  validation: ValidationResult,
  additionalChecks: { issues: string[]; checks: any },
  attempts: number,
  success: boolean,
  processingLog: { added: string[], removed: string[] } = { added: [], removed: [] }
): GenerationResult {
  const keywordDetails: KeywordDetail[] = [];
  const keywordUsage = validation.metrics.keywordUsageDetails || {};

  for (const [keyword, details] of Object.entries(keywordUsage)) {
      // @ts-ignore
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
          keywordDetails,
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