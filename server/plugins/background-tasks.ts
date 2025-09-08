import { repeatFunction } from '~/composables/processGeneration';

export default defineNitroPlugin((nitroApp) => {
  // Эта функция будет вызвана только один раз при запуске сервера
  console.log('[Nitro Plugin] Starting background task processor...');
  repeatFunction();
});