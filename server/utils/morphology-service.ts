import Az from 'az';
import { LRUCache } from 'lru-cache';
import type { Token } from 'az';

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
  private static instance: MorphologyService;
  private initialized = false;
  private initPromise: Promise<void> | null = null; // Для обработки одновременных вызовов
  private lemmaCache: LRUCache<string, MorphologyAnalysis>;
  private textAnalysisCache: LRUCache<string, TextAnalysis>;

  private constructor() {
    this.lemmaCache = new LRUCache({ max: 10000 });
    this.textAnalysisCache = new LRUCache({ max: 100 });
  }

  public static getInstance(): MorphologyService {
    if (!MorphologyService.instance) {
      MorphologyService.instance = new MorphologyService();
    }
    return MorphologyService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve(); // Уже инициализирован
    }
    // Az.js инициализируется при первом вызове, но мы "прогреем" его
    if (this.initPromise) {
      return this.initPromise; // Инициализация уже в процессе, возвращаем существующий промис
    }
  }
  private async _initialize(): Promise<void> {
    try {
      console.log('Az.js: Starting dictionary loading...');
      // ПРАВИЛЬНЫЙ ВЫЗОВ: асинхронно ждем завершения загрузки словарей.
      await Az.init();
      this.initialized = true;
      console.log('Az.js: Dictionaries loaded successfully.');
    } catch (error) {
      console.error('CRITICAL: Error during Az.init()', error);
      // Сбрасываем промис, чтобы можно было попробовать снова (хотя при фатальной ошибке это вряд ли поможет)
      this.initPromise = null; 
      throw error; // Пробрасываем ошибку выше, чтобы плагин мог ее обработать
    }
  }

  public async analyzeWord(word: string): Promise<MorphologyAnalysis | null> {
    if (!this.initialized) {
      throw new Error('MorphologyService is not initialized. Call initialize() first.');
    }
    const normalizedWord = word.toLowerCase().trim();
    
    // Проверяем кеш
    const cached = this.lemmaCache.get(normalizedWord);
    if (cached) return cached;

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
  }

  async analyzeText(text: string, useCache = true): Promise<TextAnalysis> {
    const cacheKey = this.hashText(text);
    
    if (useCache) {
      const cached = this.textAnalysisCache.get(cacheKey);
      if (cached) return cached;
    }

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
      this.textAnalysisCache.set(cacheKey, result);
    }
    
    return result;
  }

  async findWordForms(text: string, word: string): Promise<number> {
    const wordAnalysis = await this.analyzeWord(word);
    if (!wordAnalysis) return 0;
    
    const textAnalysis = await this.analyzeText(text);
    const positions = textAnalysis.lemmaMap.get(wordAnalysis.lemma) || [];
    
    return positions.length;
  }
  
  async findPhrase(text: string, phrase: string): Promise<number> {
    const phraseAnalysis = await this.analyzeText(phrase, false);
    const phraseLemmas = phraseAnalysis.lemmas.filter(l => l.length > 0);
    
    if (phraseLemmas.length === 0) return 0;
    
    const textAnalysis = await this.analyzeText(text);
    const textLemmas = textAnalysis.lemmas;
    
    let count = 0;
    const windowSize = phraseLemmas.length;
    
    for (let i = 0; i <= textLemmas.length - windowSize; i++) {
      let match = true;
      
      for (let j = 0; j < windowSize; j++) {
        if (textLemmas[i + j] !== phraseLemmas[j]) {
          match = false;
          break;
        }
      }
      
      if (match) {
        count++;
      }
    }
    
    return count;
  }
  
  private extractPOS(tag: string): string {
    const firstTag = tag.split(',')[0];
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
    };
    
    return posMap[firstTag] || 'неизвестно';
  }
  
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
  
  clearCache(): void {
    this.lemmaCache.clear();
    this.textAnalysisCache.clear();
  }
  
  getCacheStats() {
    return {
      lemmaCache: {
        size: this.lemmaCache.size,
        hits: this.lemmaCache.size,
      },
      analysisCache: {
        size: this.textAnalysisCache.size,
        hits: this.textAnalysisCache.size,
      }
    };
  }
}

export const morphologyService = MorphologyService.getInstance();
