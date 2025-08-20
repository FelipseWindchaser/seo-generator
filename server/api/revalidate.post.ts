// /server/api/revalidate.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
import { prepareFinalResult } from '~/composables/processGeneration';
import type { GenerationResult } from '~/types';
import { ModelProvider } from '../services/langchain.service';

// Схема, описывающая `generationRequest`, как она приходит с клиента
const generationRequestFromClientSchema = z.object({
  productName: z.string().min(1),
  productUrl: z.string().url().optional(),
  requiredKeywords: z.array(z.string()).length(10),
  optionalKeywords: z.array(z.string()).max(10),
  reviews: z.string(),
  usp: z.array(z.string()),
  adsPlanned: z.boolean(),
  canChangeVisuals: z.boolean(),
  modelProvider: z.nativeEnum(ModelProvider).optional(),
});

// Схема для тела запроса на перепроверку
const revalidateRequestSchema = z.object({
  text: z.string(),
  generationRequest: generationRequestFromClientSchema,
});

const validator = new ContentValidator();

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { text, generationRequest } = revalidateRequestSchema.parse(body);

    // 1. Валидируем отредактированный текст
    const validationResult = await validator.validate(
      text, 
      generationRequest.requiredKeywords,
      generationRequest.optionalKeywords
    );

    // 2. ИСПРАВЛЕНИЕ: Корректно считаем `boldKeywordsCount`
    // Это простое вычисление количества пар "**" в тексте.
    const boldCount = (text.match(/\*\*/g) || []).length / 2;
    const additionalChecks = {
      issues: [],
      checks: {
        boldKeywords: boldCount,
        // Остальные поля здесь нерелевантны, поэтому ставим 0
        utpCovered: 0,
        painPointsAddressed: 0,
        trustTriggers: 0,
      },
    };

    // 3. Собираем финальный результат с помощью хелпера
    const finalResult: GenerationResult = prepareFinalResult(
      generationRequest.productName,
      text,
      validationResult,
      additionalChecks, // Передаем объект с корректным `boldKeywordsCount`
      0, // `attempts` не имеет значения для перепроверки
      validationResult.isValid
    );

    return finalResult;

  } catch (error: any) {
    console.error(`[API /revalidate] Error:`, error);
    if (error instanceof z.ZodError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid revalidation request', data: error.errors });
    }
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', data: { message: error.message } });
  }
});