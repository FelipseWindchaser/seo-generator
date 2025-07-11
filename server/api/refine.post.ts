// /server/api/refine.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
// ИЗМЕНЕНО: Убираем импорт удаленной функции calculateKeywordInstructions
import { runUserRefinement, prepareFinalResult, checkAdditionalRequirements } from '~/composables/processGeneration';
import type { GenerationRequest, GenerationResult } from '~/types';

// --- Схемы валидации (соответствуют последней логике) ---
const generationRequestSchema = z.object({
  productUrl: z.string().url(),
  requiredKeywords: z.array(z.string()).length(10),
  optionalKeywords: z.array(z.string()).max(10),
  reviews: z.string(),
  usp: z.array(z.string()),
  adsPlanned: z.boolean(),
  canChangeVisuals: z.boolean(),
});

const refineBodySchema = z.object({
  originalTitle: z.string().min(1),
  originalContent: z.string().min(1),
  userPrompt: z.string().min(1),
  generationData: generationRequestSchema,
});

// --- Инициализация ---
const validator = new ContentValidator();

// --- Обработчик API ---
export default defineEventHandler(async (event) => {
  try {
    // 1. Валидируем входящее тело запроса
    const body = await readBody(event);
    const validatedBody = refineBodySchema.parse(body);
    const { originalTitle, originalContent, userPrompt, generationData } = validatedBody;

    // 2. Вызываем LLM для рефакторинга текста
    const refinedContent = await runUserRefinement(originalContent, userPrompt, generationData);

    // 3. ИСПРАВЛЕНО: Повторно валидируем новый текст, передавая простые массивы ключей
    const validationResult = await validator.validate(
      refinedContent, 
      generationData.requiredKeywords, // <-- Передаем массив строк
      generationData.optionalKeywords  // <-- Передаем массив строк
    );

    // 4. Собираем дополнительные метрики
    const additionalChecks = checkAdditionalRequirements(refinedContent, generationData);

    // 5. Собираем полноценный объект GenerationResult
    const finalResult: GenerationResult = prepareFinalResult(
      originalTitle,
      refinedContent,
      validationResult,
      additionalChecks,
      -1, // Специальное значение для "попыток", обозначающее доработку
      validationResult.isValid
    );

    // 6. Возвращаем клиенту полный и валидный объект
    return finalResult;

  } catch (error: any) {
    console.error(`[API /refine] Error:`, error);
    if (error instanceof z.ZodError) {
      throw createError({ statusCode: 400, statusMessage: 'Validation error', data: error.errors });
    }
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', data: { message: error.message } });
  }
});