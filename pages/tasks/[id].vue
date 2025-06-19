<template>
  <div class="min-h-screen bg-gray-50 py-8">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-3xl font-bold text-center text-gray-900 mb-8">
        🚀 SEO Генератор для Wildberries taskId: {{ id }}
      </h1>

      <div class="bg-white rounded-lg shadow-lg p-6">
        <!-- v-if="!taskId" -->

        <GenerationResult
          v-if="taskId"
          :task-id="taskId"
          @reset="resetAndNavigateToHome"
        />
      </div>
    </div>
  </div>
</template>
<!-- old mvp -->
<script setup lang="ts">
import type { GenerationRequest } from "~/types";

const loading = ref(false);
const taskId = ref<string>("");
const route = useRoute();
const router = useRouter();
const id = route.params.id;
console.log(id);
const resetAndNavigateToHome = () => {
  router.push("/"); // Перенаправляем на главную страницу для новой генерации
};

const getTask = async () => {
  taskId.value = id as string;
};

onMounted(() => {
  getTask();
});
</script>
