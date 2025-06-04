<template>
  <div class="min-h-screen bg-gray-50 py-8">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-3xl font-bold text-center text-gray-900 mb-8">
        🚀 SEO Генератор для Wildberries
      </h1>

      <div class="bg-white rounded-lg shadow-lg p-6">
        <!-- v-if="!taskId" -->
        <SeoForm @submit="handleSubmit" :loading="loading" />

        <!-- <GenerationResult v-else :task-id="taskId" @reset="resetForm" /> -->
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GenerationRequest } from "~/types";

const loading = ref(false);
const taskId = ref<string | null>(null);

const handleSubmit = async (data: GenerationRequest) => {
  // loading.value = true;

  try {
    const response = await $fetch("/api/generate", {
      method: "POST",
      body: data,
    });

    taskId.value = response.taskId;
  } catch (error) {
    console.error("Error submitting form:", error);
    // Обработка ошибок
  } finally {
    loading.value = false;
  }
};

const resetForm = () => {
  taskId.value = null;
};
</script>
