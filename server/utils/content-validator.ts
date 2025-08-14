import type { ValidationResult, ValidationMetrics, SemanticMetrics, ReadabilityMetrics, KeywordInstruction } from '~/types'
import { morphologyService } from './morphology-service'


export type ValidationStatus = "OK" | "MISSING_KEYS" | "TOO_LONG" | "TOO_SHORT" | "NON_CRITICAL_ERRORS";

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
    console.log(`\n--- [Validator] START validation for content (${content.length} chars) ---`);
    
    const issues: string[] = [];
    const allKeywords = [...requiredKeywords, ...optionalKeywords];

    const searchResult = await morphologyService.findKeywordsAdvanced(content, allKeywords, 0);

    const metrics = this.calculateMetrics(content, requiredKeywords, optionalKeywords, searchResult);
    
    this.checkLength(metrics, issues);
    this.checkKeywordUsage(metrics.keywordUsageDetails, requiredKeywords, issues);
    this.checkDensity(metrics, issues);

    const readability = this.checkReadability(content);
    this.checkReadabilityIssues(readability, issues);
    const semantic = {} as SemanticMetrics; 

    // --- ФИНАЛЬНАЯ, ПРИОРИТЕЗИРОВАННАЯ ЛОГИКА ОПРЕДЕЛЕНИЯ СТАТУСА ---
    
    let status: ValidationStatus;
    
    const hasAnyIssues = issues.length > 0;

    if (!hasAnyIssues) {
      status = "OK";
    } else {
      // Определяем наличие критических ошибок
      const hasMissingKeys = issues.some(issue => issue.startsWith('❌') && issue.includes("Отсутствует обязательный ключ"));
      const isTooLong = issues.some(issue => issue.startsWith('❌') && issue.includes("Текст длинный"));
      const isTooShort = issues.some(issue => issue.startsWith('❌') && issue.includes("Текст короткий"));

      // Применяем логику приоритетов
      if (hasMissingKeys) {
        status = "MISSING_KEYS"; // Самый высокий приоритет
      } else if (isTooLong) {
        status = "TOO_LONG";
      } else if (isTooShort) {
        status = "TOO_SHORT";
      } else {
        // Если критических ошибок нет, но issues не пуст, значит остались только предупреждения
        status = "NON_CRITICAL_ERRORS";
      }
    }

    // `isValid` теперь означает "готов к завершению цикла"
    const isValid = (status === "OK" || status === "NON_CRITICAL_ERRORS");

    const finalResult: StructuredValidationResult = {
      isValid,
      metrics: { ...metrics, readability, semantic },
      issues,
      status,
    };
    
    console.log(`[Validator] Final validation state: isValid=${finalResult.isValid}, status=${finalResult.status}, issuesCount=${finalResult.issues.length}`);
    return finalResult;
  }

  private checkKeywordUsage(
    foundDetails: Record<string, { count: number }>, 
    requiredKeywords: string[], 
    issues: string[]
  ): void {
    requiredKeywords.forEach(keyword => {
      const foundCount = foundDetails[keyword]?.count || 0;
      if (foundCount < 1) { 
        issues.push(`❌ Отсутствует обязательный ключ: "${keyword}".`);
      }
    });
  }

  // private calculateMetrics(
  //   content: string, 
  //   requiredKeywords: string[],
  //   optionalKeywords: string[],
  //   searchResult: { found_keywords: string[], details: Record<string, { count: number }> }
  // ): ValidationMetrics {
  //   const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    
  //   let requiredOccurrences = 0;
  //   requiredKeywords.forEach(keyword => {
  //       requiredOccurrences += searchResult.details[keyword]?.count || 0;
  //   });

  //   const keywordDensity = wordCount > 0 ? (requiredOccurrences / wordCount * 100) : 0;
    
  //   const foundKeywords = searchResult.found_keywords;
  //   const usedOptionalCount = optionalKeywords.filter(k => foundKeywords.includes(k)).length;
  //   const usedRequiredCount = requiredKeywords.filter(k => foundKeywords.includes(k)).length;

  //   return {
  //     charCount: content.length,
  //     charCountNoSpaces: content.replace(/\s/g, '').length,
  //     wordCount,
  //     requiredKeywordsUsed: usedRequiredCount,
  //     requiredKeywordsTotal: requiredKeywords.length,
  //     optionalKeywordsUsed: usedOptionalCount,
  //     optionalKeywordsTotal: optionalKeywords.length,
  //     keywordsFound: foundKeywords,
  //     keywordsUsed: foundKeywords.length,
  //     totalKeywords: requiredKeywords.length + optionalKeywords.length,
  //     keywordDensity: Math.round(keywordDensity * 100) / 100,
  //     keywordOccurrences: requiredOccurrences,
  //     missingKeywords: requiredKeywords.filter(k => !foundKeywords.includes(k)),
  //     keywordUsageDetails: searchResult.details,
  //     keywordPositions: { beginning: 0, middle: 0, end: 0 },
  //     charDensity: 0,
  //   };
  // }

  //Обновленный метод подсчета символов для учета спецсимволов
  private calculateMetrics(
    content: string, 
    requiredKeywords: string[],
    optionalKeywords: string[],
    searchResult: { found_keywords: string[], details: Record<string, { count: number }> }
  ): ValidationMetrics {
    // Подсчёт символов с учётом Unicode-графем (правильно считает эмодзи, акценты и т.п.)
    const charCount = Array.from(content).length;
    const charCountNoSpaces = Array.from(content.replace(/\s/g, '')).length;
  
    // Подсчёт слов
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
  
    // Подсчёт количества вхождений обязательных ключей
    let requiredOccurrences = 0;
    requiredKeywords.forEach(keyword => {
      requiredOccurrences += searchResult.details[keyword]?.count || 0;
    });
  
    // Плотность ключей в %
    const keywordDensity = wordCount > 0 ? (requiredOccurrences / wordCount * 100) : 0;
  
    const foundKeywords = searchResult.found_keywords;
    const usedOptionalCount = optionalKeywords.filter(k => foundKeywords.includes(k)).length;
    const usedRequiredCount = requiredKeywords.filter(k => foundKeywords.includes(k)).length;
  
    return {
      charCount, // теперь корректный Unicode-подсчёт
      charCountNoSpaces,
      wordCount,
      requiredKeywordsUsed: usedRequiredCount,
      requiredKeywordsTotal: requiredKeywords.length,
      optionalKeywordsUsed: usedOptionalCount,
      optionalKeywordsTotal: optionalKeywords.length,
      keywordsFound: foundKeywords,
      keywordsUsed: foundKeywords.length,
      totalKeywords: requiredKeywords.length + optionalKeywords.length,
      keywordDensity: Math.round(keywordDensity * 100) / 100,
      keywordOccurrences: requiredOccurrences,
      missingKeywords: requiredKeywords.filter(k => !foundKeywords.includes(k)),
      keywordUsageDetails: searchResult.details,
      keywordPositions: { beginning: 0, middle: 0, end: 0 },
      charDensity: 0,
    };
  }
  
  private checkLength(metrics: ValidationMetrics, issues: string[]): void {
    if (metrics.charCount < this.minChars) issues.push(`❌ Текст короткий: ${metrics.charCount} символов (нужно ${this.minChars}-${this.maxChars})`);
    else if (metrics.charCount > this.maxChars) issues.push(`❌ Текст длинный: ${metrics.charCount} символов (максимум ${this.maxChars})`);
  }

  private checkDensity(metrics: ValidationMetrics, issues: string[]): void {
    if (metrics.keywordDensity < this.minDensity) issues.push(`⚠️ Низкая плотность обязательных ключей: ${metrics.keywordDensity.toFixed(2)}% (нужно ${this.minDensity}-${this.maxDensity}%)`);
    else if (metrics.keywordDensity > this.maxDensity) issues.push(`⚠️ Высокая плотность обязательных ключей: ${metrics.keywordDensity.toFixed(2)}% (нужно ${this.minDensity}-${this.maxDensity}%)`);
  }

  private checkReadabilityIssues(readability: ReadabilityMetrics, issues: string[]): void {
    if (readability.avgSentenceLength > 18) issues.push(`⚠️ Слишком длинные предложения: ${readability.avgSentenceLength.toFixed(2)} слов (среднее > 18 слов).`);
    if (readability.complexWordsRatio > 30) issues.push(`⚠️ Много сложных слов: ${readability.complexWordsRatio.toFixed(2)}% (Нужно < 30%).`);
  }

  private checkReadability(content: string): ReadabilityMetrics {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = content.split(/\s+/).filter(w => w.length > 0);
    if (sentences.length === 0 || words.length === 0) return { avgSentenceLength: 0, maxSentenceLength: 0, complexWordsRatio: 0, longWordsRatio: 0, totalSentences: 0, fleschRuScore: 0, lexicalDiversity: 0 };
    const countSyllables = (word: string): number => word.toLowerCase().match(/[аеёиоуыэюя]/g)?.length || 0;
    const complexWords = words.filter(w => countSyllables(w) >= 4).length;
    const fleschRuScore = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (complexWords / words.length);
    return {
      avgSentenceLength: words.length / sentences.length,
      maxSentenceLength: Math.max(...sentences.map(s => s.split(/\s+/).length)),
      complexWordsRatio: (complexWords / words.length) * 100,
      longWordsRatio: (words.filter(w => w.length > 8).length / words.length) * 100,
      totalSentences: sentences.length,
      fleschRuScore,
      lexicalDiversity: (new Set(words.map(w => w.toLowerCase())).size / words.length) * 100
    };
  }
}