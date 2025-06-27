import type { ValidationResult, GenerationRequest, ValidationMetrics, SemanticMetrics, ReadabilityMetrics } from '~/types'
import { morphologyService } from './morphology-service'
import type { TextAnalysis } from '~/types/morphology'

export class ContentValidator {
  private readonly minChars = 1800
  private readonly maxChars = 2000
  private readonly minDensity = 3.0
  private readonly maxDensity = 5.0
  private readonly minKeywordsUsed = 10
  
  async validate(content: string, keywords: string[]): Promise<ValidationResult> {
    console.log(`\n--- [Validator] START validation for content (${content.length} chars) ---`);

    // ОПТИМИЗАЦИЯ: Анализируем текст ОДИН РАЗ и передаем результат дальше
    console.log("  [Morpho] Calling morphologyService.analyzeText for the entire content (ONCE)...");
    const textAnalysis = await morphologyService.analyzeText(content);
    console.log("    [Morpho] Received textAnalysis:", {
      wordCount: textAnalysis.wordCount,
      lemmasCount: textAnalysis.lemmas.length,
      lemmaMap: Object.fromEntries(textAnalysis.lemmaMap) 
    });

    // Передаем результат анализа во все последующие функции
    const metrics = await this.calculateMetrics(content, keywords, textAnalysis);
    const readability = this.checkReadability(content);
    const semantic = await this.semanticAnalysis(content, keywords, textAnalysis);
    
    const issues: string[] = [];
    
    this.checkLength(metrics, issues);
    this.checkKeywordUsage(metrics, keywords.length, issues);
    this.checkDensity(metrics, issues);
    this.checkReadabilityIssues(readability, issues);
    this.checkSemanticIssues(semantic, issues);
    
    const finalResult: ValidationResult = {
      isValid: issues.length === 0,
      metrics: {
        ...metrics,
        readability,
        semantic
      },
      issues
    };

    // ИСПРАВЛЕНИЕ: Используем console.log и JSON.stringify для полного вывода в Node.js
    console.log("  [Validator] Final Validation Result:", JSON.stringify(finalResult, null, 2));
    console.log("--- [Validator] END validation ---\n");

    return finalResult;
  }

  private async calculateMetrics(content: string, keywords: string[], textAnalysis: TextAnalysis): Promise<ValidationMetrics> {
    console.log("  [Validator] Step 1: Calculating Metrics");
    
    const charCount = content.length;
    const charCountNoSpaces = content.replace(/\s/g, '').length;
    const wordCount = textAnalysis.wordCount;
    
    const keywordUsage = await this.findKeywordsWithMorphology(content, keywords, textAnalysis);
    
    const totalOccurrences = Object.values(keywordUsage).reduce((sum, count) => sum + count, 0);
    const keywordDensity = wordCount > 0 ? (totalOccurrences / wordCount * 100) : 0;
    const charDensity = charCount > 0 
      ? (Object.entries(keywordUsage).reduce((sum, [k, v]) => sum + k.length * v, 0) / charCount * 100) 
      : 0;
    
    const missingKeywords = keywords.filter(k => !keywordUsage[k]);
    const keywordPositions = await this.analyzeKeywordPositions(content, keywordUsage);
    
    const metrics: ValidationMetrics = {
      charCount,
      charCountNoSpaces,
      wordCount,
      keywordsFound: Object.keys(keywordUsage),
      keywordsUsed: Object.keys(keywordUsage).length,
      totalKeywords: keywords.length,
      keywordDensity: Math.round(keywordDensity * 100) / 100,
      charDensity: Math.round(charDensity * 100) / 100,
      keywordOccurrences: totalOccurrences,
      missingKeywords,
      keywordUsageDetails: keywordUsage,
      keywordPositions
    };

    console.log("    [Validator] Calculated Metrics:", metrics);
    return metrics;
  }

  private async findKeywordsWithMorphology(
    content: string, 
    keywords: string[],
    textAnalysis: TextAnalysis // Теперь textAnalysis обязателен
  ): Promise<Record<string, number>> {
    console.log("  [Validator] Step 2: Finding Keywords with Morphology");
    const keywordUsage: Record<string, number> = {};
    
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      
      const exactRegex = new RegExp(`\\b${this.escapeRegex(keywordLower)}\\b`, 'gi');
      const exactMatches = (content.match(exactRegex) || []).length;
      
      if (exactMatches > 0) {
        console.log(`    [Keyword] Found '${keyword}' by exact match: ${exactMatches} times.`);
        keywordUsage[keyword] = exactMatches;
        continue;
      }
      
      const keywordWords = keywordLower.split(/\s+/).filter(w => w.length > 0);
      
      if (keywordWords.length === 1) {
        console.log(`    [Morpho] Calling morphologyService.findWordForms for single word: '${keywordWords[0]}'`);
        // ОПТИМИЗАЦИЯ: findWordForms теперь может использовать уже готовый textAnalysis
        // Убедитесь, что ваш `morphologyService.findWordForms` поддерживает этот третий аргумент
        const count = await morphologyService.findWordForms(content, keywordWords[0]); 
        console.log(`      [Morpho] Result for '${keywordWords[0]}': found ${count} forms.`);
        if (count > 0) {
          keywordUsage[keyword] = count;
        }
      } else {
        console.log(`    [Morpho] Calling morphologyService.findPhrase for multi-word: '${keyword}'`);
        const count = await morphologyService.findPhrase(content, keyword);
        console.log(`      [Morpho] Result for phrase '${keyword}': found ${count} times.`);
        if (count > 0) {
          keywordUsage[keyword] = count;
        }
      }
    }
    
    console.log("    [Validator] Final Keyword Usage:", keywordUsage);
    return keywordUsage;
  }
  
  private async analyzeKeywordPositions(
    content: string, 
    keywordUsage: Record<string, number>
  ): Promise<{ beginning: number; middle: number; end: number }> {
    const textLength = content.length;
    const positions = {
      beginning: 0,  // первые 20%
      middle: 0,     // средние 60%
      end: 0         // последние 20%
    };
    
    for (const keyword of Object.keys(keywordUsage)) {
      const keywordLower = keyword.toLowerCase();
      const regex = new RegExp(`\\b${this.escapeRegex(keywordLower)}\\b`, 'gi');
      let match;
      
      while ((match = regex.exec(content)) !== null) {
        const relativePos = match.index / textLength;
        
        if (relativePos < 0.2) {
          positions.beginning++;
        } else if (relativePos < 0.8) {
          positions.middle++;
        } else {
          positions.end++;
        }
      }
    }
    
    return positions;
  }
  
  private async semanticAnalysis(content: string, keywords: string[], textAnalysis: TextAnalysis): Promise<SemanticMetrics> {
    console.log("  [Validator] Step 3: Semantic Analysis");
    const contentLower = content.toLowerCase();
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
    
    let keywordStuffingDetected = false;
    
    console.log("    [Semantic] Checking for keyword stuffing...");
    for (const keyword of keywords) {
      const firstWord = keyword.split(' ')[0];
      console.log(`      [Morpho] Analyzing first word '${firstWord}' of keyword '${keyword}' for stuffing check.`);
      const analysis = await morphologyService.analyzeWord(firstWord);
      if (!analysis) {
        console.warn(`        [Morpho] Could not analyze '${firstWord}'. Skipping stuffing check for this keyword.`);
        continue;
      }
      
      const lemma = analysis.lemma;
      console.log(`        [Morpho] Lemma for '${firstWord}' is '${lemma}'. Using pre-fetched positions...`);
      
      // ОПТИМИЗАЦИЯ: Используем textAnalysis, а не делаем новый запрос
      const positions = textAnalysis.lemmaMap.get(lemma) || [];
      console.log(`        [Semantic] Positions for lemma '${lemma}':`, positions);
      
      for (let i = 1; i < positions.length; i++) {
        const distance = positions[i] - positions[i - 1];
        if (distance < 10) {
          console.warn(`        [Semantic] Keyword stuffing DETECTED for lemma '${lemma}'. Distance between words: ${distance}.`);
          keywordStuffingDetected = true;
          break;
        }
      }
      if (keywordStuffingDetected) break;
    }
    
    let lowCoherenceScore = false;
    
    console.log("    [Semantic] Checking for text coherence...");
    if (paragraphs.length > 1) {
      console.log(`      [Morpho] Analyzing ${paragraphs.length} paragraphs for coherence...`);
      const paragraphAnalyses = await Promise.all(
        paragraphs.map(p => morphologyService.analyzeText(p))
      );
      
      const coherenceScores: number[] = [];
      
      for (let i = 0; i < paragraphAnalyses.length - 1; i++) {
        const currentLemmas = new Set(paragraphAnalyses[i].lemmas);
        const nextLemmas = new Set(paragraphAnalyses[i + 1].lemmas);
        
        const significantCurrent = this.filterSignificantLemmas(currentLemmas);
        const significantNext = this.filterSignificantLemmas(nextLemmas);
        
        if (significantCurrent.size > 0 && significantNext.size > 0) {
          const intersection = new Set(
            [...significantCurrent].filter(x => significantNext.has(x))
          );
          
          const coherenceScore = intersection.size / Math.min(significantCurrent.size, significantNext.size);
          coherenceScores.push(coherenceScore);
        }
      }
      
      const avgCoherence = coherenceScores.length > 0
        ? coherenceScores.reduce((a, b) => a + b, 0) / coherenceScores.length
        : 0;
      
      lowCoherenceScore = avgCoherence < 0.15;
      console.log(`      [Semantic] Average coherence score: ${avgCoherence}. Low coherence detected: ${lowCoherenceScore}`);
    } else {
      console.log("      [Semantic] Only one paragraph found, skipping coherence check.");
    }
    
    const adCliches = [ 'лучший выбор', 'не упустите', 'только сегодня', 'суперцена', 'хит продаж', 'топ продаж', 'бестселлер', 'эксклюзив', 'скидка', 'акция', 'распродажа', 'выгодно' ];
    const adClichesCount = adCliches.filter(cliche => contentLower.includes(cliche)).length;
    
    const semanticMetrics = {
      keywordStuffingDetected,
      lowCoherenceScore,
      adClichesCount,
      paragraphCount: paragraphs.length
    };

    console.log("    [Validator] Semantic Analysis Metrics:", semanticMetrics);
    return semanticMetrics;
  }
  
  private filterSignificantLemmas(lemmas: Set<string>): Set<string> {
    const stopWords = new Set([
      'и', 'в', 'на', 'с', 'по', 'для', 'от', 'из', 'к', 'у', 'о', 'об',
      'это', 'быть', 'мочь', 'сказать', 'весь', 'который', 'один',
      'также', 'очень', 'когда', 'уже', 'ещё', 'бы', 'же', 'ли'
    ]);
    
    return new Set([...lemmas].filter(lemma => 
      lemma.length > 2 && !stopWords.has(lemma)
    ));
  }
  
  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  private checkLength(metrics: any, issues: string[]): void {
    if (metrics.charCount < this.minChars) {
      issues.push(
        `❌ Текст короткий: ${metrics.charCount} символов (нужно ${this.minChars}-${this.maxChars})`
      );
    } else if (metrics.charCount > this.maxChars) {
      issues.push(
        `❌ Текст длинный: ${metrics.charCount} символов (максимум ${this.maxChars})`
      );
    }
  }
  
  private checkKeywordUsage(metrics: any, totalKeywords: number, issues: string[]): void {
    if (metrics.keywordsUsed < this.minKeywordsUsed) {
      issues.push(
        `❌ Мало ключей: ${metrics.keywordsUsed} из ${totalKeywords} (минимум ${this.minKeywordsUsed})`
      );
    }
  }
  
  private checkDensity(metrics: any, issues: string[]): void {
    if (metrics.keywordDensity < this.minDensity) {
      issues.push(
        `⚠️ Низкая плотность: ${metrics.keywordDensity}% (нужно ${this.minDensity}-${this.maxDensity}%)`
      );
    } else if (metrics.keywordDensity > this.maxDensity) {
      issues.push(
        `⚠️ Высокая плотность: ${metrics.keywordDensity}% (нужно ${this.minDensity}-${this.maxDensity}%)`
      );
    }
  }
  
  private checkReadabilityIssues(readability: any, issues: string[]): void {
    if (readability.avgSentenceLength > 25) {
      issues.push("⚠️ Слишком длинные предложения (среднее > 25 слов)");
    }
    
    if (readability.complexWordsRatio > 15) {
      issues.push("⚠️ Много сложных слов (> 15%), текст трудночитаем");
    }
  }
  
  private checkSemanticIssues(semantic: any, issues: string[]): void {
    if (semantic.keywordStuffingDetected) {
      issues.push("⚠️ Обнаружен переспам ключевыми словами");
    }
    
    if (semantic.lowCoherenceScore) {
      issues.push("⚠️ Низкая связность текста между абзацами");
    }
    
    if (semantic.adClichesCount > 3) {
      issues.push("⚠️ Много рекламных штампов, текст выглядит навязчиво");
    }
  }

  private checkReadability(content: string): ReadabilityMetrics {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = content.split(/\s+/).filter(w => w.length > 0);
    
    if (sentences.length === 0 || words.length === 0) {
        return {
            avgSentenceLength: 0, maxSentenceLength: 0, complexWordsRatio: 0,
            longWordsRatio: 0, totalSentences: 0, fleschRuScore: 0, lexicalDiversity: 0
        };
    }

    const complexWords = words.filter(w => w.length > 6).length;
    const longWords = words.filter(w => w.length > 8).length;
    const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;

    const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
    const maxSentenceLength = Math.max(...sentenceLengths);

    const fleschRuScore = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (complexWords / words.length);

    return {
      avgSentenceLength: words.length / sentences.length,
      maxSentenceLength,
      complexWordsRatio: (complexWords / words.length) * 100,
      longWordsRatio: (longWords / words.length) * 100,
      totalSentences: sentences.length,
      fleschRuScore,
      lexicalDiversity: (uniqueWords / words.length) * 100
    };
  }
}