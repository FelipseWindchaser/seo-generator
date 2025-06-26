import type { ValidationResult, GenerationRequest, ValidationMetrics, SemanticMetrics, ReadabilityMetrics } from '~/types'
import { morphologyService } from './morphology-service'
import type { TextAnalysis } from '~/types/morphology'

export class ContentValidator {
  private readonly minChars = 1800
  private readonly maxChars = 2000
  private readonly minDensity = 3.0
  private readonly maxDensity = 5.0
  private readonly minKeywordsUsed = 10
  
  // Инициализация при создании 
  // removed according to gemini revision
  // async initialize() {
  //   await morphologyService.initialize()
  // }

  async validate(content: string, keywords: string[]): Promise<ValidationResult> {
    // Убеждаемся, что морфология инициализирована
    // await this.initialize()
    
    const metrics = await this.calculateMetrics(content, keywords)
    const readability = this.checkReadability(content)
    const semantic = await this.semanticAnalysis(content, keywords)
    
    const issues: string[] = []
    
    // Проверки остаются те же...
    this.checkLength(metrics, issues)
    this.checkKeywordUsage(metrics, keywords.length, issues)
    this.checkDensity(metrics, issues)
    this.checkReadabilityIssues(readability, issues)
    this.checkSemanticIssues(semantic, issues)
    
    return {
      isValid: issues.length === 0,
      metrics: {
        ...metrics,
        readability,
        semantic
      },
      issues
    }
  }

  private async calculateMetrics(content: string, keywords: string[]): Promise<ValidationMetrics> {
    const charCount = content.length
    const charCountNoSpaces = content.replace(/\s/g, '').length
    
    // Анализируем текст с помощью морфологии
    const textAnalysis = await morphologyService.analyzeText(content)
    const wordCount = textAnalysis.wordCount
    
    // Поиск ключевых слов с морфологией
    const keywordUsage = await this.findKeywordsWithMorphology(content, keywords, textAnalysis)
    
    // Подсчёт вхождений
    const totalOccurrences = Object.values(keywordUsage).reduce((sum, count) => sum + count, 0)
    
    // Плотность
    const keywordDensity = wordCount > 0 ? (totalOccurrences / wordCount * 100) : 0
    const charDensity = charCount > 0 
      ? (Object.entries(keywordUsage).reduce((sum, [k, v]) => sum + k.length * v, 0) / charCount * 100) 
      : 0
    
    // Неиспользованные ключи
    const missingKeywords = keywords.filter(k => !keywordUsage[k])
    
    // Позиции ключей
    const keywordPositions = await this.analyzeKeywordPositions(content, keywordUsage)
    
    return {
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
    }
  }

  private async findKeywordsWithMorphology(
    content: string, 
    keywords: string[],
    textAnalysis?: TextAnalysis
  ): Promise<Record<string, number>> {
    const keywordUsage: Record<string, number> = {}
    
    // Используем переданный анализ или создаём новый
    const analysis = textAnalysis || await morphologyService.analyzeText(content)
    
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase()
      
      // Стратегия 1: Точное совпадение (для брендов, точных фраз)
      const exactRegex = new RegExp(`\\b${this.escapeRegex(keywordLower)}\\b`, 'gi')
      const exactMatches = (content.match(exactRegex) || []).length
      
      if (exactMatches > 0) {
        keywordUsage[keyword] = exactMatches
        continue
      }
      
      // Стратегия 2: Морфологический поиск
      const keywordWords = keywordLower.split(/\s+/).filter(w => w.length > 0)
      
      if (keywordWords.length === 1) {
        // Однословный ключ - используем морфологию
        const count = await morphologyService.findWordForms(content, keywordWords[0])
        if (count > 0) {
          keywordUsage[keyword] = count
        }
      } else {
        // Многословный ключ - ищем фразу с учётом морфологии
        const count = await morphologyService.findPhrase(content, keyword)
        if (count > 0) {
          keywordUsage[keyword] = count
        }
      }
    }
    
    return keywordUsage
  }
  
  private async analyzeKeywordPositions(
    content: string, 
    keywordUsage: Record<string, number>
  ): Promise<{ beginning: number; middle: number; end: number }> {
    const textLength = content.length
    const positions = {
      beginning: 0,  // первые 20%
      middle: 0,     // средние 60%
      end: 0         // последние 20%
    }
    
    for (const keyword of Object.keys(keywordUsage)) {
      // Для каждого ключевого слова находим все позиции
      const keywordLower = keyword.toLowerCase()
      const regex = new RegExp(`\\b${this.escapeRegex(keywordLower)}\\b`, 'gi')
      let match
      
      while ((match = regex.exec(content)) !== null) {
        const relativePos = match.index / textLength
        
        if (relativePos < 0.2) {
          positions.beginning++
        } else if (relativePos < 0.8) {
          positions.middle++
        } else {
          positions.end++
        }
      }
    }
    
    return positions
  }
  
  private async semanticAnalysis(content: string, keywords: string[]): Promise<SemanticMetrics> {
    const contentLower = content.toLowerCase()
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0)
    
    // Проверка на keyword stuffing с учётом морфологии
    let keywordStuffingDetected = false
    
    for (const keyword of keywords) {
      // Анализируем расстояние между вхождениями
      const analysis = await morphologyService.analyzeWord(keyword.split(' ')[0])
      if (!analysis) continue
      
      const lemma = analysis.lemma
      const textAnalysis = await morphologyService.analyzeText(content)
      const positions = textAnalysis.lemmaMap.get(lemma) || []
      
      // Проверяем расстояние между позициями
      for (let i = 1; i < positions.length; i++) {
        const distance = positions[i] - positions[i - 1]
        if (distance < 10) { // Слишком близко
          keywordStuffingDetected = true
          break
        }
      }
    }
    
    // Проверка связности с учётом морфологии
    let lowCoherenceScore = false
    
    if (paragraphs.length > 1) {
      const paragraphAnalyses = await Promise.all(
        paragraphs.map(p => morphologyService.analyzeText(p))
      )
      
      const coherenceScores: number[] = []
      
      for (let i = 0; i < paragraphAnalyses.length - 1; i++) {
        const currentLemmas = new Set(paragraphAnalyses[i].lemmas)
        const nextLemmas = new Set(paragraphAnalyses[i + 1].lemmas)
        
        // Исключаем служебные слова
        const significantCurrent = this.filterSignificantLemmas(currentLemmas)
        const significantNext = this.filterSignificantLemmas(nextLemmas)
        
        if (significantCurrent.size > 0 && significantNext.size > 0) {
          const intersection = new Set(
            [...significantCurrent].filter(x => significantNext.has(x))
          )
          
          const coherenceScore = intersection.size / Math.min(significantCurrent.size, significantNext.size)
          coherenceScores.push(coherenceScore)
        }
      }
      
      const avgCoherence = coherenceScores.length > 0
        ? coherenceScores.reduce((a, b) => a + b, 0) / coherenceScores.length
        : 0
      
      lowCoherenceScore = avgCoherence < 0.15 // Повысили порог для лучшего качества
    }
    
    // Проверка на рекламные штампы
    const adCliches = [
      'лучший выбор', 'не упустите', 'только сегодня', 'суперцена',
      'хит продаж', 'топ продаж', 'бестселлер', 'эксклюзив',
      'скидка', 'акция', 'распродажа', 'выгодно'
    ]
    
    const adClichesCount = adCliches.filter(cliche => contentLower.includes(cliche)).length
    
    return {
      keywordStuffingDetected,
      lowCoherenceScore,
      adClichesCount,
      paragraphCount: paragraphs.length
    }
  }
  
  private filterSignificantLemmas(lemmas: Set<string>): Set<string> {
    const stopWords = new Set([
      'и', 'в', 'на', 'с', 'по', 'для', 'от', 'из', 'к', 'у', 'о', 'об',
      'это', 'быть', 'мочь', 'сказать', 'весь', 'который', 'один',
      'также', 'очень', 'когда', 'уже', 'ещё', 'бы', 'же', 'ли'
    ])
    
    return new Set([...lemmas].filter(lemma => 
      lemma.length > 2 && !stopWords.has(lemma)
    ))
  }
  
  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  
  // Вспомогательные методы для проверок
  private checkLength(metrics: any, issues: string[]): void {
    if (metrics.charCount < this.minChars) {
      issues.push(
        `❌ Текст короткий: ${metrics.charCount} символов (нужно ${this.minChars}-${this.maxChars})`
      )
    } else if (metrics.charCount > this.maxChars) {
      issues.push(
        `❌ Текст длинный: ${metrics.charCount} символов (максимум ${this.maxChars})`
      )
    }
  }
  
  private checkKeywordUsage(metrics: any, totalKeywords: number, issues: string[]): void {
    if (metrics.keywordsUsed < this.minKeywordsUsed) {
      issues.push(
        `❌ Мало ключей: ${metrics.keywordsUsed} из ${totalKeywords} (минимум ${this.minKeywordsUsed})`
      )
    }
  }
  
  private checkDensity(metrics: any, issues: string[]): void {
    if (metrics.keywordDensity < this.minDensity) {
      issues.push(
        `⚠️ Низкая плотность: ${metrics.keywordDensity}% (нужно ${this.minDensity}-${this.maxDensity}%)`
      )
    } else if (metrics.keywordDensity > this.maxDensity) {
      issues.push(
        `⚠️ Высокая плотность: ${metrics.keywordDensity}% (нужно ${this.minDensity}-${this.maxDensity}%)`
      )
    }
  }
  
  private checkReadabilityIssues(readability: any, issues: string[]): void {
    if (readability.avgSentenceLength > 25) {
      issues.push("⚠️ Слишком длинные предложения (среднее > 25 слов)")
    }
    
    if (readability.complexWordsRatio > 15) {
      issues.push("⚠️ Много сложных слов (> 15%), текст трудночитаем")
    }
  }
  
  private checkSemanticIssues(semantic: any, issues: string[]): void {
    if (semantic.keywordStuffingDetected) {
      issues.push("⚠️ Обнаружен переспам ключевыми словами")
    }
    
    if (semantic.lowCoherenceScore) {
      issues.push("⚠️ Низкая связность текста между абзацами")
    }
    
    if (semantic.adClichesCount > 3) {
      issues.push("⚠️ Много рекламных штампов, текст выглядит навязчиво")
    }
  }
  //added by cursor missing method for checking readability
  private checkReadability(content: string): ReadabilityMetrics {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0)
    const words = content.split(/\s+/).filter(w => w.length > 0)
    const complexWords = words.filter(w => w.length > 6).length
    const longWords = words.filter(w => w.length > 8).length
    const uniqueWords = new Set(words.map(w => w.toLowerCase())).size

    const sentenceLengths = sentences.map(s => s.split(/\s+/).length)
    const maxSentenceLength = Math.max(...sentenceLengths)

    // Calculate Flesch-Kincaid score for Russian text
    const fleschRuScore = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (complexWords / words.length)

    return {
      avgSentenceLength: words.length / sentences.length,
      maxSentenceLength,
      complexWordsRatio: (complexWords / words.length) * 100,
      longWordsRatio: (longWords / words.length) * 100,
      totalSentences: sentences.length,
      fleschRuScore,
      lexicalDiversity: (uniqueWords / words.length) * 100
    }
  }
}
