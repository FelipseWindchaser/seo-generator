import type { ValidationResult, GenerationRequest, ValidationMetrics, SemanticMetrics, ReadabilityMetrics, KeywordInstruction } from '~/types'
import { morphologyService } from './morphology-service'
import type { TextAnalysis } from '~/types/morphology'
import { findKeywordsAdvanced } from './keyword-finder'

// НОВАЯ вспомогательная функция для точного подсчета
function countOccurrences(text: string, sub: string): number {
  if (sub.length === 0) return 0;
  
  // Приводим все к нижнему регистру для регистронезависимого поиска
  const textLower = text.toLowerCase();
  const subLower = sub.toLowerCase();
  
  let count = 0;
  let pos = textLower.indexOf(subLower, 0);
  
  while (pos !== -1) {
    count++;
    pos = textLower.indexOf(subLower, pos + 1);
  }
  
  return count;
}
// function countOccurrences(text: string, sub: string): number {
//   if (sub.length === 0) return 0;
//   const escapedSub = sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//   const regex = new RegExp(`\\b${escapedSub}\\b`, 'gi'); // Ищем как целое слово/фразу
//   return (text.match(regex) || []).length;
// }

export class ContentValidator {
  private readonly minChars = 1800
  private readonly maxChars = 2000
  
  async validate(
    content: string, 
    primaryInstructions: KeywordInstruction[], 
    secondaryKeywords: string[]
  ): Promise<ValidationResult> {
    console.log(`\n--- [Validator] START validation for content (${content.length} chars) ---`);
    
    const issues: string[] = [];
    const allKeywords = [...primaryInstructions.map(i => i.keyword), ...secondaryKeywords];

    // ШАГ 1: ДЕЛАЕМ ОДИН "УМНЫЙ" ВЫЗОВ К МОРФОЛОГИЧЕСКОМУ СЕРВИСУ
    // max_distance=5 означает, что слова во фразе могут быть на расстоянии до 5 других слов друг от друга.
    console.log('[Validator] Calling advanced keyword search...');
    const searchResult = await morphologyService.findKeywordsAdvanced(content, allKeywords, 5);
    console.log('[Validator] Advanced search result:', searchResult);

    // ШАГ 2: ПРОВЕРЯЕМ КРИТИЧНЫЕ ПРАВИЛА, ИСПОЛЬЗУЯ РЕЗУЛЬТАТЫ "УМНОГО" ПОИСКА
    this.checkLength({ charCount: content.length }, issues);
    this.checkKeywordUsage(searchResult.details, primaryInstructions, secondaryKeywords, issues);
    
    // ШАГ 3: СОБИРАЕМ ВСЕ МЕТРИКИ ДЛЯ ОТЧЕТА (также на основе умного поиска)
    const metrics = this.calculateMetrics(content, allKeywords, searchResult);
    const readability = this.checkReadability(content);
    // Семантический анализ можно будет улучшить позже, пока оставим заглушку
    const semantic = {} as SemanticMetrics; 

    const finalResult: ValidationResult = {
      isValid: issues.filter(issue => issue.startsWith('❌')).length === 0,
      metrics: { ...metrics, readability, semantic },
      issues
    };

    console.log("--- [Validator] END validation ---\n");
    return finalResult;
  }

  private checkKeywordUsage(
    foundDetails: Record<string, { count: number }>, 
    primaryInstructions: KeywordInstruction[], 
    secondaryKeywords: string[], 
    issues: string[]
  ): void {
    // Проверка основных ключей
    primaryInstructions.forEach(instr => {
      const foundCount = foundDetails[instr.keyword]?.count || 0;
      if (foundCount < instr.count) { // Используем "меньше", а не "не равно" для гибкости
        issues.push(`❌ Основной ключ "${instr.keyword}" найден ${foundCount} раз(а), ожидалось ${instr.count}.`);
      }
    });

    // Проверка дополнительных ключей
    secondaryKeywords.forEach(keyword => {
      const foundCount = foundDetails[keyword]?.count || 0;
      if (foundCount < 1) {
        issues.push(`❌ Отсутствует дополнительный ключ: "${keyword}".`);
      }
    });
  }

  private calculateMetrics(
    content: string, 
    allKeywords: string[],
    searchResult: { found_keywords: string[], details: Record<string, { count: number }> }
  ): ValidationMetrics {
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    const totalOccurrences = Object.values(searchResult.details).reduce((sum, current) => sum + current.count, 0);
    const keywordDensity = wordCount > 0 ? (totalOccurrences / wordCount * 100) : 0;
    
    const foundKeywords = searchResult.found_keywords;
    const missingKeywords = allKeywords.filter(k => !foundKeywords.includes(k));
    
    return {
      charCount: content.length,
      charCountNoSpaces: content.replace(/\s/g, '').length,
      wordCount,
      keywordsFound: foundKeywords,
      keywordsUsed: foundKeywords.length,
      totalKeywords: allKeywords.length,
      keywordDensity: Math.round(keywordDensity * 100) / 100,
      charDensity: 0, 
      keywordOccurrences: totalOccurrences,
      missingKeywords,
      keywordUsageDetails: searchResult.details,
      
      // ИСПРАВЛЕНО: Возвращаем объект-заглушку с правильной структурой,
      // чтобы он соответствовал Zod-схеме.
      keywordPositions: {
        beginning: 0,
        middle: 0,
        end: 0,
      }
    };
  }
  
  // ... остальные функции (analyzeKeywordPositions, semanticAnalysis, checkLength и т.д.) без изменений ...
  private analyzeKeywordPositions(content: string, keywordUsageDetails: Record<string, { count: number }>): { beginning: number; middle: number; end: number } {
    const textLength = content.length;
    const positions = { beginning: 0, middle: 0, end: 0 };
    const contentLower = content.toLowerCase();
    for (const keyword of Object.keys(keywordUsageDetails)) {
        const firstWord = keyword.split(' ')[0];
        const regex = new RegExp(this.escapeRegex(firstWord), 'gi');
        let match;
        while ((match = regex.exec(contentLower)) !== null) {
            const relativePos = match.index / textLength;
            if (relativePos < 0.2) positions.beginning++;
            else if (relativePos < 0.8) positions.middle++;
            else positions.end++;
        }
    }
    return positions;
  }
  
  private async semanticAnalysis(content: string, keywords: string[], textAnalysis: TextAnalysis): Promise<SemanticMetrics> {
    const contentLower = content.toLowerCase();
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
    let keywordStuffingDetected = false;
    for (const keyword of keywords) {
      const firstWord = keyword.split(' ')[0];
      const analysis = await morphologyService.analyzeWord(firstWord);
      if (!analysis) continue;
      const lemma = analysis.lemma;
      const positions = textAnalysis.lemmaMap.get(lemma) || [];
      for (let i = 1; i < positions.length; i++) {
        if (positions[i] - positions[i - 1] < 10) {
          keywordStuffingDetected = true;
          break;
        }
      }
      if (keywordStuffingDetected) break;
    }
    let lowCoherenceScore = false;
    let avgCoherence = 0;
    if (paragraphs.length > 1) {
      const paragraphAnalyses = await Promise.all(paragraphs.map(p => morphologyService.analyzeText(p)));
      const coherenceScores: number[] = [];
      for (let i = 0; i < paragraphAnalyses.length - 1; i++) {
        const significantCurrent = this.filterSignificantLemmas(new Set(paragraphAnalyses[i].lemmas));
        const significantNext = this.filterSignificantLemmas(new Set(paragraphAnalyses[i + 1].lemmas));
        if (significantCurrent.size > 0 && significantNext.size > 0) {
          const intersection = new Set([...significantCurrent].filter(x => significantNext.has(x)));
          coherenceScores.push(intersection.size / Math.min(significantCurrent.size, significantNext.size));
        }
      }
      if (coherenceScores.length > 0) {
        avgCoherence = coherenceScores.reduce((a, b) => a + b, 0) / coherenceScores.length;
      }
      lowCoherenceScore = avgCoherence < 0.15;
    }
    const adCliches = ['лучший выбор', 'не упустите', 'только сегодня', 'суперцена', 'хит продаж', 'топ продаж', 'бестселлер', 'эксклюзив', 'скидка', 'акция', 'распродажа', 'выгодно'];
    const adClichesCount = adCliches.filter(cliche => contentLower.includes(cliche)).length;
    return { keywordStuffingDetected, lowCoherenceScore, adClichesCount, paragraphCount: paragraphs.length, avgCoherence };
  }

  private filterSignificantLemmas(lemmas: Set<string>): Set<string> {
    const stopWords = new Set(['и', 'в', 'на', 'с', 'по', 'для', 'от', 'из', 'к', 'у', 'о', 'об', 'это', 'быть', 'мочь', 'сказать', 'весь', 'который', 'один', 'также', 'очень', 'когда', 'уже', 'ещё', 'бы', 'же', 'ли']);
    return new Set([...lemmas].filter(lemma => lemma.length > 2 && !stopWords.has(lemma)));
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private checkLength(metrics: any, issues: string[]): void {
    if (metrics.charCount < this.minChars) issues.push(`❌ Текст короткий: ${metrics.charCount} символов (нужно ${this.minChars}-${this.maxChars})`);
    else if (metrics.charCount > this.maxChars) issues.push(`❌ Текст длинный: ${metrics.charCount} символов (максимум ${this.maxChars})`);
  }

  private checkReadabilityIssues(readability: any, issues: string[]): void {
    if (readability.avgSentenceLength > 25) issues.push(`⚠️ Слишком длинные предложения (среднее > 25 слов). Текущее значение: ${readability.avgSentenceLength.toFixed(1)} слов`);
    if (readability.complexWordsRatio > 30) issues.push(`⚠️ Много сложных слов (> 30%), текст трудночитаем. Текущее значение: ${readability.complexWordsRatio.toFixed(2)}%`);
  }

  private checkSemanticIssues(semantic: any, issues: string[]): void {
    if (semantic.keywordStuffingDetected) issues.push("⚠️ Обнаружен переспам ключевыми словами");
    if (semantic.lowCoherenceScore) issues.push(`⚠️ Низкая связность текста между абзацами. Текущее значение: ${semantic.avgCoherence.toFixed(2)} (нужно > 0.15)`);
    if (semantic.adClichesCount > 3) issues.push(`⚠️ Много рекламных штампов, текст выглядит навязчиво. Текущее значение: ${semantic.adClichesCount} (нужно < 3)`);
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