<!-- /pages/tasks/[id].vue -->
<!-- /pages/tasks/[id].vue -->
<template>
  <div class="min-h-screen bg-gray-50 py-8">
    <!-- ИЗМЕНЕНИЕ: Ширина контейнера увеличена для нового макета -->
    <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8">
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
const taskId = computed(() => route.params.id as string);

const handleReset = (retryData: GenerationRequest | null) => {
  if (retryData) {
    router.push({ path: "/", query: { retry_task_id: taskId.value } });
  } else {
    router.push("/");
  }
};
</script>
