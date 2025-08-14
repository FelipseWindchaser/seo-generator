// /server/services/langchain.service.ts

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// --- 1. ФАБРИКА МОДЕЛЕЙ (остается без изменений) ---

export enum ModelProvider {
  GEMINI = "gemini-2.0-flash",
  DEEPSEEK = "deepseek-chat",
  GROQ = "llama3-70b-8192",
  GPT_4o = "gpt-4o-mini-2024-07-18",
}

export function getModel(
  provider: ModelProvider,
  config: { temperature: number; maxOutputTokens?: number }
): BaseChatModel {
  switch (provider) {
    case ModelProvider.DEEPSEEK:
      return new ChatDeepSeek({
        model: provider,
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens,
      });
    case ModelProvider.GROQ:
      return new ChatGroq({
        model: provider,
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens,
      });
    case ModelProvider.GPT_4o:
      return new ChatOpenAI({
        model: provider,
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens,
      });
    case ModelProvider.GEMINI:
    default:
      return new ChatGoogleGenerativeAI({
        model: provider,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
      });
  }
}

// --- 2. СХЕМЫ, ПАРСЕРЫ И ПРОМПТЫ (только для используемых цепочек) ---

// Схема для генератора ключей (ВОЗВРАЩАЕМ optionalKeywords)
const keywordsSchema = z.object({
  requiredKeywords: z
    .array(z.string())
    .describe(
      "Список из 15 самых важных, высокочастотных однословных ключей."
    ),
  optionalKeywords: z
    .array(z.string())
    .describe(
      "Список из 15 второстепенных однословных ключей."
    ),
});

// Парсер для генератора ключей
function cleanAndParseJson(text: string): any {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonString = match && match[1] ? match[1] : text;
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("[JSON Parser] Failed to parse JSON from model response:", { originalText: text, cleanedText: jsonString }, e);
    return { requiredKeywords: [], optionalKeywords: [] };
  }
}

// Промпт для ручной доработки
const userRefinementPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "Ты — высокоточный редактор. Твоя задача — взять текст и запрос на изменение, а затем ВНЕСТИ ТОЛЬКО запрошенное изменение, НЕ НАРУШАЯ исходных правил...",
  ],
  [
    "human",
    `ЗАДАЧА: Аккуратно отредактируй ИСХОДНЫЙ ТЕКСТ в соответствии с ЗАПРОСОМ ПОЛЬЗОВАТЕЛЯ, при этом СТРОГО СОБЛЮДАЯ все КРИТИЧЕСКИЕ ПРАВИЛА.

--- ИСХОДНЫЙ ТЕКСТ ---
{originalContent}

--- ЗАПРОС ПОЛЬЗОВАТЕЛЯ НА ИЗМЕНЕНИЕ ---
"{userPrompt}"

--- КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА (ДОЛЖНЫ СОБЛЮДАТЬСЯ БЕЗУСЛОВНО) ---
1.  **ОБЪЕМ ТЕКСТА:** Итоговый текст должен быть объемом СТРОГО от 1800 до 2000 символов.
2.  **КЛЮЧЕВЫЕ СЛОВА:** Все обязательные ключи должны остаться в тексте.

Верни ТОЛЬКО полный, исправленный текст описания без заголовков и комментариев.`,
  ],
]);


// --- 3. АКТУАЛЬНЫЕ ЦЕПОЧКИ (CHAINS) ---

// Цепочка для генерации ключевых слов
export const keywordGeneratorChain = new RunnableLambda({
  func: async (input: {
    productName: string;
    productUrl?: string;
    modelProvider: ModelProvider;
  }) => {
    const model = getModel(input.modelProvider, {
      temperature: 0.1,
      maxOutputTokens: 1024,
    });

    // Промпт для генерации ключей (ВОЗВРАЩАЕМ optionalKeywords)
    const humanText = `
Проанализируй товар с названием: "{productName}".
${
  input.productUrl
    ? `(Используй содержимое по ссылке для дополнительного контекста: ${input.productUrl})`
    : ""
}

Твоя задача — составить семантическое ядро из однословных ключей.

1.  **Обязательные ключи (15 штук):** Самые важные, высокочастотные слова, точно идентифицирующие товар.
2.  **Дополнительные ключи (15 штук):** Слова, описывающие второстепенные характеристики.

ПРИМЕР ВЫВОДА:
{{
  "requiredKeywords": ["ключ1", "ключ2", "ключ3"],
  "optionalKeywords": ["ключA", "ключB", "ключC"]
}}
`;

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "Ты — профессиональный SEO-аналитик. Твоя задача — проанализировать название товара и составить семантическое ядро. КРИТИЧЕСКИ ВАЖНО: Твой ответ должен быть ТОЛЬКО валидным JSON объектом без Markdown-разметки.",
      ],
      ["human", humanText],
    ]);

    // Используем .withStructuredOutput для надежности, если модель его поддерживает
    const chain = prompt.pipe(model.withStructuredOutput(keywordsSchema));

    const response = await chain.invoke({
      productName: input.productName,
      productUrl: input.productUrl,
    });

    return response;
  },
});

// Цепочка для ручной доработки
export const refinementChain = new RunnableLambda({
  func: async (input: {
    originalContent: string;
    userPrompt: string;
    modelProvider: ModelProvider;
  }) => {
    const model = getModel(input.modelProvider, {
      temperature: 0.3,
      maxOutputTokens: 1024,
    });
    const chain = userRefinementPrompt.pipe(model).pipe(new StringOutputParser());
    return await chain.invoke({
        originalContent: input.originalContent,
        userPrompt: input.userPrompt,
    });
  },
});