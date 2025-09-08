// /server/utils/content-validator.ts

import type {
  ValidationResult,
  ValidationMetrics,
  SemanticMetrics,
  ReadabilityMetrics,
  KeywordDetail,
} from "~/types";
import { morphologyService, AdvancedKeywordSearchResult } from "~/server/utils/morphology-service";

// Хелпер для поиска примера вынесен сюда для инкапсуляции логики
function findKeywordExample(content: string, keyword: string): string {
  const contentLower = content.toLowerCase();
  const searchKeyword = keyword.split(" ")[0];
  const pos = contentLower.indexOf(searchKeyword.toLowerCase());
  if (pos === -1) return "Пример не найден";
  const start = Math.max(0, pos - 30);
  const end = Math.min(content.length, pos + keyword.length + 30);
  let example = content.slice(start, end);
  if (start > 0) example = "..." + example;
  if (end < content.length) example = example + "...";
  const escapeRegex = (str: string) =>
    str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return example.replace(
    new RegExp(escapeRegex(keyword), "ig"),
    (match) => `<strong>${match}</strong>`
  );
}

export type ValidationStatus =
  | "OK"
  | "MISSING_KEYS"
  | "TOO_LONG"
  | "TOO_SHORT"
  | "NON_CRITICAL_ERRORS";

export interface StructuredValidationResult extends ValidationResult {
  status: ValidationStatus;
}

export class ContentValidator {
  private readonly minChars = 1800;
  private readonly maxChars = 2000;
  private readonly minDensity = 3.0;
  private readonly maxDensity = 5.5;

  async validate(
    content: string,
    requiredKeywords: string[],
    optionalKeywords: string[]
  ): Promise<StructuredValidationResult> {
    console.log(
      `\n--- [Validator] START validation for content (${content.length} chars) ---`
    );

    // ИЗМЕНЕНИЕ: Создаем "чистую" версию текста без markdown-разметки для всех расчетов.
    const cleanContent = content.replace(/\*\*/g, "");
    console.log(
      `[Validator] Clean content length for metrics: ${cleanContent.length} chars`
    );

    const issues: string[] = [];

    // Шаг 1: Нормализуем все входные ключевые слова для поиска
    const normalizedRequired = await morphologyService.lemmatizeWords(
      requiredKeywords
    );
    const normalizedOptional = await morphologyService.lemmatizeWords(
      optionalKeywords
    );
    const allNormalizedKeywords = [
      ...new Set([...normalizedRequired, ...normalizedOptional]),
    ];

    console.log(
      `[Validator] Searching for normalized keywords:`,
      allNormalizedKeywords
    );

    // Шаг 2: Ищем в тексте нормализованные ключи
    const searchResult = await morphologyService.findKeywordsAdvanced(cleanContent, allNormalizedKeywords);

    // Шаг 3: Собираем метрики и проверяем правила
    const metrics = await this.calculateMetrics(content, cleanContent, requiredKeywords, optionalKeywords, searchResult);
    
    this.checkLength(metrics, issues); // checkLength теперь работает с корректным charCount из metrics
    this.checkKeywordUsage(metrics.keywordDetails, requiredKeywords, issues);
    this.checkDensity(metrics, issues);

    // ИЗМЕНЕНИЕ: Используем cleanContent для анализа читабельности.
    const readability = this.checkReadability(cleanContent);
    this.checkReadabilityIssues(readability, issues);
    const semantic = {} as SemanticMetrics;

    let status: ValidationStatus;
    const hasAnyIssues = issues.length > 0;

    if (!hasAnyIssues) {
      status = "OK";
    } else {
      const isTooLong = issues.some((issue) => issue.includes("Текст длинный"));
      const isTooShort = issues.some((issue) => issue.includes("Текст короткий"));
      const hasMissingKeys = issues.some((issue) => issue.startsWith("❌"));

      if (isTooLong) {
        status = "TOO_LONG";
      } else if (isTooShort) {
        status = "TOO_SHORT";
      } else if (hasMissingKeys) {
        // Проверка на ключи теперь идет после проверок на длину.
        status = "MISSING_KEYS";
      } else {
        status = "NON_CRITICAL_ERRORS";
      }
    }

    const isValid = status === "OK" || status === "NON_CRITICAL_ERRORS";

    const finalResult: StructuredValidationResult = {
      isValid,
      metrics: {
        ...metrics,
        readability,
        semantic,
        warnings: issues,
      },
      issues,
      status,
    };

    console.log(
      `[Validator] Final validation state: isValid=${finalResult.isValid}, status=${finalResult.status}, issuesCount=${finalResult.issues.length}`
    );
    return finalResult;
  }

  private checkKeywordUsage(
    keywordDetails: KeywordDetail[],
    requiredKeywords: string[],
    issues: string[]
  ): void {
    const detailsMap = new Map(keywordDetails.map((d) => [d.keyword, d.count]));

    requiredKeywords.forEach((keyword) => {
      const foundCount = detailsMap.get(keyword) || 0;
      if (foundCount < 1) {
        issues.push(`❌ Отсутствует обязательный ключ: "${keyword}".`);
      }
    });
  }

  private async calculateMetrics(
    originalContent: string, // "Грязный" контент для извлечения примеров
    cleanContent: string,    // "Чистый" контент для расчетов
    originalRequired: string[],
    originalOptional: string[],
    searchResult: AdvancedKeywordSearchResult
  ): Promise<ValidationMetrics> {
    const charCount = Array.from(cleanContent).length;
    const charCountNoSpaces = Array.from(cleanContent.replace(/\s/g, '')).length;
    const wordCount = cleanContent.split(/\s+/).filter(w => w.length > 0).length;
    const allOriginalKeywords = [...originalRequired, ...originalOptional];
    const lemmas = await morphologyService.lemmatizeWords(allOriginalKeywords);
    const originalToLemmaMap = new Map<string, string>();
    allOriginalKeywords.forEach((kw, i) =>
      originalToLemmaMap.set(kw, lemmas[i])
    );

    const keywordDetails: KeywordDetail[] = allOriginalKeywords.map(originalKeyword => {
      const lemma = originalToLemmaMap.get(originalKeyword) || '';
      return {
          keyword: originalKeyword,
          count: searchResult.details[lemma]?.count || 0,
          // ИЗМЕНЕНИЕ: Для поиска примера используем оригинальный контент, чтобы сохранить **
          example: findKeywordExample(originalContent, originalKeyword)
      };
  });

    const detailsMap = new Map(keywordDetails.map((d) => [d.keyword, d.count]));
    let requiredOccurrences = 0;
    originalRequired.forEach((kw) => {
      requiredOccurrences += detailsMap.get(kw) || 0;
    });

    const keywordDensity =
      wordCount > 0 ? (requiredOccurrences / wordCount) * 100 : 0;

    const usedRequiredCount = originalRequired.filter(
      (kw) => (detailsMap.get(kw) || 0) > 0
    ).length;
    const usedOptionalCount = originalOptional.filter(
      (kw) => (detailsMap.get(kw) || 0) > 0
    ).length;

    return {
      charCount,
      charCountNoSpaces,
      wordCount,
      requiredKeywordsUsed: usedRequiredCount,
      requiredKeywordsTotal: originalRequired.length,
      optionalKeywordsUsed: usedOptionalCount,
      optionalKeywordsTotal: originalOptional.length,
      keywordsFound: searchResult.found_lemmas, 
      keywordsUsed: searchResult.found_lemmas.length, 
      totalKeywords: allOriginalKeywords.length,
      keywordDensity: Math.round(keywordDensity * 100) / 100,
      keywordOccurrences: requiredOccurrences,
      missingKeywords: originalRequired.filter(
        (kw) => (detailsMap.get(kw) || 0) === 0
      ),
      keywordUsageDetails: searchResult.details,
      keywordDetails: keywordDetails,
      charDensity: 0,
      keywordPositions: { beginning: 0, middle: 0, end: 0 },
    };
  }

  private checkLength(metrics: ValidationMetrics, issues: string[]): void {
    if (metrics.charCount < this.minChars)
      issues.push(
        `❌ Текст короткий: ${metrics.charCount} символов (нужно ${this.minChars}-${this.maxChars})`
      );
    else if (metrics.charCount > this.maxChars)
      issues.push(
        `❌ Текст длинный: ${metrics.charCount} символов (максимум ${this.maxChars})`
      );
  }

  private checkDensity(metrics: ValidationMetrics, issues: string[]): void {
    if (metrics.keywordDensity < this.minDensity)
      issues.push(
        ` Низкая плотность обязательных ключей: ${metrics.keywordDensity.toFixed(
          2
        )}% (нужно ${this.minDensity}-${this.maxDensity}%)`
      );
    else if (metrics.keywordDensity > this.maxDensity)
      issues.push(
        ` Высокая плотность обязательных ключей: ${metrics.keywordDensity.toFixed(
          2
        )}% (нужно ${this.minDensity}-${this.maxDensity}%)`
      );
  }

  private checkReadabilityIssues(
    readability: ReadabilityMetrics,
    issues: string[]
  ): void {
    if (readability.avgSentenceLength > 18)
      issues.push(
        ` Слишком длинные предложения: ${readability.avgSentenceLength.toFixed(
          2
        )} слов (среднее > 18 слов).`
      );
    if (readability.complexWordsRatio > 30)
      issues.push(
        ` Много сложных слов: ${readability.complexWordsRatio.toFixed(
          2
        )}% (Нужно < 30%).`
      );
  }

  private checkReadability(cleanContent: string): ReadabilityMetrics {
    const sentences = cleanContent
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);
    const words = cleanContent.split(/\s+/).filter((w) => w.length > 0);
    if (sentences.length === 0 || words.length === 0)
      return {
        avgSentenceLength: 0,
        maxSentenceLength: 0,
        complexWordsRatio: 0,
        longWordsRatio: 0,
        totalSentences: 0,
        fleschRuScore: 0,
        lexicalDiversity: 0,
      };
    const countSyllables = (word: string): number =>
      word.toLowerCase().match(/[аеёиоуыэюя]/g)?.length || 0;
    const complexWords = words.filter((w) => countSyllables(w) >= 4).length;
    const fleschRuScore =
      206.835 -
      1.015 * (words.length / sentences.length) -
      84.6 * (complexWords / words.length);
    return {
      avgSentenceLength: words.length / sentences.length,
      maxSentenceLength: Math.max(
        ...sentences.map((s) => s.split(/\s+/).length)
      ),
      complexWordsRatio: (complexWords / words.length) * 100,
      longWordsRatio:
        (words.filter((w) => w.length > 8).length / words.length) * 100,
      totalSentences: sentences.length,
      fleschRuScore,
      lexicalDiversity:
        (new Set(words.map((w) => w.toLowerCase())).size / words.length) * 100,
    };
  }
}
