import { morphologyService } from '~/server/utils/morphology-service'

export default defineNitroPlugin(async (nitroApp) => {
  console.log('Initializing morphology service...')
  
  try {
    await morphologyService.initialize()
    console.log('Morphology service initialized successfully')
    
    // Добавляем эндпоинт для статистики (опционально)
    nitroApp.hooks.hook('request', async (event) => {
      if (event.node.req.url === '/api/morphology/stats') {
        event.node.res.setHeader('Content-Type', 'application/json')
        event.node.res.end(JSON.stringify(morphologyService.getCacheStats()))
      }
    })
  } catch (error) {
    console.error('Failed to initialize morphology service:', error)
    // Приложение продолжит работу, но без морфологии
  }
})
