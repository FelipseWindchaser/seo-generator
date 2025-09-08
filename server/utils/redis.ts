// server/utils/redis.ts

import Redis from "ioredis";
import type { GenerationRequest, Task } from "~/types";

// Получаем URL Redis один раз при инициализации модуля
const config = useRuntimeConfig();
const redisUrl = config.redisUrl;

if (!redisUrl) {
  throw new Error("REDIS_URL is not defined in runtime config. Please check your .env and nuxt.config.ts");
}

// Создаем единственный экземпляр клиента
const redisClient = new Redis(redisUrl);

export function getRedis(): Redis {
  return redisClient;
}

export async function createTask(request: GenerationRequest, status: "queued"): Promise<string> {
  const redis = getRedis();
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const task: Task = {
    id: taskId,
    status: "queued",
    request,
    createdAt: new Date().toISOString(),
  };

  // 10 часов = 60 секунд * 60 минут * 10 часов
  const TEN_HOURS_IN_SECONDS = 60 * 60 * 10;

  await redis.set(
    `task:${taskId}`,
    JSON.stringify(task),
    "EX",
    TEN_HOURS_IN_SECONDS
  );

  return taskId;
}

export async function getTask(taskId: string): Promise<Task | null> {
  const redis = getRedis();
  const data = await redis.get(`task:${taskId}`);

  if (!data) return null;

  return JSON.parse(data) as Task;
}

/**
 * @description Находит все задачи в статусе 'queued' с использованием неблокирующей команды SCAN.
 * Это безопасный для production способ получения ключей.
 * @returns Массив задач в статусе 'queued'.
 */
export async function getQueuedTasks(): Promise<Task[]> {
  const redis = getRedis();
  const stream = redis.scanStream({
    match: 'task:*',
    count: 100, // Сколько ключей запрашивать за один раз
  });

  const taskKeys: string[] = [];
  for await (const keys of stream) {
    taskKeys.push(...keys);
  }

  if (taskKeys.length === 0) {
    return [];
  }

  // Используем mget для получения всех задач одним запросом
  const tasksData = await redis.mget(taskKeys);

  const tasks: Task[] = [];
  for (const data of tasksData) {
    if (data) {
      const task = JSON.parse(data) as Task;
      if (task.status === 'queued') {
        tasks.push(task);
      }
    }
  }
  
  return tasks;
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>
): Promise<Task> {
  const redis = getRedis();
  const task = await getTask(taskId);

  if (!task) throw new Error("Task not found");

  const updatedTask = { ...task, ...updates };
  
  const TASK_TTL_IN_SECONDS = 60 * 60 * 10;

  // Используем setex для установки значения с TTL
  await redis.setex(`task:${taskId}`, TASK_TTL_IN_SECONDS, JSON.stringify(updatedTask));
  
  return updatedTask;
}