// old version of the code

import type { GenerationRequest } from "~/types";
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

export default defineEventHandler(async (event) => {
  try {
    // Валидация входных данных
    const body = await readBody(event);
    const validatedData = requestSchema.parse(body) as GenerationRequest;

    // Создаём задачу
    const taskId = await createTask(validatedData);

    // console.log("validatedData", validatedData);

    // console.log("taskId", taskId);

    return {
      taskId,
      status: "processing",
      message: "Генерация началась, проверьте статус через 10-30 секунд",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        statusMessage: "Validation error",
        data: error.errors,
      });
    }

    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});

//revised version of the code
// import { z } from 'zod';
// import type { GenerationRequest } from '~/types';
// import { createTask } from '~/server/utils/redis';

// const requestSchema = z.object({
//   productUrl: z
//     .string()
//     .url()
//     .refine((url) => url.includes("wildberries.ru/catalog/"), {
//       message: "URL должен быть с Wildberries",
//     }),
//   keywords: z.array(z.string()).min(10, "Минимум 10 ключевых фраз"),
//   reviews: z.string().min(20, "Добавьте отзывы конкурентов"),
//   usp: z.array(z.string()).min(2, "Минимум 2 УТП"),
//   adsPlanned: z.boolean(),
//   canChangeVisuals: z.boolean(),
// });

// export default defineEventHandler(async (event) => {
//   try {
//     const body = await readBody(event);
//     const validatedData = requestSchema.parse(body) as GenerationRequest;

//     const taskId = await createTask(validatedData);

//     // Запускаем зарегистрированную Nitro Task
//     // `runTask` (или `$runTask` в более старых версиях) доступен глобально в Nitro
//     await runTask('generate-seo', { 
//       payload: { taskId, requestData: validatedData }
//     }); 

//     return {
//       taskId,
//       status: 'processing',
//       message: 'Генерация началась, проверьте статус через 10-30 секунд',
//     };
//   } catch (error) {
//         if (error instanceof z.ZodError) {
//           throw createError({
//             statusCode: 400,
//             statusMessage: "Validation error",
//             data: error.errors,
//           });
//         }
    
//         throw createError({
//           statusCode: 500,
//           statusMessage: "Internal server error",
//         });
//       }
// });
