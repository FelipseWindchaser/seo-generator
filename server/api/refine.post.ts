// /server/api/refine.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
import { runUserRefinement, prepareFinalResult } from '~/composables/processGeneration';
import { getModel, ModelProvider } from '~/server/services/langchain.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { GenerationRequest, GenerationResult, TextVariation, AnalysisDetail } from '~/types';

// --- Zod-схемы для валидации ---

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

class ContentAnalyzer {
  async analyze(text: string, request: GenerationRequest): Promise<{ utpAnalysis: AnalysisDetail[], painPointAnalysis: AnalysisDetail[] }> {
    const model = getModel(request.modelProvider || ModelProvider.GEMINI, { temperature: 0.0 });
    const prompt = ChatPromptTemplate.fromTemplate(`
      Ты — умный и внимательный ассистент-аналитик. Твоя задача — найти семантическое подтверждение для каждого тезиса в предоставленном тексте. Ты должен понимать смысл, а не просто искать точные совпадения слов.
      --- ТЕКСТ ДЛЯ АНАЛИЗА ---
      {text}
      --- СПИСОК УТП ---
      {usp}
      --- СПИСОК БОЛЕЙ ---
      {reviews}
      --- ЗАДАЧА И ПРАВИЛА ---
      Для КАЖДОГО пункта из УТП и БОЛЕЙ найди в тексте наиболее релевантное предложение, которое подтверждает этот тезис, и вынеси вердикт.
      - isCovered: true, если СМЫСЛ тезиса передан в тексте, даже если использованы другие слова (синонимы, перефразирование).
      - isCovered: false, если тезис в тексте не упоминается.
      - evidence: Если isCovered: true, приведи ТОЧНУЮ цитату (одно полное предложение) из текста, которое лучше всего доказывает раскрытие тезиса. Если false, оставь пустую строку.
      --- ПРИМЕРЫ ПРАВИЛЬНОГО АНАЛИЗА ---
      Пример 1:
      - Тезис: "Гарантия 3 года"
      - Предложение в тексте: "Мы настолько уверены в качестве нашей соковыжималки, что предоставляем на нее трехлетнюю гарантию."
      - Твой вывод: { "point": "Гарантия 3 года", "isCovered": true, "evidence": "Мы настолько уверены в качестве нашей соковыжималки, что предоставляем на нее трехлетнюю гарантию." }
      Пример 2:
      - Тезис: "Очень шумная"
      - Предложение в тексте: "Благодаря инверторному мотору нового поколения, устройство работает практически бесшумно, позволяя готовить сок даже ранним утром."
      - Твой вывод: { "point": "Очень шумная", "isCovered": true, "evidence": "Благодаря инверторному мотору нового поколения, устройство работает практически бесшумно, позволяя готовить сок даже ранним утром." }
      Пример 3:
      - Тезис: "Подходит для твердых овощей"
      - Предложение в тексте: "Наш прибор отлично справляется с яблоками и апельсинами."
      - Твой вывод: { "point": "Подходит для твердых овощей", "isCovered": false, "evidence": "" } (потому что яблоки и апельсины - это фрукты, а не твердые овощи, как морковь или свекла).
      КРИТИЧЕСКИ ВАЖНО: Верни ответ ТОЛЬКО в формате JSON, соответствующем схеме.
    `);
    const chain = prompt.pipe(model.withStructuredOutput(analysisSchema));
    const response = await chain.invoke({
      text: text,
      usp: JSON.stringify(request.usp),
      reviews: request.reviews,
    }) as AnalysisResponseType;
    return response;
  }
}

// --- Основной обработчик ---

const validator = new ContentValidator();
const contentAnalyzer = new ContentAnalyzer();

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validatedBody = refineBodySchema.parse(body);
    const { originalTitle, originalContent, userPrompt, generationData } = validatedBody;

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
      originalTitle,
      [refinedVariation],
      -1,
      true
    );

    return finalResult;

  } catch (error: any) {
    console.error(`[API /refine] Error:`, error);
    if (error instanceof z.ZodError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid refine request', data: error.errors });
    }
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', data: { message: error.message } });
  }
});