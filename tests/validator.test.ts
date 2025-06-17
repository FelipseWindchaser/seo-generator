import { describe, it, expect, vi } from 'vitest';
import { ContentValidator } from '~/server/utils/content-validator';
import { morphologyService } from '~/server/utils/morphology-service';

// Мокируем морфологический сервис, чтобы тесты были быстрыми и предсказуемыми
vi.mock('~/server/utils/morphology-service', () => ({
  morphologyService: {
    findPhrase: vi.fn(),
  },
}));

describe('ContentValidator', () => {
  it('should correctly count multi-word keywords using morphology', async () => {
    const validator = new ContentValidator();
    const content = "Наше летнее платье идеально сидит. Эти женские платья - хит сезона.";
    const keywords = ["платье летнее", "женское платье"];

    // Настраиваем мок: говорим, что findPhrase нашел каждое слово по 1 разу
    vi.mocked(morphologyService.findPhrase)
      .mockResolvedValueOnce(1) // для "платье летнее"
      .mockResolvedValueOnce(1); // для "женское платье"

    const result = await validator.validate(content, keywords);

    // Ожидаем, что валидатор нашел 2 ключа
    expect(result.metrics.keywordsUsed).toBe(2);
    expect(morphologyService.findPhrase).toHaveBeenCalledWith(content, "платье летнее");
    expect(morphologyService.findPhrase).toHaveBeenCalledWith(content, "женское платье");
  });
});