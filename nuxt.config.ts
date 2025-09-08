export default defineNuxtConfig({
  devtools: { enabled: true },

  modules: ["@nuxtjs/tailwindcss", "@pinia/nuxt", "@vueuse/nuxt"],

  runtimeConfig: {
    GOOGLE_API_KEY: process.env.GEMINI_API_KEY || "",
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    public: {
      apiBase: process.env.API_BASE || "http://localhost:3000",
      morphologyApiUrl: process.env.MORPHOLOGY_API_URL || 'http://127.0.0.1:8000',
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
      },
    },
   
  },
});
