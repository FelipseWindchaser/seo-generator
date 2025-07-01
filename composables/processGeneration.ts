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
const MIN_CONTENT_LENGTH = 1800;
const MAX_CONTENT_LENGTH = 2000;

const LINKING_WORDS = [
  'именно поэтому', 'поэтому', 'кроме того', 'также', 'однако', 
  'более того', 'вдобавок', 'благодаря этому', 'из-за этого',
  'это позволяет', 'он позволяет', 'она позволяет', 'они позволяют',
  'таким образом', 'в результате'
];

// --- ЛОГИКА ФОНОВОГО ПРОЦЕССА ---

export const repeatFunction = () => {
  const interval = 30000;

  const execute = () => {
    processTask();
    setTimeout(execute, interval);
  };
  
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

// --- ЛОГИКА ГЕНЕРАЦИИ И ВАЛИДАЦИИ ---

async function runGenerationWithValidation(data: GenerationRequest): Promise<GenerationResult> {
  console.log(`[Generator] Starting generation process for product: ${data.productUrl}`);

  // Этап 1: Первичная генерация
  const { title, content: initialContent } = await generateInitial(data);
  let currentContent = initialContent;
  let attempts = 1;

  // --- НОВЫЙ ЭТАП 2: Расширение контента, если он слишком короткий ---
  if (currentContent.length < MIN_CONTENT_LENGTH) {
    console.warn(`[Expander] Content is too short (${currentContent.length} chars). Attempting to expand.`);
    attempts++;
    currentContent = await expandContent(currentContent, data);
  }

  // Этап 3: Первая валидация для определения недостающих ключей
  let firstValidationResult = await validator.validate(currentContent, data.keywords);
  const missingKeywords = firstValidationResult.metrics.missingKeywords;

  // Этап 4: Контролируемое добавление ключей (если нужно)
  if (missingKeywords && missingKeywords.length > 0) {
    console.warn(`[Injector] Missing ${missingKeywords.length} keywords. Attempting to inject them.`);
    attempts++;
    currentContent = await injectMissingKeywords(currentContent, missingKeywords, data.productUrl);
  }
  
  // Этап 5: Умная обрезка текста до лимита
  const originalLength = currentContent.length;
  currentContent = smartTruncate(currentContent, MAX_CONTENT_LENGTH, data.keywords);
  if (originalLength > currentContent.length) {
    console.log(`[Trimmer] Content was truncated from ${originalLength} to ${currentContent.length} characters.`);
  }

  // Этап 6: Финальная валидация
  console.log("[Generator] Performing final validation on the processed content...");
  let finalValidationResult = await validator.validate(currentContent, data.keywords);
  
  // Этап 7: Подготовка финального результата
  const additionalChecks = checkAdditionalRequirements(currentContent, data);
  const allIssues = [...finalValidationResult.issues, ...additionalChecks.issues];
  const isSuccess = allIssues.length === 0;

  if (isSuccess) {
    console.log(`[Generator] Final validation successful.`);
  } else {
    console.warn(`[Generator] Final validation failed with issues:`, allIssues);
  }
  
  finalValidationResult.issues = allIssues;

  return prepareFinalResult(
    title,
    currentContent,
    finalValidationResult,
    additionalChecks,
    attempts,
    isSuccess
  );
}

/**
 * Расширяет короткий текст, генерируя новые абзацы на основе УТП и отзывов.
 */
async function expandContent(currentContent: string, data: GenerationRequest): Promise<string> {
  const neededChars = MIN_CONTENT_LENGTH - currentContent.length;
  // Определяем, сколько примерно абзацев нужно (считаем, что абзац ~300-400 символов)
  const paragraphsNeeded = Math.ceil(neededChars / 350);

  // Собираем темы для расширения из УТП и отзывов
  const expansionTopics = [...data.usp, data.reviews].filter(Boolean);

  if (expansionTopics.length === 0) {
    console.error("[Expander] No topics (USP, reviews) available to expand content.");
    return currentContent;
  }

  const systemPrompt = `Ты - SEO-копирайтер. Твоя задача - написать несколько дополнительных, подробных абзацев для существующего текста. Не пиши вступление или заключение. Не повторяй то, что уже сказано. Просто сгенерируй новый, свежий контент на заданные темы.`;
  const userPrompt = `СУЩЕСТВУЮЩИЙ ТЕКСТ (для контекста):\n${currentContent.slice(0, 500)}...\n\nЗАДАЧА: Напиши ${paragraphsNeeded} новых абзаца(ев), раскрывая следующие темы:\n- ${expansionTopics.join('\n- ')}\n\nОтветь ТОЛЬКО новыми абзацами.`;
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      config: { temperature: 0.7 },
    });
    const newParagraphs = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (newParagraphs) {
      console.log(`[Expander] SUCCESS: Generated new paragraphs to add.`);
      // Вставляем новые абзацы в середину текста
      const contentParts = currentContent.split('\n\n');
      const middleIndex = Math.floor(contentParts.length / 2);
      contentParts.splice(middleIndex, 0, newParagraphs);
      return contentParts.join('\n\n');
    } else {
      console.error(`[Expander] FAILED: LLM returned an empty response for expansion.`);
      return currentContent;
    }
  } catch (error) {
    console.error(`[Expander] FAILED: API error during content expansion.`, error);
    return currentContent;
  }
}

function smartTruncate(text: string, maxLength: number, keywords: string[]): string {
  if (text.length <= maxLength) {
    return text;
  }
  
  console.log(`[Trimmer] Starting smart truncation. Initial length: ${text.length}`);

  const lowerCaseKeywords = keywords.map(kw => kw.toLowerCase());
  let sentences = text.match(/[^.!?]+[.!?]|\n\n+/g) || [];
  
  for (let i = sentences.length - 1; i >= 0; i--) {
    const currentTotalLength = sentences.join(' ').length;
    if (currentTotalLength <= maxLength) {
      console.log(`[Trimmer] Length is now within limits (${currentTotalLength}). Stopping.`);
      break;
    }

    const sentence = sentences[i];
    const sentenceLower = sentence.toLowerCase();

    const hasKeyword = lowerCaseKeywords.some(kw => sentenceLower.includes(kw));
    if (hasKeyword) {
      console.log(`[Trimmer] Keeping sentence with keyword: "${sentence.trim().slice(0, 50)}..."`);
      continue;
    }

    const hasNextSentence = i + 1 < sentences.length;
    if (hasNextSentence) {
      const nextSentence = sentences[i + 1].trim().toLowerCase();
      const isContextForNext = LINKING_WORDS.some(word => nextSentence.startsWith(word));
      if (isContextForNext) {
        console.log(`[Trimmer] Keeping sentence as it provides context for the next one: "${sentence.trim().slice(0, 50)}..."`);
        continue;
      }
    }

    console.log(`[Trimmer] Removing safe sentence: "${sentence.trim().slice(0, 50)}..."`);
    sentences.splice(i, 1);
  }

  return sentences.join(' ').trim();
}


async function injectMissingKeywords(
  currentContent: string,
  missingKeywords: string[],
  productUrl: string
): Promise<string> {
  let modifiedContent = currentContent;
  const sentences = currentContent.match(/[^.!?]+[.!?]/g) || [];
  const usedSentenceIndexes: Set<number> = new Set();

  for (const keyword of missingKeywords) {
    const sentenceIndex = findSentenceForInjection(sentences, usedSentenceIndexes);
    if (sentenceIndex === -1) {
      console.error(`[Injector] Could not find a suitable sentence to inject keyword: "${keyword}"`);
      continue;
    }

    const originalSentence = sentences[sentenceIndex];
    usedSentenceIndexes.add(sentenceIndex);

    console.log(`[Injector] Injecting keyword "${keyword}" into sentence: "${originalSentence.trim()}"`);

    const systemPrompt = `Ты - редактор SEO-текстов. Твоя задача - аккуратно переписать предложение, чтобы органично и естественно включить в него заданную ключевую фразу. Сохрани основной смысл и стиль. Не добавляй ничего лишнего. Ответь ТОЛЬКО переписанным предложением.`;
    const userPrompt = `ПЕРЕПИШИ ПРЕДЛОЖЕНИЕ: "${originalSentence.trim()}"\n\nЧТОБЫ ВКЛЮЧИТЬ КЛЮЧЕВУЮ ФРАЗУ: "${keyword}"`;
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    try {
      const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        config: { temperature: 0.6, maxOutputTokens: 200 },
      });
      const newSentence = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (newSentence) {
        modifiedContent = modifiedContent.replace(originalSentence, newSentence + ' ');
        console.log(`[Injector] SUCCESS: Replaced with: "${newSentence}"`);
      } else {
        console.error(`[Injector] FAILED: LLM returned an empty response for keyword "${keyword}".`);
      }
    } catch (error) {
      console.error(`[Injector] FAILED: API error while injecting keyword "${keyword}".`, error);
    }
  }

  return modifiedContent;
}

function findSentenceForInjection(sentences: string[], usedIndexes: Set<number>): number {
  const candidates: number[] = [];
  const minLength = 8;

  for (let i = 0; i < sentences.length; i++) {
    if (usedIndexes.has(i)) continue;
    const wordCount = sentences[i].split(/\s+/).length;
    if (wordCount >= minLength) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) return -1;
  const middleIndex = Math.floor(candidates.length / 2);
  return candidates[middleIndex];
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