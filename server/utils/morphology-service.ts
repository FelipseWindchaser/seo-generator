// server/utils/morphology-service.ts

import { ofetch } from 'ofetch';

/**
 * @description Тип, который ожидает ContentValidator от результата поиска.
 */
export interface AdvancedKeywordSearchResult {
  found_lemmas: string[];
  details: Record<string, { count: number }>;
}

// Создаем единый API-клиент для взаимодействия с сервисом морфологии
const apiClient = ofetch.create({
  headers: { 'Content-Type': 'application/json' },
  async onResponseError({ request, response }) {
    console.error(
      `[Morphology API Client] HTTP Error: ${response.status} ${response.statusText} for ${request}`
    );
  }
});

export class MorphologyService {
  private apiUrl: string;

  constructor() {
    const config = useRuntimeConfig();
    const apiUrlFromConfig = config.public.morphologyApiUrl;

    // Добавляем более строгую проверку, чтобы предотвратить ошибки
    if (!apiUrlFromConfig || typeof apiUrlFromConfig !== 'string') {
      throw new Error("NUXT_PUBLIC_MORPHOLOGY_API_URL is not defined or invalid in .env. Please add it. Example: NUXT_PUBLIC_MORPHOLOGY_API_URL=http://127.0.0.1:8000");
    }
    this.apiUrl = apiUrlFromConfig;
  }

  /**
   * @description Лемматизирует массив слов одним batch-запросом к API.
   * @param words Массив слов для лемматизации.
   * @returns Промис, который разрешается в массив лемм.
   */
  async lemmatizeWords(words: string[]): Promise<string[]> {
    if (!words || words.length === 0) {
      return [];
    }
    try {
      const response = await apiClient<{ lemmas: string[] }>(`${this.apiUrl}/lemmatize-words`, {
        method: 'POST',
        body: { words },
      });
      return response.lemmas;
    } catch (error) {
      console.error('[MorphologyService] Batch lemmatization failed. Falling back to original words.', error);
      return words.map(w => w.toLowerCase());
    }
  }

  /**
   * @description Получает частотный словарь лемм из текста.
   * @param text Текст для анализа.
   * @param keywordsToCount Массив лемм, которые нас интересуют.
   * @returns Промис с результатом поиска.
   */
  public async findKeywordsAdvanced(
    text: string,
    keywordsToCount: string[]
  ): Promise<AdvancedKeywordSearchResult> {
    if (!text.trim() || keywordsToCount.length === 0) {
      return { found_lemmas: [], details: {} };
    }
    try {
      const lemmaFrequencyMap = await apiClient<Record<string, number>>(`${this.apiUrl}/analyze-text-lemmas`, {
        method: 'POST',
        body: { text },
      });

      const foundLemmas: string[] = [];
      const details: Record<string, { count: number }> = {};
      
      for (const lemma of keywordsToCount) {
        const count = lemmaFrequencyMap[lemma];
        if (count && count > 0) {
          foundLemmas.push(lemma);
          details[lemma] = { count: count };
        }
      }
      
      return { found_lemmas: foundLemmas, details: details };

    } catch (error) {
      console.error('[MorphologyService] Advanced keyword search failed:', error);
      return { found_lemmas: [], details: {} };
    }
  }
}

export const morphologyService = new MorphologyService();