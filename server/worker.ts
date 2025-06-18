console.log('🚀 Worker started. Waiting for tasks...');
import { initializeRedis, getRedis, updateTask } from './utils/redis';
import { SEOGenerator } from './utils/llm-generator';
import 'dotenv/config';
import type { Task } from '../types';

console.log('🚀 Worker started. Waiting for tasks...');
// process.on('uncaughtException', (err, origin) => { console.error(`UNCAUGHT EXCEPTION: ${origin}`, err); process.exit(1); });
// process.on('unhandledRejection', (reason, promise) => { console.error('UNHANDLED REJECTION:', reason); });

// try {

const redisUrl = process.env.REDIS_URL;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!redisUrl || !geminiApiKey) {
  throw new Error('Missing REDIS_URL or GEMINI_API_KEY in .env file.');
}

initializeRedis(redisUrl);
const redis = getRedis();
const generator = new SEOGenerator(geminiApiKey);

console.log('✅ Worker initialized successfully. Waiting for tasks...');

async function processTask(taskId: string) {
  console.log(`[${taskId}] Processing task...`);
  const taskData = await redis.get(taskId);
  console.log('taskData', taskData);
  if (!taskData) {
    console.error(`[${taskId}] Task data not found in Redis.`);
    return;
  }

  const task = JSON.parse(taskData) as Task;
  console.log('task', task);
  try {
    await updateTask(taskId, { status: 'processing' });
    const result = await generator.generateWithValidation(task.request!);

    await updateTask(taskId, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    });
    console.log(`[${taskId}] Task completed successfully.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown worker error';
    console.error(`[${taskId}] Task failed:`, errorMessage);
    await updateTask(taskId, {
      status: 'error',
      error: errorMessage,
      completedAt: new Date().toISOString(),
    });
  }
}

export async function main() {
  while (true) {
    try {
      // BRPOP атомарно извлекает элемент из списка. '0' означает ждать вечно.
      // Это самый эффективный способ слушать очередь.
      const result = await redis.brpop('tasks:queue', 0);
      console.log('result', result);
      if (result) {
        const taskId = result[1];
        await processTask(taskId);
      }
    } catch (error) {
      console.error('Worker main loop error:', error);
      // Пауза перед повторной попыткой подключения к Redis
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}


// } catch (error) {
//   console.error(`!!!!!!!!!! WORKER FAILED TO START !!!!!!!!!!!`);
//   console.error(error);
//   process.exit(1);
// }
