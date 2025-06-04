<template>
  <div
    class="inline-block animate-spin rounded-full border-b-2 border-current"
    :style="{
      width: size + 'px',
      height: size + 'px',
      borderWidth: Math.max(2, size || 20 / 20) + 'px',
    }"
  />
</template>

<script setup lang="ts">
defineProps<{
  size?: number;
}>();
</script>
