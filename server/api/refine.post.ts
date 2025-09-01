// /server/api/refine.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
import { runUserRefinement, prepareFinalResult } from '~/composables/processGeneration';
import type { GenerationRequest, GenerationResult } from '~/types';
import { handleGoogleAIError } from "~/server/utils/error-handler";
import { ModelProvider } from '../services/langchain.service';

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
  numberOfVariations: z.number().min(1).max(5).optional(),
});

const refineBodySchema = z.object({
  originalTitle: z.string().min(1),
  originalContent: z.string().min(1),
  userPrompt: z.string().min(1),
  generationData: generationRequestFromClientSchema,
});

const validator = new ContentValidator();

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validatedBody = refineBodySchema.parse(body);
    const { originalTitle, originalContent, userPrompt, generationData } = validatedBody;

    const refinedContent = await runUserRefinement(originalContent, userPrompt, generationData);

    const validationResult = await validator.validate(
      refinedContent, 
      generationData.requiredKeywords,
      generationData.optionalKeywords
    );

    // ИСПРАВЛЕНО: Вызов prepareFinalResult теперь соответствует новой сигнатуре
    const finalResult: GenerationResult = prepareFinalResult(
      originalTitle,
      [refinedContent], // 1. Передаем строку как массив из одного элемента
      validationResult,
      null,             // 2. Передаем null для analysis, так как здесь он не вычисляется
      -1, // attempts для refine нерелевантны
      validationResult.isValid
    );

    return finalResult;

  } catch (error: any) {
    console.error(`[API /refine] Error:`, error);
    if (error instanceof z.ZodError) {
      // Используем статус 400 для ошибок валидации
      throw createError({ statusCode: 400, statusMessage: 'Invalid refine request', data: error.errors });
    }
    // Для всех остальных ошибок используем 500
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', data: { message: error.message } });
  }
});