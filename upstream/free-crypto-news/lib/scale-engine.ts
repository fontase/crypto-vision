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
 * Scale Engine — Infrastructure for handling 1M+ concurrent users
 *
 * This module provides the core scaling primitives:
 *
 * 1. **Request Queue** — Back-pressure queue with priority lanes
 * 2. **Connection Pool** — Managed pool for external API connections
 * 3. **Load Shedding** — Graceful degradation under extreme load
 * 4. **Adaptive Throttling** — Auto-adjusts based on upstream health
 * 5. **Request Coalescing** — Merges identical concurrent requests
 * 6. **Circuit Dashboard** — Real-time health overview
 *
 * ## Traffic Model for 1M+ Users
 *
 * Assumptions:
 * - 1M DAU → ~100K concurrent → ~10K req/s peak
 * - 80% cacheable → ~2K req/s hitting origin
 * - 50% of origin hits can be coalesced → ~1K unique API calls/s
 * - Average external API latency: 200ms
 * - Required connection pool: ~200 concurrent connections
 *
 * @module scale-engine
 */

// =============================================================================
// TYPES
// =============================================================================

export type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface QueuedRequest<T = unknown> {
  id: string;
  priority: Priority;
  handler: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  timeoutMs: number;
  retries: number;
  maxRetries: number;
}

export interface LoadMetrics {
  /** Current requests per second */
  rps: number;
  /** Active concurrent connections */
  activeConnections: number;
  /** Queue depth */
  queueDepth: number;
  /** Average response time (ms) */
  avgResponseTime: number;
  /** p99 response time (ms) */
  p99ResponseTime: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** CPU load estimate (0-1) */
  cpuEstimate: number;
  /** Memory usage estimate (MB) */
  memoryMb: number;
  /** Load level */
  level: 'normal' | 'elevated' | 'high' | 'critical';
}

export interface ScaleConfig {
  /** Maximum concurrent external connections */
  maxConnections: number;
  /** Maximum queue depth before shedding */
  maxQueueDepth: number;
  /** Request timeout (ms) */
  requestTimeoutMs: number;
  /** Enable load shedding */
  loadSheddingEnabled: boolean;
  /** Load shedding threshold (0-1, percentage of capacity) */
  loadSheddingThreshold: number;
  /** Enable request coalescing */
  coalescingEnabled: boolean;
  /** Coalescing window (ms) */
  coalescingWindowMs: number;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: ScaleConfig = {
  maxConnections: 200,
  maxQueueDepth: 10_000,
  requestTimeoutMs: 30_000,
  loadSheddingEnabled: true,
  loadSheddingThreshold: 0.85,
  coalescingEnabled: true,
  coalescingWindowMs: 50,
};

// =============================================================================
// PRIORITY QUEUE
// =============================================================================

const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

class PriorityQueue<T> {
  private _queues: Map<Priority, QueuedRequest<T>[]> = new Map([
    ['critical', []],
    ['high', []],
    ['normal', []],
    ['low', []],
    ['background', []],
  ]);

  enqueue(request: QueuedRequest<T>): void {
    this._queues.get(request.priority)!.push(request);
  }

  dequeue(): QueuedRequest<T> | null {
    for (const priority of ['critical', 'high', 'normal', 'low', 'background'] as Priority[]) {
      const queue = this._queues.get(priority)!;
      if (queue.length > 0) {
        return queue.shift()!;
      }
    }
    return null;
  }

  get size(): number {
    let total = 0;
    for (const queue of this._queues.values()) {
      total += queue.length;
    }
    return total;
  }

  sizeByPriority(): Record<Priority, number> {
    const result: Record<Priority, number> = {
      critical: 0, high: 0, normal: 0, low: 0, background: 0,
    };
    for (const [priority, queue] of this._queues) {
      result[priority] = queue.length;
    }
    return result;
  }

  /**
   * Shed load by dropping low-priority requests.
   * Returns the number of requests dropped.
   */
  shed(targetDepth: number): number {
    let dropped = 0;
    // Drop background first, then low, then normal
    for (const priority of ['background', 'low', 'normal'] as Priority[]) {
      const queue = this._queues.get(priority)!;
      while (this.size > targetDepth && queue.length > 0) {
        const request = queue.pop()!;
        request.reject(new Error(`Load shedding: request shed (priority: ${priority})`));
        dropped++;
      }
    }
    return dropped;
  }

  /**
   * Expire timed-out requests.
   */
  expireTimedOut(): number {
    let expired = 0;
    const now = Date.now();
    for (const queue of this._queues.values()) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const req = queue[i];
        if (now - req.enqueuedAt > req.timeoutMs) {
          queue.splice(i, 1);
          req.reject(new Error('Request timed out in queue'));
          expired++;
        }
      }
    }
    return expired;
  }
}

// =============================================================================
// SLIDING WINDOW METRICS
// =============================================================================

class SlidingWindowMetrics {
  private _responseTimes: number[] = [];
  private _errors: number[] = [];
  private _timestamps: number[] = [];
  private _windowMs: number;

  constructor(windowMs: number = 60_000) {
    this._windowMs = windowMs;
  }

  recordSuccess(responseTimeMs: number): void {
    const now = Date.now();
    this._responseTimes.push(responseTimeMs);
    this._timestamps.push(now);
    this._prune();
  }

  recordError(): void {
    const now = Date.now();
    this._errors.push(now);
    this._prune();
  }

  get rps(): number {
    this._prune();
    const windowSec = this._windowMs / 1000;
    return this._timestamps.length / windowSec;
  }

  get avgResponseTime(): number {
    this._prune();
    if (this._responseTimes.length === 0) return 0;
    return this._responseTimes.reduce((a, b) => a + b, 0) / this._responseTimes.length;
  }

  get p99ResponseTime(): number {
    this._prune();
    if (this._responseTimes.length === 0) return 0;
    const sorted = [...this._responseTimes].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.99) - 1;
    return sorted[idx] ?? 0;
  }

  get errorRate(): number {
    this._prune();
    const total = this._timestamps.length + this._errors.length;
    if (total === 0) return 0;
    return this._errors.length / total;
  }

  private _prune(): void {
    const cutoff = Date.now() - this._windowMs;
    while (this._timestamps.length > 0 && this._timestamps[0] < cutoff) {
      this._timestamps.shift();
      this._responseTimes.shift();
    }
    while (this._errors.length > 0 && this._errors[0] < cutoff) {
      this._errors.shift();
    }
  }
}

// =============================================================================
// SCALE ENGINE — Main class
// =============================================================================

export class ScaleEngine {
  private _config: ScaleConfig;
  private _queue: PriorityQueue<unknown>;
  private _metrics: SlidingWindowMetrics;
  private _activeConnections = 0;
  private _totalProcessed = 0;
  private _totalShed = 0;
  private _totalCoalesced = 0;
  private _coalesceMap = new Map<string, Promise<unknown>>();
  private _processingInterval: ReturnType<typeof setInterval>;
  private _cleanupInterval: ReturnType<typeof setInterval>;
  private _idCounter = 0;

  constructor(config?: Partial<ScaleConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._queue = new PriorityQueue();
    this._metrics = new SlidingWindowMetrics();

    // Process queue continuously
    this._processingInterval = setInterval(() => this._processQueue(), 10);
    // Cleanup expired entries
    this._cleanupInterval = setInterval(() => {
      this._queue.expireTimedOut();
      this._pruneCoalesceMap();
    }, 1_000);
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Submit a request to the scale engine.
   * Handles queuing, coalescing, and back-pressure.
   */
  async submit<T>(
    handler: () => Promise<T>,
    options?: {
      priority?: Priority;
      coalesceKey?: string;
      timeoutMs?: number;
      maxRetries?: number;
    },
  ): Promise<T> {
    const priority = options?.priority ?? 'normal';
    const timeoutMs = options?.timeoutMs ?? this._config.requestTimeoutMs;

    // Check load shedding
    if (this._config.loadSheddingEnabled) {
      const load = this._calculateLoad();
      if (load >= this._config.loadSheddingThreshold && PRIORITY_WEIGHT[priority] >= 2) {
        this._totalShed++;
        throw new Error(
          `Service overloaded (load: ${(load * 100).toFixed(0)}%). ` +
          `Shedding ${priority}-priority requests. Try again shortly.`,
        );
      }
    }

    // Request coalescing
    if (this._config.coalescingEnabled && options?.coalesceKey) {
      const existing = this._coalesceMap.get(options.coalesceKey);
      if (existing) {
        this._totalCoalesced++;
        return existing as Promise<T>;
      }
    }

    // Queue the request
    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: `req_${++this._idCounter}`,
        priority,
        handler,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        timeoutMs,
        retries: 0,
        maxRetries: options?.maxRetries ?? 2,
      };

      // Check queue depth
      if (this._queue.size >= this._config.maxQueueDepth) {
        // Try to shed lower-priority requests
        const shed = this._queue.shed(this._config.maxQueueDepth * 0.8);
        this._totalShed += shed;

        if (this._queue.size >= this._config.maxQueueDepth) {
          reject(new Error('Queue full — service at maximum capacity'));
          return;
        }
      }

      this._queue.enqueue(request as QueuedRequest<unknown>);

      // Register coalesce key
      if (this._config.coalescingEnabled && options?.coalesceKey) {
        const promise = new Promise<T>((res, rej) => {
          // The actual resolve/reject will come from the queue processing
          const orig = request.resolve;
          const origReject = request.reject;
          request.resolve = (val: T) => { orig(val); res(val); };
          request.reject = (err: Error) => { origReject(err); rej(err); };
        });
        this._coalesceMap.set(options.coalesceKey, promise);
      }
    });
  }

  /**
   * Get real-time load metrics.
   */
  getMetrics(): LoadMetrics {
    const load = this._calculateLoad();
    const level: LoadMetrics['level'] =
      load < 0.5 ? 'normal' :
      load < 0.7 ? 'elevated' :
      load < 0.85 ? 'high' :
      'critical';

    return {
      rps: this._metrics.rps,
      activeConnections: this._activeConnections,
      queueDepth: this._queue.size,
      avgResponseTime: this._metrics.avgResponseTime,
      p99ResponseTime: this._metrics.p99ResponseTime,
      errorRate: this._metrics.errorRate,
      cpuEstimate: load,
      memoryMb: (process.memoryUsage?.()?.heapUsed ?? 0) / (1024 * 1024),
      level,
    };
  }

  /**
   * Get detailed statistics.
   */
  getStats(): {
    totalProcessed: number;
    totalShed: number;
    totalCoalesced: number;
    queueByPriority: Record<Priority, number>;
    activeConnections: number;
    maxConnections: number;
  } {
    return {
      totalProcessed: this._totalProcessed,
      totalShed: this._totalShed,
      totalCoalesced: this._totalCoalesced,
      queueByPriority: this._queue.sizeByPriority(),
      activeConnections: this._activeConnections,
      maxConnections: this._config.maxConnections,
    };
  }

  /**
   * Graceful shutdown — drain queue before stopping.
   */
  async shutdown(timeoutMs: number = 30_000): Promise<void> {
    clearInterval(this._processingInterval);
    clearInterval(this._cleanupInterval);

    // Wait for active connections to finish
    const start = Date.now();
    while (this._activeConnections > 0 && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 100));
    }

    // Reject remaining queued requests
    let req;
    while ((req = this._queue.dequeue())) {
      req.reject(new Error('Server shutting down'));
    }
  }

  // ===========================================================================
  // PRIVATE
  // ===========================================================================

  private async _processQueue(): Promise<void> {
    // Process as many requests as we have connection capacity
    while (this._activeConnections < this._config.maxConnections) {
      const request = this._queue.dequeue();
      if (!request) break;

      this._activeConnections++;
      this._executeRequest(request).finally(() => {
        this._activeConnections--;
      });
    }
  }

  private async _executeRequest(request: QueuedRequest<unknown>): Promise<void> {
    const start = Date.now();
    try {
      const result = await request.handler();
      const elapsed = Date.now() - start;
      this._metrics.recordSuccess(elapsed);
      this._totalProcessed++;
      request.resolve(result);
    } catch (error) {
      this._metrics.recordError();

      // Retry if allowed
      if (request.retries < request.maxRetries) {
        request.retries++;
        this._queue.enqueue(request);
        return;
      }

      this._totalProcessed++;
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private _calculateLoad(): number {
    const connectionLoad = this._activeConnections / this._config.maxConnections;
    const queueLoad = this._queue.size / this._config.maxQueueDepth;
    const errorPenalty = this._metrics.errorRate * 0.3;

    return Math.min(1, connectionLoad * 0.5 + queueLoad * 0.3 + errorPenalty);
  }

  private _pruneCoalesceMap(): void {
    // Remove completed coalesce entries
    for (const [key, promise] of this._coalesceMap) {
      // Promises that are resolved/rejected are done
      Promise.race([
        promise.then(() => true),
        new Promise(r => setTimeout(() => r(false), 0)),
      ]).then(done => {
        if (done) this._coalesceMap.delete(key);
      });
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const scaleEngine = new ScaleEngine();

/**
 * Convenience function to submit a request through the scale engine.
 */
export async function scaledFetch<T>(
  fetcher: () => Promise<T>,
  options?: {
    priority?: Priority;
    coalesceKey?: string;
    timeoutMs?: number;
  },
): Promise<T> {
  return scaleEngine.submit(fetcher, options);
}
