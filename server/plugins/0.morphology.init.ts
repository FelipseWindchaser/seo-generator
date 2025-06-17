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

import { morphologyService } from '~/server/utils/morphology-service';

export default defineNitroPlugin(async (nitroApp) => {
  console.log('Nitro plugin: Triggering morphology service initialization...');
  
  try {
    // Вызываем наш надежный метод инициализации
    await morphologyService.initialize();
    console.log('Nitro plugin: Morphology service is ready.');
  } catch (error) {
    // Это критическая ошибка. Если словари не загрузились, воркер не сможет работать корректно.
    // Мы должны залогировать это максимально заметно.
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('!! CRITICAL FAILURE: Could not initialize Morphology Service. !!');
    console.error('!! The application will run in a degraded state.              !!');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    
    // В продакшене можно было бы остановить приложение: process.exit(1)
    // Но для отказоустойчивости мы позволяем ему запуститься,
    // но все вызовы к морфологии будут выбрасывать ошибку.
  }
});