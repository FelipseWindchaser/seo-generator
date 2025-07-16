<!-- /pages/tasks/[id].vue -->
<template>
  <div class="min-h-screen bg-gray-50 py-8">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-3xl font-bold text-center text-gray-900 mb-8">
        Результат генерации
      </h1>
      <div class="bg-white rounded-lg shadow-lg p-6">
        <GenerationResult
          v-if="taskId"
          :task-id="taskId"
          @reset="handleReset"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GenerationRequest } from "~/types";

const route = useRoute();
const router = useRouter();
// Получаем ID задачи из параметров маршрута
const taskId = computed(() => route.params.id as string);

// ИЗМЕНЕНО: Обработчик теперь принимает данные для повтора
const handleReset = (retryData: GenerationRequest | null) => {
  if (retryData) {
    // Если есть данные, перенаправляем с query-параметром
    console.log(`Retrying with data for task: ${taskId.value}`);
    router.push({ path: "/", query: { retry_task_id: taskId.value } });
  } else {
    // Если данных нет, просто перенаправляем на главную
    console.log("Resetting to a new form.");
    router.push("/");
  }
};
</script>
