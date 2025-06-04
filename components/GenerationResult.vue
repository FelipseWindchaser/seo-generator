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
            <span class="text-gray-600">Символов:</span>
            <span class="font-medium">{{ result.metrics.charCount }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Использовано ключей:</span>
            <span class="font-medium">
              {{ result.metrics.keywordsUsed }} из
              {{ result.metrics.totalKeywords }}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Плотность ключей:</span>
            <span class="font-medium"
              >{{ result.metrics.keywordDensity }}%</span
            >
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Попыток генерации:</span>
            <span class="font-medium">{{ result.attempts }}</span>
          </div>
        </div>
      </div>

      <!-- Контент -->
      <div class="bg-white border border-gray-200 rounded-lg p-6">
        <div class="prose max-w-none" v-html="formattedContent" />
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

      <!-- Предупреждения -->
      <div
        v-if="result.warnings && result.warnings.length > 0"
        class="bg-yellow-50 border border-yellow-200 rounded-lg p-4"
      >
        <h4 class="font-medium text-yellow-800 mb-2">⚠️ Внимание:</h4>
        <ul class="list-disc list-inside text-sm text-yellow-700">
          <li v-for="warning in result.warnings" :key="warning">
            {{ warning }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GenerationResult } from "~/types";

const props = defineProps<{
  taskId: string;
}>();

const emit = defineEmits<{
  reset: [];
}>();

// Состояние
const status = ref<"processing" | "completed" | "error">("processing");
const result = ref<GenerationResult | null>(null);
const error = ref<string>("");
const copied = ref(false);

// Проверка статуса
const checkStatus = async () => {
  try {
    const response = await $fetch(`/api/status/${props.taskId}`);

    if (response.status === "completed") {
      status.value = "completed";
      result.value = response.result;
    } else if (response.status === "error") {
      status.value = "error";
      error.value = response.error || "Неизвестная ошибка";
    } else if (response.status === "not_found") {
      status.value = "error";
      error.value = "Задача не найдена";
    }
    // Если processing - продолжаем проверку
  } catch (err) {
    status.value = "error";
    error.value = "Ошибка при проверке статуса";
  }
};

// Форматирование контента (преобразование ** в <strong>)
const formattedContent = computed(() => {
  if (!result.value) return "";

  return result.value.content
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
});

// Копирование в буфер обмена
const copyToClipboard = async () => {
  if (!result.value) return;

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

// Периодическая проверка статуса
let intervalId: NodeJS.Timeout;

onMounted(() => {
  checkStatus(); // Первая проверка сразу

  intervalId = setInterval(() => {
    if (status.value === "processing") {
      checkStatus();
    } else {
      clearInterval(intervalId);
    }
  }, 2000); // Проверяем каждые 2 секунды
});

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId);
  }
});
</script>
