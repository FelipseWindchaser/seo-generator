// /server/api/revalidate.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { ContentValidator } from '~/server/utils/content-validator';
import { getModel, ModelProvider } from '~/server/services/langchain.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { GenerationRequest, TextVariation, AnalysisDetail } from '~/types';

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
      - Твой вывод: {{ "point": "Гарантия 3 года", "isCovered": true, "evidence": "Мы настолько уверены в качестве нашей соковыжималки, что предоставляем на нее трехлетнюю гарантию." }}
      Пример 2:
      - Тезис: "Очень шумная"
      - Предложение в тексте: "Благодаря инверторному мотору нового поколения, устройство работает практически бесшумно, позволяя готовить сок даже ранним утром."
      - Твой вывод: {{ "point": "Очень шумная", "isCovered": true, "evidence": "Благодаря инверторному мотору нового поколения, устройство работает практически бесшумно, позволяя готовить сок даже ранним утром." }}
      Пример 3:
      - Тезис: "Подходит для твердых овощей"
      - Предложение в тексте: "Наш прибор отлично справляется с яблоками и апельсинами."
      - Твой вывод: {{ "point": "Подходит для твердых овощей", "isCovered": false, "evidence": "" }} (потому что яблоки и апельсины - это фрукты, а не твердые овощи, как морковь или свекла).
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