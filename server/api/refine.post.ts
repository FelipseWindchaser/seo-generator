// /server/api/refine.post.ts

import { z } from 'zod';
import { defineEventHandler, readValidatedBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
// ИМПОРТИРУЕМ ВСЕ НЕОБХОДИМЫЕ ФУНКЦИИ
import { runUserRefinement, prepareFinalResult, findKeywordExample, calculateKeywordInstructions, checkAdditionalRequirements } from '~/composables/processGeneration';
import type { GenerationRequest, GenerationResult, KeywordInstruction } from '~/types';

// --- Схемы валидации (остаются без изменений) ---
const generationRequestSchema = z.object({
  productUrl: z.string().url(),
  primaryKeywords: z.array(z.string()).min(1).max(3),
  secondaryKeywords: z.array(z.string()),
  reviews: z.string(),
  usp: z.array(z.string()),
  adsPlanned: z.boolean(),
  canChangeVisuals: z.boolean(),
}).superRefine((data, ctx) => {
    if (data.primaryKeywords.length + data.secondaryKeywords.length < 10) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "В сумме должно быть не менее 10 ключей", path: ["secondaryKeywords"] });
    }
});

const refineBodySchema = z.object({
  originalTitle: z.string().min(1),
  originalContent: z.string().min(1),
  userPrompt: z.string().min(1),
  data: generationRequestSchema,
});

// --- Инициализация ---
const validator = new ContentValidator();

// --- Обработчик API (полностью переписан) ---
export default defineEventHandler(async (event) => {
  try {
    // 1. Валидируем входящее тело запроса
    const body = await readValidatedBody(event, (rawBody) => refineBodySchema.parse(rawBody));
    const { originalTitle, originalContent, userPrompt, data } = body;

    // 2. Вызываем LLM для рефакторинга текста
    const refinedContent = await runUserRefinement(originalContent, userPrompt, data);

    // 3. Повторно валидируем новый текст, чтобы получить свежие метрики
    const primaryInstructions = calculateKeywordInstructions(data.primaryKeywords);
    const validationResult = await validator.validate(refinedContent, primaryInstructions, data.secondaryKeywords);

    // 4. Собираем дополнительные метрики (например, количество жирных слов)
    const additionalChecks = checkAdditionalRequirements(refinedContent, data);

    // 5. ИСПОЛЬЗУЕМ prepareFinalResult для сборки ПОЛНОЦЕННОГО объекта GenerationResult
    const finalResult: GenerationResult = prepareFinalResult(
      originalTitle, // Заголовок можно взять из data или поставить заглушку
      refinedContent,
      validationResult,
      additionalChecks,
      -1, // Используем -1 или другое специальное значение для "попыток", чтобы обозначить доработку
      validationResult.isValid
    );

    // 6. Возвращаем клиенту полный и валидный объект
    return finalResult;

  } catch (error: any) {
    console.error(`[API /refine] Error:`, error);
    if (error.name === 'ZodError') {
      throw createError({ statusCode: 400, statusMessage: 'Validation error', data: error.errors });
    }
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', data: { message: error.message } });
  }
});