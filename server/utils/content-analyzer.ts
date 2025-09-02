// /server/utils/content-analyzer.ts

import { z } from "zod";
import { getModel, ModelProvider } from "~/server/services/langchain.service";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { GenerationRequest, AnalysisDetail } from "~/types";

const analysisSchema = z.object({
  utpAnalysis: z.array(
    z.object({
      point: z.string(),
      isCovered: z.boolean(),
      evidence: z.string(),
    })
  ),
  painPointAnalysis: z.array(
    z.object({
      point: z.string(),
      isCovered: z.boolean(),
      evidence: z.string(),
    })
  ),
});
type AnalysisResponseType = z.infer<typeof analysisSchema>;

export class ContentAnalyzer {
  async analyze(
    text: string,
    request: GenerationRequest
  ): Promise<AnalysisResponseType> {
    const model = getModel(request.modelProvider || ModelProvider.GEMINI, {
      temperature: 0.0,
    });

    const prompt = ChatPromptTemplate.fromTemplate(`
      Ты — умный и внимательный ассистент-аналитик. Твоя задача — найти семантическое подтверждение для каждого тезиса в предоставленном тексте. Ты должен понимать смысл, а не просто искать точные совпадения слов.

      --- ТЕКСТ ДЛЯ АНАЛИЗА ---
      {text}

      --- СПИСОК УТП (Уникальные Торговые Преимущества) ---
      {usp}

      --- СПИСОК БОЛЕЙ (Проблемы из отзывов, которые нужно отработать) ---
      {reviews}

      --- ЗАДАЧА И ПРАВИЛА ---
      Для КАЖДОГО пункта из УТП и БОЛЕЙ найди в тексте наиболее релевантное предложение, которое подтверждает этот тезис, и вынеси вердикт.
      - isCovered: true, если СМЫСЛ тезиса передан в тексте. Это может быть прямое упоминание или косвенное решение проблемы.
      - isCovered: false, если тезис в тексте не упоминается.
      - evidence: Если isCovered: true, приведи ТОЧНУЮ цитату (одно полное предложение) из текста, которое лучше всего доказывает раскрытие тезиса. Если false, оставь пустую строку.

      --- ПРИМЕРЫ ПРАВИЛЬНОГО АНАЛИЗА ---
        В примерах рассматривается товар - соковыжималка.

      Пример 1 (Прямое совпадение):
      - Тезис: "Гарантия 3 года"
      - Предложение в тексте: "Мы настолько уверены в качестве нашей соковыжималки, что предоставляем на нее трехлетнюю гарантию."
      - Твой вывод: {{ "point": "Гарантия 3 года", "isCovered": true, "evidence": "Мы настолько уверены в качестве нашей соковыжималки, что предоставляем на нее трехлетнюю гарантию." }}

      Пример 2 (Прямое опровержение "боли"):
      - Тезис: "Очень шумная"
      - Предложение в тексте: "Благодаря инверторному мотору нового поколения, устройство работает практически бесшумно, позволяя готовить сок даже ранним утром."
      - Твой вывод: {{ "point": "Очень шумная", "isCovered": true, "evidence": "Благодаря инверторному мотору нового поколения, устройство работает практически бесшумно, позволяя готовить сок даже ранним утром." }}

      Пример 3 (Несоответствие):
      - Тезис: "Подходит для твердых овощей"
      - Предложение в тексте: "Наш прибор отлично справляется с яблоками и апельсинами."
      - Твой вывод: {{ "point": "Подходит для твердых овощей", "isCovered": false, "evidence": "" }} (потому что яблоки и апельсины - это фрукты, а не твердые овощи).

      Пример 4 (Косвенное решение "боли"):
      - Тезис: "Сломалась через 5 минут после включения"
      - Предложение в тексте: "Вы можете быть уверены, что получите товар в идеальном состоянии и он прослужит вам долгие годы."
      - Твой вывод: {{ "point": "Сломалась через 5 минут после включения", "isCovered": true, "evidence": "Вы можете быть уверены, что получите товар в идеальном состоянии и он прослужит вам долгие годы." }} (потому что "прослужит долгие годы" является прямым ответом на проблему поломки).

      КРИТИЧЕСКИ ВАЖНО: Верни ответ ТОЛЬКО в формате JSON, соответствующем схеме.
    `);

    const chain = prompt.pipe(model.withStructuredOutput(analysisSchema));
    const response = (await chain.invoke({
      text: text,
      usp: JSON.stringify(request.usp),
      reviews: request.reviews,
    })) as AnalysisResponseType;
    return response;
  }
}
