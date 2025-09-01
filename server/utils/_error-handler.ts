// /server/utils/error-handler.ts

import type { GoogleRpcStatus } from '@google/genai';

/**
 * Анализирует ошибку от Google GenAI API и возвращает объект
 * с кодом состояния HTTP и понятным сообщением.
 * @param error - Объект ошибки, пойманный в блоке catch.
 * @returns Объект { statusCode: number, statusMessage: string }.
 */
export function handleGoogleAIError(error: any): { statusCode: number, statusMessage: string } {
  const rpcStatus = error.cause as GoogleRpcStatus || error.details as GoogleRpcStatus;

  if (rpcStatus && typeof rpcStatus === 'object' && rpcStatus.code) {
    switch (rpcStatus.code) {
      // gRPC 14: UNAVAILABLE -> HTTP 503
      case 14:
        return { 
          statusCode: 503, 
          statusMessage: "Серверы AI-модели временно недоступны или перегружены. Пожалуйста, попробуйте снова через несколько минут." 
        };
      // gRPC 8: RESOURCE_EXHAUSTED -> HTTP 429
      case 8:
        return { 
          statusCode: 429, 
          statusMessage: "Превышен лимит запросов (квота). Пожалуйста, проверьте ваш тарифный план или попробуйте позже." 
        };
      // gRPC 3: INVALID_ARGUMENT -> HTTP 400
      case 3:
        return { 
          statusCode: 400, 
          statusMessage: `Некорректный аргумент в запросе к модели: ${rpcStatus.message}` 
        };
      default:
        return { 
          statusCode: 500, 
          statusMessage: `Произошла неизвестная ошибка API (код: ${rpcStatus.code}): ${rpcStatus.message}` 
        };
    }
  }

  // Фоллбэк на парсинг строки сообщения
  if (error.message) {
    if (error.message.includes('503')) {
      return { statusCode: 503, statusMessage: "Серверы AI-модели временно недоступны или перегружены." };
    }
    if (error.message.includes('429')) {
      return { statusCode: 429, statusMessage: "Превышен лимит запросов (квота)." };
    }
  }

  // Самый общий фоллбэк
  return { 
    statusCode: 500, 
    statusMessage: error.message || "Неизвестная ошибка при обращении к AI модели." 
  };
}