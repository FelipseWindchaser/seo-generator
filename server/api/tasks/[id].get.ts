// /server/api/tasks/[id].get.ts

import { getTask } from "~/server/utils/redis";

export default defineEventHandler(async (event) => {
  // Отключаем кеширование, чтобы всегда получать свежие данные
  setHeader(event, 'Cache-Control', 'no-cache, no-store, must-revalidate');
  setHeader(event, 'Pragma', 'no-cache');
  setHeader(event, 'Expires', '0');

  // Получаем ID из URL. Убедитесь, что 'id' совпадает с именем файла [id].get.ts
  const taskId = getRouterParam(event, "id");

  if (!taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Task ID is required",
    });
  }

  const task = await getTask(taskId);

  if (!task) {
    throw createError({
      statusCode: 404,
      statusMessage: "Task not found",
    });
  }

  // Возвращаем полную структуру, как ожидает фронтенд
  return {
    status: task.status,
    result: task.result || null,
    request: task.request || null,
  };
});