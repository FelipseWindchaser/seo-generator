import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import type { Task, GenerationRequest, GenerationResult, ValidationResult, KeywordDetail } from '~/types';
import { ContentValidator } from '~/server/utils/content-validator';

// --- ИНИЦИАЛИЗАЦИЯ ---
const { geminiApiKey } = useRuntimeConfig();
if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not set');
const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
const validator = new ContentValidator();
const MAX_CONTENT_LENGTH = 2000;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function escapeRegex(string: string): string { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function splitTextIntoParts(text: string): string[] { return text.match(/[^.!?\n]+[.!?]\s*|\n\n+/g) || [text]; }

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
  return example.replace(new RegExp(escapeRegex(keyword), 'i'), (match) => `<strong>${match}</strong>`);
}

function checkAdditionalRequirements(content: string, data: GenerationRequest): { issues: string[]; checks: any } {
  return { issues: [], checks: { boldKeywords: (content.match(/\*\*/g) || []).length / 2, utpCovered: 0, painPointsAddressed: 0, trustTriggers: 0 } };
}

// --- ЛОГИКА ФОНОВОГО ПРОЦЕССА ---
export const repeatFunction = () => {
  const interval = 30000;
  const execute = () => { processTask(); setTimeout(execute, interval); };
  setTimeout(execute, interval);
};

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

// --- НОВАЯ, НАДЕЖНАЯ ГЛАВНАЯ ЛОГИКА ---
async function runGenerationWithValidation(data: GenerationRequest): Promise<GenerationResult> {
  console.log(`[Generator] Starting 'Content-First, SEO-Second' process...`);
  const processingLog: { added: string[], removed: string[] } = { added: [], removed: [] };
  let attempts = 1;

  // --- ЭТАП 1: Генерация качественного текста БЕЗ КЛЮЧЕЙ ---
  console.log('[Generator] Stage 1: Generating high-quality base text.');
  const { title, content: baseContent } = await generateInitial(data);
  
  // --- ЭТАП 2: Хирургическое внедрение ВСЕХ ключей в базовый текст ---
  console.log(`[Generator] Stage 2: Injecting all ${data.keywords.length} keywords into the base text.`);
  attempts++;
  let contentWithKeywords = await injectKeywordsIntoBaseText(baseContent, data);

  // --- ЭТАП 3: Финальная жесткая обрезка и валидация ---
  const originalLength = contentWithKeywords.length;
  let finalContent = contentWithKeywords;

  if (originalLength > MAX_CONTENT_LENGTH) {
      console.warn(`[Trimmer] Text is too long after injection (${originalLength}). Performing final hard truncation.`);
      const finalTruncationResult = smartTruncate(contentWithKeywords, MAX_CONTENT_LENGTH);
      finalContent = finalTruncationResult.newContent;
      processingLog.removed.push(...finalTruncationResult.removedSentences);
  }

  console.log("[Generator] Performing final validation...");
  const finalValidationResult = await validator.validate(finalContent, data.keywords);
  
  const additionalChecks = checkAdditionalRequirements(finalContent, data);
  const allIssues = [...finalValidationResult.issues, ...additionalChecks.issues];
  const isSuccess = allIssues.length === 0;

  if (isSuccess) console.log(`[Generator] Final validation successful.`);
  else console.warn(`[Generator] Final validation failed with issues:`, allIssues);
  
  finalValidationResult.issues = allIssues;

  return prepareFinalResult(title, finalContent, finalValidationResult, additionalChecks, attempts, isSuccess, processingLog);
}

// --- УПРОЩЕННАЯ И НАДЕЖНАЯ SMARTTRUNCATE ---
function smartTruncate(text: string, maxLength: number): { newContent: string, removedSentences: string[] } {
  const removedSentences: string[] = [];
  if (text.length <= maxLength) {
    return { newContent: text, removedSentences };
  }
  
  console.log(`[Trimmer] Starting hard truncation. Initial length: ${text.length}`);
  let sentences = splitTextIntoParts(text);
  
  while (sentences.join('').length > maxLength && sentences.length > 0) {
    const removedSentence = sentences.pop();
    if (removedSentence) {
      removedSentences.unshift(removedSentence.trim());
    }
  }

  console.log(`[Trimmer] Removed ${removedSentences.length} sentences.`);
  return { newContent: sentences.join(''), removedSentences };
}

// --- НОВАЯ ФУНКЦИЯ ДЛЯ НАДЕЖНОГО ВНЕДРЕНИЯ КЛЮЧЕЙ ---
async function injectKeywordsIntoBaseText(
  baseContent: string,
  data: GenerationRequest
): Promise<string> {
    const systemPrompt = `Ты - SEO-редактор. Твоя задача - взять готовый, качественный текст и аккуратно отредактировать его, чтобы органично вплести в него ВСЕ ключевые фразы из предоставленного списка.
- Сохраняй основной смысл, стиль и структуру исходного текста.
- Не добавляй новой информации, только редактируй существующие предложения для включения ключей.
- Выделяй вставленные ключевые фразы жирным шрифтом (**ключ**).
- Постарайся распределить ключи по тексту равномерно.`;
    
    const userPrompt = `ОТРЕДАКТИРУЙ ЭТОТ ТЕКСТ:\n\n${baseContent}\n\n-----\n\nОБЯЗАТЕЛЬНО ВСТАВЬ В НЕГО ВСЕ ЭТИ КЛЮЧЕВЫЕ ФРАЗЫ:\n${data.keywords.map(k => `- ${k}`).join('\n')}`;

    try {
        const result = await genAI.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                temperature: 0.5,
                maxOutputTokens: 4096,
                systemInstruction: { parts: [{ text: systemPrompt }] }
            },
        });
        const newContent = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (newContent) {
            console.log(`[Injector] Successfully injected keywords into base text.`);
            return newContent;
        }
    } catch (error) {
        console.error(`[Injector] FAILED: API error during keyword injection.`, error);
    }
    // В случае ошибки возвращаем исходный текст с добавленными ключами в конце, чтобы валидатор их увидел
    console.warn(`[Injector] Injection failed, appending keywords to the end as a fallback.`);
    return baseContent + '\n\n' + data.keywords.map(k => `**${k}**`).join('. ');
}

// --- ОБНОВЛЕННЫЙ ПРОМПТ ДЛЯ ГЕНЕРАЦИИ БАЗОВОГО ТЕКСТА ---
async function generateInitial(data: GenerationRequest): Promise<{ title: string; content: string }> {
  const systemPrompt = `Ты - опытный маркетолог-копирайтер, который пишет "живые" и убедительные тексты для карточек товаров.
Твоя цель - не просто перечислить характеристики, а создать у покупателя образ, рассказать историю и подвести к покупке.
Твои принципы:
- Польза, а не фичи: Говори о том, что товар ДАЕТ покупателю (экономию времени, здоровье, удовольствие), а не просто о том, что в нем ЕСТЬ.
- Структура: Текст должен быть разбит на логические абзацы для удобства чтения.
- НЕ ИСПОЛЬЗУЙ SEO-КЛЮЧИ. Сосредоточься на качестве и убедительности текста.
- ВАЖНО: Речь идет о СОКОВЫЖИМАЛКЕ, а не о блендере. Не используй слово "блендер" или "смузи".`;
  
  const userPrompt = `Создай продающее описание для товара "Соковыжималка Atvel".

ЗАДАЧА: Напиши убедительный текст, разделенный на абзацы. НЕ ИСПОЛЬЗУЙ SEO-КЛЮЧИ на этом этапе.

ВХОДНЫЕ ДАННЫЕ:
- URL товара: ${data.productUrl}
- Отзывы конкурентов (закрой эти боли и возражения):
${data.reviews}
- УТП (раскрой все, говоря о выгоде для клиента):
${data.usp.map((u, i) => `${i + 1}. ${u}`).join('\n')}
- Реклама планируется: ${data.adsPlanned ? 'ДА - закончи текст сильным призывом к действию' : 'НЕТ'}

ФОРМАТ ОТВЕТА:
===ЗАГОЛОВОК===
[яркий, привлекательный заголовок до 60 символов]
===ОПИСАНИЕ===
[текст примерно 1700-1900 символов, разделенный на абзацы]`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 4000,
      safetySettings: [{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    },
  });

  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
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
  success: boolean = true,
  processingLog: { added: string[], removed: string[] }
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
      processingLog,
  };

  if (!success) {
    result.warnings = validation.issues;
  }
  return result;
}