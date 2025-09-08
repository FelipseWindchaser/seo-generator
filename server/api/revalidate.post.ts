// /server/api/revalidate.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
import { getModel, ModelProvider } from '~/server/services/langchain.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { GenerationRequest, TextVariation, AnalysisDetail } from '~/types';
import { ContentAnalyzer } from '~/server/utils/content-analyzer';

// --- Zod-схемы для валидации ---

const generationRequestFromClientSchema = z.object({
  productName: z.string().min(1),
  requiredKeywords: z.array(z.string()).length(10),
  optionalKeywords: z.array(z.string()).max(10),
  reviews: z.string(),
  usp: z.array(z.string()),
  modelProvider: z.nativeEnum(ModelProvider).optional(),
});

const analysisDetailSchema = z.object({
  point: z.string(),
  isCovered: z.boolean(),
  evidence: z.string(),
});

const revalidateRequestSchema = z.object({
  text: z.string(),
  generationRequest: generationRequestFromClientSchema,
  mode: z.enum(['light', 'full']).default('light'),
  currentAnalysis: z.object({
    utpAnalysis: z.array(analysisDetailSchema),
    painPointAnalysis: z.array(analysisDetailSchema),
  }).optional(), // Делаем опциональным для обратной совместимости
});

// --- Переиспользуемый класс для анализа контента ---

const analysisSchema = z.object({
  utpAnalysis: z.array(z.object({
    point: z.string(),
    isCovered: z.boolean(),
    evidence: z.string(),
  })),
  painPointAnalysis: z.array(z.object({
    point: z.string(),
    isCovered: z.boolean(),
    evidence: z.string(),
  })),
});
type AnalysisResponseType = z.infer<typeof analysisSchema>;


// --- Основной обработчик ---

const validator = new ContentValidator();
const contentAnalyzer = new ContentAnalyzer();

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { text, generationRequest, mode, currentAnalysis } = revalidateRequestSchema.parse(body);

    // Шаг 1: SEO-валидация выполняется всегда.
    const validationResult = await validator.validate(
      text, 
      generationRequest.requiredKeywords,
      generationRequest.optionalKeywords
    );

    let analysisResult: { utpAnalysis: AnalysisDetail[], painPointAnalysis: AnalysisDetail[] };

    // Шаг 2: Анализ контента (LLM) выполняется только в 'full' режиме.
    if (mode === 'full') {
      console.log('[API /revalidate] Running in FULL mode. Analyzing content...');
      analysisResult = await contentAnalyzer.analyze(text, generationRequest);
    } else {
      // В 'light' режиме просто возвращаем текущий анализ, который прислал клиент.
      console.log('[API /revalidate] Running in LIGHT mode. Skipping content analysis.');
      analysisResult = currentAnalysis || { utpAnalysis: [], painPointAnalysis: [] };
    }

    const updatedVariation: Pick<TextVariation, 'metrics' | 'analysis'> = {
      metrics: {
        ...validationResult.metrics,
        boldKeywordsCount: (text.match(/\*\*/g) || []).length / 2,
      },
      analysis: {
        utpAnalysis: analysisResult.utpAnalysis,
        painPointAnalysis: analysisResult.painPointAnalysis,
      },
    };

    return updatedVariation;

  } catch (error: any) {
    console.error(`[API /revalidate] Error:`, error);
    if (error instanceof z.ZodError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid revalidation request', data: error.errors });
    }
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', data: { message: error.message } });
  }
});