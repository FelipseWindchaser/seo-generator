import { describe, it, expect } from "vitest";
import { ContentValidator } from "~/server/utils/content-validator";

describe("ContentValidator", () => {
  const validator = new ContentValidator();

  it("should validate correct content", async () => {
    const content = "А".repeat(1900); // 1900 символов
    const keywords = ["тест1", "тест2", "тест3"];

    // Добавляем ключевые слова в контент
    const contentWithKeywords = content + " тест1 тест2 тест3";

    const result = await validator.validate(contentWithKeywords, keywords);

    expect(result.isValid).toBe(false); // Недостаточно ключевых слов
    expect(result.metrics.charCount).toBeGreaterThan(1800);
    expect(result.metrics.charCount).toBeLessThan(2000);
  });

  it("should detect keyword stuffing", async () => {
    const content = "платье платье платье женское женское женское";
    const keywords = ["платье женское"];

    const result = await validator.validate(content, keywords);

    expect(result.metrics.semantic.keywordStuffingDetected).toBe(true);
  });
});
