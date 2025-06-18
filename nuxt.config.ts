export default defineNuxtConfig({
  devtools: { enabled: true },

  modules: ["@nuxtjs/tailwindcss", "@pinia/nuxt", "@vueuse/nuxt"],

  runtimeConfig: {
    // Приватные переменные (только сервер)
    geminiApiKey: process.env.GEMINI_API_KEY,
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

    // Публичные переменные
    public: {
      apiBase: process.env.API_BASE || "http://localhost:3000",
    },
  },

  typescript: {
    strict: true,
  },

  nitro: {
    experimental: {
      tasks: true,
    },
    storage: {
      redis: {
        driver: "redis",
        // Конфигурация Redis
      },
    },
   
  },
});
