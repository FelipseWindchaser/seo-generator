<template>
  <form @submit.prevent="onSubmit" class="space-y-6">
    <!-- URL товара -->
    <div>
      <label for="productUrl" class="block text-sm font-medium text-gray-700"
        >URL товара на Wildberries *</label
      >
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

    <!-- Обязательные ключи -->
    <div>
      <label
        for="requiredKeywords"
        class="block text-sm font-medium text-gray-700"
        >Обязательные ключи (ровно 10 шт.) *</label
      >
      <textarea
        id="requiredKeywords"
        v-model="requiredKeywordsText"
        required
        rows="5"
        placeholder="соковыжималка
сок
фрукты
овощи
здоровье
витамины
завтрак
atvel
шнековая
гарантия"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
      <p class="mt-1 text-sm text-gray-500">
        10 однословных ключей, которые должны быть в тексте. Введено:
        {{ requiredKeywordsCount }} / 10
      </p>
    </div>

    <!-- Необязательные ключи -->
    <div>
      <label
        for="optionalKeywords"
        class="block text-sm font-medium text-gray-700"
        >Необязательные ключи (до 10 шт.)</label
      >
      <textarea
        id="optionalKeywords"
        v-model="optionalKeywordsText"
        rows="5"
        placeholder="отжим
чистка
мощность
тихая
сталь
рецепты
польза
энергия
качество
стиль"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
      <p class="mt-1 text-sm text-gray-500">
        Будут использованы, если подходят по контексту. Введено:
        {{ optionalKeywordsCount }} / 10
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

      <!-- ВОССТАНОВЛЕННЫЙ БЛОК -->
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
  productUrl: "",
  reviews: "",
  adsPlanned: false,
  canChangeVisuals: false, // <-- ВОССТАНОВЛЕННОЕ ПОЛЕ
});

const requiredKeywordsText = ref("");
const optionalKeywordsText = ref("");
const uspText = ref("");

const parseTextarea = (text: string) =>
  text
    .split("\n")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

const requiredKeywords = computed(() =>
  parseTextarea(requiredKeywordsText.value)
);
const optionalKeywords = computed(() =>
  parseTextarea(optionalKeywordsText.value)
);
const usp = computed(() => parseTextarea(uspText.value));

const requiredKeywordsCount = computed(() => requiredKeywords.value.length);
const optionalKeywordsCount = computed(() => optionalKeywords.value.length);

// Валидация
const errors = ref<string[]>([]);
const isValid = computed(() => {
  const errs: string[] = [];
  if (!form.productUrl.includes("wildberries.ru/catalog/"))
    errs.push("URL должен быть с Wildberries");
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
