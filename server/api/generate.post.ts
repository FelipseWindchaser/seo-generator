// /server/api/generate.post.ts

import type { GenerationRequest } from "~/types";
import { createTask } from "~/server/utils/redis";
import { z } from "zod";
// ИМПОРТИРУЕМ ENUM, ЧТОБЫ ZOD МОГ ЕГО ИСПОЛЬЗОВАТЬ
import { ModelProvider } from '~/server/services/langchain.service';

// --- ИСПРАВЛЕННАЯ СХЕМА ВАЛИДАЦИИ ---
const requestSchema = z.object({
  productName: z.string().min(1),
  productUrl: z
    .string()
    .url({ message: "Требуется корректный URL товара" })
    .refine((url) => url.includes("wildberries.ru/catalog/"), {
      message: "URL должен быть с Wildberries",
    }),
  
  requiredKeywords: z.array(z.string().min(1, "Обязательный ключ не может быть пустым"))
    .length(10, "Требуется ровно 10 обязательных ключей"),

  optionalKeywords: z.array(z.string().min(1, "Необязательный ключ не может быть пустым"))
    .max(10, "Не более 10 необязательных ключей"),

  reviews: z.string().min(20, "Добавьте отзывы конкурентов"),
  usp: z.array(z.string().min(1)).min(2, "Минимум 2 УТП"),
  adsPlanned: z.boolean(),
  canChangeVisuals: z.boolean(),

  // ДОБАВЛЕНО: Теперь Zod знает об этом поле и не будет его удалять.
  modelProvider: z.nativeEnum(ModelProvider).optional(),
  // numberOfVariations: z.number().min(1).max(5).optional(),
});

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const validatedData = requestSchema.parse(body) as GenerationRequest;

    // Теперь validatedData будет содержать modelProvider, если он был в запросе
    const taskId = await createTask(validatedData, 'queued');

    // console.log(`[API /generate] Task ${taskId} created successfully with model: ${validatedData.modelProvider || 'default'} for ${validatedData.numberOfVariations || 1} variations.`);

    return {
      taskId,
      status: "processing",
      message: "Генерация началась, проверьте статус через 10-30 секунд",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("[API /generate] Validation failed:", error.errors);
      throw createError({
        statusCode: 400,
        statusMessage: "Validation error",
        data: error.errors,
      });
    }

    console.error("[API /generate] Internal server error:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});