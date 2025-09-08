// /server/api/refine.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
import { runUserRefinement, prepareFinalResult } from '~/composables/processGeneration';
import { getModel, ModelProvider } from '~/server/services/langchain.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { GenerationRequest, GenerationResult, TextVariation, AnalysisDetail } from '~/types';
import { ContentAnalyzer } from '~/server/utils/content-analyzer';
import { handleLangChainError } from '~/server/utils/langchain-error-handler';
// --- Zod-схемы для валидации ---

const generationRequestFromClientSchema = z.object({
  productName: z.string().min(1),
  requiredKeywords: z.array(z.string()).length(10),
  optionalKeywords: z.array(z.string()).max(10),
  reviews: z.string(),
  usp: z.array(z.string()),
  modelProvider: z.nativeEnum(ModelProvider).optional(),
});

const refineBodySchema = z.object({
  originalContent: z.string().min(1),
  userPrompt: z.string().min(1),
  generationData: generationRequestFromClientSchema,
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
    const validatedBody = refineBodySchema.parse(body);
    const {originalContent, userPrompt, generationData } = validatedBody;

    const refinedContent = await runUserRefinement(originalContent, userPrompt, generationData);

    const [validationResult, analysisResult] = await Promise.all([
      validator.validate(
        refinedContent, 
        generationData.requiredKeywords,
        generationData.optionalKeywords
      ),
      contentAnalyzer.analyze(refinedContent, generationData)
    ]);

    // ИСПРАВЛЕНО: Собираем единственную вариацию типа TextVariation
    const refinedVariation: TextVariation = {
      description: refinedContent,
      metrics: {
        ...validationResult.metrics, // Берем все метрики из валидатора
        // И добавляем недостающее поле, посчитав его здесь
        boldKeywordsCount: (refinedContent.match(/\*\*/g) || []).length / 2,
      },
      analysis: {
        utpAnalysis: analysisResult.utpAnalysis,
        painPointAnalysis: analysisResult.painPointAnalysis,
      },
    };
    
    const finalResult: GenerationResult = prepareFinalResult(
      [refinedVariation], // Первый аргумент - массив вариаций
      -1, // attempts, -1 означает, что это не итерация графа
      true
    );

    return finalResult;

  } catch (error: any) {
    console.error(`[API /refine] Error:`, error);
    if (error instanceof z.ZodError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid refine request', data: error.errors });
    }
    // ИЗМЕНЕНИЕ: Используем новый обработчик вместо общего
    const errorResponse = handleLangChainError(error);
    throw createError(errorResponse);
  }
});