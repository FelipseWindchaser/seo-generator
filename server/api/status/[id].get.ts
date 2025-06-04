import { getTask } from "~/server/utils/redis";

export default defineEventHandler(async (event) => {
  const taskId = getRouterParam(event, "id");

  if (!taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Task ID is required",
    });
  }

  const task = await getTask(taskId);

  if (!task) {
    return {
      status: "not_found",
      message: "Задача не найдена",
    };
  }

  if (task.status === "completed" && task.result) {
    return {
      status: "completed",
      result: task.result,
      generatedAt: task.completedAt,
    };
  }

  if (task.status === "error") {
    return {
      status: "error",
      error: task.error || "Unknown error",
    };
  }

  return {
    status: "processing",
    message: "Ещё генерируется...",
  };
});
