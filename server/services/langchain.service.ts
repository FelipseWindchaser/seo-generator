// /server/services/langchain.service.ts

// ИСПРАВЛЕНО: Импортируем ChatPromptTemplate
import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  RunnableSequence,
  RunnablePassthrough,
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

import { z } from "zod";

import type { GenerationRequest } from "~/types";

// --- 1. ИНИЦИАЛИЗАЦИЯ МОДЕЛЕЙ (без изменений) ---
const creativeModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0.7,
  maxOutputTokens: 2048,
});

const editorModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0.3,
  maxOutputTokens: 1024,
});

const structuredOutputModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0.1,
});

// --- 2. ШАБЛОНЫ ПРОМПТОВ (ИСПРАВЛЕНО: используем ChatPromptTemplate) ---

// Шаблон для Этапа 1
const fillerGeneratorPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "Ты — опытный копирайтер. Твоя задача — написать 'живой', подробный и убедительный текст для карточки товара, основываясь на его преимуществах. ЗАБУДЬ О SEO и КЛЮЧЕВЫХ СЛОВАХ. Сосредоточься на качестве и пользе для клиента. Верни ТОЛЬКО текст описания, без заголовка и разделителей.",
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
    "Ты — умный SEO-редактор. Твоя задача — взять готовый текст и АККУРАТНО внедрить в него ключевые слова, следуя правилу 'перевернутой пирамиды'. Верни ТОЛЬКО полный, исправленный текст описания без заголовков и комментариев. Выдели жирным шрифтом все внедренные ключевые слова.",
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

// --- 3. СБОРКА ЦЕПОЧКИ (CHAIN) ---

// Цепочка для Этапа 1: Генерация "наполнителя"
const fillerChain = RunnableSequence.from([
  // Форматируем входные данные для промпта
  (data: GenerationRequest) => ({
    productName: data.productName,
    reviews: data.reviews,
    usp: data.usp.join(", "),
  }),
  fillerGeneratorPrompt, // Этот шаблон уже создает массив сообщений
  creativeModel, // Модель получает готовый массив
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
  keywordInjectorPrompt, // Этот шаблон уже создает массив сообщений
  editorModel, // Модель получает готовый массив
  new StringOutputParser(),
]);

const keywordsSchema = z.object({
  requiredKeywords: z.array(z.string()).describe("..."),
  optionalKeywords: z.array(z.string()).describe("..."),
});

// Основная цепочка, которая объединяет все шаги
export const seoGeneratorChain = RunnableSequence.from([
  {
    baseContent: fillerChain,
    originalRequest: new RunnablePassthrough<GenerationRequest>(),
  },
  injectorChain,
]);

export const refinementChain = userRefinementPrompt
  .pipe(editorModel)
  .pipe(new StringOutputParser());

export const keywordGeneratorChain = RunnableSequence.from([
  // Первый шаг - это лямбда-функция, которая ДИНАМИЧЕСКИ создает промпт
  (input: { productName: string; productUrl?: string }) => {
    const messages = [
      new SystemMessage(
        "Ты — профессиональный SEO-аналитик. Твоя задача — проанализировать название товара и составить семантическое ядро из 30 однословных ключей, разделив их на две категории по 15 ключей: обязательные и дополнительные. Верни результат в виде JSON-объекта, соответствующего предоставленной схеме."
      ),
    ];

    // Собираем текст для HumanMessage
    let humanText = `Проанализируй товар с названием: "${input.productName}".`;

    // Если URL предоставлен и он не пустой, добавляем дополнительный контекст
    if (input.productUrl) {
      humanText += `\n(Используй содержимое по ссылке для дополнительного контекста: ${input.productUrl})`;
    }

    messages.push(new HumanMessage(humanText));

    // Эта лямбда-функция возвращает готовый для модели массив сообщений
    return messages;
  },
  // Второй шаг - вызываем модель со структурированным выводом
  structuredOutputModel.withStructuredOutput(keywordsSchema),
]);
