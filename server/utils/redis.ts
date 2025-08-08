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

export async function createTask(request: GenerationRequest, status: string): Promise<string> {
  const redis = getRedis();
  const taskId = `task_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  const task: Task = {
    id: taskId,
    status: "queued",
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

export async function getTask(taskId: string): Promise<Task | null> {
  const redis = getRedis();
  const data = await redis.get(`task:${taskId}`);

  if (!data) return null;

  return JSON.parse(data) as Task;
}


// find all processing tasks
export async function getQueuedTasks(): Promise<Task[]> {
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
      task !== null && task.status === 'queued'
    );
    
  } catch (error) {
    console.error('Error getting processing tasks:', error);
    throw new Error('Failed to retrieve processing tasks');
  }
}
// get task object by id
const getalltasks = async () => {
  const result = await getQueuedTasks();
  // console.log('getalltasks', result);
}
getalltasks();

export async function updateTask(
  taskId: string,
  updates: Partial<Task>
): Promise<Task> {
  const redis = getRedis();
  const task = await getTask(taskId);

  if (!task) throw new Error("Task not found");

  const updatedTask = { ...task, ...updates };

  await redis.setex(`task:${taskId}`, 36000, JSON.stringify(updatedTask));
  return updatedTask;
}

// import { repeatFunction } from '~/composables/processGeneration';
// repeatFunction();

