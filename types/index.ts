// /types/index.ts

import type { ModelProvider } from "~/server/services/langchain.service";

// --- Типы для инструкций и запросов ---

/**
 * @description Новый тип для передачи конкретных инструкций по количеству использований
 * ключевого слова. Используется для передачи рассчитанных данных в генератор промптов и валидатор.
 */
export interface KeywordInstruction {
  keyword: string;
  count: number;
}

/**
 * @description Основной объект запроса на генерацию.
 * ИСПОЛЬЗУЕТ НОВУЮ СТРУКТУРУ КЛЮЧЕЙ.
 */
export interface GenerationRequest {
  productName: string;
  productUrl?: string;
  requiredKeywords: string[]; // 10 обязательных ключей
  optionalKeywords: string[]; // до 10 необязательных
  reviews: string;
  usp: string[];
  adsPlanned: boolean;
  canChangeVisuals: boolean;
  modelProvider?: ModelProvider;
  numberOfVariations?: number;
}


// --- Типы для метрик и результатов валидации ---

/**
 * @description Метрики, рассчитываемые валидатором.
 * ДОБАВЛЕНЫ НОВЫЕ ПОЛЯ для детализации по типам ключей.
 */
export interface ValidationMetrics {
  charCount: number;
  charCountNoSpaces: number;
  wordCount: number;
  
  // Новые детализированные поля
  requiredKeywordsUsed: number;
  requiredKeywordsTotal: number;
  optionalKeywordsUsed: number;
  optionalKeywordsTotal: number;

  // Старые поля для общей информации
  keywordsFound: string[];
  keywordsUsed: number;
  totalKeywords: number;
  
  // Плотность теперь считается только по обязательным ключам
  keywordDensity: number;
  keywordOccurrences: number; // Вхождения только обязательных ключей
  
  missingKeywords: string[]; // Только обязательные пропущенные ключи
  keywordUsageDetails: Record<string, { count: number }>;
  
  // Эти поля можно оставить как есть или доработать
  charDensity: number;
  keywordPositions: {
    beginning: number;
    middle: number;
    end: number;
  };
}

export interface ReadabilityMetrics {
  avgSentenceLength: number;
  maxSentenceLength: number;
  complexWordsRatio: number;
  longWordsRatio: number;
  totalSentences: number;
  fleschRuScore: number;
  lexicalDiversity: number;
}

export interface SemanticMetrics {
  keywordStuffingDetected: boolean;
  lowCoherenceScore: boolean;
  avgCoherence: number;
  adClichesCount: number;
  paragraphCount: number;
}

/**
 * @description Полный результат валидации, который содержит все метрики и ошибки.
 */
export interface ValidationResult {
  isValid: boolean;
  metrics: ValidationMetrics & {
    readability: ReadabilityMetrics;
    semantic: SemanticMetrics;
  };
  issues: string[];
  status: "OK" | "MISSING_KEYS" | "TOO_LONG" | "TOO_SHORT" | "NON_CRITICAL_ERRORS";
}


// --- Основные типы для результата и задачи ---

export interface KeywordDetail {
  keyword: string;
  count: number;
  example: string;
}

export interface TextVariation {
  description: string;
  // ИСПРАВЛЕНО: Тип metrics теперь является полным, как и ожидалось
  metrics: ValidationMetrics & {
    boldKeywordsCount: number;
    // Мы можем добавить и keywordDetails для полной консистентности,
    // хотя revalidate его не генерирует, но это сделает тип надежнее.
    keywordDetails?: KeywordDetail[]; 
  };
  analysis: {
    utpAnalysis: AnalysisDetail[];
    painPointAnalysis: AnalysisDetail[];
  };
}

export interface GenerationResult {
  success: boolean;
  // content: string;
  title: string;
  // descriptions: string[];
  variations: TextVariation[];
  // metrics?: ValidationMetrics & { 
  //   keywordDetails: KeywordDetail[];
  //   boldKeywordsCount: number;
  //   utpCovered?: number;
  //   painPointsAddressed?: number;
  //   trustTriggers?: number;
  // };
  attempts: number;
  warnings?: string[];
  processingLog?: {
    added: string[];
    removed: string[];
  };
  // analysis?: {
  //   utpAnalysis: AnalysisDetail[];
  //   painPointAnalysis: AnalysisDetail[];
  // };
}

export interface AnalysisDetail {
  point: string;
  isCovered: boolean;
  evidence: string;
}

/**
 * @description Объект задачи, хранящийся в базе данных (например, Redis).
 */
export interface Task {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  request?: GenerationRequest; // Использует обновленный GenerationRequest
  result?: GenerationResult;   // Использует обновленный GenerationResult
  error?: string;
  createdAt: string;
  completedAt?: string;
}

