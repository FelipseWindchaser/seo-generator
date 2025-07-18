// /server/api/keywords/generate.post.ts

import { z } from 'zod';
import { defineEventHandler, readValidatedBody, createError } from 'h3';
// ИМПОРТИРУЕМ НАШУ НОВУЮ ЦЕПОЧКУ
import { keywordGeneratorChain, ModelProvider } from '~/server/services/langchain.service';
import { handleGoogleAIError } from "~/server/utils/error-handler";

// Схема валидации для входящего запроса (остается без изменений)
const requestSchema = z.object({
  productName: z.string().min(1, { message: "Название товара обязательно" }),
  productUrl: z.string().url({ message: "Требуется корректный URL" }).optional(),
  modelProvider: z.nativeEnum(ModelProvider).optional(),
});

type KeywordResult = {
  requiredKeywords: string[];
  optionalKeywords: string[];
};

export default defineEventHandler(async (event) => {
  try {
    // 1. Валидируем входящие данные
    const { productName, productUrl, modelProvider } = await readValidatedBody(event, (body) => requestSchema.parse(body));

    // 2. ВЫЗЫВАЕМ ЦЕПОЧКУ LANGCHAIN
    console.log(`[API /keywords/generate] Invoking LangChain with model: ${modelProvider || 'default (Gemini)'}...`);
    
     // ИСПРАВЛЕНО: Передаем modelProvider в invoke.
    // Если он не пришел с фронтенда, используем Gemini по умолчанию.
    const keywords = (await keywordGeneratorChain.invoke({
      productName,
      productUrl: productUrl || "",
      // Передаем modelProvider, устанавливая значение по умолчанию
      modelProvider: modelProvider || ModelProvider.GEMINI,
  })) as KeywordResult;

    // 3. Проверяем, что результат соответствует ожиданиям
    if (!keywords.requiredKeywords || !keywords.optionalKeywords) {
      throw new Error("LangChain вернул объект некорректной структуры.");
    }

    console.log(`[API /keywords/generate] Successfully generated ${keywords.requiredKeywords.length} required and ${keywords.optionalKeywords.length} optional keywords.`);
    
    // 4. Возвращаем результат
    return keywords;

  } catch (error: any) {
    console.error("[API /keywords/generate] Error:", error);
    
    // Используем наш хелпер для обработки ошибок от Google
    const errorResponse = handleGoogleAIError(error);
    
    // Выбрасываем ошибку, которую поймет фронтенд
    throw createError(errorResponse);
  }
});