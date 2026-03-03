/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

/**
 * Load Shedding — Graceful degradation under heavy load
 *
 * Severity levels:
 *   GREEN  — Normal operation. All features enabled.
 *   YELLOW — Elevated load (>70%). Disable AI features, double cache TTLs.
 *   ORANGE — High load (>85%). Serve stale cache only, no background jobs.
 *   RED    — Critical (>95%). 503 everything except /api/prices and /api/news.
 *
 * The load factor is computed from a rolling window of request latencies
 * and active concurrent request count vs. the configured capacity.
 *
 * @module load-shedding
 */

// =============================================================================
// TYPES
// =============================================================================

export type ServiceLevel = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

export interface LoadState {
  level: ServiceLevel;
  loadFactor: number; // 0.0 – 1.0
  concurrentRequests: number;
  avgLatencyMs: number;
  timestamp: number;
}

export interface LoadSheddingConfig {
  /** Maximum concurrent requests before entering degraded state. Default: 10000 */
  maxConcurrent: number;
  /** Target p95 latency in ms. Exceeding triggers escalation. Default: 500 */
  targetLatencyMs: number;
  /** Rolling window size for latency tracking. Default: 1000 */
  windowSize: number;
  /** Thresholds for load factor → service level transitions */
  thresholds: { yellow: number; orange: number; red: number };
}

const DEFAULT_CONFIG: LoadSheddingConfig = {
  maxConcurrent: 10_000,
  targetLatencyMs: 500,
  windowSize: 1000,
  thresholds: { yellow: 0.70, orange: 0.85, red: 0.95 },
};

// =============================================================================
// LOAD SHEDDER
// =============================================================================

export class LoadShedder {
  private config: LoadSheddingConfig;
  private concurrent = 0;
  private latencies: number[] = [];
  private latencyIdx = 0;
  private level: ServiceLevel = 'GREEN';

  constructor(config?: Partial<LoadSheddingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.latencies = new Array(this.config.windowSize).fill(0);
  }

  /**
   * Record a request starting — call when the request begins.
   * Returns a finish function to call when the request completes.
   */
  requestStart(): () => void {
    this.concurrent++;
    const start = Date.now();

    return () => {
      this.concurrent = Math.max(0, this.concurrent - 1);
      const elapsed = Date.now() - start;
      this.latencies[this.latencyIdx % this.config.windowSize] = elapsed;
      this.latencyIdx++;
      this.recalculate();
    };
  }

  /**
   * Check whether a request should be shed (rejected).
   *
   * @param pathname Route path
   * @returns `null` if allowed, or a reason string if rejected
   */
  shouldShed(pathname: string): string | null {
    if (this.level === 'RED') {
      // Only allow critical endpoints
      if (/^\/(api\/)?(prices|news|health)/.test(pathname)) return null;
      return `Service overloaded (RED). Only /prices and /news available.`;
    }
    return null;
  }

  /**
   * Whether a feature is enabled at the current service level.
   */
  isFeatureEnabled(feature: 'ai' | 'search' | 'websocket-new' | 'background-jobs'): boolean {
    switch (feature) {
      case 'ai':
        return this.level === 'GREEN';
      case 'search':
        return this.level !== 'RED';
      case 'websocket-new':
        return this.level !== 'RED' && this.level !== 'ORANGE';
      case 'background-jobs':
        return this.level === 'GREEN' || this.level === 'YELLOW';
    }
  }

  /**
   * Get the multiplier for cache TTLs at the current service level.
   */
  getCacheTtlMultiplier(): number {
    switch (this.level) {
      case 'GREEN':
        return 1;
      case 'YELLOW':
        return 2;
      case 'ORANGE':
        return 5;
      case 'RED':
        return 10;
    }
  }

  /**
   * Get the current service state.
   */
  getState(): LoadState {
    return {
      level: this.level,
      loadFactor: this.computeLoadFactor(),
      concurrentRequests: this.concurrent,
      avgLatencyMs: this.computeAvgLatency(),
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // INTERNAL
  // ---------------------------------------------------------------------------

  private recalculate(): void {
    const factor = this.computeLoadFactor();
    const { thresholds } = this.config;

    if (factor >= thresholds.red) {
      this.level = 'RED';
    } else if (factor >= thresholds.orange) {
      this.level = 'ORANGE';
    } else if (factor >= thresholds.yellow) {
      this.level = 'YELLOW';
    } else {
      this.level = 'GREEN';
    }
  }

  private computeLoadFactor(): number {
    const concurrencyFactor = this.concurrent / this.config.maxConcurrent;
    const avgLatency = this.computeAvgLatency();
    const latencyFactor = avgLatency / this.config.targetLatencyMs;

    // Weighted blend: 60% concurrency, 40% latency
    return Math.min(1, concurrencyFactor * 0.6 + latencyFactor * 0.4);
  }

  private computeAvgLatency(): number {
    const count = Math.min(this.latencyIdx, this.config.windowSize);
    if (count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += this.latencies[i];
    return sum / count;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const loadShedder = new LoadShedder();
