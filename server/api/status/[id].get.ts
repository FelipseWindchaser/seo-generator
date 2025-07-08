import { getTask,  } from "~/server/utils/redis";

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
      status: "404",
      message: "Задача не найдена",
    };
  }
  //if (task.status === "completed" && task.result) {
  if (task.status === "completed") {
    return {
      status: "completed",
      message: "Задача выполнена",
      result: task.result,
      request: task.request,
      generatedAt: task.completedAt,
      task: task,
    };
  }

  if (task.status === "error") {
    return {
      status: "error",
      error: task.error || "Unknown error",
      result:
      {
        content: task.error || "Unknown error",
        success: false,
      },
      request: task.request,
    };
  }

  return {
    status: "processing",
    message: "Ещё генерируется...",
    task: task,
    result: task.result,
    request: task.request,
  };
});

