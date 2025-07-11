<!-- /components/GenerationForm.vue -->
<template>
  <form @submit.prevent="onSubmit" class="space-y-6">
    <!-- НОВОЕ ПОЛЕ: Название товара -->
    <div>
      <label for="productName" class="block text-sm font-medium text-gray-700"
        >Название товара *</label
      >
      <input
        id="productName"
        v-model="form.productName"
        type="text"
        required
        placeholder="Например: Шнековая соковыжималка Atvel PowerTwist J7"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
    </div>

    <!-- URL товара и кнопка генерации ключей -->
    <div>
      <label for="productUrl" class="block text-sm font-medium text-gray-700"
        >URL товара на Wildberries</label
      >
      <div class="mt-1 flex rounded-md shadow-sm">
        <input
          id="productUrl"
          v-model="form.productUrl"
          type="url"
          pattern=".*wildberries\.ru/catalog/.*"
          placeholder="https://www.wildberries.ru/catalog/123456/detail.aspx"
          class="block w-full flex-1 rounded-none rounded-l-md border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
        />
        <button
          type="button"
          @click="generateKeywords"
          :disabled="!isUrlValidForScraping || isGeneratingKeywords"
          class="relative -ml-px inline-flex items-center space-x-2 rounded-r-md border border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-200 disabled:cursor-not-allowed"
        >
          <LoadingSpinner v-if="isGeneratingKeywords" class="h-4 w-4" />
          <span v-else>✨ Сгенерировать ключи</span>
        </button>
      </div>
    </div>

    <!-- Блок для отображения сгенерированных ключей -->
    <div
      v-if="keywordGenerationError"
      class="p-4 bg-red-50 rounded-md text-sm text-red-700"
    >
      {{ keywordGenerationError }}
    </div>
    <div v-if="generatedKeywords" class="p-4 bg-green-50 rounded-md">
      <h4 class="text-sm font-medium text-gray-900 mb-2">
        Предложенные ключи (нажмите, чтобы добавить):
      </h4>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h5 class="text-xs font-semibold text-gray-700 mb-2">Обязательные</h5>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="kw in availableRequiredKeywords"
              :key="kw"
              @click="addKeyword(kw, 'required')"
              class="cursor-pointer rounded-full bg-sky-100 px-2.5 py-1 text-xs text-sky-800 hover:bg-sky-200"
            >
              {{ kw }}
            </span>
          </div>
        </div>
        <div>
          <h5 class="text-xs font-semibold text-gray-700 mb-2">
            Необязательные
          </h5>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="kw in availableOptionalKeywords"
              :key="kw"
              @click="addKeyword(kw, 'optional')"
              class="cursor-pointer rounded-full bg-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-300"
            >
              {{ kw }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Поле для обязательных ключей в виде редактора тегов -->
    <div>
      <label
        for="requiredKeywordsInput"
        class="block text-sm font-medium text-gray-700"
        >Обязательные ключи (ровно 10 шт.) *</label
      >
      <div
        class="mt-1 p-2 w-full rounded-md border border-gray-300 bg-white min-h-[40px] flex flex-wrap items-center gap-2"
      >
        <span
          v-for="kw in requiredKeywords"
          :key="kw"
          class="flex items-center gap-1.5 rounded-full bg-blue-100 px-2 py-1 text-sm text-blue-800"
        >
          <span>{{ kw }}</span>
          <button
            @click="removeKeyword(kw, 'required')"
            type="button"
            class="text-blue-500 hover:text-blue-700 focus:outline-none"
          >
            <svg
              class="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </span>
        <input
          id="requiredKeywordsInput"
          @keydown.enter.prevent="addKeywordFromInput($event, 'required')"
          @keydown.backspace="handleBackspace($event, 'required')"
          type="text"
          placeholder="Введите ключ и нажмите Enter..."
          class="flex-grow p-0 border-none focus:ring-0 text-sm"
        />
      </div>
      <p class="mt-1 text-sm text-gray-500">
        Введено: {{ requiredKeywordsCount }} / 10
      </p>
    </div>

    <!-- Поле для необязательных ключей в виде редактора тегов -->
    <div>
      <label
        for="optionalKeywordsInput"
        class="block text-sm font-medium text-gray-700"
        >Необязательные ключи (до 10 шт.)</label
      >
      <div
        class="mt-1 p-2 w-full rounded-md border border-gray-300 bg-white min-h-[40px] flex flex-wrap items-center gap-2"
      >
        <span
          v-for="kw in optionalKeywords"
          :key="kw"
          class="flex items-center gap-1.5 rounded-full bg-gray-200 px-2 py-1 text-sm text-gray-800"
        >
          <span>{{ kw }}</span>
          <button
            @click="removeKeyword(kw, 'optional')"
            type="button"
            class="text-gray-500 hover:text-gray-700 focus:outline-none"
          >
            <svg
              class="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </span>
        <input
          id="optionalKeywordsInput"
          @keydown.enter.prevent="addKeywordFromInput($event, 'optional')"
          @keydown.backspace="handleBackspace($event, 'optional')"
          type="text"
          placeholder="Введите ключ и нажмите Enter..."
          class="flex-grow p-0 border-none focus:ring-0 text-sm"
        />
      </div>
      <p class="mt-1 text-sm text-gray-500">
        Введено: {{ optionalKeywordsCount }} / 10
      </p>
    </div>

    <!-- Отзывы конкурентов -->
    <div>
      <label for="reviews" class="block text-sm font-medium text-gray-700"
        >Отзывы конкурентов (минимум 2) *</label
      >
      <textarea
        id="reviews"
        v-model="form.reviews"
        required
        rows="4"
        placeholder="1. Очень шумная, будит всю семью.
2. Сложно мыть, много деталей."
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
    </div>

    <!-- УТП -->
    <div>
      <label for="usp" class="block text-sm font-medium text-gray-700"
        >УТП - уникальные торговые предложения (минимум 2) *</label
      >
      <textarea
        id="usp"
        v-model="uspText"
        required
        rows="3"
        placeholder="Работает на 30% тише аналогов
Разбирается для чистки за 15 секунд"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
    </div>

    <!-- Чекбоксы -->
    <div class="space-y-3">
      <label class="flex items-center">
        <input
          v-model="form.adsPlanned"
          type="checkbox"
          class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
        />
        <span class="ml-2 text-sm text-gray-700">Реклама планируется</span>
      </label>
      <label class="flex items-center">
        <input
          v-model="form.canChangeVisuals"
          type="checkbox"
          class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
        />
        <span class="ml-2 text-sm text-gray-700">Можно менять визуалы</span>
      </label>
    </div>

    <!-- Кнопка отправки -->
    <button
      type="submit"
      :disabled="loading || !isValid"
      class="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
    >
      <LoadingSpinner v-if="loading" class="mr-2" />
      {{ loading ? "Генерируем..." : "Сгенерировать SEO-описание" }}
    </button>

    <!-- Ошибки валидации -->
    <div v-if="errors.length > 0" class="mt-4 p-4 bg-red-50 rounded-md">
      <h3 class="text-sm font-medium text-red-800">
        Пожалуйста, исправьте ошибки:
      </h3>
      <ul class="list-disc list-inside text-sm text-red-700 mt-2">
        <li v-for="error in errors" :key="error">{{ error }}</li>
      </ul>
    </div>
  </form>
</template>

<script setup lang="ts">
import type { GenerationRequest } from "~/types";

const props = defineProps<{
  loading: boolean;
}>();

const emit = defineEmits<{
  submit: [data: GenerationRequest];
}>();

// Состояние формы
const form = reactive({
  productName: "",
  productUrl: "",
  reviews: "",
  adsPlanned: false,
  canChangeVisuals: false,
});

// Состояние для ключей и УТП
const requiredKeywords = ref<string[]>([]);
const optionalKeywords = ref<string[]>([]);
const uspText = ref("");

// Состояние для генератора ключей
const isGeneratingKeywords = ref(false);
const keywordGenerationError = ref("");
const generatedKeywords = ref<{
  requiredKeywords: string[];
  optionalKeywords: string[];
} | null>(null);

// Вычисляемые свойства
const usp = computed(() =>
  uspText.value
    .split("\n")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
);
const requiredKeywordsCount = computed(() => requiredKeywords.value.length);
const optionalKeywordsCount = computed(() => optionalKeywords.value.length);

const isUrlValidForScraping = computed(() => {
  return form.productUrl && form.productUrl.includes("wildberries.ru/catalog/");
});

const availableRequiredKeywords = computed(() => {
  if (!generatedKeywords.value) return [];
  return generatedKeywords.value.requiredKeywords.filter(
    (kw) => !requiredKeywords.value.includes(kw)
  );
});

const availableOptionalKeywords = computed(() => {
  if (!generatedKeywords.value) return [];
  return generatedKeywords.value.optionalKeywords.filter(
    (kw) => !optionalKeywords.value.includes(kw)
  );
});

// Валидация
const errors = ref<string[]>([]);
const isValid = computed(() => {
  const errs: string[] = [];
  if (!form.productName.trim())
    errs.push("Название товара обязательно для заполнения");
  if (requiredKeywordsCount.value !== 10)
    errs.push(
      `Нужно ровно 10 обязательных ключей (сейчас: ${requiredKeywordsCount.value})`
    );
  if (optionalKeywordsCount.value > 10)
    errs.push(
      `Можно ввести не более 10 необязательных ключей (сейчас: ${optionalKeywordsCount.value})`
    );
  if (!form.reviews || form.reviews.length < 20)
    errs.push("Добавьте минимум 2 отзыва конкурентов");
  if (usp.value.length < 2) errs.push("Добавьте минимум 2 УТП");

  errors.value = errs;
  return errs.length === 0;
});

// Генерация ключей
const generateKeywords = async () => {
  // Добавляем проверку и на productName
  if (!form.productName.trim() && !isUrlValidForScraping.value) {
    keywordGenerationError.value =
      "Пожалуйста, введите название товара или URL.";
    return;
  }
  isGeneratingKeywords.value = true;
  keywordGenerationError.value = "";
  generatedKeywords.value = null;

  try {
    const response = await $fetch<{
      requiredKeywords: string[];
      optionalKeywords: string[];
    }>("/api/keywords/generate", {
      method: "POST",
      body: {
        productName: form.productName,
        productUrl: form.productUrl,
      },
    });
    generatedKeywords.value = response;
  } catch (err: any) {
    keywordGenerationError.value =
      err.data?.message || "Не удалось сгенерировать ключи.";
  } finally {
    isGeneratingKeywords.value = false;
  }
};

// Добавление ключа
const addKeyword = (keyword: string, type: "required" | "optional") => {
  const targetArray =
    type === "required" ? requiredKeywords.value : optionalKeywords.value;
  const limit = 10;

  if (targetArray.length >= limit) {
    console.warn(`Limit of ${limit} reached for ${type} keywords.`);
    return;
  }
  const cleanedKeyword = keyword.trim().replace(/,/g, "");
  if (cleanedKeyword && !targetArray.includes(cleanedKeyword)) {
    targetArray.push(cleanedKeyword);
  }
};

// Удаление ключа
const removeKeyword = (
  keywordToRemove: string,
  type: "required" | "optional"
) => {
  if (type === "required") {
    requiredKeywords.value = requiredKeywords.value.filter(
      (k) => k !== keywordToRemove
    );
  } else {
    optionalKeywords.value = optionalKeywords.value.filter(
      (k) => k !== keywordToRemove
    );
  }
};

// Обработчик для поля ввода
const addKeywordFromInput = (
  event: KeyboardEvent,
  type: "required" | "optional"
) => {
  const input = event.target as HTMLInputElement;
  const keyword = input.value;
  if (keyword) {
    addKeyword(keyword, type);
    input.value = "";
  }
};

// Обработчик для Backspace
const handleBackspace = (
  event: KeyboardEvent,
  type: "required" | "optional"
) => {
  const input = event.target as HTMLInputElement;
  if (input.value === "") {
    if (type === "required") {
      requiredKeywords.value.pop();
    } else {
      optionalKeywords.value.pop();
    }
  }
};

// Отправка формы
const onSubmit = () => {
  if (!isValid.value) return;
  const data: GenerationRequest = {
    ...form,
    requiredKeywords: requiredKeywords.value,
    optionalKeywords: optionalKeywords.value,
    usp: usp.value,
  };
  emit("submit", data);
};
</script>
