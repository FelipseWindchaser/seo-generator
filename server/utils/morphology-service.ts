import { ofetch } from 'ofetch';
import type { TextAnalysis, MorphologyAnalysis } from '~/types/morphology';
import type { AdvancedKeywordSearchResult } from './keyword-finder';

// URL микросервиса должен быть в переменных окружения для гибкости
const MORPHOLOGY_API_URL = process.env.MORPHOLOGY_API_URL || 'http://127.0.0.1:8000';

const apiClient = ofetch.create({
  baseURL: MORPHOLOGY_API_URL,
  headers: { 'Content-Type': 'application/json' },
  // Добавляем обработку ошибок для лучшей диагностики
  async onResponseError({ request, response, options }) {
    console.error(
      `[Morphology API Client] HTTP Error: ${response.status} ${response.statusText}`,
      `Request: ${request}`,
      `Response: ${JSON.stringify(response._data)}`
    );
  }
});

export class MorphologyService {
  private static instance: MorphologyService;
  private initialized = false;

  private constructor() {}

  static getInstance(): MorphologyService {
    if (!MorphologyService.instance) {
      MorphologyService.instance = new MorphologyService();
    }
    return MorphologyService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      await apiClient('/health');
      this.initialized = true;
      console.log(`MorphologyService: Microservice at ${MORPHOLOGY_API_URL} is healthy.`);
    } catch (error) {
      console.error(`MorphologyService: Failed to connect to microservice at ${MORPHOLOGY_API_URL}.`);
      throw new Error('Morphology microservice is unavailable.');
    }
  }

  async analyzeWord(word: string): Promise<MorphologyAnalysis | null> {
    try {
      return await apiClient<MorphologyAnalysis>('/analyze-word', {
        method: 'POST',
        body: { word },
      });
    } catch (error) {
      // Ошибка уже залогирована в onResponseError
      return null;
    }
  }

  async analyzeText(text: string, useCache = true): Promise<TextAnalysis> {
    try {
      // `useCache` игнорируется, так как кеширование не на клиенте
      const response = await apiClient<any>('/analyze-text', {
        method: 'POST',
        body: { text },
      });
      
      // Преобразуем ответ с обычного объекта в Map для совместимости
      return {
        ...response,
        lemmaMap: new Map(Object.entries(response.lemmaMap)),
        tokens: [], // Пустая заглушка для совместимости
      };

    } catch (error) {
      // Возвращаем пустую структуру, чтобы не ломать `ContentValidator`
      return {
        tokens: [],
        lemmas: [],
        lemmaMap: new Map(),
        wordCount: 0,
      };
    }
  }

  // async findWordForms(text: string, word: string): Promise<number> {
  //   const wordAnalysis = await this.analyzeWord(word);
  //   if (!wordAnalysis) return 0;

  //   const textAnalysis = await this.analyzeText(text);
  //   const positions = textAnalysis.lemmaMap.get(wordAnalysis.lemma) || [];
  //   return positions.length;
  // }

  async findWordForms(text: string, word: string, textAnalysis?: TextAnalysis): Promise<number> {
    const wordAnalysis = await this.analyzeWord(word);
    if (!wordAnalysis) return 0;

    // Если анализ текста не передан, делаем новый запрос. Иначе используем готовый.
    const analysis = textAnalysis || await this.analyzeText(text);
    const positions = analysis.lemmaMap.get(wordAnalysis.lemma) || [];
    return positions.length;
  }

  async findPhrase(text: string, phrase: string): Promise<number> {
    try {
      return await apiClient<number>('/find-phrase', {
        method: 'POST',
        body: { text, phrase },
      });
    } catch (error) {
      return 0;
    }
  }

  public async findKeywordsAdvanced(
    text: string,
    keywords: string[],
    max_distance: number
  ): Promise<AdvancedKeywordSearchResult> {
    try {
      return await apiClient<AdvancedKeywordSearchResult>('/find-keywords-advanced', {
        method: 'POST',
        body: { text, keywords, max_distance },
      });
    } catch (error) {
      // В случае ошибки API возвращаем пустой результат, чтобы не ломать валидатор
      console.error('[MorphologyService] Advanced keyword search failed:', error);
      return { found_keywords: [], details: {} };
    }
  }

}

export const morphologyService = MorphologyService.getInstance();