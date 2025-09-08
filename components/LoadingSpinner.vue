<!-- /components/LoadingSpinner.vue -->
<template>
  <div
    class="inline-block animate-spin rounded-full border-solid"
    :style="spinnerStyle"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    size?: number;
  }>(),
  {
    size: 20, // Задаем значение по умолчанию прямо здесь
  }
);

const spinnerStyle = computed(() => {
  // Простая и понятная логика: толщина рамки - 1/8 от размера, но не меньше 2px.
  const borderWidth = Math.max(2, Math.round(props.size / 8));

  return {
    width: `${props.size}px`,
    height: `${props.size}px`,
    borderWidth: `${borderWidth}px`,
    // Это стандартный и надежный способ создать "дугу" для анимации вращения.
    // Цвет рамки наследуется от цвета текста (currentColor), но одна из сторон делается прозрачной.
    borderColor: "currentColor",
    borderRightColor: "transparent",
  };
});
</script>
