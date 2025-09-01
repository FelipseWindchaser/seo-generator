// /server/api/tasks/[id].put.ts

import { updateTask } from '~/server/utils/redis';
import type { Task } from '~/types';
import { z } from 'zod';

// --- АКТУАЛЬНЫЕ СХЕМЫ, СИНХРОНИЗИРОВАННЫЕ С TYPES.TS ---

// Схема для AnalysisDetail
const analysisDetailSchema = z.object({
  point: z.string(),
  isCovered: z.boolean(),
  evidence: z.string(),
});

// Схема для ValidationMetrics
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
  // Добавляем поле, которое теперь является частью метрик
  boldKeywordsCount: z.number(),
});

// Схема для одной вариации текста (TextVariation)
const textVariationSchema = z.object({
  description: z.string(),
  metrics: validationMetricsSchema,
  analysis: z.object({
    utpAnalysis: z.array(analysisDetailSchema),
    painPointAnalysis: z.array(analysisDetailSchema),
  }),
});

// Финальная схема для GenerationResult
const generationResultSchema = z.object({
  success: z.boolean(),
  title: z.string(),
  variations: z.array(textVariationSchema), // Валидируем массив вариаций
  attempts: z.number(),
  warnings: z.array(z.string()).optional(),
  processingLog: z.object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
  }).optional(),
  // УДАЛЕНО: content, metrics, analysis - они теперь внутри variations
});

// Схема для валидации всего тела запроса
const updateBodySchema = z.object({
  result: generationResultSchema,
});


export default defineEventHandler(async (event) => {
  const taskId = getRouterParam(event, 'id');
  
  if (!taskId) {
    throw createError({ statusCode: 400, message: 'Task ID is required' });
  }

  const body = await readBody(event);

  // 1. Валидируем тело запроса по новой, полной схеме
  const validation = updateBodySchema.safeParse(body);
  if (!validation.success) {
    // Логируем ошибку для отладки на сервере
    console.error('[Task Update] Zod Validation Error:', validation.error.errors);
    throw createError({ statusCode: 400, message: 'Invalid request body', data: validation.error.errors });
  }
  
  const { result } = validation.data;

  // 2. Создаем объект с изменениями для Redis
  const updates: Partial<Task> = {
    result: result,
    status: 'completed',
    completedAt: new Date().toISOString(),
  };

  // 3. Вызываем функцию updateTask для сохранения в Redis
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