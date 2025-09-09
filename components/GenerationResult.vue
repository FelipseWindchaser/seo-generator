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
      <!-- <div
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
      </div> -->

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

      <!-- БЛОК 2: ЗАМЕЧАНИЯ ВАЛИДАТОРА -->
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
        <!-- НОВОЕ МЕСТО ДЛЯ ТАБОВ ВАРИАЦИЙ -->
        <div
          v-if="result.variations && result.variations.length > 1"
          class="mb-6"
        >
          <div class="border-b border-gray-200">
            <nav class="-mb-px flex space-x-6" aria-label="Tabs">
              <button
                v-for="(variation, index) in result.variations"
                :key="index"
                @click="currentVariationIndex = index"
                :class="[
                  currentVariationIndex === index
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                  'whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm focus:outline-none',
                ]"
              >
                Вариация {{ index + 1 }}
              </button>
            </nav>
          </div>
        </div>

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
            v-model="editorText"
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

      <!-- БЛОК 4: ГЕНЕРАЦИЯ ВАРИАЦИЙ (ЗНАЧИТЕЛЬНЫЕ ИЗМЕНЕНИЯ) -->
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-6">
        <h3 class="text-lg font-semibold text-slate-800 mb-2">
          Сгенерировать вариации
        </h3>
        <p class="text-sm text-slate-600 mb-4">
          Создать несколько стилистически уникальных версий на основе текущего
          активного текста. Всего можно иметь не более 5 вариаций.
        </p>
        <div class="flex items-center gap-4">
          <select
            v-model.number="numNewVariations"
            :disabled="!canGenerateMoreVariations"
            class="block w-40 rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm disabled:bg-gray-200 disabled:cursor-not-allowed"
          >
            <option
              v-for="n in availableSlotsForVariations"
              :key="n"
              :value="n"
            >
              {{ n }}
            </option>
          </select>
          <button
            @click="handleGenerateVariations"
            :disabled="!canGenerateMoreVariations || isGeneratingVariations"
            class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center justify-center font-medium whitespace-nowrap"
          >
            <LoadingSpinner
              v-if="isGeneratingVariations"
              class="mr-2"
              :size="20"
            />
            <span v-if="canGenerateMoreVariations">
              {{
                isGeneratingVariations
                  ? "Создаем..."
                  : `✨ Создать ${numNewVariations} ${
                      numNewVariations > 1 ? "варианта" : "вариант"
                    }`
              }}
            </span>
            <span v-else> Достигнут лимит (5) </span>
          </button>
        </div>
        <!-- Баннеры обратной связи -->
        <transition name="fade">
          <div
            v-if="variationGenerationSuccess"
            class="mt-4 bg-green-100 border border-green-200 text-green-800 text-sm font-medium rounded-lg p-4 text-center"
          >
            {{ variationGenerationSuccess }}
          </div>
        </transition>
        <transition name="fade">
          <div
            v-if="variationGenerationError"
            class="mt-4 bg-red-100 border border-red-200 text-red-800 text-sm font-medium rounded-lg p-4 text-center"
          >
            {{ variationGenerationError }}
          </div>
        </transition>
      </div>

      <!-- БЛОК 5: УЛУЧШЕНИЕ С ПОМОЩЬЮ ИИ (REFINE) -->
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

      <!-- БЛОК 6: РАСШИФРОВКА КЛЮЧЕВЫХ СЛОВ -->
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
                  v-for="(detail, index) in requiredKeywordsList"
                  :key="detail.keyword"
                  class="flex justify-between items-center py-2 px-3"
                  :class="{ 'border-t border-slate-100': index > 0 }"
                >
                  <span class="text-slate-700">{{ detail.keyword }}</span>
                  <span
                    :class="
                      detail.count > 0 ? 'text-green-600' : 'text-red-600'
                    "
                    class="font-mono bg-slate-200 text-xs px-2 py-0.5 rounded-full font-semibold"
                  >
                    {{ detail.count }}
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
                  v-for="(detail, index) in optionalKeywordsList"
                  :key="detail.keyword"
                  class="flex justify-between items-center py-2 px-3"
                  :class="{ 'border-t border-slate-100': index > 0 }"
                >
                  <span class="text-slate-700">{{ detail.keyword }}</span>
                  <span
                    class="font-mono bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full font-semibold"
                    >{{ detail.count }}</span
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
const editorText = ref("");
const originalMetricsBeforeEdit = ref<TextVariation["metrics"] | null>(null);

const isGeneratingVariations = ref(false);
const variationGenerationError = ref("");
const variationGenerationSuccess = ref("");
const numNewVariations = ref(2);
const MAX_VARIATIONS = 5;

const activeVariation = computed<TextVariation>(() => {
  if (result.value && result.value.variations[currentVariationIndex.value]) {
    return result.value.variations[currentVariationIndex.value];
  }
  return {
    description: "",
    metrics: {} as any,
    analysis: { utpAnalysis: [], painPointAnalysis: [] },
  };
});

// ИЗМЕНЕНО: Логика для лимита вариаций
const totalVariations = computed(() => result.value?.variations.length || 0);

const canGenerateMoreVariations = computed(
  () => totalVariations.value < MAX_VARIATIONS
);

const availableSlotsForVariations = computed(() => {
  const slots = MAX_VARIATIONS - totalVariations.value;
  return slots > 0 ? Array.from({ length: slots }, (_, i) => i + 1) : [];
});

// Следим, чтобы выбранное число не превышало доступное
watch(availableSlotsForVariations, (newSlots) => {
  if (newSlots.length > 0 && !newSlots.includes(numNewVariations.value)) {
    numNewVariations.value = newSlots[0];
  }
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

function highlightKeywordsInText(text: string, keywords: string[]): string {
  if (!keywords || keywords.length === 0) {
    return text;
  }

  const regex = new RegExp(
    `\\b(${keywords
      .map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})\\b`,
    "giu" // 'u' (unicode) флаг исправляет обработку границ слова \b для кириллицы
  );

  return text.replace(regex, "**$1**");
}

const startEditing = () => {
  // Сохраняем оригинальный "грязный" текст
  originalContentBeforeEdit.value = activeVariation.value.description;
  // Сохраняем глубокую копию оригинальных метрик
  originalMetricsBeforeEdit.value = JSON.parse(
    JSON.stringify(activeVariation.value.metrics)
  );
  // Помещаем в редактор "чистую" версию текста
  editorText.value = activeVariation.value.description.replace(/\*\*/g, "");
  isEditing.value = true;
};

const cancelEdits = () => {
  // ИЗМЕНЕНИЕ: Восстанавливаем не только текст, но и метрики
  if (result.value?.variations && originalMetricsBeforeEdit.value) {
    result.value.variations[currentVariationIndex.value].description =
      originalContentBeforeEdit.value;
    result.value.variations[currentVariationIndex.value].metrics =
      originalMetricsBeforeEdit.value;
  }
  isEditing.value = false;
};

const commitEdits = async () => {
  if (!editorText.value || !originalRequest.value || !result.value) return;

  // 1. Восстанавливаем разметку в отредактированном тексте
  const allKeywords = [
    ...originalRequest.value.requiredKeywords,
    ...originalRequest.value.optionalKeywords,
  ];
  const newMarkedUpText = highlightKeywordsInText(
    editorText.value,
    allKeywords
  );

  // 2. Сравниваем новый "грязный" текст с оригинальным "грязным"
  const hasChanges = newMarkedUpText !== originalContentBeforeEdit.value;

  if (!hasChanges) {
    console.log("[CommitEdits] No changes detected. Exiting edit mode.");
    isEditing.value = false;
    return;
  }

  console.log("[CommitEdits] Changes detected. Saving and revalidating.");
  isSaving.value = true;
  editorSaveSuccessMessage.value = "";

  try {
    // 3. Сохраняем "грязный" текст в наше основное состояние
    result.value.variations[currentVariationIndex.value].description =
      newMarkedUpText;

    // 4. Отправляем "чистый" текст на полную ревалидацию
    const fullyUpdatedParts = await $fetch<
      Pick<TextVariation, "metrics" | "analysis">
    >("/api/revalidate", {
      method: "POST",
      body: {
        text: editorText.value, // Отправляем чистый текст
        generationRequest: originalRequest.value,
        mode: "full",
      },
    });

    // 5. Обновляем метрики и анализ
    result.value.variations[currentVariationIndex.value].metrics =
      fullyUpdatedParts.metrics;
    result.value.variations[currentVariationIndex.value].analysis =
      fullyUpdatedParts.analysis;

    // 6. Сохраняем весь объект result на сервере
    await handleSave("editor");
  } catch (err) {
    console.error("Failed to commit edits:", err);
  } finally {
    isSaving.value = false;
    isEditing.value = false;
  }
};

const revalidateContent = useDebounceFn(async () => {
  if (!editorText.value || !originalRequest.value) return;

  try {
    // Отправляем на API "чистый" текст из редактора
    const updatedParts = await $fetch<
      Pick<TextVariation, "metrics" | "analysis">
    >("/api/revalidate", {
      method: "POST",
      body: {
        text: editorText.value, // Отправляем чистый текст
        generationRequest: originalRequest.value,
        mode: "light",
        currentAnalysis: activeVariation.value.analysis,
      },
    });

    if (result.value?.variations) {
      // Обновляем только метрики, так как анализ в light-режиме не меняется
      result.value.variations[currentVariationIndex.value].metrics =
        updatedParts.metrics;
      metricsJustUpdated.value = true;
      setTimeout(() => {
        metricsJustUpdated.value = false;
      }, 1000);
    }
  } catch (err) {
    console.error("Failed to revalidate content (light):", err);
  }
}, 750);

// ИЗМЕНЕНИЕ: Следим за чистым текстом в редакторе
watch(editorText, () => {
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
    !activeVariation.value.metrics?.keywordDetails
  ) {
    return [];
  }
  const requiredSet = new Set(originalRequest.value.requiredKeywords);
  return activeVariation.value.metrics.keywordDetails.filter((detail) =>
    requiredSet.has(detail.keyword)
  );
});

const optionalKeywordsList = computed(() => {
  if (
    !originalRequest.value ||
    !activeVariation.value.metrics?.keywordDetails
  ) {
    return [];
  }
  const optionalSet = new Set(originalRequest.value.optionalKeywords);
  return activeVariation.value.metrics.keywordDetails.filter((detail) =>
    optionalSet.has(detail.keyword)
  );
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
  };

  try {
    // ИЗМЕНЕНИЕ: Ожидаем получить не GenerationResult, а одну TextVariation
    const updatedVariation = await $fetch<TextVariation>("/api/refine", {
      method: "POST",
      body: payload,
    });

    // ИЗМЕНЕНИЕ: Не заменяем весь result, а "хирургически" обновляем
    // только ту вариацию, с которой работал пользователь.
    if (result.value?.variations) {
      result.value.variations[currentVariationIndex.value] = updatedVariation;
    }

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

const handleGenerateVariations = async () => {
  if (!result.value || !originalRequest.value) return;

  // Сбрасываем сообщения
  variationGenerationError.value = "";
  variationGenerationSuccess.value = "";

  const confirmed = window.confirm(
    `Вы уверены, что хотите сгенерировать ${numNewVariations.value} новых варианта? Это может занять до минуты.`
  );
  if (!confirmed) return;

  isGeneratingVariations.value = true;
  try {
    const newVariations = await $fetch<TextVariation[]>(
      "/api/variations/generate",
      {
        method: "POST",
        body: {
          baseText: activeVariation.value.description,
          generationRequest: originalRequest.value,
          numVariations: numNewVariations.value,
        },
      }
    );

    result.value.variations.push(...newVariations);
    currentVariationIndex.value =
      result.value.variations.length - newVariations.length;
    variationGenerationSuccess.value = `✅ Успешно создано ${newVariations.length} новых варианта!`;
    setTimeout(() => (variationGenerationSuccess.value = ""), 4000);
  } catch (err: any) {
    variationGenerationError.value =
      err.data?.message || "Не удалось создать вариации.";
  } finally {
    isGeneratingVariations.value = false;
  }
};

const formattedContent = computed(() => {
  if (!activeVariation.value.description) return "";
  return activeVariation.value.description
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
});

// ИЗМЕНЕНИЕ: plainTextContent теперь всегда возвращает чистый текст
const plainTextContent = computed(() => {
  return activeVariation.value.description.replace(/\*\*/g, "");
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
