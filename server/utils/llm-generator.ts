import { Anthropic } from "@anthropic-ai/sdk";
import type {
  GenerationRequest,
  GenerationResult,
  KeywordDetail,
  ValidationResult,
} from "~/types";
import { ContentValidator } from "./content-validator";

export class SEOGenerator {
  private anthropic: Anthropic;
  private validator: ContentValidator;

  constructor() {
    const config = useRuntimeConfig();
    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
    this.validator = new ContentValidator();
  }

  async generateWithValidation(
    data: GenerationRequest
  ): Promise<GenerationResult> {
    const maxAttempts = 3;
    let currentContent = "";
    let currentTitle = "";
    let validationResult: ValidationResult | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.log(`Generation attempt ${attempt + 1}/${maxAttempts}`);

      try {
        if (attempt === 0) {
          // Первая генерация
          const generated = await this.generateInitial(data);
          currentTitle = generated.title;
          currentContent = generated.content;
        } else {
          // Доработка на основе проблем
          if (!validationResult) throw new Error("No validation result");

          const generated = await this.fixContent(
            currentTitle,
            currentContent,
            validationResult,
            data
          );
          currentContent = generated.content;
        }

        // Валидация
        validationResult = await this.validator.validate(
          currentContent,
          data.keywords
        );

        // Дополнительные проверки
        const additionalChecks = this.checkAdditionalRequirements(
          currentContent,
          data
        );

        // Объединяем проблемы
        const allIssues = [
          ...validationResult.issues,
          ...additionalChecks.issues,
        ];

        // Если всё хорошо
        if (allIssues.length === 0) {
          return this.prepareFinalResult(
            currentTitle,
            currentContent,
            validationResult,
            additionalChecks,
            attempt + 1,
            true
          );
        }

        // Обновляем для следующей итерации
        validationResult.issues = allIssues;
      } catch (error) {
        console.error(`Error in generation attempt ${attempt + 1}:`, error);
        if (attempt === maxAttempts - 1) throw error;
      }
    }

    // Возвращаем с предупреждениями
    return this.prepareFinalResult(
      currentTitle,
      currentContent,
      validationResult!,
      this.checkAdditionalRequirements(currentContent, data),
      maxAttempts,
      false
    );
  }

  private async generateInitial(
    data: GenerationRequest
  ): Promise<{ title: string; content: string }> {
    const systemPrompt = `Ты - эксперт по созданию SEO-оптимизированных описаний для Wildberries.

ПРИНЦИПЫ РАБОТЫ:
- chain_of_thought: продумывай каждый шаг
- check_inputs_before_outputs: проверяй входные данные
- fix_stage_before_next: исправляй ошибки сразу
- no_fabrication: не выдумывай факты
- diagnostic_hypotheses_only: только проверенные решения

ЖЁСТКИЕ ТРЕБОВАНИЯ:
1. Заголовок: до 60 символов, в формате "Товар Brand — ключевое преимущество"
2. Описание: РОВНО 1800-2000 символов с пробелами
3. Каждый ключ из списка должен быть внедрён и выделен **жирным**
4. Минимум 10 ключей должны быть использованы
5. Плотность ключевых слов: 3-5%
6. Все УТП должны быть раскрыты
7. Боли из отзывов должны быть закрыты

СТРУКТУРА ОПИСАНИЯ:
1. Вводный абзац с главным ключом
2. Описание характеристик с ключами
3. Преимущества (закрытие болей из отзывов)
4. УТП с конкретными цифрами
5. Призыв к действию (если реклама планируется)

СТИЛЬ:
- Живой, продающий язык
- Конкретика вместо общих фраз
- Эмоциональные триггеры
- Доверительные элементы`;

    const userPrompt = `Создай SEO-описание для товара, следуя ВСЕМ требованиям.

ВХОДНЫЕ ДАННЫЕ:
URL товара: ${data.productUrl}

Ключевые фразы (ИСПОЛЬЗУЙ ВСЕ, выделяй **жирным**):
${data.keywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}

Отзывы конкурентов (закрой эти боли):
${data.reviews}

УТП (раскрой все):
${data.usp.map((u, i) => `${i + 1}. ${u}`).join("\n")}

Реклама планируется: ${
      data.adsPlanned ? "ДА - добавь призывы к действию" : "НЕТ"
    }
Можно менять визуалы: ${
      data.canChangeVisuals ? "ДА - можно упомянуть дизайн" : "НЕТ"
    }

ФОРМАТ ОТВЕТА:
===ЗАГОЛОВОК===
[заголовок до 60 символов]
===ОПИСАНИЕ===
[описание 1800-2000 символов с **выделенными** ключами]`;

    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    // Парсим ответ
    const content =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parts = content.split("===");

    let title = "";
    let description = "";

    for (let i = 0; i < parts.length; i++) {
      if (parts[i].includes("ЗАГОЛОВОК") && i + 1 < parts.length) {
        title = parts[i + 1].trim();
      } else if (parts[i].includes("ОПИСАНИЕ") && i + 1 < parts.length) {
        description = parts[i + 1].trim();
      }
    }

    // Fallback
    if (!title || !description) {
      const lines = content.trim().split("\n");
      title = lines[0] || "Товар";
      description = lines.slice(1).join("\n") || content;
    }

    return { title, content: description };
  }

  private checkAdditionalRequirements(
    content: string,
    data: GenerationRequest
  ) {
    const issues: string[] = [];
    const checks = {
      boldKeywords: 0,
      utpMentioned: 0,
      painPointsAddressed: 0,
      trustTriggers: 0,
    };

    // Проверка выделения жирным
    const boldMatches = content.match(/\*\*([^*]+)\*\*/g) || [];
    checks.boldKeywords = boldMatches.length;

    if (checks.boldKeywords < 10) {
      issues.push(
        `Выделено жирным только ${checks.boldKeywords} ключей, нужно минимум 10`
      );
    }

    // Проверка УТП
    const contentLower = content.toLowerCase();
    for (const utp of data.usp) {
      const utpWords = utp.split(" ").slice(0, 3);
      if (utpWords.some((word) => contentLower.includes(word.toLowerCase()))) {
        checks.utpMentioned++;
      }
    }

    if (checks.utpMentioned < data.usp.length) {
      issues.push(
        `Раскрыто только ${checks.utpMentioned} УТП из ${data.usp.length}`
      );
    }

    // Проверка закрытия болей
    const painKeywords = [
      "не садится",
      "не линяет",
      "не выцветает",
      "качественн",
      "прочн",
      "сертификат",
      "гарант",
      "натуральн",
    ];

    for (const keyword of painKeywords) {
      if (contentLower.includes(keyword)) {
        checks.painPointsAddressed++;
      }
    }

    if (checks.painPointsAddressed < 2) {
      issues.push("Недостаточно закрыты боли из отзывов конкурентов");
    }

    // Проверка доверительных триггеров
    const trustKeywords = [
      "сертифи",
      "гарант",
      "достав",
      "возврат",
      "оригинал",
      "производител",
      "качеств",
      "проверен",
    ];

    for (const keyword of trustKeywords) {
      if (contentLower.includes(keyword)) {
        checks.trustTriggers++;
      }
    }

    return {
      issues,
      checks,
    };
  }

  private async fixContent(
    title: string,
    content: string,
    validation: ValidationResult,
    data: GenerationRequest
  ): Promise<{ title: string; content: string }> {
    const issues = validation.issues;
    const metrics = validation.metrics;

    // Строим инструкции для исправления
    const fixInstructions: string[] = [];

    // Длина текста
    if (metrics.charCount < 1800) {
      fixInstructions.push(
        `КРИТИЧНО: Добавь ${1800 - metrics.charCount} символов. ` +
          `Расширь описание характеристик и преимуществ.`
      );
    } else if (metrics.charCount > 2000) {
      fixInstructions.push(
        `КРИТИЧНО: Убери ${metrics.charCount - 2000} символов. ` +
          `Сократи повторы, оставь только важное.`
      );
    }

    // Ключевые слова
    if (metrics.keywordsUsed < data.keywords.length) {
      const missing = metrics.missingKeywords.slice(0, 7);
      fixInstructions.push(
        `КРИТИЧНО: Добавь ключи и выдели **жирным**: ${missing.join(", ")}`
      );
    }

    // Плотность
    if (metrics.keywordDensity < 3.0) {
      fixInstructions.push(
        "Увеличь плотность ключей до 3-5%. Повтори важные ключи 2-3 раза."
      );
    } else if (metrics.keywordDensity > 5.0) {
      fixInstructions.push(
        "Уменьши плотность ключей до 3-5%. Замени повторы синонимами."
      );
    }

    // Специфичные проблемы
    for (const issue of issues) {
      if (issue.includes("жирным")) {
        fixInstructions.push(
          "Выдели ВСЕ использованные ключевые фразы **жирным** (двойные звёздочки)"
        );
      } else if (issue.includes("УТП")) {
        fixInstructions.push(
          `Раскрой ВСЕ УТП с конкретными цифрами: ${data.usp.join(", ")}`
        );
      } else if (issue.includes("боли")) {
        fixInstructions.push(
          "Добавь фразы, закрывающие боли: 'не садится после стирки', " +
            "'сохраняет цвет', 'качественные материалы'"
        );
      }
    }

    const systemPrompt = `Ты - эксперт по доработке SEO-текстов для Wildberries.
Исправь текст ТОЧНО по инструкциям, сохранив стиль и основную структуру.`;

    const userPrompt = `Доработай описание, исправив ВСЕ проблемы:

ИНСТРУКЦИИ ПО ИСПРАВЛЕНИЮ:
${fixInstructions.map((inst, i) => `${i + 1}. ${inst}`).join("\n")}

ТЕКУЩИЕ МЕТРИКИ:
- Символов: ${metrics.charCount} (нужно 1800-2000)
- Ключей использовано: ${metrics.keywordsUsed}/${data.keywords.length}
- Плотность: ${metrics.keywordDensity}% (нужно 3-5%)

ЗАГОЛОВОК (не меняй):
${title}

ТЕКСТ ДЛЯ ДОРАБОТКИ:
${content}

ФОРМАТ ОТВЕТА:
===ОПИСАНИЕ===
[исправленное описание с **выделенными** ключами]`;

    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    // Парсим ответ
    const responseContent =
      response.content[0].type === "text" ? response.content[0].text : "";
    let description = responseContent;

    if (responseContent.includes("===ОПИСАНИЕ===")) {
      description = responseContent.split("===ОПИСАНИЕ===")[1].trim();
    }

    return {
      title,
      content: description,
    };
  }

  private prepareFinalResult(
    title: string,
    content: string,
    validation: ValidationResult,
    additional: { issues: string[]; checks: any },
    attempts: number,
    success: boolean = true
  ): GenerationResult {
    // Детальная статистика по ключевым словам
    const keywordDetails: KeywordDetail[] = [];

    for (const [keyword, count] of Object.entries(
      validation.metrics.keywordUsageDetails
    )) {
      const example = this.findKeywordExample(content, keyword);
      keywordDetails.push({
        keyword,
        count,
        example,
      });
    }

    // Форматируем финальный контент
    const finalContent = `**${title}**\n\n${content}`;

    const result: GenerationResult = {
      success,
      content: finalContent,
      title,
      description: content,
      metrics: {
        ...validation.metrics,
        keywordDetails,
        boldKeywordsCount: additional.checks.boldKeywords,
        utpCovered: additional.checks.utpMentioned,
        painPointsAddressed: additional.checks.painPointsAddressed,
        trustTriggers: additional.checks.trustTriggers,
      },
      attempts,
    };

    if (!success) {
      result.warnings = validation.issues;
    }

    return result;
  }

  private findKeywordExample(content: string, keyword: string): string {
    const contentLower = content.toLowerCase();
    const keywordLower = keyword.toLowerCase();

    // Ищем позицию ключевого слова
    let pos = contentLower.indexOf(keywordLower);

    if (pos === -1) {
      // Пробуем найти отдельные слова
      const words = keywordLower.split(" ");
      for (const word of words) {
        pos = contentLower.indexOf(word);
        if (pos !== -1) break;
      }
    }

    if (pos === -1) {
      return "не найден точный пример";
    }

    // Берём контекст
    const start = Math.max(0, pos - 20);
    const end = Math.min(content.length, pos + keyword.length + 20);

    let example = content.slice(start, end);
    if (start > 0) example = "..." + example;
    if (end < content.length) example = example + "...";

    return example;
  }
}
