// /server/utils/langchain-error-handler.ts

/**
 * Обрабатывает ошибки, сгенерированные LangChain, используя стандартизированное
 * свойство `lc_error_code` для точной классификации.
 * 
 * @param error - Объект ошибки, пойманный в блоке catch.
 * @returns Объект { statusCode: number, statusMessage: string }, готовый для createError.
 */
export function handleLangChainError(error: any): { statusCode: number, statusMessage: string } {
  // 1. Проверяем наличие стандартного кода ошибки LangChain
  if (error?.lc_error_code) {
    switch (error.lc_error_code) {
      case "MODEL_AUTHENTICATION":
        // Проблема с API-ключом. Это ошибка конфигурации сервера.
        console.error("[LangChain Error] Authentication failed. Check API key.", error);
        return { 
          statusCode: 500, // Не 401, т.к. это проблема сервера, а не клиента
          statusMessage: "Ошибка конфигурации: неверный или отсутствующий API-ключ для модели." 
        };

      case "MODEL_RATE_LIMIT":
        // Превышен лимит запросов.
        return { 
          statusCode: 429, 
          statusMessage: "Превышен лимит запросов к AI-модели (квота). Пожалуйста, попробуйте позже." 
        };
        
      case "MODEL_NOT_FOUND":
        // Запрошенная модель не существует. Ошибка конфигурации.
        console.error(`[LangChain Error] Model not found: ${error.message}`, error);
        return { 
          statusCode: 500, 
          statusMessage: "Ошибка конфигурации: указанная AI-модель не найдена." 
        };

      case "OUTPUT_PARSING_FAILURE":
        // Модель вернула ответ, который не удалось распарсить (например, невалидный JSON).
        // Это частая проблема, стоит попробовать еще раз.
        return { 
          statusCode: 502, // Bad Gateway - модель вернула плохой ответ
          statusMessage: "AI-модель вернула ответ в некорректном формате. Пожалуйста, попробуйте сгенерировать снова." 
        };
        
      case "INVALID_PROMPT_INPUT":
      case "INVALID_TOOL_RESULTS":
      case "MESSAGE_COERCION_FAILURE":
        // Эти ошибки указывают на баг в нашем коде (неправильные данные передаются в цепочку).
        // Это серьезная внутренняя ошибка сервера.
        console.error(`[LangChain Error] Internal logic error (${error.lc_error_code}): ${error.message}`, error);
        return { 
          statusCode: 500, 
          statusMessage: `Внутренняя ошибка сервера при обработке данных для AI (${error.lc_error_code}).` 
        };

      default:
        // Неизвестный код ошибки LangChain
        console.error(`[LangChain Error] Unknown lc_error_code: ${error.lc_error_code}`, error);
        return { 
          statusCode: 500, 
          statusMessage: `Произошла неизвестная ошибка LangChain: ${error.message}` 
        };
    }
  }

  // 2. Фоллбэк: если это не ошибка LangChain, используем общую логику
  if (error.statusCode) {
    return { 
      statusCode: error.statusCode, 
      statusMessage: error.data?.message || error.statusMessage || "Произошла ошибка API." 
    };
  }

  // 3. Самый общий фоллбэк
  return { 
    statusCode: 500, 
    statusMessage: error.message || "Произошла неизвестная внутренняя ошибка." 
  };
}