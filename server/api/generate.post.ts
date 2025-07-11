// /server/api/generate.post.ts

import type { GenerationRequest } from "~/types";
import { createTask } from "~/server/utils/redis";
import { z } from "zod";

// --- ИСПРАВЛЕННАЯ СХЕМА ВАЛИДАЦИИ ---
// Адаптирована под requiredKeywords и optionalKeywords
const requestSchema = z.object({
  productName: z.string().min(1),
  productUrl: z
    .string()
    .url({ message: "Требуется корректный URL товара" })
    .refine((url) => url.includes("wildberries.ru/catalog/"), {
      message: "URL должен быть с Wildberries",
    }),
  
  // Новое правило для обязательных ключей
  requiredKeywords: z.array(z.string().min(1, "Обязательный ключ не может быть пустым"))
    .length(10, "Требуется ровно 10 обязательных ключей"), // .length(10) проверяет точное количество

  // Новое правило для необязательных ключей
  optionalKeywords: z.array(z.string().min(1, "Необязательный ключ не может быть пустым"))
    .max(10, "Не более 10 необязательных ключей"), // .max(10) проверяет верхний лимит

  // Правила для остальных полей остаются
  reviews: z.string().min(20, "Добавьте отзывы конкурентов"),
  usp: z.array(z.string().min(1)).min(2, "Минимум 2 УТП"),
  adsPlanned: z.boolean(),
  canChangeVisuals: z.boolean(),
});

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    // Валидируем тело запроса по новой схеме
    const validatedData = requestSchema.parse(body) as GenerationRequest;

    // Создаём задачу с новыми данными
    const taskId = await createTask(validatedData);

    console.log(`[API /generate] Task ${taskId} created successfully.`);

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