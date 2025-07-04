// /server/utils/content-validator/keyword-finder.test.ts
import { describe, it, expect, vi } from 'vitest';
import { findKeywordsAdvanced } from './keyword-finder';
import { morphologyService } from './morphology-service';

// Мокируем вызов к morphologyService, чтобы тестировать логику keyword-finder изолированно
vi.mock('../morphology-service', () => ({
  morphologyService: {
    findKeywordsAdvanced: vi.fn(),
  },
}));

describe('findKeywordsAdvanced', () => {

  it('should correctly find a keyword with a different word ending', async () => {
    const text = 'В нашем магазине вы можете купить лучшую соковыжималку.';
    const keywords = ['купить соковыжималку'];
    
    // Настраиваем мок, чтобы он возвращал ожидаемый результат от Python API
    vi.mocked(morphologyService.findKeywordsAdvanced).mockResolvedValue({
      found_keywords: ['купить соковыжималку'],
      details: { 'купить соковыжималку': { count: 1 } },
    });

    const result = await findKeywordsAdvanced(text, keywords);
    
    expect(result.found_keywords).toContain('купить соковыжималку');
    expect(result.details['купить соковыжималку'].count).toBe(1);
  });

  it('should find a multi-word keyword with other words in between', async () => {
    const text = 'Про нашу соковыжималку от бренда Atvel мы получили только хорошие отзывы.';
    const keywords = ['соковыжималка atvel отзывы'];

    vi.mocked(morphologyService.findKeywordsAdvanced).mockResolvedValue({
      found_keywords: ['соковыжималка atvel отзывы'],
      details: { 'соковыжималка atvel отзывы': { count: 1 } },
    });

    const result = await findKeywordsAdvanced(text, keywords);

    expect(result.found_keywords).toContain('соковыжималка atvel отзывы');
  });

  it('should not find a keyword if parts are too far apart', async () => {
    const text = 'Это лучшая соковыжималка. Мы получили на нее прекрасные отзывы от всех наших клиентов, которые живут в Москве.';
    const keywords = ['соковыжималка отзывы']; // max_distance = 5 по умолчанию

    vi.mocked(morphologyService.findKeywordsAdvanced).mockResolvedValue({
      found_keywords: [],
      details: {},
    });

    const result = await findKeywordsAdvanced(text, keywords);

    expect(result.found_keywords).not.toContain('соковыжималка отзывы');
  });
  
  it('should return an empty result for empty text', async () => {
    const result = await findKeywordsAdvanced('', ['ключ']);
    expect(result.found_keywords).toEqual([]);
    expect(Object.keys(result.details).length).toBe(0);
    // Убедимся, что API не вызывался зря
    expect(morphologyService.findKeywordsAdvanced).not.toHaveBeenCalled();
  });
});