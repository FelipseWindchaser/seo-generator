// import { defineTask } from '#imports';
// import { SEOGenerator } from '~/server/utils/llm-generator';
// import { updateTask } from '~/server/utils/redis';
// import type { GenerationRequest } from '~/types';

// export default defineTask({
//   async run(event) {
//     const { taskId, requestData } = event.payload as { taskId: string; requestData: GenerationRequest };
//     const generator = new SEOGenerator();
//     try {
//       console.log(`[Task ${taskId}] Starting generation...`);
//       const result = await generator.generateWithValidation(requestData);

//       await updateTask(taskId, {
//         status: 'completed',
//         result,
//         completedAt: new Date().toISOString(),
//       });
//       console.log(`[Task ${taskId}] Completed.`);
//       return { result };
//     } catch (error) {
//       console.error(`[Task ${taskId}] Error during generation:`, error);
//       await updateTask(taskId, {
//         status: 'error',
//         error: error instanceof Error ? error.message : 'Unknown error',
//         completedAt: new Date().toISOString(),
//       });
//       throw error;
//     }
//   },
// });
