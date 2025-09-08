// /server/api/variations/generate.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { getModel, ModelProvider } from '~/server/services/langchain.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ContentValidator } from '~/server/utils/content-validator';
import { intelligentTruncate } from '~/server/utils/text-trimmer';
import { ContentAnalyzer } from '~/server/utils/content-analyzer'; // <-- ИМПОРТИРУЕМ НОВЫЙ КЛАСС
import type { GenerationRequest, TextVariation } from '~/types';
import { handleLangChainError } from '~/server/utils/langchain-error-handler';

const validator = new ContentValidator();
const MAX_CONTENT_LENGTH = 2000;

// --- Zod-схемы для валидации входящего запроса ---

const generationRequestFromClientSchema = z.object({
  productName: z.string().min(1),
  requiredKeywords: z.array(z.string()).length(10),
  optionalKeywords: z.array(z.string()).max(10),
  reviews: z.string(),
  usp: z.array(z.string()),
  modelProvider: z.nativeEnum(ModelProvider).optional(),
});

const variationsBodySchema = z.object({
  baseText: z.string().min(1),
  generationRequest: generationRequestFromClientSchema,
  numVariations: z.number().min(1).max(4),
});

// --- Логика генерации строковых вариаций ---

const variationsSchema = z.object({
  variations: z.array(z.string()),
});
type VariationsResponseType = z.infer<typeof variationsSchema>;

async function generateVariationStrings(baseText: string, request: GenerationRequest, numVariations: number): Promise<string[]> {
    if (numVariations < 1) return [];

    const model = getModel(request.modelProvider || ModelProvider.GEMINI, { temperature: 0.6 });
    const prompt = ChatPromptTemplate.fromTemplate(`
      Ты — креативный редактор-копирайтер. Твоя задача — взять исходный SEO-текст и создать на его основе {numVariations} стилистически разных версий.
      --- ИСХОДНЫЙ ТЕКСТ (ОБРАЗЕЦ) ---
      {baseText}
      --- КОНТЕКСТ (для сохранения смысла) ---
      - Ключевые УТП: {usp}
      - Обязательные SEO-ключи: {requiredKeywords}
      --- ПРАВИЛА СОЗДАНИЯ ВАРИАЦИЙ ---
      1.  **СОХРАНЯЙ СУТЬ:** Все вариации должны сохранять исходную структуру и раскрывать те же УТП.
      2.  **СОХРАНЯЙ SEO:** Все обязательные SEO-ключи ДОЛЖНЫ присутствовать в каждой вариации.
      3.  **КРИТИЧЕСКИ ВАЖНО - ОБЪЕМ:** Длина каждой вариации должна быть СТРОГО в диапазоне 1800-2000 символов. Не превышай этот лимит.
      4.  **МЕНЯЙ СТИЛЬ:** Вариации должны отличаться за счет использования синонимов, изменения первых предложений, небольшого изменения тональности и перефразирования.
      5.  **ПРАВИЛО ВЫДЕЛЕНИЯ:** В каждой вариации все обязательные и необязательные ключевые слова ОБЯЗАТЕЛЬНО выделяй жирным шрифтом с помощью двух звездочек. Пример: Наша **соковыжималка** поможет вам...
  
      КРИТИЧЕСКИ ВАЖНО: Верни ответ ТОЛЬКО в формате JSON с одним ключом "variations", который содержит массив из {numVariations} строк.
    `);
    const chain = prompt.pipe(model.withStructuredOutput(variationsSchema));
    const response = await chain.invoke({
        baseText,
        numVariations,
        usp: request.usp.join(', '),
        requiredKeywords: JSON.stringify(request.requiredKeywords),
    }) as VariationsResponseType;
    return response.variations;
}

// --- Основной обработчик ---

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validatedBody = variationsBodySchema.parse(body);
    
    const { baseText, generationRequest, numVariations } = validatedBody;
    const contentAnalyzer = new ContentAnalyzer();

    const additionalStrings = await generateVariationStrings(baseText, generationRequest, numVariations);
    
    const correctedStrings = additionalStrings.map(text => {
        if (text.length > MAX_CONTENT_LENGTH) {
            return intelligentTruncate(text, MAX_CONTENT_LENGTH).newContent;
        }
        return text;
    });

    const newVariations = await Promise.all(correctedStrings.map(async (text) => {
      const [validation, analysis] = await Promise.all([
        validator.validate(text, generationRequest.requiredKeywords, generationRequest.optionalKeywords),
        contentAnalyzer.analyze(text, generationRequest)
      ]);
      
      const variation: TextVariation = {
        description: text,
        metrics: {
          ...validation.metrics,
          boldKeywordsCount: (text.match(/\*\*/g) || []).length / 2,
        },
        analysis: {
          utpAnalysis: analysis.utpAnalysis,
          painPointAnalysis: analysis.painPointAnalysis,
        },
      };
      return variation;
    }));

    return newVariations;

  } catch (error: any) {
    console.error(`[API /variations/generate] Error:`, error);
    if (error instanceof z.ZodError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid request body', data: error.errors });
    }
    // ИЗМЕНЕНИЕ: Используем новый обработчик вместо общего
    const errorResponse = handleLangChainError(error);
    throw createError(errorResponse);
  }
});