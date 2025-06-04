import type { GenerationRequest, Task } from "~/types";

export const useSeoGenerator = () => {
  const loading = ref(false);
  const error = ref<string | null>(null);

  const generateSeo = async (
    data: GenerationRequest
  ): Promise<string | null> => {
    loading.value = true;
    error.value = null;

    try {
      // Создаём задачу
      const { taskId } = await $fetch("/api/generate", {
        method: "POST",
        body: data,
      });

      return taskId;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка генерации";
      return null;
    } finally {
      loading.value = false;
    }
  };

  const getTaskStatus = async (taskId: string): Promise<Task | null> => {
    try {
      const response = await $fetch(`/api/status/${taskId}`);
      return response as Task;
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Ошибка получения статуса";
      return null;
    }
  };
};
