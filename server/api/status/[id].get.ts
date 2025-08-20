// /server/api/status/[id].get.ts

import { getTask } from "~/server/utils/redis";

export default defineEventHandler(async (event) => {

  // --- ДОБАВЬТЕ ЭТОТ ЛОГ ---
  console.log(`--- [GET /api/status] Handler for task ${getRouterParam(event, "id")} EXECUTED at ${new Date().toLocaleTimeString()} ---`);
  // --- КОНЕЦ ЛОГА ---
// --- НАЧАЛО ИЗМЕНЕНИЙ ---
  // Добавляем заголовки, запрещающие кеширование на всех уровнях (браузер, прокси, сервер)
  setHeader(event, 'Cache-Control', 'no-cache, no-store, must-revalidate');
  setHeader(event, 'Pragma', 'no-cache');
  setHeader(event, 'Expires', '0');
  // --- КОНЕЦ ИЗМЕНЕНИЙ ---
  const taskId = getRouterParam(event, "id");

  if (!taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Task ID is required",
    });
  }

  const task = await getTask(taskId);

  // ИСПРАВЛЕНИЕ №1: Правильная обработка ошибки 404
  if (!task) {
    // Выбрасываем настоящую HTTP-ошибку, которую поймает catch на фронтенде
    throw createError({
      statusCode: 404,
      statusMessage: "Task not found",
    });
  }

  // ИСПРАВЛЕНИЕ №2: Возвращаем ЕДИНУЮ и ЧИСТУЮ структуру ответа
  // для всех успешных случаев (когда задача найдена).
  // Фронтенд будет получать только то, что ему нужно.
  return {
    status: task.status, // 'processing', 'completed', или 'error'
    result: task.result || null, // Результат, если он есть, иначе null
    request: task.request || null, // Запрос, если он есть, иначе null
  };
});