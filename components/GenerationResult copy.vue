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
        @click="handleRetry"
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
      <div v-if="result.metrics" class="bg-gray-50 rounded-lg p-4">
        <h3 class="font-medium text-gray-900 mb-3">Метрики</h3>
        <div class="space-y-4">
          <!-- Общие метрики -->
          <div class="text-sm space-y-1">
            <div class="flex justify-between">
              <span class="text-gray-600">Символов:</span>
              <span class="font-medium">{{ result.metrics.charCount }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600"
                >Плотность (по обязательным ключам):</span
              >
              <span class="font-medium"
                >{{ result.metrics.keywordDensity?.toFixed(2) }}%</span
              >
            </div>
          </div>

          <!-- Детализация по обязательным ключам -->
          <div class="pt-3 border-t border-gray-200">
            <!-- ИЗМЕНЕНО: Заголовок и счетчик объединены в одну строку -->
            <div class="flex justify-between items-baseline text-sm mb-2">
              <h4 class="font-semibold text-gray-800">Обязательные ключи</h4>
              <span class="font-medium text-gray-600">
                {{ result.metrics.requiredKeywordsUsed }} /
                {{ result.metrics.requiredKeywordsTotal }}
              </span>
            </div>
            <!-- Обертка для таблицы с рамкой -->
            <div class="border border-gray-200 rounded-md bg-white">
              <!-- ИЗМЕНЕНО: Стилизован заголовок таблицы -->
              <div
                class="flex justify-between text-xs font-semibold text-gray-500 uppercase px-2 py-1.5 bg-gray-100 border-b border-gray-200"
              >
                <span>Ключ</span>
                <span>Кол-во</span>
              </div>
              <ul class="text-xs">
                <li
                  v-for="(keyword, index) in requiredKeywordsList"
                  :key="keyword.name"
                  class="flex justify-between items-center py-1.5 px-2"
                  :class="{ 'border-t border-gray-100': index > 0 }"
                >
                  <span class="text-gray-600">{{ keyword.name }}</span>
                  <span
                    :class="
                      keyword.count > 0 ? 'text-green-600' : 'text-red-600'
                    "
                    class="font-mono bg-gray-200 px-1.5 py-0.5 rounded"
                  >
                    {{ keyword.count }}
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <!-- Детализация по необязательным ключам -->
          <div class="pt-3 border-t border-gray-200">
            <!-- ИЗМЕНЕНО: Заголовок и счетчик объединены в одну строку -->
            <div class="flex justify-between items-baseline text-sm mb-2">
              <h4 class="font-semibold text-gray-800">Необязательные ключи</h4>
              <span class="font-medium text-gray-600">
                {{ result.metrics.optionalKeywordsUsed }} /
                {{ result.metrics.optionalKeywordsTotal }}
              </span>
            </div>
            <!-- Обертка для таблицы с рамкой -->
            <div class="border border-gray-200 rounded-md bg-white">
              <!-- ИЗМЕНЕНО: Стилизован заголовок таблицы -->
              <div
                class="flex justify-between text-xs font-semibold text-gray-500 uppercase px-2 py-1.5 bg-gray-100 border-b border-gray-200"
              >
                <span>Ключ</span>
                <span>Кол-во</span>
              </div>
              <ul class="text-xs">
                <li
                  v-for="(keyword, index) in optionalKeywordsList"
                  :key="keyword.name"
                  class="flex justify-between items-center py-1.5 px-2"
                  :class="{ 'border-t border-gray-100': index > 0 }"
                >
                  <span class="text-gray-600">{{ keyword.name }}</span>
                  <span class="font-mono bg-gray-200 px-1.5 py-0.5 rounded">{{
                    keyword.count
                  }}</span>
                </li>
              </ul>
            </div>
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
          @click="$emit('reset', null)"
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
  (e: "reset", payload: GenerationRequest | null): void;
}>();

const status = ref<"processing" | "completed" | "error">("processing");
const result = ref<GenerationResult | null>(null);
const originalRequest = ref<GenerationRequest | null>(null);
const error = ref<string>("");
const copied = ref(false);

const refinementPrompt = ref("");
const isRefining = ref(false);
const refinementError = ref("");
const isSaving = ref(false);
const saveSuccessMessage = ref("");

// const checkStatus = async () => {
//   try {
//     const response = (await $fetch(`/api/status/${props.taskId}`)) as any;
//     if (response.status === "completed") {
//       status.value = "completed";
//       result.value = response?.result || null;
//       originalRequest.value = response?.request || null;
//       if (!result.value) {
//         status.value = "error";
//         error.value = "Задача завершена, но результат генерации отсутствует.";
//       }
//     } else if (response.status === "error") {
//       status.value = "error";
//       error.value =
//         response.result?.content || "Произошла неизвестная ошибка на сервере.";
//     }
//   } catch (err: any) {
//     // Обработка HTTP-ошибок, которые выбросил $fetch
//     status.value = "error";
//     console.error("Failed to fetch task status:", err);

//     // Проверяем наличие statusCode в объекте ошибки
//     if (err.statusCode) {
//       switch (err.statusCode) {
//         case 404:
//           error.value =
//             "Задача не найдена. Возможно, вы открыли неверную или устаревшую ссылку.";
//           break;
//         case 500:
//           error.value =
//             "Произошла критическая ошибка на сервере. Пожалуйста, попробуйте позже.";
//           break;
//         case 400:
//           error.value = `Некорректный запрос к серверу: ${
//             err.data?.message || "проверьте данные"
//           }.`;
//           break;
//         // case 503:
//         //   error.value = "Сервис перегружен. Пожалуйста, попробуйте позже.";
//         //   break;
//         default:
//           error.value = `Произошла ошибка сети (код: ${err.statusCode}). Пожалуйста, проверьте ваше подключение.`;
//           break;
//       }
//     } else {
//       // Если statusCode отсутствует, скорее всего, это проблема с сетью (CORS, DNS и т.д.)
//       error.value =
//         "Не удалось связаться с сервером. Проверьте ваше интернет-соединение.";
//     }
//     // Останавливаем интервал, так как произошла окончательная ошибка
//     if (intervalId) {
//       clearInterval(intervalId);
//     }
//   }
// };
const checkStatus = async () => {
  try {
    const response = (await $fetch(`/api/status/${props.taskId}`)) as any;

    // --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ ---
    // Всегда обновляем originalRequest, если он пришел с сервера.
    // Это гарантирует, что у нас всегда будут данные для повторной попытки.
    if (response && response.request) {
      originalRequest.value = response.request;
      console.log(
        "[checkStatus] Original request data has been updated/confirmed."
      );
    }

    // Теперь обрабатываем статус задачи
    if (response.status === "completed") {
      status.value = "completed";
      result.value = response.result || null;
      if (!result.value) {
        status.value = "error";
        error.value = "Задача завершена, но результат генерации пуст.";
      }
    } else if (response.status === "error") {
      status.value = "error";
      error.value =
        response.result?.content ||
        "Произошла неизвестная ошибка в процессе генерации.";
    }
    // Если статус 'processing', мы ничего не делаем, просто ждем следующего вызова.
  } catch (err: any) {
    status.value = "error";
    console.error("Failed to fetch task status:", err);

    if (err.statusCode) {
      switch (err.statusCode) {
        case 404:
          error.value =
            "Задача не найдена. Возможно, вы открыли неверную или устаревшую ссылку.";
          break;
        case 500:
          error.value =
            "Произошла критическая ошибка на сервере. Пожалуйста, попробуйте позже.";
          break;
        case 400:
          error.value = `Некорректный запрос к серверу: ${
            err.data?.message || "проверьте данные"
          }.`;
          break;
        default:
          error.value = `Произошла ошибка сети (код: ${err.statusCode}). Пожалуйста, проверьте ваше подключение.`;
          break;
      }
    } else {
      error.value =
        "Не удалось связаться с сервером. Проверьте ваше интернет-соединение.";
    }

    if (intervalId) {
      clearInterval(intervalId);
    }
  }
};

const handleRetry = () => {
  console.log("--- [handleRetry] CLICKED ---");
  console.log(
    "Value of originalRequest at the moment of retry:",
    originalRequest.value
  );
  emit("reset", originalRequest.value);
};

const requiredKeywordsList = computed(() => {
  if (!originalRequest.value || !result.value?.metrics?.keywordUsageDetails) {
    return [];
  }
  return originalRequest.value.requiredKeywords.map((keywordName) => ({
    name: keywordName,
    count: result.value?.metrics?.keywordUsageDetails[keywordName]?.count || 0,
  }));
});

const optionalKeywordsList = computed(() => {
  if (!originalRequest.value || !result.value?.metrics?.keywordUsageDetails) {
    return [];
  }
  return originalRequest.value.optionalKeywords.map((keywordName) => ({
    name: keywordName,
    count: result.value?.metrics?.keywordUsageDetails[keywordName]?.count || 0,
  }));
});

const handleRefinement = async () => {
  if (
    !refinementPrompt.value.trim() ||
    !result.value?.description ||
    !originalRequest.value
  ) {
    refinementError.value = "Не все данные для улучшения готовы.";
    return;
  }
  isRefining.value = true;
  refinementError.value = "";
  saveSuccessMessage.value = "";
  const payload = {
    productName: originalRequest.value.productName,
    originalContent: result.value.description,
    userPrompt: refinementPrompt.value,
    generationData: originalRequest.value,
    originalTitle: result.value.title,
  };

  // --- ДИАГНОСТИЧЕСКИЙ ЛОГ ---
  console.log(
    "Sending this payload to /api/refine:",
    JSON.stringify(payload, null, 2)
  );
  try {
    const newResult = await $fetch<GenerationResult>("/api/refine", {
      method: "POST",
      body: payload,
    });
    result.value = newResult;
    refinementPrompt.value = "";
  } catch (err: any) {
    refinementError.value = err.data?.message || "Не удалось улучшить текст.";
    console.error("Validation error details from server:", err.data);
  } finally {
    isRefining.value = false;
  }
};

const handleSave = async () => {
  if (!result.value) return;
  isSaving.value = true;
  saveSuccessMessage.value = "";
  refinementError.value = "";

  try {
    await $fetch(`/api/tasks/${props.taskId}`, {
      method: "PUT",
      body: { result: result.value },
    });
    saveSuccessMessage.value = "✅ Результат успешно сохранен!";
    setTimeout(() => (saveSuccessMessage.value = ""), 3000);
  } catch (err: any) {
    refinementError.value =
      err.data?.message || "Не удалось сохранить результат.";
  } finally {
    isSaving.value = false;
  }
};

const formattedContent = computed(() => {
  if (!result.value?.content) return "";
  return result.value.content
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
});

// --- НОВОЕ ВЫЧИСЛЯЕМОЕ СВОЙСТВО ---
// "Чистый" текст без Markdown для копирования
const plainTextContent = computed(() => {
  if (!result.value?.content) return "";
  // Удаляем ** и заменяем <br> обратно на переносы строк
  return result.value.content.replace(/\*\*/g, "").replace(/<br>/g, "\n");
});

const copyToClipboard = async () => {
  if (!plainTextContent.value) return;
  try {
    await navigator.clipboard.writeText(plainTextContent.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (err) {
    console.error("Failed to copy:", err);
  }
};

let intervalId: NodeJS.Timeout;
onMounted(() => {
  checkStatus();
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
