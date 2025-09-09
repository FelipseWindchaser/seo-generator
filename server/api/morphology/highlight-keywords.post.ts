// /server/api/morphology/highlight-keywords.post.ts

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    const body = await readBody(event);
  
    try {
      // Просто перенаправляем запрос на Python-сервис
      const response = await $fetch(`${config.public.morphologyApiUrl}/highlight-keywords`, {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'application/json' },
      });
      return response;
    } catch (error) {
      console.error("Proxy to morphology service failed:", error);
      throw createError({
        statusCode: 502, // Bad Gateway
        statusMessage: "Morphology service is unavailable.",
      });
    }
  });