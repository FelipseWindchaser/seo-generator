<!-- /components/GenerationResult.vue -->
<template>
  <div>
    <!-- Загрузка -->
    <div v-if="status === 'processing'" class="text-center py-12">
      <LoadingSpinner class="mx-auto mb-4" :size="40" />
      <p class="text-gray-600">Генерируем оптимизированное описание...</p>
      <p class="text-sm text-gray-500 mt-2">Это может занять 10-30 секунд</p>
    </div>

    <!-- Ошибка -->
    <div
      v-else-if="status === 'error'"
      class="bg-red-50 border border-red-200 rounded-lg p-6"
    >
      <h3 class="text-lg font-medium text-red-800 mb-2">Ошибка генерации</h3>
      <p class="text-red-600">{{ error }}</p>
      <button
        @click="$emit('reset')"
        class="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
      >
        Попробовать снова
      </button>
    </div>

    <!-- Результат -->
    <div v-else-if="status === 'completed' && result" class="space-y-6">
      <div class="bg-green-50 border border-green-200 rounded-lg p-4">
        <h2 class="text-xl font-semibold text-green-800 mb-2">
          ✅ Описание готово!
        </h2>
      </div>

      <!-- Метрики -->
      <div class="bg-gray-50 rounded-lg p-4">
        <h3 class="font-medium text-gray-900 mb-3">Метрики</h3>
        <div class="space-y-2">
          <div class="flex justify-between">
            <span class="text-gray-600">Символов:</span
            ><span class="font-medium">{{ result.metrics?.charCount }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Использовано ключей:</span
            ><span class="font-medium"
              >{{ result.metrics?.keywordsUsed }} из
              {{ result.metrics?.totalKeywords }}</span
            >
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Плотность ключей:</span
            ><span class="font-medium"
              >{{ result.metrics?.keywordDensity }}%</span
            >
          </div>
        </div>
      </div>

      <!-- Предупреждения валидатора -->
      <div
        v-if="result.warnings && result.warnings.length > 0"
        class="bg-yellow-50 border border-yellow-200 rounded-lg p-4"
      >
        <h4 class="font-medium text-yellow-800 mb-2">
          ⚠️ Замечания валидатора:
        </h4>
        <ul class="list-disc list-inside text-sm text-yellow-700 space-y-1">
          <li v-for="(warning, index) in result.warnings" :key="index">
            {{ warning }}
          </li>
        </ul>
      </div>

      <!-- Контент -->
      <div class="bg-white border border-gray-200 rounded-lg p-6">
        <div class="prose max-w-none" v-html="formattedContent" />
      </div>

      <!-- НОВЫЙ БЛОК: УЛУЧШИТЬ РЕЗУЛЬТАТ -->
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 class="font-medium text-gray-900 mb-3">Улучшить результат</h3>
        <p class="text-sm text-gray-600 mb-3">
          Не понравился результат? Опишите, что нужно изменить, и ИИ перепишет
          текст, сохранив SEO-требования.
        </p>
        <textarea
          v-model="refinementPrompt"
          rows="3"
          class="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          placeholder="Например: Сделай текст более официальным. Добавь абзац про пользу для здоровья. Убери предложение про гарантию."
        ></textarea>
        <button
          @click="handleRefinement"
          :disabled="isRefining || !refinementPrompt.trim()"
          class="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center"
        >
          <LoadingSpinner v-if="isRefining" class="mr-2" :size="20" />
          {{ isRefining ? "Улучшаем..." : "🚀 Улучшить" }}
        </button>
        <p v-if="refinementError" class="text-sm text-red-600 mt-2">
          {{ refinementError }}
        </p>
      </div>

      <!-- Кнопки действий -->
      <div class="flex gap-4">
        <button
          @click="copyToClipboard"
          class="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          {{ copied ? "✅ Скопировано!" : "📋 Скопировать текст" }}
        </button>
        <button
          @click="$emit('reset')"
          class="flex-1 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Создать новое описание
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GenerationResult, GenerationRequest } from "~/types";

const props = defineProps<{
  taskId: string;
}>();

const emit = defineEmits<{
  reset: [];
}>();

// Состояние
const status = ref<"processing" | "completed" | "error">("processing");
const result = ref<GenerationResult | null>(null);
const originalRequest = ref<GenerationRequest | null>(null); // Храним исходный запрос
const error = ref<string>("");
const copied = ref(false);

// Состояние для блока улучшения
const refinementPrompt = ref("");
const isRefining = ref(false);
const refinementError = ref("");

// Проверка статуса
const checkStatus = async () => {
  try {
    const response = (await $fetch(`/api/status/${props.taskId}`)) as any;

    // --- DEBUG LOG ---
    console.log("[checkStatus] Received status response:", response);

    if (response.status === "completed") {
      status.value = "completed";
      result.value = response?.result || null;
      // --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ ---
      // Сохраняем исходный запрос из ответа API
      originalRequest.value = response?.request || null;

      // --- DEBUG LOG ---
      console.log(
        "[checkStatus] Task completed. Result populated:",
        !!result.value
      );
      console.log(
        "[checkStatus] Original request populated:",
        !!originalRequest.value,
        originalRequest.value
      );

      if (!result.value) {
        status.value = "error";
        error.value = "Задача завершена, но результат генерации отсутствует.";
      }
    } else if (response.status === "error") {
      status.value = "error";
      error.value =
        response.result?.content || "Произошла неизвестная ошибка на сервере.";
    }
  } catch (err) {
    status.value = "error";
    error.value =
      "Не удалось получить статус задачи. Возможно, проблема с сетью или сервером.";
    console.error(err);
  }
};

// Обработка запроса на улучшение
const handleRefinement = async () => {
  // --- DEBUG LOG ---
  console.log("--- [handleRefinement] CLICKED ---");
  console.log("Checking guard conditions...");
  console.log(
    `1. Refinement Prompt Present:`,
    !!refinementPrompt.value.trim(),
    `(Value: "${refinementPrompt.value}")`
  );
  console.log(
    `2. Result Description Present:`,
    !!result.value?.description,
    `(Value: "${result.value?.description?.substring(0, 30)}...")`
  );
  console.log(
    `3. Original Request Present:`,
    !!originalRequest.value,
    `(Value:`,
    originalRequest.value,
    `)`
  );

  if (
    !refinementPrompt.value.trim() ||
    !result.value?.description ||
    !originalRequest.value
  ) {
    console.error("[handleRefinement] Guard condition FAILED. Aborting.");
    refinementError.value =
      "Не все данные для улучшения готовы. Попробуйте обновить страницу.";
    return;
  }

  isRefining.value = true;
  refinementError.value = "";

  const payload = {
    originalContent: result.value.description,
    userPrompt: refinementPrompt.value,
    generationData: originalRequest.value,
  };

  console.log("[handleRefinement] Payload to be sent:", payload);

  try {
    const newResult = await $fetch<GenerationResult>("/api/refine", {
      method: "POST",
      body: payload,
    });

    console.log("[handleRefinement] SUCCESS. Received new result:", newResult);
    result.value = newResult;
    refinementPrompt.value = "";
  } catch (err: any) {
    console.error("[handleRefinement] FAILED. API call error:", err);
    refinementError.value = err.data?.message || "Не удалось улучшить текст.";
  } finally {
    isRefining.value = false;
  }
};

// Форматирование контента
const formattedContent = computed(() => {
  if (!result.value?.content) return "";
  return result.value.content
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
});

// Копирование в буфер обмена
const copyToClipboard = async () => {
  if (!result.value?.content) return;
  try {
    await navigator.clipboard.writeText(result.value.content);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (err) {
    console.error("Failed to copy:", err);
  }
};

// Хуки жизненного цикла
let intervalId: NodeJS.Timeout;
onMounted(() => {
  checkStatus(); // Первая проверка сразу
  intervalId = setInterval(() => {
    if (status.value === "processing") {
      checkStatus();
    } else {
      clearInterval(intervalId);
    }
  }, 2000);
});

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId);
  }
});
</script>
