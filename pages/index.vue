<!-- /pages/index.vue -->
<template>
  <div class="min-h-screen bg-gray-50 py-8">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-3xl font-bold text-center text-gray-900 mb-8">
        🚀 SEO Генератор для Wildberries
      </h1>
      <div class="bg-white rounded-lg shadow-lg p-6">
        <!-- Передаем initialData в форму -->
        <SeoForm
          @submit="handleSubmit"
          :loading="loading"
          :initial-data="formDataForRetry"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GenerationRequest } from "~/types";

const loading = ref(false);
const router = useRouter();
const route = useRoute();

// Состояние для хранения данных для предзаполнения формы
const formDataForRetry = ref<GenerationRequest | null>(null);

const handleSubmit = async (data: GenerationRequest) => {
  loading.value = true;
  try {
    const response = await $fetch("/api/generate", {
      method: "POST",
      body: data,
    });
    // После успешной отправки перенаправляем на страницу задачи
    router.push(`/tasks/${response.taskId}`);
  } catch (error) {
    console.error("Error submitting form:", error);
    // Здесь можно добавить логику отображения ошибки пользователю
  } finally {
    loading.value = false;
  }
};

// ИЗМЕНЕНО: При монтировании страницы проверяем URL
onMounted(async () => {
  const retryTaskId = route.query.retry_task_id as string;
  if (retryTaskId) {
    console.log(`Found retry_task_id in URL: ${retryTaskId}. Fetching data...`);
    try {
      // Запрашиваем данные старой задачи
      const taskData = await $fetch(`/api/status/${retryTaskId}`);
      if (taskData && taskData.request) {
        // Сохраняем данные для передачи в форму
        formDataForRetry.value = taskData.request;
        console.log(
          "Successfully fetched data for retry:",
          formDataForRetry.value
        );
      }
    } catch (error) {
      console.error(`Failed to fetch data for task ${retryTaskId}:`, error);
      // Если не удалось загрузить, просто покажем пустую форму
      formDataForRetry.value = null;
    }
  }
});
</script>
