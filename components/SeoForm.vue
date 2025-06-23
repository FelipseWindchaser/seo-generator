<template>
  <form @submit.prevent="onSubmit" class="space-y-6">
    <!-- URL товара -->
    <div>
      <label for="productUrl" class="block text-sm font-medium text-gray-700">
        URL товара на Wildberries *
      </label>
      <input
        id="productUrl"
        v-model="form.productUrl"
        type="url"
        required
        pattern=".*wildberries\.ru/catalog/.*"
        placeholder="https://www.wildberries.ru/catalog/123456/detail.aspx"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
      <p class="mt-1 text-sm text-gray-500">
        Скопируйте полную ссылку на товар
      </p>
    </div>

    <!-- Ключевые фразы -->
    <div>
      <label for="keywords" class="block text-sm font-medium text-gray-700">
        Ключевые фразы (минимум 10) *
      </label>
      <textarea
        id="keywords"
        v-model="keywordsText"
        required
        rows="6"
        placeholder="платье женское летнее&#10;платье в пол&#10;платье на выпускной"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
      <p class="mt-1 text-sm text-gray-500">
        Каждая фраза с новой строки. Введено: {{ keywordsCount }}/10
      </p>
    </div>

    <!-- Отзывы конкурентов -->
    <div>
      <label for="reviews" class="block text-sm font-medium text-gray-700">
        Отзывы конкурентов (минимум 2) *
      </label>
      <textarea
        id="reviews"
        v-model="form.reviews"
        required
        rows="4"
        placeholder="1. Платье село после стирки, ткань тонкая&#10;2. Размер не соответствует"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
      <p class="mt-1 text-sm text-gray-500">
        Скопируйте негативные отзывы конкурентов
      </p>
    </div>

    <!-- УТП -->
    <div>
      <label for="usp" class="block text-sm font-medium text-gray-700">
        УТП - уникальные торговые предложения (минимум 2) *
      </label>
      <textarea
        id="usp"
        v-model="uspText"
        required
        rows="3"
        placeholder="Не садится после стирки - протестировано на 50 циклах&#10;Премиальная ткань с сертификатом"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
      <p class="mt-1 text-sm text-gray-500">
        Конкретные измеримые преимущества. Введено: {{ uspCount }}/2
      </p>
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
      <ul class="list-disc list-inside text-sm text-red-800">
        <li v-for="error in errors" :key="error">{{ error }}</li>
      </ul>
    </div>
  </form>
</template>

<script setup lang="ts">
import type { GenerationRequest } from "~/types";
import { useSeoGenerator } from "~/composables/useSeoGenerator";
const router = useRouter();
const taskId = ref<string>("");
const props = defineProps<{
  loading: boolean;
}>();

const emit = defineEmits<{
  submit: [data: GenerationRequest];
}>();

// Состояние формы
const form = reactive({
  productUrl: "",
  reviews: "",
  adsPlanned: false,
  canChangeVisuals: false,
});

const keywordsText = ref("");
const uspText = ref("");

// Вычисляемые свойства
const keywords = computed(() =>
  keywordsText.value
    .split("\n")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
);

const usp = computed(() =>
  uspText.value
    .split("\n")
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
);

const keywordsCount = computed(() => keywords.value.length);
const uspCount = computed(() => usp.value.length);

// Валидация
const errors = ref<string[]>([]);

const isValid = computed(() => {
  const errs: string[] = [];

  if (!form.productUrl.includes("wildberries.ru/catalog/")) {
    errs.push("URL должен быть с Wildberries");
  }

  if (keywordsCount.value < 10) {
    errs.push(
      `Нужно минимум 10 ключевых фраз (сейчас: ${keywordsCount.value})`
    );
  }

  if (uspCount.value < 2) {
    errs.push(`Нужно минимум 2 УТП (сейчас: ${uspCount.value})`);
  }

  if (!form.reviews || form.reviews.length < 20) {
    errs.push("Добавьте отзывы конкурентов");
  }

  errors.value = errs;
  return errs.length === 0;
});

// Отправка формы
const onSubmit = () => {
  if (!isValid.value) return;

  const data: GenerationRequest = {
    ...form,
    keywords: keywords.value,
    usp: usp.value,
  };

  // router.push(`/tasks/${taskId.value}`);
  emit("submit", data);
};
</script>
