
import { morphologyService } from '~/server/utils/morphology-service'

export default defineNitroPlugin(async (nitroApp) => {
  console.log('Initializing morphology service...')
  
  try {
    // Ensure initialization completes before proceeding
    await morphologyService.initialize()
    
    // Add a test analysis to verify it works
    const testAnalysis = await morphologyService.analyzeWord('пример')
    console.log('Test analysis:', testAnalysis)
    
    console.log('Morphology service initialized successfully')
    
    // Add your endpoint hook here
    nitroApp.hooks.hook('request', async (event) => {
      if (event.node.req.url === '/api/morphology/stats') {
        event.node.res.setHeader('Content-Type', 'application/json')
        event.node.res.end(JSON.stringify(morphologyService.getCacheStats()))
      }
    })
  } catch (error) {
    console.error('Critical: Failed to initialize morphology service:', error)
    // Consider whether your app can run without morphology
    throw error // Fail fast if morphology is critical
  }
})