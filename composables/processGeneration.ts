import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import type { Task, GenerationRequest, GenerationResult, ValidationResult, KeywordDetail } from '~/types';
import { ContentValidator } from '~/server/utils/content-validator';

// --- ИНИЦИАЛИЗАЦИЯ ЗАВИСИМОСТЕЙ ---

const { geminiApiKey } = useRuntimeConfig();
console.log('geminiApiKey', geminiApiKey);
if (!geminiApiKey) {
  throw new Error('GEMINI_API_KEY is not set in server runtime config');
}

const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
const validator = new ContentValidator();

// --- ЛОГИКА ФОНОВОГО ПРОЦЕССА ---

export const repeatFunction = () => {
  const interval = 10000; // 30 секунд

  const execute = () => {
    processTask();
    setTimeout(execute, interval);
  };
  
  // Запускаем первый вызов
  setTimeout(execute, interval);
};

const processTask = async () => {
  console.log(`[ProcessTask] Checking for new tasks at ${new Date().toLocaleTimeString()}`);
  
  try {
    const tasks: Task[] = await getProcessingTasks();
    if (tasks.length === 0) {
      console.log('[ProcessTask] No tasks to process.');
      return;
    }

    console.log(`[ProcessTask] Found ${tasks.length} tasks to process.`);
    for await (const task of tasks) {
      if (!task.request) {
        console.error(`[ProcessTask] Task ${task.id} has no request data. Skipping.`);
        await updateTask(task.id, { status: "error", result: { content: "Ошибка: отсутствуют данные для запроса.", success: false, attempts: 0, title: '', description: '' } });
        continue;
      }

      try {
        console.log(`[ProcessTask] Starting generation for task ${task.id}`);
        const result = await runGenerationWithValidation(task.request);
        
        console.log(`[ProcessTask] Generation for task ${task.id} finished. Success: ${result.success}`);
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

// --- ЛОГИКА ГЕНЕРАЦИИ И ВАЛИДАЦИИ (Упрощено до 1 попытки) ---

async function runGenerationWithValidation(data: GenerationRequest): Promise<GenerationResult> {
  console.log(`[Generator] Starting single generation attempt for product: ${data.productUrl}`);

  // Шаг 1: Первичная генерация
  const { title: currentTitle, content: currentContent } = await generateInitial(data);

  // Шаг 2: Валидация
  const validationResult = await validator.validate(currentContent, data.keywords);
  const additionalChecks = checkAdditionalRequirements(currentContent, data);
  
  const allIssues = [...validationResult.issues, ...additionalChecks.issues];
  
  // Шаг 3: Определение результата и его подготовка
  const isSuccess = allIssues.length === 0;

  if (isSuccess) {
    console.log(`[Generator] Validation successful.`);
  } else {
    console.warn(`[Generator] Validation failed with issues:`, allIssues);
  }
  
  // Обновляем issues в объекте validationResult для корректной передачи в prepareFinalResult
  validationResult.issues = allIssues;

  const finalResult = prepareFinalResult(
    currentTitle,
    currentContent,
    validationResult,
    additionalChecks,
    1, // Количество попыток всегда 1
    isSuccess
  );

  return finalResult;
}


async function generateInitial(data: GenerationRequest): Promise<{ title: string; content: string }> {
  const systemPrompt = `Ты - эксперт по созданию SEO-оптимизированных описаний для Wildberries. Твоя задача - создать текст, который будет максимально релевантен поисковым запросам и привлекателен для покупателей. Следуй всем жестким требованиям и структуре.`;
  const userPrompt = `Создай SEO-описание для товара, следуя ВСЕМ требованиям.

ВХОДНЫЕ ДАННЫЕ:
- URL товара: ${data.productUrl}
- Ключевые фразы (ИСПОЛЬЗУЙ ВСЕ, выделяй **жирным**):
${data.keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}
- Отзывы конкурентов (закрой эти боли):
${data.reviews}
- УТП (раскрой все):
${data.usp.map((u, i) => `${i + 1}. ${u}`).join('\n')}
- Реклама планируется: ${data.adsPlanned ? 'ДА - добавь призывы к действию' : 'НЕТ'}
- Можно менять визуалы: ${data.canChangeVisuals ? 'ДА - можно упомянуть дизайн' : 'НЕТ'}

ФОРМАТ ОТВЕТА:
===ЗАГОЛОВОК===
[заголовок до 60 символов]
===ОПИСАНИЕ===
[описание 1800-2000 символов с **выделенными** ключами]`;

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 4000,
      safetySettings: [{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },],
    },
  });

  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  console.debug('[Generator] Initial response from LLM:', responseText);
  return parseLLMResponse(responseText || '');
}

/**
 * Эта функция больше не используется в текущей логике, но оставлена на случай,
 * если вы захотите вернуть цикл исправлений в будущем.
 */
async function fixContent(
  title: string,
  content: string,
  validation: ValidationResult,
  data: GenerationRequest
): Promise<{ title: string; content: string }> {
  console.warn("[Generator] fixContent function was called, but it should be disabled in single-attempt mode.");
  const systemPrompt = `Ты - эксперт по доработке SEO-текстов для Wildberries. Исправь текст ТОЧНО по инструкциям, сохранив стиль и основную структуру. Не меняй то, что уже хорошо.`;
  const userPrompt = `Доработай описание, исправив ВСЕ проблемы:

ИНСТРУКЦИИ ПО ИСПРАВЛЕНИЮ:
${validation.issues.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}
КРИТИЧЕСКИ ВАЖНОЕ ПРАВИЛО: Итоговый текст должен быть СТРОГО в диапазоне 1800-2000 символов. Это самая главная задача. Добейся этого, даже если придется переписать целые абзацы.

ТЕКУЩИЕ МЕТРИКИ:
- Символов: ${validation.metrics.charCount} (нужно 1800-2000)
- Ключей использовано: ${validation.metrics.keywordsUsed}/${data.keywords.length}
- Плотность: ${validation.metrics.keywordDensity}% (нужно 3-5%)

ЗАГОЛОВОК (не меняй):
${title}

ТЕКСТ ДЛЯ ДОРАБОТКИ:
${content}

ФОРМАТ ОТВЕТА (только описание, без заголовка):
===ОПИСАНИЕ===
[исправленное описание с **выделенными** ключами]`;

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 4000,
      safetySettings: [{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },],
    },
  });
  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;

  console.debug('[Generator] Fix response from LLM:', responseText);

  let description = responseText;
  if (responseText && responseText.includes('===ОПИСАНИЕ===')) {
    description = responseText.split('===ОПИСАНИЕ===')[1].trim();
  }
  
  return { title, content: description || '' };
}


// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function parseLLMResponse(responseText: string): { title: string; content: string } {
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
      console.warn("[Parser] LLM response did not contain expected separators. Using fallback parsing.");
      const lines = responseText.trim().split('\n');
      title = lines[0] || "Заголовок не был сгенерирован";
      description = lines.slice(1).join('\n').trim() || responseText;
  }
  
  return { title, content: description };
}

function prepareFinalResult(
  title: string,
  content: string,
  validation: ValidationResult,
  additionalChecks: { issues: string[]; checks: any },
  attempts: number,
  success: boolean = true
): GenerationResult {
  const keywordDetails: KeywordDetail[] = [];
  const keywordUsage = validation.metrics.keywordUsageDetails || {};

  for (const [keyword, count] of Object.entries(keywordUsage)) {
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
          utpCovered: additionalChecks.checks.utpMentioned,
          painPointsAddressed: additionalChecks.checks.painPointsAddressed,
          trustTriggers: additionalChecks.checks.trustTriggers,
      },
      attempts,
  };

  if (!success) {
    result.warnings = validation.issues;
  }
  return result;
}

function findKeywordExample(content: string, keyword: string): string {
  const contentLower = content.toLowerCase();
  const keywordLower = keyword.toLowerCase();
  const pos = contentLower.indexOf(keywordLower);

  if (pos === -1) return "Пример не найден";

  const start = Math.max(0, pos - 25);
  const end = Math.min(content.length, pos + keyword.length + 25);
  let example = content.slice(start, end);

  if (start > 0) example = "..." + example;
  if (end < content.length) example = example + "...";

  return example.replace(
      new RegExp(escapeRegex(keyword), 'i'),
      (match) => `<strong>${match}</strong>`
  );
}

function checkAdditionalRequirements(content: string, data: GenerationRequest): { issues: string[]; checks: any } {
  const issues: string[] = [];
  const checks = {
    boldKeywords: (content.match(/\*\*/g) || []).length / 2,
    utpMentioned: 0,
    painPointsAddressed: 0,
    trustTriggers: 0
  };
  return { issues, checks };
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}