import Redis from "ioredis";
import type { GenerationRequest, Task } from "~/types";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const config = useRuntimeConfig();
    redis = new Redis(config.redisUrl);
  }
  return redis;
}

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
    3600 // TTL 1 час
  );

  return taskId;
}

// Проверка TTL
async function getTaskTtl(taskId: string) {
  const redis = getRedis();
  return await redis.ttl(taskId); // -2 если ключа нет, -1 если нет TTL
}

export async function getTask(taskId: string): Promise<Task | null> {
  const redis = getRedis();
  const data = await redis.get(`task:${taskId}`);

  if (!data) return null;

  return JSON.parse(data) as Task;
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>
): Promise<void> {
  const redis = getRedis();
  const task = await getTask(taskId);

  if (!task) throw new Error("Task not found");

  const updatedTask = { ...task, ...updates };

  await redis.setex(`task:${taskId}`, 3600, JSON.stringify(updatedTask));
}
