// /server/api/refine.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
import { runUserRefinement, prepareFinalResult, checkAdditionalRequirements } from '~/composables/processGeneration';
import type { GenerationRequest, GenerationResult } from '~/types';
import { handleGoogleAIError } from "~/server/utils/error-handler";

// Эта схема описывает объект, который мы СОХРАНИЛИ в Redis
// и который приходит с фронтенда в поле `generationData`.
// В нем НЕТ productName на верхнем уровне, он внутри.
const generationRequestFromClientSchema = z.object({
  productName: z.string().min(1),
  productUrl: z.string().url().optional(),
  requiredKeywords: z.array(z.string()).length(10),
  optionalKeywords: z.array(z.string()).max(10),
  reviews: z.string(),
  usp: z.array(z.string()),
  adsPlanned: z.boolean(),
  canChangeVisuals: z.boolean(),
});

// Эта схема описывает ВСЕ тело запроса на /api/refine
const refineBodySchema = z.object({
  originalTitle: z.string().min(1),
  originalContent: z.string().min(1),
  userPrompt: z.string().min(1),
  generationData: generationRequestFromClientSchema, // Используем схему выше
});

const validator = new ContentValidator();

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validatedBody = refineBodySchema.parse(body);
    const { originalTitle, originalContent, userPrompt, generationData } = validatedBody;

    // Вызываем LLM для рефакторинга
    const refinedContent = await runUserRefinement(originalContent, userPrompt, generationData);

    // Валидируем результат
    const validationResult = await validator.validate(
      refinedContent, 
      generationData.requiredKeywords,
      generationData.optionalKeywords
    );

    const additionalChecks = checkAdditionalRequirements(refinedContent, generationData);

    const finalResult: GenerationResult = prepareFinalResult(
      originalTitle,
      refinedContent,
      validationResult,
      additionalChecks,
      -1,
      validationResult.isValid
    );

    return finalResult;

  } catch (error: any) {
    console.error(`[API /refine] Error:`, error);
    if (error instanceof z.ZodError) {
      throw createError({ statusCode: handleGoogleAIError(error).statusCode, statusMessage: handleGoogleAIError(error).statusMessage, data: error.errors });
    }
    throw createError({ statusCode: handleGoogleAIError(error).statusCode, statusMessage: handleGoogleAIError(error).statusMessage, data: { message: error.message } });
  }
});