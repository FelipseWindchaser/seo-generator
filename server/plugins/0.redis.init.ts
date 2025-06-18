// server/plugins/0.redis.init.ts

import { initializeRedis } from '../utils/redis'; // Относительный путь

export default defineNitroPlugin((nitroApp) => {
  // Получаем конфигурацию из Nuxt
  const config = useRuntimeConfig();
  
  if (config.redisUrl) {
    // Инициализируем Redis с URL из конфига
    initializeRedis(config.redisUrl);
    console.log('✅ Redis initialized for Nuxt server.');
  } else {
    console.error('❌ Redis URL not found in runtime config for Nuxt.');
  }
});