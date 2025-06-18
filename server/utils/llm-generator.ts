// server/utils/llm-generator.ts

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import type { GenerationRequest, GenerationResult, ValidationResult, KeywordDetail } from '../../types';
import { ContentValidator } from './content-validator';

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export class SEOGenerator {
  private genAI: GoogleGenAI;
  private validator: ContentValidator;

  constructor(apiKey: string) {
    console.log('Received in constructor:', apiKey);
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }
    this.genAI = new GoogleGenAI({ apiKey });
    this.validator = new ContentValidator();
  }

  public async generateWithValidation(data: GenerationRequest): Promise<GenerationResult> {
    const maxAttempts = 3;
    let currentContent: string | null = null;
    let currentTitle: string | null = null;
    let validationResult: ValidationResult | null = null;
    let additionalChecks: { issues: string[]; checks: any } | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.log(`[SEOGenerator] Generation attempt ${attempt + 1}/${maxAttempts}`);

      try {
        if (attempt === 0) {
          const generated = await this.generateInitial(data);
          currentTitle = generated.title;
          currentContent = generated.content;
        } else if (currentTitle && currentContent && validationResult) {
          const fixed = await this.fixContent(currentTitle, currentContent, validationResult, data);
          currentContent = fixed.content;
        } else {
            throw new Error("Cannot fix content without initial generation.");
        }

        validationResult = await this.validator.validate(currentContent, data.keywords);
        additionalChecks = this.checkAdditionalRequirements(currentContent, data);
        
        const allIssues = [...validationResult.issues, ...additionalChecks.issues];
        
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
        
        validationResult.issues = allIssues;
        
      } catch (error) {
        console.error(`[SEOGenerator] Error in generation attempt ${attempt + 1}:`, error);
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }
    
    if (currentTitle && currentContent && validationResult && additionalChecks) {
        return this.prepareFinalResult(
            currentTitle,
            currentContent,
            validationResult,
            additionalChecks,
            maxAttempts,
            false
        );
    }

    throw new Error("Generation failed after all attempts and result could not be prepared.");
  }

  /**
   * Первичная генерация текста с помощью Gemini.
   */
  private async generateInitial(data: GenerationRequest): Promise<{ title: string; content: string }> {
    const systemPrompt = `Ты - эксперт по созданию SEO-оптимизированных описаний для Wildberries. Твоя задача - создать текст, который будет максимально релевантен поисковым запросам и привлекателен для покупателей. Следуй всем жестким требованиям и структуре.`;
    const userPrompt = `Создай SEO-описание для товара, следуя ВСЕМ требованиям.

ВХОДНЫЕ ДАННЫЕ:
- URL товара: ${data.productUrl}
- Ключевые фразы (ИСПОЛЬЗУЙ ВСЕ, выделяй **жирным**):
${data.keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}
- Отзывы конкурентов (закрой эти боли):
${data.reviews}
- УТП (раскрой все):
${data.usp.map((u, i) => `${i + 1}. ${u}`).join('\n')}
- Реклама планируется: ${data.adsPlanned ? 'ДА - добавь призывы к действию' : 'НЕТ'}
- Можно менять визуалы: ${data.canChangeVisuals ? 'ДА - можно упомянуть дизайн' : 'НЕТ'}

ФОРМАТ ОТВЕТА:
===ЗАГОЛОВОК===
[заголовок до 60 символов]
===ОПИСАНИЕ===
[описание 1800-2000 символов с **выделенными** ключами]`;

    // ИСПРАВЛЕНО: Объединяем системный и пользовательский промпты в один.
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    // ИСПРАВЛЕНО: Используем новый, одноступенчатый метод вызова API.
    const result = await this.genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: 4000,
        safetySettings: [{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },],
      },
    });

    const response = await this.genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents:
      fullPrompt,
    });
    
    if (response.text) {
      console.debug(response.text);
      return this.parseLLMResponse(response.text);
    } else {
      throw new Error("Response text is undefined.");
    }
  }
  
  private async fixContent(
    title: string,
    content: string,
    validation: ValidationResult,
    data: GenerationRequest
  ): Promise<{ title: string; content: string }> {
    const systemPrompt = `Ты - эксперт по доработке SEO-текстов для Wildberries. Исправь текст ТОЧНО по инструкциям, сохранив стиль и основную структуру. Не меняй то, что уже хорошо.`;
    const fixInstructions = validation.issues;
    const userPrompt = `Доработай описание, исправив ВСЕ проблемы:

ИНСТРУКЦИИ ПО ИСПРАВЛЕНИЮ:
${fixInstructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}

ТЕКУЩИЕ МЕТРИКИ:
- Символов: ${validation.metrics.charCount} (нужно 1800-2000)
- Ключей использовано: ${validation.metrics.keywordsUsed}/${data.keywords.length}
- Плотность: ${validation.metrics.keywordDensity}% (нужно 3-5%)

ЗАГОЛОВОК (не меняй):
${title}

ТЕКСТ ДЛЯ ДОРАБОТКИ:
${content}

ФОРМАТ ОТВЕТА:
===ОПИСАНИЕ===
[исправленное описание с **выделенными** ключами]`;

    // ИСПРАВЛЕНО: Та же логика объединения промптов и одноступенчатого вызова.
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    const result = await this.genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        config: {
            temperature: 0.5,
            maxOutputTokens: 4000,
            safetySettings: [{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },],
          },
    });
    const responseFix = await this.genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents:
      fullPrompt,
    });
    
    if (responseFix.text) {
      console.debug(responseFix.text);
      
    } else {
      throw new Error("ResponseFix text is undefined.");
    }
    let description = responseFix.text;
    if (responseFix.text.includes('===ОПИСАНИЕ===')) {
      description = responseFix.text.split('===ОПИСАНИЕ===')[1].trim();
    }
    
    return { title, content: description };
  }

  /**
   * Парсит сырой ответ от LLM, извлекая заголовок и описание.
   */
  private parseLLMResponse(responseText: string): { title: string; content: string } {
    const contentParts = responseText.split('===');
    let title = "";
    let description = "";
    
    for (let i = 0; i < contentParts.length; i++) {
        if (contentParts[i].includes('ЗАГОЛОВОК') && i + 1 < contentParts.length) {
            title = contentParts[i + 1].trim();
        } else if (contentParts[i].includes('ОПИСАНИЕ') && i + 1 < contentParts.length) {
            description = contentParts[i + 1].trim();
        }
    }
    
    if (!title || !description) {
        const lines = responseText.trim().split('\n');
        title = lines[0] || "Заголовок по умолчанию";
        description = lines.slice(1).join('\n') || responseText;
    }
    
    return { title, content: description };
  }

  /**
   * Готовит финальный объект с результатом, включая детальную статистику по ключам.
   */
  private prepareFinalResult(
    title: string,
    content: string,
    validation: ValidationResult,
    additionalChecks: { issues: string[]; checks: any },
    attempts: number,
    success: boolean = true
  ): GenerationResult {
    const keywordDetails: KeywordDetail[] = [];
    const keywordUsage = validation.metrics.keywordUsageDetails || {};

    for (const [keyword, count] of Object.entries(keywordUsage)) {
        const example = this.findKeywordExample(content, keyword);
        keywordDetails.push({ keyword, count, example });
    }

    const finalContent = `**${title}**\n\n${content}`;

    const result: GenerationResult = {
        success,
        content: finalContent,
        title,
        description: content,
        metrics: {
            ...validation.metrics,
            keywordDetails,
            boldKeywordsCount: additionalChecks.checks.boldKeywords,
            utpCovered: additionalChecks.checks.utpMentioned,
            painPointsAddressed: additionalChecks.checks.painPointsAddressed,
            trustTriggers: additionalChecks.checks.trustTriggers,
        },
        attempts,
    };

    if (!success) result.warnings = validation.issues;
    return result;
  }

  /**
   * Находит пример использования ключевого слова в тексте для отчета.
   */
  private findKeywordExample(content: string, keyword: string): string {
    const contentLower = content.toLowerCase();
    const keywordLower = keyword.toLowerCase();
    const pos = contentLower.indexOf(keywordLower);

    if (pos === -1) {
        return "Пример не найден";
    }

    const start = Math.max(0, pos - 25);
    const end = Math.min(content.length, pos + keyword.length + 25);
    let example = content.slice(start, end);

    if (start > 0) example = "..." + example;
    if (end < content.length) example = example + "...";

    return example.replace(
        new RegExp(this.escapeRegex(keyword), 'i'),
        (match) => `<strong>${match}</strong>`
    );
  }

  /**
   * Проверяет дополнительные бизнес-требования (УТП, боли и т.д.).
   */
  private checkAdditionalRequirements(content: string, data: GenerationRequest): { issues: string[]; checks: any } {
    const issues: string[] = [];
    const checks = {
      boldKeywords: 0,
      utpMentioned: 0,
      painPointsAddressed: 0,
      trustTriggers: 0
    };
    
    // Здесь должна быть ваша полная логика проверок
    
    return { issues, checks };
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}