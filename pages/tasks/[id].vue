<template>
  <div class="min-h-screen bg-gray-50 py-8">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-3xl font-bold text-center text-gray-900 mb-8">
        🚀 SEO Генератор для Wildberries taskId: {{ taskId }}
      </h1>

      <div class="bg-white rounded-lg shadow-lg p-6">
        <!-- v-if="!taskId" -->

        <GenerationResult
          :task="taskStore.currentTask"
          :error="taskStore.error"
          @reset="navigateToHome"
          :taskId="taskId"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskStore } from "~/stores/task";

const route = useRoute();
const router = useRouter();
const taskStore = useTaskStore();
const taskId = route.params.id as string;

// Запускаем загрузку данных при открытии страницы
onMounted(() => {
  taskStore.fetchTask(taskId);
});

// Очищаем интервал при уходе со страницы
onUnmounted(() => {
  taskStore.stopPolling();
});

const navigateToHome = () => {
  taskStore.reset();
  router.push("/");
};
</script>
