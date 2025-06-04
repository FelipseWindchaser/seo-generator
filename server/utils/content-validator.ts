import type {
  ValidationResult,
  SemanticMetrics,
  ReadabilityMetrics,
  ValidationMetrics,
} from "~/types";

export class ContentValidator {
  private readonly minChars = 1800;
  private readonly maxChars = 2000;
  private readonly minDensity = 3.0;
  private readonly maxDensity = 5.0;
  private readonly minKeywordsUsed = 10;

  async validate(
    content: string,
    keywords: string[]
  ): Promise<ValidationResult> {
    const metrics = await this.calculateMetrics(content, keywords);
    const readability = this.checkReadability(content);
    const semantic = this.semanticAnalysis(content, keywords);

    const issues: string[] = [];

    // Проверка длины
    if (metrics.charCount < this.minChars) {
      issues.push(
        `❌ Текст короткий: ${metrics.charCount} символов (нужно ${this.minChars}-${this.maxChars})`
      );
    } else if (metrics.charCount > this.maxChars) {
      issues.push(
        `❌ Текст длинный: ${metrics.charCount} символов (максимум ${this.maxChars})`
      );
    }

    // Проверка использования ключей
    if (metrics.keywordsUsed < this.minKeywordsUsed) {
      issues.push(
        `❌ Мало ключей: ${metrics.keywordsUsed} из ${keywords.length} (минимум ${this.minKeywordsUsed})`
      );
    }

    // Проверка плотности
    if (metrics.keywordDensity < this.minDensity) {
      issues.push(
        `⚠️ Низкая плотность: ${metrics.keywordDensity.toFixed(1)}% (нужно ${
          this.minDensity
        }-${this.maxDensity}%)`
      );
    } else if (metrics.keywordDensity > this.maxDensity) {
      issues.push(
        `⚠️ Высокая плотность: ${metrics.keywordDensity.toFixed(1)}% (нужно ${
          this.minDensity
        }-${this.maxDensity}%)`
      );
    }

    // Проверка читабельности
    if (readability.avgSentenceLength > 25) {
      issues.push("⚠️ Слишком длинные предложения (среднее > 25 слов)");
    }

    if (readability.complexWordsRatio > 15) {
      issues.push("⚠️ Много сложных слов (> 15%), текст трудночитаем");
    }

    // Семантические проблемы
    if (semantic.keywordStuffingDetected) {
      issues.push("⚠️ Обнаружен переспам ключевыми словами");
    }

    if (semantic.lowCoherenceScore) {
      issues.push("⚠️ Низкая связность текста между абзацами");
    }

    return {
      isValid: issues.length === 0,
      metrics: {
        ...metrics,
        readability,
        semantic,
      },
      issues,
    };
  }

  private async calculateMetrics(
    content: string,
    keywords: string[]
  ): Promise<ValidationMetrics> {
    const charCount = content.length;
    const charCountNoSpaces = content.replace(/\s/g, "").length;

    // Подсчёт слов
    const words = content.match(/\b[а-яА-ЯёЁa-zA-Z]+\b/g) || [];
    const wordCount = words.length;

    // Поиск ключевых слов
    const keywordUsage = await this.findKeywordsAdvanced(content, keywords);

    // Подсчёт вхождений
    const totalOccurrences = Object.values(keywordUsage).reduce(
      (sum, count) => sum + count,
      0
    );

    // Плотность
    const keywordDensity =
      wordCount > 0 ? (totalOccurrences / wordCount) * 100 : 0;
    const charDensity =
      charCount > 0
        ? (Object.entries(keywordUsage).reduce(
            (sum, [k, v]) => sum + k.length * v,
            0
          ) /
            charCount) *
          100
        : 0;

    // Неиспользованные ключи
    const missingKeywords = keywords.filter((k) => !keywordUsage[k]);

    // Позиции ключей
    const keywordPositions = this.analyzeKeywordPositions(
      content,
      keywordUsage
    );

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
      keywordPositions,
    };
  }

  private async findKeywordsAdvanced(
    content: string,
    keywords: string[]
  ): Promise<Record<string, number>> {
    const contentLower = content.toLowerCase();
    const keywordUsage: Record<string, number> = {};

    // Для JS используем простой поиск без морфологии
    // В реальном проекте можно подключить библиотеку для морфологии
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();

      // Точное совпадение
      const regex = new RegExp(`\\b${keywordLower}\\b`, "gi");
      const matches = content.match(regex) || [];

      if (matches.length > 0) {
        keywordUsage[keyword] = matches.length;
      } else {
        // Поиск по отдельным словам для многословных ключей
        const keywordWords = keywordLower.split(/\s+/);
        if (keywordWords.length > 1) {
          let found = true;
          for (const word of keywordWords) {
            if (!contentLower.includes(word)) {
              found = false;
              break;
            }
          }
          if (found) {
            keywordUsage[keyword] = 1;
          }
        }
      }
    }

    return keywordUsage;
  }

  private analyzeKeywordPositions(
    content: string,
    keywordUsage: Record<string, number>
  ) {
    const textLength = content.length;
    const positions = {
      beginning: 0,
      middle: 0,
      end: 0,
    };

    for (const keyword in keywordUsage) {
      const keywordLower = keyword.toLowerCase();
      let startPos = 0;

      while (true) {
        const pos = content.toLowerCase().indexOf(keywordLower, startPos);
        if (pos === -1) break;

        const relativePos = pos / textLength;
        if (relativePos < 0.2) {
          positions.beginning++;
        } else if (relativePos < 0.8) {
          positions.middle++;
        } else {
          positions.end++;
        }

        startPos = pos + 1;
      }
    }

    return positions;
  }

  private checkReadability(content: string): ReadabilityMetrics {
    // Разбиваем на предложения
    const sentences = content
      .split(/[.!?]+\s*/)
      .filter((s) => s.trim().length > 10);

    // Статистика по предложениям
    const sentenceLengths: number[] = [];
    for (const sentence of sentences) {
      const words = sentence.match(/\b[а-яА-ЯёЁa-zA-Z]+\b/g) || [];
      if (words.length > 0) {
        sentenceLengths.push(words.length);
      }
    }

    const avgSentenceLength =
      sentenceLengths.length > 0
        ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
        : 0;

    const maxSentenceLength = Math.max(...sentenceLengths, 0);

    // Сложные слова
    const allWords =
      content.toLowerCase().match(/\b[а-яА-ЯёЁa-zA-Z]+\b/g) || [];
    let complexWords = 0;
    let longWords = 0;

    for (const word of allWords) {
      // Подсчёт слогов по гласным
      const vowels = (word.match(/[аеёиоуыэюяaeiouy]/gi) || []).length;
      if (vowels > 3) complexWords++;
      if (word.length > 10) longWords++;
    }

    const complexRatio =
      allWords.length > 0 ? (complexWords / allWords.length) * 100 : 0;
    const longWordsRatio =
      allWords.length > 0 ? (longWords / allWords.length) * 100 : 0;

    // Индекс удобочитаемости (адаптированный Flesch для русского)
    const fleschRu =
      206.835 -
      1.015 * avgSentenceLength -
      84.6 * (complexWords / Math.max(allWords.length, 1));

    // Разнообразие лексики
    const uniqueWords = new Set(allWords).size;
    const lexicalDiversity =
      allWords.length > 0 ? uniqueWords / allWords.length : 0;

    return {
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      maxSentenceLength,
      complexWordsRatio: Math.round(complexRatio * 10) / 10,
      longWordsRatio: Math.round(longWordsRatio * 10) / 10,
      totalSentences: sentences.length,
      fleschRuScore: Math.round(fleschRu * 10) / 10,
      lexicalDiversity: Math.round(lexicalDiversity * 100) / 100,
    };
  }

  private semanticAnalysis(
    content: string,
    keywords: string[]
  ): SemanticMetrics {
    const contentLower = content.toLowerCase();
    const paragraphs = content.split("\n\n");

    // Проверка на keyword stuffing
    let keywordStuffingDetected = false;
    for (const keyword of keywords) {
      const pattern = new RegExp(
        keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi"
      );
      const matches = Array.from(content.matchAll(pattern));

      for (let i = 0; i < matches.length - 1; i++) {
        const distance =
          matches[i + 1].index! - (matches[i].index! + matches[i][0].length);
        if (distance < 50) {
          keywordStuffingDetected = true;
          break;
        }
      }
    }

    // Проверка связности
    let lowCoherenceScore = false;
    if (paragraphs.length > 1) {
      const paragraphWords: Set<string>[] = [];

      for (const para of paragraphs) {
        const words = new Set(
          para.toLowerCase().match(/\b[а-яА-ЯёЁ]{4,}\b/g) || []
        );
        paragraphWords.push(words);
      }

      // Проверяем пересечения
      const coherenceScores: number[] = [];
      for (let i = 0; i < paragraphWords.length - 1; i++) {
        const intersection = new Set(
          [...paragraphWords[i]].filter((x) => paragraphWords[i + 1].has(x))
        );

        const minSize = Math.min(
          paragraphWords[i].size,
          paragraphWords[i + 1].size
        );
        if (minSize > 0) {
          coherenceScores.push(intersection.size / minSize);
        }
      }

      const avgCoherence =
        coherenceScores.length > 0
          ? coherenceScores.reduce((a, b) => a + b, 0) / coherenceScores.length
          : 0;

      lowCoherenceScore = avgCoherence < 0.1;
    }

    // Проверка на рекламные штампы
    const adCliches = [
      "лучший выбор",
      "не упустите",
      "только сегодня",
      "суперцена",
      "хит продаж",
      "топ продаж",
      "бестселлер",
      "эксклюзив",
    ];

    const adClichesCount = adCliches.filter((cliche) =>
      contentLower.includes(cliche)
    ).length;

    return {
      keywordStuffingDetected,
      lowCoherenceScore,
      adClichesCount,
      paragraphCount: paragraphs.length,
    };
  }
}
