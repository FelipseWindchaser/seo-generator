// /server/api/generate.post.ts

import type { GenerationRequest } from "~/types";
import { createTask } from "~/server/utils/redis"; // Убрал неиспользуемый updateTask
import { z } from "zod";

// ИСПРАВЛЕНО: Обновляем схему валидации для соответствия новой структуре данных
const requestSchema = z.object({
  productUrl: z
    .string()
    .url({ message: "Требуется корректный URL товара" })
    .refine((url) => url.includes("wildberries.ru/catalog/"), {
      message: "URL должен быть с Wildberries",
    }),
  
  // Новое правило для основных ключей
  primaryKeywords: z.array(z.string().min(1, "Основной ключ не может быть пустым"))
    .min(1, "Требуется хотя бы 1 основной ключ")
    .max(3, "Не более 3 основных ключей"),

  // Новое правило для дополнительных ключей
  secondaryKeywords: z.array(z.string().min(1, "Дополнительный ключ не может быть пустым")),
  
  // Правила для остальных полей остаются
  reviews: z.string().min(20, "Добавьте отзывы конкурентов"),
  usp: z.array(z.string().min(1)).min(2, "Минимум 2 УТП"),
  adsPlanned: z.boolean(),
  canChangeVisuals: z.boolean(),
})
// ИСПОЛЬЗУЕМ SUPERREFINE: для проверки общего количества ключей
.superRefine((data, ctx) => {
  const totalKeywords = data.primaryKeywords.length + data.secondaryKeywords.length;
  if (totalKeywords < 10) {
    // Если общее количество ключей меньше 10, добавляем ошибку.
    // Мы "прикрепляем" эту ошибку к полю secondaryKeywords, чтобы она отобразилась в UI.
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 10,
      type: 'array',
      inclusive: true,
      message: `В сумме должно быть не менее 10 ключевых слов (сейчас: ${totalKeywords})`,
      path: ["secondaryKeywords"], // Указываем, к какому полю относится ошибка
    });
  }
});

export default defineEventHandler(async (event) => {
  try {
    // Валидация входных данных. Теперь она будет работать корректно.
    const body = await readBody(event);
    const validatedData = requestSchema.parse(body) as GenerationRequest;

    // Создаём задачу
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