// /server/api/tasks/[id].put.ts

import { updateTask } from '~/server/utils/redis';
import type { GenerationResult, Task } from '~/types';
import { z } from 'zod';

// --- ДЕТАЛЬНЫЕ СХЕМЫ, ПОЛНОСТЬЮ СИНХРОНИЗИРОВАННЫЕ С TYPES.TS ---

// Схема для типа KeywordDetail
const keywordDetailSchema = z.object({
  keyword: z.string(),
  count: z.number(),
  example: z.string(),
});

// Схема для типа ValidationMetrics (теперь включает все новые поля)
const validationMetricsSchema = z.object({
  charCount: z.number(),
  charCountNoSpaces: z.number(),
  wordCount: z.number(),
  requiredKeywordsUsed: z.number(),
  requiredKeywordsTotal: z.number(),
  optionalKeywordsUsed: z.number(),
  optionalKeywordsTotal: z.number(),
  keywordsFound: z.array(z.string()),
  keywordsUsed: z.number(),
  totalKeywords: z.number(),
  keywordDensity: z.number(),
  keywordOccurrences: z.number(),
  missingKeywords: z.array(z.string()),
  keywordUsageDetails: z.record(z.object({ count: z.number() })),
  keywordPositions: z.object({
    beginning: z.number(),
    middle: z.number(),
    end: z.number(),
  }),
  charDensity: z.number(),
});

// Схема для объекта metrics внутри GenerationResult
const generationMetricsSchema = validationMetricsSchema.extend({
  keywordDetails: z.array(keywordDetailSchema),
  boldKeywordsCount: z.number(),
  utpCovered: z.number().optional(),
  painPointsAddressed: z.number().optional(),
  trustTriggers: z.number().optional(),
});

// --- ФИНАЛЬНАЯ СХЕМА ДЛЯ GenerationResult ---
const generationResultSchema = z.object({
  success: z.boolean(),
  content: z.string(),
  title: z.string(),
  description: z.string(),
  metrics: generationMetricsSchema.optional(),
  attempts: z.number(),
  warnings: z.array(z.string()).optional(),
  processingLog: z.object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
  }).optional(),
});

// Схема для валидации всего тела запроса
const updateBodySchema = z.object({
  result: generationResultSchema,
});


export default defineEventHandler(async (event) => {
  const taskId = getRouterParam(event, 'id');
  const body = await readBody(event);

  if (!taskId) {
    throw createError({ statusCode: 400, message: 'Task ID is required' });
  }

  // 1. Валидируем тело запроса по новой, полной схеме
  const validation = updateBodySchema.safeParse(body);
  if (!validation.success) {
    console.error('[Task Update] Validation Error:', validation.error.errors);
    throw createError({ statusCode: 400, message: 'Invalid request body', data: validation.error.errors });
  }
  
  const { result } = validation.data;

  // 2. Создаем объект с изменениями для Redis
  const updates: Partial<Task> = {
    result: result,
    status: 'completed',
    completedAt: new Date().toISOString(),
  };

  // 3. Вызываем вашу функцию updateTask
  try {
    await updateTask(taskId, updates);
    return { success: true, message: 'Task updated successfully' };
  } catch (error: any) {
    console.error(`[Task Update] Failed to update task ${taskId}:`, error);
    if (error.message === 'Task not found') {
        throw createError({ statusCode: 404, message: 'Task to update not found' });
    }
    throw createError({ statusCode: 500, message: 'Failed to save the task' });
  }
});