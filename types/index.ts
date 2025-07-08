// Основные типы данных
export interface GenerationRequest {
  productUrl: string;
  keywords: string[];
  reviews: string;
  usp: string[];
  adsPlanned: boolean;
  canChangeVisuals: boolean;
}

export interface ValidationMetrics {
  charCount: number;
  charCountNoSpaces: number;
  wordCount: number;
  keywordsFound: string[];
  keywordsUsed: number;
  totalKeywords: number;
  keywordDensity: number;
  charDensity: number;
  keywordOccurrences: number;
  missingKeywords: string[];
  keywordUsageDetails: Record<string, { count: number }>;
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

export interface ValidationResult {
  isValid: boolean;
  metrics: ValidationMetrics & {
    readability: ReadabilityMetrics;
    semantic: SemanticMetrics;
  };
  issues: string[];
}

export interface SemanticMetrics {
  keywordStuffingDetected: boolean;
  lowCoherenceScore: boolean;
  avgCoherence: number;
  adClichesCount: number;
  paragraphCount: number;
}

export interface GenerationResult {
  success: boolean;
  content: string;
  title: string;
  description: string;
  metrics?: ValidationMetrics & {
    keywordDetails: KeywordDetail[];
    boldKeywordsCount: number;
    utpCovered?: number;
    painPointsAddressed?: number;
    trustTriggers?: number;
  };
  attempts: number;
  warnings?: string[];
  processingLog?: {
    added: string[];
    removed: string[];
  };
}

export interface KeywordDetail {
  keyword: string;
  count: number;
  example: string;
}

export interface Task {
  id: string;
  status: "processing" | "completed" | "error";
  request?: GenerationRequest;
  result?: GenerationResult;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
