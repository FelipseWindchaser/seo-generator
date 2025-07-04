import { morphologyService } from '~/server/utils/morphology-service';
import type { TextAnalysis } from '~/types/morphology';

// Определим тип ответа от нового эндпоинта
export interface AdvancedKeywordSearchResult {
  found_keywords: string[];
  details: Record<string, { count: number }>;
}

/**
 * Находит вхождения ключевых слов в тексте, используя продвинутый морфологический анализ
 * с учетом расстояния между словами. Делегирует сложную логику Python-микросервису.
 *
 * @param text - Исходный текст для анализа.
 * @param keywords - Массив ключевых слов для поиска.
 * @param maxDistance - Максимальное количество слов между частями ключевой фразы.
 * @returns Объект с найденными ключевыми словами и деталями их использования.
 */
export async function findKeywordsAdvanced(
  text: string,
  keywords: string[],
  maxDistance: number = 5
): Promise<AdvancedKeywordSearchResult> {
  // Если нет текста или ключей, возвращаем пустой результат
  if (!text.trim() || keywords.length === 0) {
    return { found_keywords: [], details: {} };
  }

  // Вызываем новый метод сервиса морфологии
  const result = await morphologyService.findKeywordsAdvanced(text, keywords, maxDistance);

  // Возвращаем результат как есть, так как он уже в нужном формате
  return result;
}