

import type { GenerationRequest, Task } from "~/types";
import { createTask, updateTask } from "~/server/utils/redis";
import { z } from "zod";


// Схема валидации
const requestSchema = z.object({
  productUrl: z
    .string()
    .url()
    .refine((url) => url.includes("wildberries.ru/catalog/"), {
      message: "URL должен быть с Wildberries",
    }),
  keywords: z.array(z.string()).min(10, "Минимум 10 ключевых фраз"),
  reviews: z.string().min(20, "Добавьте отзывы конкурентов"),
  usp: z.array(z.string()).min(2, "Минимум 2 УТП"),
  adsPlanned: z.boolean(),
  canChangeVisuals: z.boolean(),
});

// export default defineEventHandler(async (event) => {
//   try {
//     // Валидация входных данных
//     const body = await readBody(event);
//     const validatedData = requestSchema.parse(body) as GenerationRequest;

//     // Создаём задачу
//     const taskId = await createTask(validatedData);

//     // console.log("validatedData", validatedData);

//     // console.log("taskId", taskId);

//     return {
//       taskId,
//       status: "processing",
//       message: "Генерация началась, проверьте статус через 10-30 секунд",
//     };
//   } catch (error) {
//     if (error instanceof z.ZodError) {
//       throw createError({
//         statusCode: 400,
//         statusMessage: "Validation error",
//         data: error.errors,
//       });
//     }

//     throw createError({
//       statusCode: 500,
//       statusMessage: "Internal server error",
//     });
//   }
// });

export default defineEventHandler(async (event) => {
  try {
    const redis = getRedis();
    const body = await readBody(event);
    const requestData = requestSchema.parse(body) as GenerationRequest;

    const taskId = `task:${Date.now()}`;
    const task: Task = {
      id: taskId,
      status: 'queued', // Новый статус "в очереди"
      request: requestData,
      createdAt: new Date().toISOString(),
    };

    // 1. Сохраняем полную информацию о задаче в HASH
    await redis.setex(taskId, 3600, JSON.stringify(task));

    // 2. Помещаем ID задачи в список для воркера (LIFO - последним пришел, первым вышел)
    await redis.lpush('tasks:queue', taskId);

    // Перенаправляем пользователя сразу на страницу статуса
    // setHeader(event, 'Location', `/tasks/${taskId.replace('task:', '')}`);
    // sendRedirect(event, `/tasks/${taskId.replace('task:', '')}`, 302);
    // Или просто возвращаем ID для редиректа на клиенте
    return { taskId: taskId.replace('task:', '') };

  } catch (error) {
    // Обработка ошибок Zod и других
    if (error instanceof z.ZodError) {
      throw createError({ statusCode: 400, statusMessage: 'Validation Error', data: error.errors });
    }
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error' });
  }
});