// /server/api/keywords/generate.post.ts

import { z } from 'zod';
import { defineEventHandler, readValidatedBody, createError } from 'h3';
import { keywordGeneratorChain, ModelProvider } from '~/server/services/langchain.service';
import { handleGoogleAIError } from "~/server/utils/_error-handler";

// ИЗМЕНЕНИЕ: Упрощаем схему валидации, убираем productUrl
const requestSchema = z.object({
  productName: z.string().min(1, { message: "Название товара обязательно" }),
  // productUrl: z.string().url({ message: "Требуется корректный URL" }).optional(), // УДАЛЕНО
  modelProvider: z.nativeEnum(ModelProvider).optional(),
});

type KeywordResult = {
  requiredKeywords: string[];
  optionalKeywords: string[];
};

export default defineEventHandler(async (event) => {
  try {
    // 1. Валидируем входящие данные
    // ИЗМЕНЕНИЕ: Больше не получаем productUrl
    const { productName, modelProvider } = await readValidatedBody(event, (body) => requestSchema.parse(body));

    // 2. ВЫЗЫВАЕМ ЦЕПОЧКУ LANGCHAIN
    console.log(`[API /keywords/generate] Invoking LangChain with model: ${modelProvider || 'default (Gemini)'}...`);
    
    // ИЗМЕНЕНИЕ: Убираем productUrl из вызова
    const keywords = (await keywordGeneratorChain.invoke({
      productName,
      // productUrl: productUrl || "", // УДАЛЕНО
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
    
    const errorResponse = handleGoogleAIError(error);
    
    throw createError(errorResponse);
  }
});