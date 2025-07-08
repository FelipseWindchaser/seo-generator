import { runUserRefinement } from "~/composables/processGeneration";
import { ContentValidator } from "~/server/utils/content-validator";
import type {
  GenerationRequest,
  GenerationResult,
  KeywordDetail,
} from "~/types";

function prepareFinalResult(
  title: string,
  content: string,
  validation: any,
  additionalChecks: any,
  attempts: number,
  success: boolean
): GenerationResult {
  const keywordDetails: KeywordDetail[] = [];
  const keywordUsage = validation.metrics.keywordUsageDetails || {};

  for (const [keyword, details] of Object.entries(keywordUsage)) {
    // @ts-ignore
    const count = details.count || 0;
    // findKeywordExample здесь недоступен, можно либо передавать, либо опустить для этого ответа
    keywordDetails.push({
      keyword,
      count,
      example: "Пример недоступен после улучшения",
    });
  }

  const finalContent = `**${title}**\n\n${content}`;

  const result: GenerationResult = {
    success,
    content: finalContent,
    title,
    description: content,
    metrics: {
      ...validation.metrics,
      keywordDetails,
      boldKeywordsCount: additionalChecks.checks.boldKeywords,
    },
    attempts,
    processingLog: { added: [], removed: [] }, // Правки были ручные
  };

  if (!success) {
    result.warnings = validation.issues;
  }
  return result;
}

export default defineEventHandler(async (event) => {
  // --- DEBUG LOG ---
  console.log("--- [/api/refine] Received request ---");
  const body = await readBody(event);
  // --- DEBUG LOG ---
  console.log("[/api/refine] Request body:", body);
  const { originalContent, userPrompt, generationData } = body as {
    originalContent: string;
    userPrompt: string;
    generationData: GenerationRequest;
  };

  if (!originalContent || !userPrompt || !generationData) {
    // --- DEBUG LOG ---
    console.error("[/api/refine] Validation FAILED. Missing required fields.");
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields for refinement.",
    });
  }

  // 1. Выполняем улучшение
   // --- DEBUG LOG ---
   console.log("[/api/refine] Calling runUserRefinement...");
  const refinedContent = await runUserRefinement(
    originalContent,
    userPrompt,
    generationData
  );

  // 2. Снова валидируем результат, чтобы пользователь видел актуальные метрики
   // --- DEBUG LOG ---
   console.log("[/api/refine] Calling validator...")
  const validator = new ContentValidator();
  const validationResult = await validator.validate(
    refinedContent,
    generationData.keywords
  );

  // 3. Готовим и возвращаем новый объект GenerationResult
  const isSuccess = validationResult.isValid;
  const title = "Улучшенный результат"; // Заголовок можно оставить старым или обновить

  // checkAdditionalRequirements здесь недоступен, можно передать заглушку
  const additionalChecks = {
    issues: [],
    checks: { boldKeywords: (refinedContent.match(/\*\*/g) || []).length / 2 },
  };

  const finalResult = prepareFinalResult(
    title,
    refinedContent,
    validationResult,
    additionalChecks,
    (body.attempts || 2) + 1, // Увеличиваем счетчик попыток
    isSuccess
  );
  
  console.log("[/api/refine] Sending final response.");
  return finalResult;
});
