import type { GenerationRequest, GenerationResult } from "../../types";

interface LogEntry {
  timestamp: string;
  request: {
    keywordsCount: number;
    uspCount: number;
    adsPlanned: boolean;
    url: string;
  };
  result: {
    success: boolean;
    charCount: number;
    keywordsUsed: number;
    keywordDensity: number;
    attempts: number;
    warnings: number;
  };
  performance: {
    durationSeconds: number;
    costEstimate: number;
  };
}

export class GenerationMonitor {
  private logs: LogEntry[] = [];

  logGeneration(
    requestData: GenerationRequest,
    result: GenerationResult,
    duration: number
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      request: {
        keywordsCount: requestData.keywords.length,
        uspCount: requestData.usp.length,
        adsPlanned: requestData.adsPlanned,
        url: requestData.productUrl,
      },
      result: {
        success: result.success,
        charCount: result.metrics.charCount,
        keywordsUsed: result.metrics.keywordsUsed,
        keywordDensity: result.metrics.keywordDensity,
        attempts: result.attempts,
        warnings: result.warnings?.length || 0,
      },
      performance: {
        durationSeconds: Math.round(duration),
        costEstimate: this.estimateCost(result.attempts),
      },
    };

    this.logs.push(entry);

    // В продакшене отправляем в систему логирования
    console.log("Generation logged:", entry);
  }

  private estimateCost(attempts: number): number {
    // Claude 3.5 Sonnet: ~$0.003 per 1K input tokens, $0.015 per 1K output tokens
    const costPerAttempt = 0.003 * 2 + 0.015 * 1;
    return Math.round(costPerAttempt * attempts * 10000) / 10000;
  }

  getDailyReport(): {
    totalGenerations: number;
    successRate: number;
    averageDuration: number;
    totalCost: number;
    averageAttempts: number;
  } {
    const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
    const recentLogs = this.logs.filter(
      (log) => new Date(log.timestamp).getTime() > last24Hours
    );

    if (recentLogs.length === 0) {
      return {
        totalGenerations: 0,
        successRate: 0,
        averageDuration: 0,
        totalCost: 0,
        averageAttempts: 0,
      };
    }

    const successCount = recentLogs.filter((log) => log.result.success).length;
    const totalDuration = recentLogs.reduce(
      (sum, log) => sum + log.performance.durationSeconds,
      0
    );
    const totalCost = recentLogs.reduce(
      (sum, log) => sum + log.performance.costEstimate,
      0
    );
    const totalAttempts = recentLogs.reduce(
      (sum, log) => sum + log.result.attempts,
      0
    );

    return {
      totalGenerations: recentLogs.length,
      successRate: (successCount / recentLogs.length) * 100,
      averageDuration: totalDuration / recentLogs.length,
      totalCost,
      averageAttempts: totalAttempts / recentLogs.length,
    };
  }
}

// Глобальный экземпляр
export const monitor = new GenerationMonitor();
