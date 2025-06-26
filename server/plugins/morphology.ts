// import { morphologyService } from '~/server/utils/morphology-service'

// export default defineNitroPlugin(async (nitroApp) => {
//   console.log('Initializing morphology service...')
  
//   try {
//     await morphologyService.initialize()
//     console.log('Morphology service initialized successfully')
    
//     // Добавляем эндпоинт для статистики (опционально)
//     nitroApp.hooks.hook('request', async (event) => {
//       if (event.node.req.url === '/api/morphology/stats') {
//         event.node.res.setHeader('Content-Type', 'application/json')
//         event.node.res.end(JSON.stringify(morphologyService.getCacheStats()))
//       }
//     })
//   } catch (error) {
//     console.error('Failed to initialize morphology service:', error)
//     // Приложение продолжит работу, но без морфологии
//   }
// })

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