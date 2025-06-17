// import type { GenerationRequest, Task } from "~/types";

// export const useSeoGenerator = () => {
//   const loading = ref(false);
//   const error = ref<string | null>(null);

//   const generateSeo = async (
//     data: GenerationRequest
//   ): Promise<string | null> => {
//     loading.value = true;
//     error.value = null;

//     try {
//       // Создаём задачу
//       const { taskId } = await $fetch("/api/generate", {
//         method: "POST",
//         body: data,
//       });
//       return taskId;
      
//     } catch (err) {
//       error.value = err instanceof Error ? err.message : "Ошибка генерации";
//       return null;
//     } finally {
//       loading.value = false;
//     }
//   };

//   const getTaskStatus = async (taskId: string): Promise<Task | null> => {
//     try {
//       const response = await $fetch(`/api/status/${taskId}`);
//       return response as Task;
//     } catch (err) {
//       error.value =
//         err instanceof Error ? err.message : "Ошибка получения статуса";
//       return null;
//     }
//   };

//   const updateTaskStatus = async (taskId: string, status: string): Promise<Task | null> => {
//     try {
//       const response = await $fetch<Task>(`/api/status/${taskId}`, {
//         method: "PUT" as const,
//         body: { status },
//       });
//       return response as Task;
//     } catch (err) {
//       error.value =
//         err instanceof Error ? err.message : "Ошибка получения статуса";
//       return null;
//     }
//   };
//   // const getTasksWithStatus = async (status: string): Promise<Task | null> => {
//   //   try {
//   //     const response = await $fetch(`/api/status/${status}`);
//   //     return (response as any).task as Task;
//   //   } catch (err) {
//   //     error.value =
//   //       err instanceof Error ? err.message : "Ошибка получения задач со статусом";
//   //     return null;
//   //   }
//   // };



//   return {
//     generateSeo,
//     getTaskStatus,
//     updateTaskStatus,
//     // getTasksWithStatus,
//     loading,
//     error
//   };
// };

// // const { getTaskStatus } = useSeoGenerator();
// // const taskStatus = async () => {
// //   const result = await getTaskStatus('task_1749109569620_13h7kyapm');
// //   console.log('task status', result);
// // }
// // taskStatus();
