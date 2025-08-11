// /server/services/generation.graph.ts

import { StateGraph, END, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";
import type { GenerationRequest } from "~/types";
import { getModel, ModelProvider } from "./langchain.service";
import { ContentValidator } from "~/server/utils/content-validator";

const validator = new ContentValidator();

// --- 1. ОПРЕДЕЛЕНИЕ ИНСТРУМЕНТА ---
// Инструмент должен быть самодостаточным. Все данные он получает через input.
const validateTextTool = new DynamicTool({
  name: "validateSeoText",
  description: "Проверяет сгенерированный SEO-текст на соответствие правилам. Input должен быть JSON-строкой с полями: textToValidate, requiredKeywords, optionalKeywords.",
  func: async (input: string) => {
    try {
      const { textToValidate, requiredKeywords, optionalKeywords } = JSON.parse(input);
      if (!textToValidate || !requiredKeywords || !optionalKeywords) {
          return "Ошибка: В JSON-строке отсутствуют обязательные поля (textToValidate, requiredKeywords, optionalKeywords).";
      }
      console.log(`[Tool] Validating text of length ${textToValidate.length}...`);
      const result = await validator.validate(textToValidate, requiredKeywords, optionalKeywords);
      
      if (result.isValid) {
        return "Валидация пройдена успешно. Ошибок нет. Текст готов.";
      } else {
        return `Валидация провалена. Вот список ошибок для исправления: ${result.issues.join('; ')}`;
      }
    } catch (e) {
      console.error("[Tool] Error parsing input for validation tool:", e);
      return `Ошибка: Входные данные для инструмента не являются валидным JSON. Вероятно, в строке "textToValidate" есть неэкранированные символы новой строки или кавычки. Пожалуйста, исправь синтаксис JSON и вызови инструмент снова.`;
    }
  },
});

// --- 2. ОПРЕДЕЛЕНИЕ УЗЛОВ И ЛОГИКИ АГЕНТА ---

// Определяем тип состояния, используя MessagesAnnotation.
// Это стандартный способ для агентов, работающих с историей сообщений.
type AgentState = {
  messages: BaseMessage[];
  toolInvocations: number; 
};

// "Мозг" агента.
const agentNode = async (state: AgentState, config?: { configurable?: { modelProvider?: ModelProvider } }) => {
  console.log("[Agent Node] Calling model...");
  // ИСПРАВЛЕНО: Безопасно извлекаем modelProvider из config с установкой значения по умолчанию.
  const modelProvider = config?.configurable?.modelProvider || ModelProvider.GEMINI;
  
  // Теперь TypeScript уверен, что modelProvider не undefined.
    const model = getModel(modelProvider, { temperature: 0.2 })
    if (!model) {
      throw new Error(`Модель для провайдера ${modelProvider} не найдена. agentNode`);
    }
    const modelWithTools = model.bindTools?.([validateTextTool]);
    if (!modelWithTools) {
      throw new Error(`Не удалось привязать инструменты к модели ${modelProvider}. agentNode`);
    }
  
  const response = await modelWithTools.invoke(state.messages);
  if (!response) {
    throw new Error(`Не удалось получить ответ от модели ${modelProvider}. agentNode`);
  }
  
  return { messages: [response] };
};

// Узел инструментов.
const toolNode = async (state: AgentState) => {
  const toolExecutor = new ToolNode([validateTextTool]);
  const response = await toolExecutor.invoke(state);
  // Инкрементируем счетчик каждый раз, когда вызываются инструменты
  return { ...response, toolInvocations: state.toolInvocations + 1 };
};

// ИЗМЕНЯЕМ МАРШРУТИЗАТОР, чтобы он проверял счетчик
const MAX_TOOL_CALLS = 5; // Устанавливаем жесткий лимит
const shouldContinue = (state: AgentState): "tools" | "__end__" => {
const lastMessage = state.messages[state.messages.length - 1];

// Проверяем предохранитель
if (state.toolInvocations >= MAX_TOOL_CALLS) {
    console.warn(`[Router] Max tool calls (${MAX_TOOL_CALLS}) reached. Forcing END.`);
    return "__end__";
}

if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
  return "tools";
}
return "__end__";
};

// --- 3. СБОРКА ГРАФА АГЕНТА ---

// ИСПРАВЛЕНО: Создаем граф, передавая ему MessagesAnnotation НАПРЯМУЮ.
// Это самый правильный и типобезопасный способ.
const generativeAgent = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
      default: () => [],
    },
    // Добавляем канал для нашего счетчика
    toolInvocations: {
        value: (x: number, y: number) => y,
        default: () => 0,
    }
  },
})
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile();

export { generativeAgent };