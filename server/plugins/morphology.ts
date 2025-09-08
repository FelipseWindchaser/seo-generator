import { morphologyService } from '~/server/utils/morphology-service'

export default defineNitroPlugin(async (nitroApp) => {
  // Проверяем, задан ли URL для сервиса. Если нет, нет смысла его инициализировать.
  if (!process.env.MORPHOLOGY_API_URL) {
    console.warn('MORPHOLOGY_API_URL is not set. Morphology service will be disabled.');
    return;
  }

  console.log('Initializing morphology service connection...');
  
  try {
    await morphologyService.initialize();
    console.log('Morphology service connection established successfully.');
    
    // Эндпоинт для статистики кеша, который был раньше, здесь не нужен.
  } catch (error) {
    console.error('CRITICAL: Failed to initialize morphology service. Content validation will be degraded or non-functional.');
  }
})