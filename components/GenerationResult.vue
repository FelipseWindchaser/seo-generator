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

      <!-- Блок Улучшения и Сохранения -->
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 class="font-medium text-gray-900 mb-3">Улучшить или Сохранить</h3>
        <p class="text-sm text-gray-600 mb-3">
          Вы можете внести правки с помощью ИИ или сохранить текущий результат,
          даже если он не прошел валидацию.
        </p>
        <textarea
          v-model="refinementPrompt"
          rows="3"
          class="w-full p-2 border border-gray-300 rounded-md"
          placeholder="Например: Сделай текст более официальным..."
        ></textarea>

        <div class="mt-3 flex flex-col sm:flex-row gap-2">
          <button
            @click="handleRefinement"
            :disabled="isRefining || !refinementPrompt.trim()"
            class="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center"
          >
            <LoadingSpinner v-if="isRefining" class="mr-2" :size="20" />
            {{ isRefining ? "Улучшаем..." : "🚀 Улучшить по промпту" }}
          </button>

          <button
            @click="handleSave"
            :disabled="isSaving"
            class="flex-1 px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700 disabled:bg-gray-400 flex items-center justify-center"
          >
            <LoadingSpinner v-if="isSaving" class="mr-2" :size="20" />
            {{ isSaving ? "Сохраняем..." : "💾 Сохранить текущий результат" }}
          </button>
        </div>

        <p v-if="refinementError" class="text-sm text-red-600 mt-2">
          {{ refinementError }}
        </p>
        <p v-if="saveSuccessMessage" class="text-sm text-green-600 mt-2">
          {{ saveSuccessMessage }}
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

// const hasBeenRefined = ref(false);
const isSaving = ref(false);
const saveSuccessMessage = ref("");

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

  // 1. Проверка наличия всех необходимых данных
  if (
    !refinementPrompt.value.trim() ||
    !result.value?.description ||
    !originalRequest.value
  ) {
    const errorMessage =
      "Не все данные для улучшения готовы. Попробуйте обновить страницу.";
    console.error("[handleRefinement] Guard condition FAILED. Aborting.", {
      prompt: !!refinementPrompt.value.trim(),
      description: !!result.value?.description,
      request: !!originalRequest.value,
    });
    refinementError.value = errorMessage;
    return;
  }

  isRefining.value = true;
  refinementError.value = "";

  // 2. Формирование тела запроса (payload). Этот код уже правильный.
  const payload = {
    originalContent: result.value.description,
    userPrompt: refinementPrompt.value,
    data: originalRequest.value,
    originalTitle: result.value.title,
  };

  console.log("[handleRefinement] Payload to be sent:", payload);

  try {
    // 3. ИСПРАВЛЕНО: Ожидаем от API полноценный объект GenerationResult
    const newResult = await $fetch<GenerationResult>("/api/refine", {
      method: "POST",
      body: payload,
    });

    console.log(
      "[handleRefinement] SUCCESS. Received new full result:",
      newResult
    );

    // 4. ИСПРАВЛЕНО: Полностью заменяем старый результат новым.
    // Это гарантирует, что все поля (включая вложенные метрики) будут корректными.
    result.value = newResult;

    refinementPrompt.value = ""; // Очищаем поле ввода после успеха
  } catch (err: any) {
    // 5. ИСПРАВЛЕНО: Улучшенная обработка ошибок
    console.error("[handleRefinement] FAILED. API call error object:", err);

    // Сначала пытаемся достать сообщение из данных ошибки, если они есть
    if (err.data && err.data.message) {
      refinementError.value = `Ошибка сервера: ${err.data.message}`;
    }
    // Если данных нет, но есть статусное сообщение от h3/ofetch
    else if (err.statusMessage) {
      refinementError.value = `Ошибка сервера (${err.statusCode || ""}): ${
        err.statusMessage
      }`;
    }
    // Самый крайний случай (например, CORS или проблемы с сетью)
    else {
      refinementError.value =
        "Произошла неизвестная ошибка при связи с сервером.";
    }
  } finally {
    isRefining.value = false;
  }
};

// НОВАЯ ФУНКЦИЯ: Сохранение результата
const handleSave = async () => {
  if (!result.value) return;

  isSaving.value = true;
  saveSuccessMessage.value = "";
  refinementError.value = "";

  try {
    await $fetch(`/api/tasks/${props.taskId}`, {
      method: "PUT",
      body: {
        result: result.value, // Отправляем весь текущий объект результата
      },
    });

    saveSuccessMessage.value = "✅ Результат успешно сохранен!";
    // hasBeenRefined.value = false; // Сбрасываем флаг, так как текущее состояние сохранено
    setTimeout(() => (saveSuccessMessage.value = ""), 3000); // Убираем сообщение через 3 сек
  } catch (err: any) {
    console.error("Save failed:", err);
    refinementError.value =
      err.data?.message || "Не удалось сохранить результат.";
  } finally {
    isSaving.value = false;
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
