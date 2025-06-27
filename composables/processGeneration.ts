// import type { Task } from "~/types";

// export const repeatFunction = () => {
//     const interval = 10000; 

//     const execute = () => {
//         processTask();
//         setTimeout(execute, interval);
//     }
//     setTimeout(execute, interval);

   
// }

// const processTask = async () => {
//     console.log(`Вызов в ${new Date().toLocaleTimeString()}`);
    
//     const tasks:Task[] = await getProcessingTasks();
//     for await (const task of tasks) {
//         generateTextFromTask(task);
//         // updateTask(task.id, { status: "completed" })
//         // console.log('task', task);
//         console.log(task.id, task.status, 'processTask: status updated');
//         //update task

//         //return results with new page
//     }
// }
// //adsplanned and canchange visuals - ?
// const generateTextFromTask = async (task: Task) => {
//     console.log('generateTextFromTask', task);
//     const body = {
//         contents: [
//           {
//             parts: [
//               {
//                 text: `Сгенерируй текст для товара ${task.request?.productUrl} с ключевыми словами ${task.request?.keywords.join(', ')} с отзывами ${task.request?.reviews} и уникальными торговыми предложениями ${task.request?.usp}. Выведи в ответе ссылку на товар и опиши ее содержание.`
//               }
//             ]
//           }
//         ]
//       }
      
//     const result = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyAFyS-OM-smmw1tBlcyQVMY0Qg7bqnTyNw', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json', // Указываем, что передаём JSON
//         },
//         body: JSON.stringify(body)
//       })
//         .then(response => {
//           if (!response.ok) {
//             throw new Error(`Ошибка HTTP: ${response.status}`);
//           }
          
//           return response.json(); // Парсим JSON-ответ
//         })
//         .then(data => {

//             // console.log('Ответ сервера:', data);
        
//             const text = data.candidates[0].content.parts[0].text;
//             updateTask(task.id, { status: "completed", result: {
//                 content: text,
//                 title: '',
//                 description: '',
//                 success: true,
//                 attempts: 0
//             } })
//             console.log('text', text);
//             return data;
//         })
//         .catch(error => console.error('Ошибка:', error));
// }


import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import type { Task, GenerationRequest, GenerationResult, ValidationResult, KeywordDetail } from '~/types';
import { ContentValidator } from '~/server/utils/content-validator';

const { geminiApiKey } = useRuntimeConfig();
console.log('geminiApiKey', geminiApiKey);
if (!geminiApiKey) {
  throw new Error('GEMINI_API_KEY is not set in server runtime config');
}

const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
const validator = new ContentValidator();

export const repeatFunction = () => {
  const interval = 30000;

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

async function runGenerationWithValidation(data: GenerationRequest): Promise<GenerationResult> {
  const maxAttempts = 3;
  let currentContent: string | null = null;
  let currentTitle: string | null = null;
  let validationResult: ValidationResult | null = null;
  let additionalChecks: { issues: string[]; checks: any } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log(`[Generator] Attempt ${attempt + 1}/${maxAttempts} for product: ${data.productUrl}`);

    // Шаг 1: Генерация или исправление
    if (attempt === 0) {
      const generated = await generateInitial(data);
      currentTitle = generated.title;
      currentContent = generated.content;
    } else if (currentTitle && currentContent && validationResult) {
      const fixed = await fixContent(currentTitle, currentContent, validationResult, data);
      currentContent = fixed.content;
    } else {
      throw new Error("Cannot fix content without initial generation or validation result.");
    }

    // Шаг 2: Валидация
    validationResult = await validator.validate(currentContent, data.keywords);
    additionalChecks = checkAdditionalRequirements(currentContent, data);
    
    const allIssues = [...validationResult.issues, ...additionalChecks.issues];
    
    // Шаг 3: Проверка на успех
    if (allIssues.length === 0) {
      console.log(`[Generator] Validation successful on attempt ${attempt + 1}.`);
      return prepareFinalResult(
        currentTitle,
        currentContent,
        validationResult,
        additionalChecks,
        attempt + 1,
        true
      );
    }
    
    console.warn(`[Generator] Validation failed on attempt ${attempt + 1} with issues:`, allIssues);
    validationResult.issues = allIssues; // Обновляем список проблем для следующей итерации
  }
  
  // Если вышли из цикла, значит, все попытки исчерпаны
  console.error(`[Generator] Failed to generate valid content after ${maxAttempts} attempts.`);
  if (currentTitle && currentContent && validationResult && additionalChecks) {
      return prepareFinalResult(
          currentTitle,
          currentContent,
          validationResult,
          additionalChecks,
          maxAttempts,
          false
      );
  }

  throw new Error("Generation failed catastrophically. Could not prepare final result.");
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

  // const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", safetySettings });
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
  // const result = await model.generateContent(fullPrompt);
  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  console.debug('[Generator] Initial response from LLM:', responseText);
  return parseLLMResponse(responseText || '');
}

/**
 * Исправляет контент на основе замечаний валидатора.
 */
async function fixContent(
  title: string,
  content: string,
  validation: ValidationResult,
  data: GenerationRequest
): Promise<{ title: string; content: string }> {
  const systemPrompt = `Ты - эксперт по доработке SEO-текстов для Wildberries. Исправь текст ТОЧНО по инструкциям, сохранив стиль и основную структуру. Не меняй то, что уже хорошо.`;
  const userPrompt = `Доработай описание, исправив ВСЕ проблемы:

ИНСТРУКЦИИ ПО ИСПРАВЛЕНИЮ:
${validation.issues.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}

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

  // const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", safetySettings });
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
  
  // Fallback, если LLM не вернула разделители
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
  // TODO: Реализовать детальную логику проверок
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
