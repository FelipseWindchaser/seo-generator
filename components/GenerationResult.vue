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
      <transition name="fade">
        <div
          v-if="showGenerationSuccessBanner"
          class="bg-green-50 border border-green-200 rounded-lg p-4 text-center"
        >
          <h2 class="text-xl font-semibold text-green-800">
            ✅ Описание успешно сгенерировано!
          </h2>
        </div>
      </transition>

      <!-- Панель вариаций -->
      <div
        v-if="result.variations && result.variations.length > 1"
        class="bg-white border border-slate-200 rounded-lg p-4"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-medium text-slate-600 mr-2">Вариации:</span>
          <button
            v-for="(variation, index) in result.variations"
            :key="index"
            @click="currentVariationIndex = index"
            class="px-3 py-1 text-sm font-semibold rounded-full transition-colors"
            :class="
              currentVariationIndex === index
                ? 'bg-blue-600 text-white'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            "
          >
            {{ index + 1 }}
          </button>
        </div>
      </div>

      <!-- БЛОК 1: МЕТРИКИ ВАЛИДАТОРА -->
      <div
        v-if="activeVariation.metrics"
        class="bg-slate-50 border border-slate-200 rounded-lg p-6 transition-colors"
        :class="{ 'flash-success': metricsJustUpdated }"
      >
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold text-slate-800">SEO Метрики</h3>
        </div>
        <div class="flex flex-col space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-slate-600">Символов:</span>
            <span class="font-medium text-slate-900">{{
              activeVariation.metrics.charCount
            }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-600">Плотность (обязательные ключи):</span>
            <span class="font-medium text-slate-900"
              >{{ activeVariation.metrics.keywordDensity?.toFixed(2) }}%</span
            >
          </div>
        </div>
      </div>

      <!-- ИЗМЕНЕНО: Возвращаем блок с предупреждениями и привязываем к activeVariation -->
      <div
        v-if="
          activeVariation.metrics?.warnings &&
          activeVariation.metrics.warnings.length > 0
        "
        class="bg-yellow-50 border border-yellow-200 rounded-lg p-6"
      >
        <h3 class="text-lg font-semibold text-yellow-900 mb-3">
          ⚠️ Замечания валидатора
        </h3>
        <ul class="list-disc list-inside text-sm text-yellow-800 space-y-1">
          <li
            v-for="(warning, index) in activeVariation.metrics.warnings"
            :key="index"
          >
            {{ warning }}
          </li>
        </ul>
      </div>

      <!-- БЛОК: АНАЛИЗ СОДЕРЖАНИЯ -->
      <div
        v-if="activeVariation.analysis"
        class="bg-slate-50 border border-slate-200 rounded-lg p-6"
      >
        <h3 class="text-lg font-semibold text-slate-800 mb-4">
          Анализ содержания
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <!-- Колонка УТП -->
          <div>
            <h4 class="font-semibold text-slate-700 mb-3">Раскрытие УТП</h4>
            <ul class="space-y-4">
              <li
                v-for="(item, index) in activeVariation.analysis.utpAnalysis"
                :key="`utp-${index}`"
              >
                <div class="flex items-start">
                  <span class="mr-3 text-xl">{{
                    item.isCovered ? "✅" : "❌"
                  }}</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-slate-800">
                      {{ item.point }}
                    </p>
                    <blockquote
                      v-if="item.isCovered"
                      class="mt-1 text-xs text-slate-500 border-l-2 border-green-400 pl-2 italic"
                    >
                      "{{ item.evidence }}"
                    </blockquote>
                  </div>
                </div>
              </li>
            </ul>
          </div>
          <!-- Колонка Болей -->
          <div>
            <h4 class="font-semibold text-slate-700 mb-3">
              Отработка "болей" из отзывов
            </h4>
            <ul class="space-y-4">
              <li
                v-for="(item, index) in activeVariation.analysis
                  .painPointAnalysis"
                :key="`pain-${index}`"
              >
                <div class="flex items-start">
                  <span class="mr-3 text-xl">{{
                    item.isCovered ? "✅" : "❌"
                  }}</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-slate-800">
                      {{ item.point }}
                    </p>
                    <blockquote
                      v-if="item.isCovered"
                      class="mt-1 text-xs text-slate-500 border-l-2 border-green-400 pl-2 italic"
                    >
                      "{{ item.evidence }}"
                    </blockquote>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Сообщение об успехе сохранения для редактора -->
      <transition name="fade">
        <div
          v-if="editorSaveSuccessMessage"
          class="bg-green-100 border border-green-200 text-green-800 text-sm font-medium rounded-lg p-4 text-center"
        >
          {{ editorSaveSuccessMessage }}
        </div>
      </transition>

      <!-- БЛОК 3: РЕДАКТОР ТЕКСТА И ОСНОВНЫЕ ДЕЙСТВИЯ -->
      <div class="bg-white border border-slate-200 rounded-lg p-6">
        <div class="flex justify-between items-center">
          <h3 class="text-lg font-semibold text-slate-800">
            Ваше SEO-описание
          </h3>
          <div class="flex items-center gap-4">
            <div v-if="isEditing" class="flex items-center gap-2">
              <button
                @click="cancelEdits"
                class="px-4 py-2 bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-sm font-medium transition-colors hover:bg-slate-200 hover:border-slate-300"
              >
                Отменить
              </button>
              <button
                @click="commitEdits"
                class="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-md text-sm font-medium transition-colors hover:bg-green-600"
              >
                <span>✅</span>
                <span>Сохранить</span>
              </button>
            </div>
            <button
              v-else
              @click="startEditing"
              class="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-sm font-medium transition-colors hover:bg-slate-200 hover:border-slate-300"
            >
              <span>✏️</span>
              <span>Редактировать</span>
            </button>
          </div>
        </div>

        <div class="mt-4 pt-4 border-t border-slate-200">
          <div
            v-if="!isEditing"
            class="prose max-w-none prose-slate"
            v-html="formattedContent"
          />
          <textarea
            v-else
            v-model="editableContent"
            rows="15"
            class="w-full p-3 border border-slate-300 rounded-md font-mono text-sm focus:ring-blue-500 focus:border-blue-500 transition bg-slate-50"
          ></textarea>
        </div>

        <div
          class="mt-6 pt-6 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <button
            @click="handleRegenerate"
            :disabled="isRegenerating"
            class="w-full px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:bg-slate-400 flex items-center justify-center text-sm font-medium"
          >
            <LoadingSpinner v-if="isRegenerating" class="mr-2" :size="16" />
            {{ isRegenerating ? "Пересоздаем..." : "♻️ Перегенерировать" }}
          </button>

          <button
            @click="copyToClipboard"
            class="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center justify-center text-sm font-medium"
          >
            {{ copied ? "✅ Скопировано!" : "📋 Скопировать текст" }}
          </button>

          <button
            @click="$emit('reset', null)"
            class="w-full px-4 py-2 bg-slate-600 text-white rounded-md hover:bg-slate-700 text-sm font-medium flex items-center justify-center"
          >
            Создать новое описание
          </button>
        </div>
      </div>

      <!-- БЛОК 4: УЛУЧШЕНИЕ С ПОМОЩЬЮ ИИ (REFINE) -->
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-6">
        <h3 class="text-lg font-semibold text-slate-800 mb-2">
          Улучшить с помощью ИИ
        </h3>
        <p class="text-sm text-slate-600 mb-4">
          Введите команду, чтобы точечно изменить текст. Например: "Сделай тон
          более официальным" или "Добавь эмодзи в конце".
        </p>
        <textarea
          v-model="refinementPrompt"
          rows="3"
          class="w-full p-3 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 transition"
          placeholder="Ваша команда для ИИ..."
        ></textarea>
        <div class="mt-4 flex flex-col sm:flex-row gap-4">
          <button
            @click="handleRefinement"
            :disabled="isRefining || !refinementPrompt.trim()"
            class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-slate-400 flex items-center justify-center font-medium"
          >
            <LoadingSpinner v-if="isRefining" class="mr-2" :size="20" />
            {{ isRefining ? "Улучшаем..." : "🚀 Отправить команду" }}
          </button>
          <button
            @click="handleSave('refine')"
            :disabled="isSaving"
            class="flex-1 px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:bg-slate-400 flex items-center justify-center font-medium"
          >
            <LoadingSpinner v-if="isSaving" class="mr-2" :size="20" />
            {{ isSaving ? "Сохраняем..." : "💾 Сохранить результат" }}
          </button>
        </div>
        <transition name="fade">
          <div
            v-if="refineSaveSuccessMessage"
            class="mt-4 bg-green-100 border border-green-200 text-green-800 text-sm font-medium rounded-lg p-4 text-center"
          >
            {{ refineSaveSuccessMessage }}
          </div>
        </transition>
        <transition name="fade">
          <div
            v-if="refinementError"
            class="mt-4 bg-red-100 border border-red-200 text-red-800 text-sm font-medium rounded-lg p-4 text-center"
          >
            {{ refinementError }}
          </div>
        </transition>
      </div>

      <!-- БЛОК 5: РАСШИФРОВКА КЛЮЧЕВЫХ СЛОВ -->
      <div
        v-if="activeVariation.metrics"
        class="bg-slate-50 border border-slate-200 rounded-lg p-6"
      >
        <h3 class="text-lg font-semibold text-slate-800 mb-4">
          Расшифровка ключевых слов
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div class="flex justify-between items-baseline text-sm mb-2">
              <h4 class="font-semibold text-slate-800">Обязательные</h4>
              <span class="font-medium text-slate-600">
                {{ activeVariation.metrics.requiredKeywordsUsed }} /
                {{ activeVariation.metrics.requiredKeywordsTotal }}
              </span>
            </div>
            <div class="border border-slate-200 rounded-md bg-white">
              <div
                class="flex justify-between text-xs font-semibold text-slate-500 uppercase px-3 py-2 bg-slate-100 border-b border-slate-200"
              >
                <span>Ключ</span>
                <span>Кол-во</span>
              </div>
              <ul class="text-sm">
                <li
                  v-for="(keyword, index) in requiredKeywordsList"
                  :key="keyword.name"
                  class="flex justify-between items-center py-2 px-3"
                  :class="{ 'border-t border-slate-100': index > 0 }"
                >
                  <span class="text-slate-700">{{ keyword.name }}</span>
                  <span
                    :class="
                      keyword.count > 0 ? 'text-green-600' : 'text-red-600'
                    "
                    class="font-mono bg-slate-200 text-xs px-2 py-0.5 rounded-full font-semibold"
                  >
                    {{ keyword.count }}
                  </span>
                </li>
              </ul>
            </div>
          </div>
          <div>
            <div class="flex justify-between items-baseline text-sm mb-2">
              <h4 class="font-semibold text-slate-800">Необязательные</h4>
              <span class="font-medium text-slate-600">
                {{ activeVariation.metrics.optionalKeywordsUsed }} /
                {{ activeVariation.metrics.optionalKeywordsTotal }}
              </span>
            </div>
            <div class="border border-slate-200 rounded-md bg-white">
              <div
                class="flex justify-between text-xs font-semibold text-slate-500 uppercase px-3 py-2 bg-slate-100 border-b border-slate-200"
              >
                <span>Ключ</span>
                <span>Кол-во</span>
              </div>
              <ul class="text-sm">
                <li
                  v-for="(keyword, index) in optionalKeywordsList"
                  :key="keyword.name"
                  class="flex justify-between items-center py-2 px-3"
                  :class="{ 'border-t border-slate-100': index > 0 }"
                >
                  <span class="text-slate-700">{{ keyword.name }}</span>
                  <span
                    class="font-mono bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full font-semibold"
                    >{{ keyword.count }}</span
                  >
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import type {
  GenerationResult,
  GenerationRequest,
  TextVariation,
} from "~/types";

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
const refineSaveSuccessMessage = ref("");
const editorSaveSuccessMessage = ref("");
const isRegenerating = ref(false);
const router = useRouter();

const isEditing = ref(false);
const metricsJustUpdated = ref(false);
const showGenerationSuccessBanner = ref(false);
const originalContentBeforeEdit = ref("");
const currentVariationIndex = ref(0);

// --- ЦЕНТРАЛИЗОВАННЫЙ ДОСТУП К ДАННЫМ АКТИВНОЙ ВАРИАЦИИ ---
const activeVariation = computed<TextVariation>(() => {
  if (result.value && result.value.variations[currentVariationIndex.value]) {
    return result.value.variations[currentVariationIndex.value];
  }
  // Возвращаем "пустую" структуру, чтобы избежать ошибок в шаблоне до загрузки данных
  return {
    description: "",
    metrics: {} as any,
    analysis: { utpAnalysis: [], painPointAnalysis: [] },
  };
});

const editableContent = computed({
  get() {
    return activeVariation.value.description;
  },
  set(newValue) {
    if (result.value?.variations) {
      result.value.variations[currentVariationIndex.value].description =
        newValue;
    }
  },
});

const startEditing = () => {
  originalContentBeforeEdit.value = editableContent.value;
  isEditing.value = true;
};

const cancelEdits = () => {
  editableContent.value = originalContentBeforeEdit.value;
  isEditing.value = false;
};

const commitEdits = async () => {
  await handleSave("editor");
  isEditing.value = false;
};

const revalidateContent = useDebounceFn(async () => {
  if (!editableContent.value || !originalRequest.value) return;

  try {
    const updatedVariation = await $fetch<TextVariation>("/api/revalidate", {
      method: "POST",
      body: {
        text: editableContent.value,
        generationRequest: originalRequest.value,
      },
    });

    if (result.value?.variations) {
      result.value.variations[currentVariationIndex.value].metrics =
        updatedVariation.metrics;
      result.value.variations[currentVariationIndex.value].analysis =
        updatedVariation.analysis;

      metricsJustUpdated.value = true;
      setTimeout(() => {
        metricsJustUpdated.value = false;
      }, 1000);
    }
  } catch (err) {
    console.error("Failed to revalidate content:", err);
  }
}, 750);

watch(editableContent, () => {
  if (isEditing.value) {
    revalidateContent();
  }
});

const handleRegenerate = async () => {
  if (!originalRequest.value) {
    console.error("Cannot regenerate without original request data.");
    return;
  }
  isRegenerating.value = true;
  try {
    const response = await $fetch<{ taskId: string }>("/api/generate", {
      method: "POST",
      body: originalRequest.value,
    });

    if (response.taskId) {
      await router.push(`/tasks/${response.taskId}`);
      window.location.reload();
    }
  } catch (err: any) {
    console.error("Failed to start regeneration:", err);
  } finally {
    isRegenerating.value = false;
  }
};

const checkStatus = async () => {
  try {
    const response = (await $fetch(`/api/tasks/${props.taskId}`)) as any;

    if (response && response.request) {
      originalRequest.value = response.request;
    }

    if (response.status === "completed") {
      if (status.value !== "completed") {
        showGenerationSuccessBanner.value = true;
        setTimeout(() => {
          showGenerationSuccessBanner.value = false;
        }, 4000);
      }

      status.value = "completed";
      result.value = response.result || null;

      // ИСПРАВЛЕНО: Защита от пустого массива variations
      if (
        result.value &&
        (!result.value.variations || result.value.variations.length === 0)
      ) {
        result.value.variations = [
          {
            description: "",
            metrics: {} as any,
            analysis: { utpAnalysis: [], painPointAnalysis: [] },
          },
        ];
      }

      if (!result.value) {
        status.value = "error";
        error.value = "Задача завершена, но результат генерации пуст.";
      }
    } else if (response.status === "error") {
      status.value = "error";
      error.value =
        response.result?.variations?.[0]?.description ||
        "Произошла неизвестная ошибка в процессе генерации.";
    }
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
  emit("reset", originalRequest.value);
};

const requiredKeywordsList = computed(() => {
  if (
    !originalRequest.value ||
    !activeVariation.value.metrics?.keywordUsageDetails
  ) {
    return [];
  }
  return originalRequest.value.requiredKeywords.map((keywordName) => ({
    name: keywordName,
    count:
      activeVariation.value.metrics.keywordUsageDetails[keywordName]?.count ||
      0,
  }));
});

const optionalKeywordsList = computed(() => {
  if (
    !originalRequest.value ||
    !activeVariation.value.metrics?.keywordUsageDetails
  ) {
    return [];
  }
  return originalRequest.value.optionalKeywords.map((keywordName) => ({
    name: keywordName,
    count:
      activeVariation.value.metrics.keywordUsageDetails[keywordName]?.count ||
      0,
  }));
});

const handleRefinement = async () => {
  if (
    !refinementPrompt.value.trim() ||
    !editableContent.value ||
    !originalRequest.value
  ) {
    refinementError.value = "Не все данные для улучшения готовы.";
    return;
  }
  isRefining.value = true;
  refinementError.value = "";
  refineSaveSuccessMessage.value = "";
  const payload = {
    productName: originalRequest.value.productName,
    originalContent: editableContent.value,
    userPrompt: refinementPrompt.value,
    generationData: originalRequest.value,
    originalTitle: result.value?.title,
  };

  try {
    const newResult = await $fetch<GenerationResult>("/api/refine", {
      method: "POST",
      body: payload,
    });
    result.value = newResult;
    currentVariationIndex.value = 0;
    refinementPrompt.value = "";
  } catch (err: any) {
    refinementError.value = err.data?.message || "Не удалось улучшить текст.";
  } finally {
    isRefining.value = false;
  }
};

const handleSave = async (source: "editor" | "refine") => {
  if (!result.value) return;
  isSaving.value = true;
  refineSaveSuccessMessage.value = "";
  editorSaveSuccessMessage.value = "";
  refinementError.value = "";

  const resultToSave = { ...result.value };

  try {
    await $fetch(`/api/tasks/${props.taskId}`, {
      method: "PUT",
      body: { result: resultToSave },
    });

    if (source === "editor") {
      editorSaveSuccessMessage.value = "✅ Результат успешно сохранен!";
      setTimeout(() => (editorSaveSuccessMessage.value = ""), 3000);
    } else {
      refineSaveSuccessMessage.value = "✅ Результат успешно сохранен!";
      setTimeout(() => (refineSaveSuccessMessage.value = ""), 3000);
    }
  } catch (err: any) {
    refinementError.value =
      err.data?.message || "Не удалось сохранить результат.";
  } finally {
    isSaving.value = false;
  }
};

const formattedContent = computed(() => {
  if (!editableContent.value) return "";
  return (
    `<strong>${result.value?.title || ""}</strong><br><br>` +
    editableContent.value
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>")
  );
});

const plainTextContent = computed(() => {
  if (!editableContent.value) return "";
  const cleanDescription = editableContent.value.replace(/\*\*/g, "");
  return `${result.value?.title}\n\n${cleanDescription}`;
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

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes flash-bg {
  from {
    background-color: theme("colors.blue.100");
  }
  to {
    background-color: transparent;
  }
}

.flash-success {
  animation: flash-bg 1s ease-out;
}
</style>
