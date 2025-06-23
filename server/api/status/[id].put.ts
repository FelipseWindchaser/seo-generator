// import { updateTask,  } from "~/server/utils/redis";

// export default defineEventHandler(async (event) => {
//   const taskId = getRouterParam(event, "id");

//   if (!taskId) {
//     throw createError({
//       statusCode: 400,
//       statusMessage: "Task ID is required",
//     });
//   }

//   const task = await updateTask(taskId, { status: "processing" });

//   if (!task) {
//     return {
//       status: "not_found",
//       message: "Задача не найдена, невозможно обновить статус",
//     };
//   }
//   //if (task.status === "completed" && task.result) {
//   if (task.status === "completed") {
//     return {
//       status: "completed",
//       message: "Статус обновлен: задача выполнена",
//       result: task.result,
//       generatedAt: task.completedAt,
//       task: task,
//     };
//   }

//   if (task.status === "error") {
//     return {
//       status: "error",
//       error: task.error || "Неизвестная ошибка, невозможно обновить статус",
//     };
//   }

//   return {
//     status: "processing",
//     message: "Статус обновлен: задача в процессе",
//     task: task,
//   };
// });

