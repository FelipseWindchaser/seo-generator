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
    <div v-else-if="status === 'completed'" class="space-y-6">
      <div class="bg-green-50 border border-green-200 rounded-lg p-4">
        <h2 class="text-xl font-semibold text-green-800 mb-2">
          ✅ Описание готово!
        </h2>
      </div>

      <!-- Метрики -->
      <div v-if="result" class="bg-gray-50 rounded-lg p-4">
        <h3 class="font-medium text-gray-900 mb-3">Метрики</h3>
        <div class="space-y-2">
          <div class="flex justify-between">
            <span class="text-gray-600">Символов:</span>
            <span class="font-medium">{{ result.metrics?.charCount }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600"> Использовано ключей:</span>
            <span class="font-medium">
              {{ result.metrics?.keywordsUsed }} из
              {{ result.metrics?.totalKeywords }}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Плотность ключей:</span>
            <span class="font-medium"
              >{{ result.metrics?.keywordDensity }}%</span
            >
          </div>
          <div class="flex justify-between">
            <!-- <span class="text-gray-600">Попыток генерации:</span> -->
            <!-- <span class="font-medium">{{ result.attempts }}</span> -->
          </div>
        </div>
      </div>
      <!-- Предупреждения валидатора -->
      <div
        v-if="result && result.warnings && result.warnings.length > 0"
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
      <!-- Ход автоматических правок -->
      <div
        v-if="
          result &&
          result.processingLog &&
          (result.processingLog.added.length > 0 ||
            result.processingLog.removed.length > 0)
        "
        class="bg-gray-50 rounded-lg p-4"
      >
        <h3 class="font-medium text-gray-900 mb-3">
          Ход автоматических правок
        </h3>
        <div class="space-y-4 text-sm">
          <!-- Блок добавленного текста -->
          <div v-if="result.processingLog.added.length > 0">
            <h4 class="font-medium text-green-700 mb-2">
              ✅ Добавлено для увеличения объема:
            </h4>
            <div
              v-for="(paragraph, index) in result.processingLog.added"
              :key="`added-${index}`"
              class="bg-green-100 border-l-4 border-green-500 text-green-800 p-3"
            >
              <p class="italic">{{ paragraph }}</p>
            </div>
          </div>

          <!-- Блок удаленного текста -->
          <div v-if="result.processingLog.removed.length > 0">
            <h4 class="font-medium text-red-700 mb-2">
              ❌ Удалено для сокращения объема:
            </h4>
            <div
              v-for="(sentence, index) in result.processingLog.removed"
              :key="`removed-${index}`"
              class="bg-red-100 border-l-4 border-red-500 text-red-800 p-3"
            >
              <p class="italic line-through">{{ sentence }}</p>
            </div>
          </div>
        </div>
      </div>

      <div v-else>
        <p class="text-sm text-gray-600 italic">
          Автоматические правки не потребовались, текст сгенерирован в пределах
          заданных лимитов.
        </p>
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
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GenerationResult, Task } from "~/types";

const props = defineProps<{
  taskId: string;
}>();

const emit = defineEmits<{
  reset: [];
}>();

// Состояние
const status = ref<"processing" | "completed" | "error">("processing");
const result = ref<GenerationResult | null>(null);
const error = ref<string>(""); // Эта переменная будет хранить текст ошибки для отображения
const copied = ref(false);

// Проверка статуса
const checkStatus = async () => {
  try {
    // Получаем с API полный объект задачи
    const response = (await $fetch(`/api/status/${props.taskId}`)) as any;
    console.log("Status check response:", response);

    if (response.status === "completed") {
      status.value = "completed";
      result.value = response?.result || null;
      // Дополнительная проверка на случай, если результат пустой
      if (!result.value) {
        status.value = "error";
        error.value = "Задача завершена, но результат генерации отсутствует.";
      }
    } else if (response.status === "error") {
      status.value = "error";
      // --- КЛЮЧЕВАЯ ЛОГИКА ЗДЕСЬ ---
      // Извлекаем сообщение об ошибке из поля result.content, как мы его сохранили на бэкенде.
      // Добавляем запасной вариант, если result или content отсутствуют.
      error.value =
        response.result?.content || "Произошла неизвестная ошибка на сервере.";
      console.log("Error:", error.value);
      // -----------------------------
    }
    // Если статус 'processing', ничего не делаем, цикл продолжится
  } catch (err) {
    status.value = "error";
    // Эта ошибка срабатывает, если сам API-запрос не удался (например, 404 или 500)
    error.value =
      "Не удалось получить статус задачи. Возможно, проблема с сетью или сервером.";
    console.error(err);
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
  }, 2000);
});

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId);
  }
});
</script>
