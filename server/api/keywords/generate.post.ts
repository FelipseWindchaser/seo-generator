// /server/api/keywords/generate.post.ts

import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { GoogleGenAI } from '@google/genai';
import { handleGoogleAIError } from "~/server/utils/error-handler";

// --- Инициализация ---
const { geminiApiKey } = useRuntimeConfig();
if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
const genAI = new GoogleGenAI({ apiKey: geminiApiKey });

// --- ИЗМЕНЕНО: Схема валидации теперь принимает и название, и URL ---
const requestSchema = z.object({
  productName: z.string().min(1, { message: "Название товара обязательно" }),
  productUrl: z.string().url({ message: "Требуется корректный URL" }).optional(),
});

/**
 * Безопасно извлекает JSON из ответа LLM,
 * очищая его от возможной Markdown-разметки.
 * @param text Ответ от LLM.
 * @returns Распарсенный объект или null в случае ошибки.
 */
function extractJsonFromText(text: string): any | null {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonString = match ? match[1] : text;
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("Failed to parse JSON from LLM response:", e);
    return null;
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const validation = requestSchema.safeParse(body);

  if (!validation.success) {
    // Возвращаем первую ошибку для простоты
    const firstError = validation.error.errors[0]?.message || 'Некорректные данные';
    throw createError({ statusCode: 400, message: firstError });
  }

  // Деструктурируем оба поля
  const { productName, productUrl } = validation.data;

  // --- ИЗМЕНЕНО: Промпт теперь использует название товара, а не пытается перейти по ссылке ---
  const systemPrompt = `Ты — профессиональный SEO-аналитик. Твоя задача — проанализировать название товара и извлечь из него наиболее релевантные ключевые слова, разделив их на две категории.`;
  
  const userPrompt = `
Проанализируй товар с названием: "${productName}".
${productUrl ? `(Прочитай содержимое по ссылке и используй его для дополнительного контекста: ${productUrl})` : ''}

Твоя задача — составить семантическое ядро из однословных ключей.

1.  **Обязательные ключи (15 штук):** Самые важные, высокочастотные слова, точно идентифицирующие товар, его категорию, бренд и основную функцию.
2.  **Необязательные ключи (15 штук):** Слова, описывающие второстепенные характеристики, технологии, преимущества или сценарии использования.

КРИТИЧЕСКИ ВАЖНО: Верни ответ ТОЛЬКО в формате валидного JSON-объекта со следующей структурой и без каких-либо других пояснений или текста:
{
  "requiredKeywords": ["ключ1", "ключ2", ...],
  "optionalKeywords": ["ключA", "ключB", ...]
}
`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
        systemInstruction: { parts: [{ text: systemPrompt }] },
      },
    });

    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    const keywords = JSON.parse(responseText);

    if (!keywords.requiredKeywords || !keywords.optionalKeywords) {
      throw new Error("Модель вернула JSON некорректной структуры.");
    }

    return keywords;

  } catch (error: any) {
    console.error("[API /keywords/generate] Error:", error);
    
    // ИСПОЛЬЗУЕМ НАШ НОВЫЙ ХЕЛПЕР, который возвращает готовый объект
    const errorResponse = handleGoogleAIError(error);
    
    // Выбрасываем ошибку с динамическим кодом и сообщением
    throw createError(errorResponse);
  }
});