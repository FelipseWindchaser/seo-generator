import { defineStore } from 'pinia';
import type { GenerationRequest, Task } from '~/types';

export const useTaskStore = defineStore('task', () => {
  const currentTask = ref<Task | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  let pollInterval: NodeJS.Timeout | null = null;

  async function generate(request: GenerationRequest) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await $fetch('/api/generate', {
        method: 'POST',
        body: request,
      });
      await navigateTo(`/tasks/${response.taskId}`);
    } catch (e: any) {
      error.value = e.data?.message || 'Произошла ошибка при создании задачи.';
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchTask(taskId: string) {
    try {
      const taskData = await $fetch<Task>(`/api/status/${taskId}`);
      currentTask.value = taskData;

      // Если задача в процессе, продолжаем опрос
      if (taskData.status === 'queued' || taskData.status === 'processing') {
        startPolling(taskId);
      } else {
        stopPolling();
      }
    } catch (e: any) {
      error.value = 'Не удалось загрузить задачу.';
      stopPolling();
    }
  }

  function startPolling(taskId: string) {
    if (pollInterval) return; // Уже опрашиваем
    pollInterval = setInterval(() => {
      fetchTask(taskId);
    }, 3000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function reset() {
    currentTask.value = null;
    error.value = null;
    stopPolling();
  }

  return { currentTask, isLoading, error, generate, fetchTask, reset, stopPolling };
});