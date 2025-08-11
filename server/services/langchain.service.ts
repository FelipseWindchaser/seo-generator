// /server/services/langchain.service.ts

import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  RunnableSequence,
  RunnablePassthrough,
  RunnableLambda,
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
// ИМПОРТИРУЕМ ОБЕ МОДЕЛИ
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import type { GenerationRequest } from "~/types";
import { z } from "zod";

// --- 1. ФАБРИКА МОДЕЛЕЙ ---

// Создаем Enum для типобезопасного выбора модели
export enum ModelProvider {
  GEMINI = "gemini-2.0-flash",
  DEEPSEEK = "deepseek-chat",
  GROQ = "llama3-70b-8192",
  GPT_4o = "gpt-4o-2024-08-06",
}

// Функция-фабрика, которая возвращает нужный экземпляр модели
export function getModel(
  provider: ModelProvider,
  config: { temperature: number; maxOutputTokens?: number }
): BaseChatModel {
  switch (provider) {
    case ModelProvider.DEEPSEEK:
      console.log(
        `[LangChain Service] Initializing Deepseek model: ${provider}`
      );
      return new ChatDeepSeek({
        model: provider,
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens,
        // apiKey берется из переменной окружения DEEPSEEK_API_KEY
      });

    // НОВЫЙ БЛОК
    case ModelProvider.GROQ:
      console.log(`[LangChain Service] Initializing Groq model: ${provider}`);
      return new ChatGroq({
        model: provider,
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens,
        // apiKey берется из переменной окружения GROQ_API_KEY
      });

    case ModelProvider.GPT_4o:
      console.log(`[LangChain Service] Initializing OpenAI model: ${provider}`);
      return new ChatOpenAI({
        modelName: provider, // У OpenAI это `modelName`
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens,
        // apiKey берется из переменной окружения OPENAI_API_KEY
      });

    case ModelProvider.GEMINI:
    default:
      console.log(`[LangChain Service] Initializing Gemini model: ${provider}`);
      return new ChatGoogleGenerativeAI({
        model: provider,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        // apiKey берется из переменной окружения GOOGLE_API_KEY
      });
  }
}

const keywordsSchema = z.object({
  requiredKeywords: z
    .array(z.string())
    .describe(
      "Список из 15 самых важных, высокочастотных однословных ключей, точно идентифицирующих товар."
    ),
  optionalKeywords: z
    .array(z.string())
    .describe(
      "Список из 15 однословных ключей, описывающих второстепенные характеристики, технологии или преимущества."
    ),
});

// --- 2. ШАБЛОНЫ ПРОМПТОВ (ИСПРАВЛЕНО: используем ChatPromptTemplate) ---

// Шаблон для Этапа 1
const fillerGeneratorPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "Ты — опытный копирайтер. Русский язык - твой родной язык, ты пишешь и думаешь на русском языке. Твоя задача — написать 'живой', подробный и убедительный текст для карточки товара, основываясь на его преимуществах. ЗАБУДЬ О SEO и КЛЮЧЕВЫХ СЛОВАХ. Сосредоточься на качестве и пользе для клиента. Верни ТОЛЬКО текст описания, без заголовка и разделителей.",
  ],
  [
    "human",
    `ЗАДАЧА: Напиши подробный, качественный текст для товара "{productName}", разделенный на 5-7 логических абзацев.

ВХОДНЫЕ ДАННЫЕ:
- Отзывы конкурентов (закрой эти боли): {reviews}
- УТП (раскрой все, говоря о выгоде): {usp}`,
  ],
]);

// Шаблон для Этапа 2
const keywordInjectorPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "Ты — умный SEO-редактор. Русский язык - твой родной язык, ты пишешь и думаешь на русском языке. Твоя задача — взять готовый текст и АККУРАТНО внедрить в него ключевые слова, следуя правилу 'перевернутой пирамиды' - больше всего ключей в первом абзаце, меньше во втором, в третьем абзаце - еще меньше и так далее. Верни ТОЛЬКО полный, исправленный текст описания без заголовков и комментариев. Выдели жирным шрифтом все внедренные ключевые слова.",
  ],
  [
    "human",
    `ОТРЕДАКТИРУЙ ЭТОТ ТЕКСТ:
---
{base_content}
---

ПРАВИЛА ВНЕДРЕНИЯ КЛЮЧЕВЫХ СЛОВ:
1.  **ПЕРВЫЙ АБЗАЦ:** Внедри сюда большинство **обязательных** ключей: {requiredKeywords}.
2.  **ОСТАЛЬНОЙ ТЕКСТ:** Распредели здесь **дополнительные** ключи: {optionalKeywords}.
3.  **ОБЪЕМ:** Итоговый текст должен быть около 2000 символов.`,
  ],
]);

const userRefinementPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "Ты — высокоточный редактор. Русский язык - твой родной язык, ты пишешь и думаешь на русском языке. Твоя задача — взять текст и запрос на изменение, а затем ВНЕСТИ ТОЛЬКО запрошенное изменение, НЕ НАРУШАЯ исходных правил...",
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

// Цепочка для Этапа 1: Генерация "наполнителя"
const fillerChain = RunnableSequence.from([
  // Входные данные (data) уже содержат все необходимое
  fillerGeneratorPrompt,
  (promptValue, config) => {
    // ИСПРАВЛЕНО: Берем modelProvider из `config`, который передается из invoke
    const model = getModel(config.configurable.modelProvider, {
      temperature: 0.7,
      maxOutputTokens: 2048,
    });
    return model.invoke(promptValue);
  },
  new StringOutputParser(),
]);

// Цепочка для Этапа 2: Внедрение ключей
const injectorChain = RunnableSequence.from([
  // Форматируем входные данные для промпта
  (input: { baseContent: string; originalRequest: GenerationRequest }) => ({
    base_content: input.baseContent,
    requiredKeywords: input.originalRequest.requiredKeywords.join(", "),
    optionalKeywords: input.originalRequest.optionalKeywords.join(", "),
  }),
  keywordInjectorPrompt,
  (promptValue, config) => {
    // ИСПРАВЛЕНО: Берем modelProvider из `config`
    const model = getModel(config.configurable.modelProvider, {
      temperature: 0.3,
      maxOutputTokens: 1024,
    });
    return model.invoke(promptValue);
  },
  new StringOutputParser(),
]);

// Основная цепочка, которая объединяет все шаги
export const seoGeneratorChain = RunnableSequence.from([
  {
    baseContent: fillerChain,
    originalRequest: new RunnablePassthrough<GenerationRequest>(),
  },
  injectorChain,
]);

function cleanAndParseJson(text: string): any {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);

  // Если нашли Markdown-блок и в нем есть содержимое (match[1]), используем его.
  // В противном случае, используем исходный текст.
  const jsonString = match && match[1] ? match[1] : text;

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error(
      "[JSON Parser] Failed to parse JSON from model response:",
      { originalText: text, cleanedText: jsonString },
      e
    );
    return { requiredKeywords: [], optionalKeywords: [] };
  }
}

export const keywordGeneratorChain = new RunnableLambda({
  func: async (input: {
    productName: string;
    productUrl?: string;
    modelProvider: ModelProvider;
  }) => {
    console.log(
      `[Keyword Chain] Invoking with explicit JSON prompt for model ${input.modelProvider}`
    );

    const model = getModel(input.modelProvider, {
      temperature: 0.1,
      maxOutputTokens: 600,
    });

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
        "Ты — профессиональный SEO-аналитик. Русский язык - твой родной язык, ты пишешь и думаешь на русском языке. Твоя задача — проанализировать название товара и составить семантическое ядро. КРИТИЧЕСКИ ВАЖНО: Твой ответ должен быть ТОЛЬКО валидным JSON объектом, без какого-либо другого текста или Markdown-разметки (никаких ```json).",
      ],
      ["human", humanText],
    ]);

    const chain = prompt.pipe(model).pipe(new StringOutputParser());

    const responseText = await chain.invoke({
      productName: input.productName,
      productUrl: input.productUrl,
    });

    // ИСПОЛЬЗУЕМ НАШУ НОВУЮ ФУНКЦИЮ-ПАРСЕР
    return cleanAndParseJson(responseText);
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
    const prompt = userRefinementPrompt;
    const chain = prompt.pipe(model).pipe(new StringOutputParser());
    return await chain.invoke(input);
  },
});
