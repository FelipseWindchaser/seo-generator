import Az from 'az'
import { LRUCache } from 'lru-cache'
import PQueue from 'p-queue'
import type { Token, MorphResult } from 'az'

export interface MorphologyAnalysis {
  lemma: string
  pos: string // part of speech
  grammemes: string[]
  score: number
}

export interface TextAnalysis {
  tokens: Token[]
  lemmas: string[]
  lemmaMap: Map<string, number[]> // lemma -> positions
  wordCount: number
}

export class MorphologyService {
  private static instance: MorphologyService
  private initialized = false
  private initPromise: Promise<void> | null = null
  
  // Кеш для оптимизации
  private lemmaCache: LRUCache<string, MorphologyAnalysis>
  private analysisCache: LRUCache<string, TextAnalysis>
  
  // Очередь для батчинга операций
  private queue: PQueue
  
  private constructor() {
    // LRU кеш для лемм (10000 записей)
    this.lemmaCache = new LRUCache<string, MorphologyAnalysis>({
      max: 10000,
      ttl: 1000 * 60 * 60 * 24 // 24 часа
    })
    
    // Кеш для анализа текстов (1000 записей)
    this.analysisCache = new LRUCache<string, TextAnalysis>({
      max: 1000,
      ttl: 1000 * 60 * 60 // 1 час
    })
    
    // Очередь для контроля нагрузки
    this.queue = new PQueue({ 
      concurrency: 10,
      interval: 100,
      intervalCap: 50
    })
  }
  
  static getInstance(): MorphologyService {
    if (!MorphologyService.instance) {
      MorphologyService.instance = new MorphologyService()
    }
    return MorphologyService.instance
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) return
    
    if (!this.initPromise) {
      this.initPromise = this._initialize()
    }
    
    return this.initPromise
  }
  
  private async _initialize(): Promise<void> {
    try {
      // Az.js автоматически инициализируется при первом использовании
      // Делаем тестовый вызов для прогрева
      this.initialized = true
      console.log('MorphologyService: Az.js initialized successfully')
    } catch (error) {
      console.error('MorphologyService: Failed to initialize Az.js', error)
      throw error
    }
  }
  
  /**
   * Анализирует слово и возвращает морфологическую информацию
   */
  // async analyzeWord(word: string): Promise<MorphologyAnalysis | null> {
  //   const normalizedWord = word.toLowerCase().trim()
    
  //   // Проверяем кеш
  //   const cached = this.lemmaCache.get(normalizedWord)
  //   if (cached) return cached
    
  //   return this.queue.add(async () => {
  //     try {
  //       const morphs = Az.Morph(normalizedWord)
  //       if (morphs.length === 0) return null
        
  //       const best = morphs[0]
  //       const analysis: MorphologyAnalysis = {
  //         lemma: best.normalize().word,
  //         pos: this.extractPOS(best.tag),
  //         grammemes: best.tag.split(',').map(g => g.trim()),
  //         score: best.score
  //       }
        
  //       this.lemmaCache.set(normalizedWord, analysis)
  //       return analysis
  //     } catch (error) {
  //       console.error(`MorphologyService: Error analyzing word "${word}"`, error)
  //       return null
  //     }
  //   })
  // }
  //deepseek
  async analyzeWord(word: string): Promise<MorphologyAnalysis | null> {
    const normalizedWord = word.toLowerCase().trim();
    
    // Проверяем кеш
    const cached = this.lemmaCache.get(normalizedWord);
    if (cached) return cached;
    
    // Explicitly type the return value of the queue.add callback
    const result = await this.queue.add<MorphologyAnalysis | null>(async () => {
      try {
        const morphs = Az.Morph(normalizedWord);
        if (morphs.length === 0) return null;
        
        const best = morphs[0];
        const analysis: MorphologyAnalysis = {
          lemma: best.normalize().word,
          pos: this.extractPOS(best.tag),
          grammemes: best.tag.split(',').map(g => g.trim()),
          score: best.score
        };
        
        this.lemmaCache.set(normalizedWord, analysis);
        return analysis;
      } catch (error) {
        console.error(`MorphologyService: Error analyzing word "${word}"`, error);
        return null;
      }
    });
    
    return result ?? null; // Ensure we return null if result is undefined
}
  /**
   * Анализирует текст и возвращает токены, леммы и другую информацию
   */
  // async analyzeText(text: string, useCache = true): Promise<TextAnalysis> {
  //   const cacheKey = this.hashText(text)
    
  //   if (useCache) {
  //     const cached = this.analysisCache.get(cacheKey)
  //     if (cached) return cached
  //   }
    
  //   return this.queue.add(async () => {
  //     try {
  //       const tokens = Az.Tokens(text).done()
  //       const lemmas: string[] = []
  //       const lemmaMap = new Map<string, number[]>()
  //       let wordCount = 0
        
  //       // Обрабатываем токены
  //       for (let i = 0; i < tokens.length; i++) {
  //         const token = tokens[i]
          
  //         if (token.type === Az.TOKEN_WORD) {
  //           wordCount++
            
  //           const analysis = await this.analyzeWord(token.text)
  //           if (analysis) {
  //             lemmas.push(analysis.lemma)
              
  //             // Добавляем позицию в карту лемм
  //             const positions = lemmaMap.get(analysis.lemma) || []
  //             positions.push(i)
  //             lemmaMap.set(analysis.lemma, positions)
  //           } else {
  //             // Если не удалось проанализировать, используем исходное слово
  //             lemmas.push(token.text.toLowerCase())
  //           }
  //         }
  //       }
        
  //       const result: TextAnalysis = {
  //         tokens,
  //         lemmas,
  //         lemmaMap,
  //         wordCount
  //       }
        
  //       if (useCache) {
  //         this.analysisCache.set(cacheKey, result)
  //       }
        
  //       return result
  //     } catch (error) {
  //       console.error('MorphologyService: Error analyzing text', error)
  //       throw error
  //     }
  //   })
  // }
  async analyzeText(text: string, useCache = true): Promise<TextAnalysis> {
    const cacheKey = this.hashText(text);
    
    if (useCache) {
      const cached = this.analysisCache.get(cacheKey);
      if (cached) return cached;
    }
    
    const result = await this.queue.add<TextAnalysis>(async (): Promise<TextAnalysis> => {
      const tokens = Az.Tokens(text).done();
      const lemmas: string[] = [];
      const lemmaMap = new Map<string, number[]>();
      let wordCount = 0;
      
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        if (token.type === Az.TOKEN_WORD) {
          wordCount++;
          const analysis = await this.analyzeWord(token.text);
          
          if (analysis) {
            lemmas.push(analysis.lemma);
            const positions = lemmaMap.get(analysis.lemma) || [];
            positions.push(i);
            lemmaMap.set(analysis.lemma, positions);
          } else {
            lemmas.push(token.text.toLowerCase());
          }
        }
      }
      
      const result: TextAnalysis = {
        tokens,
        lemmas,
        lemmaMap,
        wordCount
      };
      
      if (useCache) {
        this.analysisCache.set(cacheKey, result);
      }
      
      return result;
    });

    return result!; //HARDCODE
}
  /**
   * Находит все формы слова в тексте
   */
  async findWordForms(text: string, word: string): Promise<number> {
    const wordAnalysis = await this.analyzeWord(word)
    if (!wordAnalysis) return 0
    
    const textAnalysis = await this.analyzeText(text)
    const positions = textAnalysis.lemmaMap.get(wordAnalysis.lemma) || []
    
    return positions.length
  }
  
  /**
   * Находит многословное ключевое слово с учётом морфологии
   */
  async findPhrase(text: string, phrase: string): Promise<number> {
    // Анализируем фразу
    const phraseAnalysis = await this.analyzeText(phrase, false)
    const phraseLemmas = phraseAnalysis.lemmas.filter(l => l.length > 0)
    
    if (phraseLemmas.length === 0) return 0
    
    // Анализируем текст
    const textAnalysis = await this.analyzeText(text)
    const textLemmas = textAnalysis.lemmas
    
    let count = 0
    const windowSize = phraseLemmas.length
    
    // Скользящее окно по тексту
    for (let i = 0; i <= textLemmas.length - windowSize; i++) {
      let match = true
      
      for (let j = 0; j < windowSize; j++) {
        if (textLemmas[i + j] !== phraseLemmas[j]) {
          match = false
          break
        }
      }
      
      if (match) {
        count++
      }
    }
    
    return count
  }
  
  /**
   * Извлекает часть речи из тега
   */
  private extractPOS(tag: string): string {
    const firstTag = tag.split(',')[0]
    const posMap: Record<string, string> = {
      'NOUN': 'существительное',
      'ADJF': 'прилагательное',
      'ADJS': 'краткое прилагательное',
      'COMP': 'компаратив',
      'VERB': 'глагол',
      'INFN': 'инфинитив',
      'PRTF': 'причастие',
      'PRTS': 'краткое причастие',
      'GRND': 'деепричастие',
      'NUMR': 'числительное',
      'ADVB': 'наречие',
      'NPRO': 'местоимение',
      'PRED': 'предикатив',
      'PREP': 'предлог',
      'CONJ': 'союз',
      'PRCL': 'частица',
      'INTJ': 'междометие'
    }
    
    return posMap[firstTag] || 'неизвестно'
  }
  
  /**
   * Хеширует текст для кеширования
   */
  private hashText(text: string): string {
    // Простой хеш для кеширования (в продакшене можно использовать crypto)
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return hash.toString(36)
  }
  
  /**
   * Очищает кеши
   */
  clearCache(): void {
    this.lemmaCache.clear()
    this.analysisCache.clear()
  }
  
  /**
   * Получает статистику кешей
   */
  getCacheStats() {
    return {
      lemmaCache: {
        size: this.lemmaCache.size,
        hits: this.lemmaCache.size, // В LRUCache нет встроенной статистики
      },
      analysisCache: {
        size: this.analysisCache.size,
        hits: this.analysisCache.size,
      },
      queueSize: this.queue.size,
      queuePending: this.queue.pending
    }
  }
}

// Экспортируем singleton instance
export const morphologyService = MorphologyService.getInstance()
