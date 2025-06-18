import Redis from "ioredis";
import type { GenerationRequest, Task } from "../../types";
import { SEOGenerator } from "./llm-generator";

let redisInstance: Redis | null = null;

const generator = new SEOGenerator(process.env.GEMINI_API_KEY || '');
/**
 * Инициализирует и возвращает единственный экземпляр Redis.
 * Эта функция должна вызываться с URL при первом запуске.
 * @param redisUrl - URL для подключения к Redis.
 */
export function initializeRedis(redisUrl: string): Redis {
  if (redisInstance) {
    console.warn("Redis is already initialized.");
    return redisInstance;
  }
  if (!redisUrl) {
    throw new Error("Redis URL must be provided for initialization.");
  }
  redisInstance = new Redis(redisUrl);
  console.log("Redis client initialized.");
  return redisInstance;
}

export function getRedis(): Redis {
  if (!redisInstance) {
    throw new Error("Redis has not been initialized. Call initializeRedis(url) first.");
  }
  return redisInstance;
}
// Остальные функции (updateTask и т.д.) остаются без изменений,
// так как они используют getRedis() для получения инстанса.

export async function createTask(request: GenerationRequest): Promise<string> {
  const redis = getRedis();
  const taskId = `task_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  const task: Task = {
    id: taskId,
    status: "processing",
    request,
    createdAt: new Date().toISOString(),
  };

  await redis.set(
    `task:${taskId}`,
    JSON.stringify(task),
    "EX",
    36000 // TTL 1 час
  );

  return taskId;
}

// Проверка TTL
async function getTaskTtl(taskId: string) {
  const redis = getRedis();
  return await redis.ttl(taskId); // -2 если ключа нет, -1 если нет TTL
}

async function processTask(taskId: string) {
  console.log(`[${taskId}] Processing task...`);
  
  // ИСПРАВЛЕНО: Добавляем проверку здесь же.
  // const taskData = await getRedis().get(taskId);

  // if (!taskData) {
  //   console.error(`[processTask] Task data for ${taskId} not found. It might have expired. Skipping task.`);
  //   return; // <-- Просто переходим к следующей задаче
  // }

  // const task = JSON.parse(taskData) as Task;

  try {// 1. Устанавливаем статус "в обработке". `updateTask` сам справится, если задача уже удалена.
    await updateTask(taskId, { status: 'processing' });

    // 2. Получаем актуальные данные задачи для генератора.
    // Эта проверка нужна, так как между `updateTask` и этим моментом могло что-то произойти.
    const currentTaskData = await getRedis().get(taskId);
    if (!currentTaskData) {
        console.warn(`[processTask] Task ${taskId} disappeared after setting status to processing. Skipping.`);
        return;
    }
    const task = JSON.parse(currentTaskData) as Task;
    
    // 3. Запускаем генерацию.
    const result = await generator.generateWithValidation(task.request!);

    // 4. Обновляем задачу с финальным результатом.
    await updateTask(taskId, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    });
    console.log(`[${taskId}] Task completed successfully.`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown worker error';
    console.error(`[${taskId}] Task failed:`, errorMessage);
    // 5. В случае ошибки обновляем задачу со статусом "error".
    await updateTask(taskId, {
      status: 'error',
      error: errorMessage,
      completedAt: new Date().toISOString(),
    });
  }
}

export async function getTask(taskId: string): Promise<Task | null> {
  const redis = getRedis();
  const data = await redis.get(`task:${taskId}`);

  if (!data) return null;

  return JSON.parse(data) as Task;
}


// find all processing tasks
export async function getProcessingTasks(): Promise<Task[]> {
  const redis = getRedis();
  
  try {
    // 1. Get all task keys
    const keys = await redis.keys('task:*');
    // console.log('keys', keys);
    // 2. If no tasks exist, return empty array
    if (!keys.length) return [];
    
    // 3. Get all tasks in parallel
    const tasks = await Promise.all(
      keys.map(async (key) => {
        const data = await redis.get(key);
        return data ? (JSON.parse(data) as Task) : null;
      })
    );
    
    // 4. Filter for processing tasks
    return tasks.filter((task): task is Task => 
      task !== null && task.status === 'processing'
    );
    
  } catch (error) {
    console.error('Error getting processing tasks:', error);
    throw new Error('Failed to retrieve processing tasks');
  }
}
// get task object by id
// const getalltasks = async () => {
//   const result = await getProcessingTasks();
//   // console.log('getalltasks', result);
// }
// getalltasks();

/**
 * Обновляет данные задачи в Redis.
 * @param taskId - ID задачи (например, 'task:12345').
 * @param updates - Объект с полями для обновления.
 */
export async function updateTask(
  taskId: string,
  updates: Partial<Task>
): Promise<Task | void> {
  const redis = getRedis();
  const task = await getTask(taskId);
  //cursor
  if (!task) {
    console.warn(`[updateTask] Task data for ${taskId} not found. It might have expired. Skipping update.`);
    return;
  }

  const updatedTask: Task = { ...task, ...updates };

  await redis.setex(`task:${taskId}`, 36000, JSON.stringify(updatedTask));
  return updatedTask;
}

// import { repeatFunction } from '~/composables/processGeneration';
// repeatFunction();

