/**
 * Crypto Vision — Request Queue
 *
 * Bounded concurrency queue for expensive operations (AI / LLM calls).
 * Prevents a traffic spike from simultaneously launching thousands of
 * LLM requests — which would blow API rate limits and cost budgets.
 *
 * At 10M+ users, hundreds of concurrent AI requests are expected.
 * This queue ensures at most `concurrency` run in parallel, with
 * the rest waiting in a FIFO queue (bounded by `maxQueue`).
 */

import { logger } from "./logger.js";
import { queueDepth, queueTasksTotal, queueTaskDurationSeconds } from "./metrics.js";

export interface QueueConfig {
  /** Max concurrent executions (default: 10) */
  concurrency: number;
  /** Max queued items; beyond this, new requests are rejected (default: 500) */
  maxQueue: number;
  /** Timeout per task in ms (default: 30_000) */
  timeout: number;
}

export interface QueueMetrics {
  /** Total tasks executed successfully */
  totalExecuted: number;
  /** Total tasks rejected (queue full) */
  totalRejected: number;
  /** Total tasks that timed out */
  totalTimedOut: number;
  /** Cumulative wait time in ms (divide by totalExecuted for avg) */
  totalWaitMs: number;
  /** Peak concurrent tasks observed */
  peakConcurrent: number;
}

export class RequestQueue {
  private running = 0;
  private queue: Array<{
    resolve: (value: void) => void;
    reject: (error: Error) => void;
    enqueued: number;
  }> = [];
  private config: QueueConfig;
  readonly name: string;
  private metrics: QueueMetrics = {
    totalExecuted: 0,
    totalRejected: 0,
    totalTimedOut: 0,
    totalWaitMs: 0,
    peakConcurrent: 0,
  };

  constructor(config: Partial<QueueConfig> & { name?: string } = {}) {
    this.name = config.name ?? "unnamed";
    this.config = {
      concurrency: config.concurrency ?? 10,
      maxQueue: config.maxQueue ?? 500,
      timeout: config.timeout ?? 30_000,
    };
  }

  /**
   * Execute `fn` with bounded concurrency.
   * Waits in queue if at capacity. Rejects if queue is full.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const waitStart = Date.now();
    await this.acquire();
    this.metrics.totalWaitMs += Date.now() - waitStart;
    if (this.running > this.metrics.peakConcurrent) {
      this.metrics.peakConcurrent = this.running;
    }
    queueDepth.set({ queue_name: this.name }, this.running + this.queue.length);

    const execStart = Date.now();
    try {
      // Wrap with timeout
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Queue task timeout")),
            this.config.timeout,
          );
          // Prevent timer from keeping the process alive
          if (typeof timer === "object" && "unref" in timer) timer.unref();
        }),
      ]);
      this.metrics.totalExecuted++;
      queueTasksTotal.inc({ queue_name: this.name, result: "success" });
      queueTaskDurationSeconds.observe({ queue_name: this.name }, (Date.now() - execStart) / 1000);
      return result;
    } catch (err) {
      if (err instanceof Error && err.message === "Queue task timeout") {
        this.metrics.totalTimedOut++;
        queueTasksTotal.inc({ queue_name: this.name, result: "timeout" });
      } else {
        queueTasksTotal.inc({ queue_name: this.name, result: "error" });
      }
      queueTaskDurationSeconds.observe({ queue_name: this.name }, (Date.now() - execStart) / 1000);
      throw err;
    } finally {
      this.release();
      queueDepth.set({ queue_name: this.name }, this.running + this.queue.length);
    }
  }

  private async acquire(): Promise<void> {
    if (this.running < this.config.concurrency) {
      this.running++;
      return;
    }

    if (this.queue.length >= this.config.maxQueue) {
      this.metrics.totalRejected++;
      queueTasksTotal.inc({ queue_name: this.name, result: "rejected" });
      throw new QueueFullError(this.config.maxQueue);
    }

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject, enqueued: Date.now() });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // Check if this waiter has been in the queue too long
      if (Date.now() - next.enqueued > this.config.timeout) {
        next.reject(new Error("Queued too long — timeout"));
        this.release(); // try next in queue
        return;
      }
      next.resolve();
    } else {
      this.running--;
    }
  }

  /** Stats for monitoring */
  stats() {
    const avgWaitMs = this.metrics.totalExecuted > 0
      ? Math.round(this.metrics.totalWaitMs / this.metrics.totalExecuted)
      : 0;
    return {
      name: this.name,
      running: this.running,
      queued: this.queue.length,
      concurrency: this.config.concurrency,
      maxQueue: this.config.maxQueue,
      totalExecuted: this.metrics.totalExecuted,
      totalRejected: this.metrics.totalRejected,
      totalTimedOut: this.metrics.totalTimedOut,
      avgWaitMs,
      peakConcurrent: this.metrics.peakConcurrent,
    };
  }
}

export class QueueFullError extends Error {
  public status = 503;
  constructor(maxQueue: number) {
    super(`Service busy — ${maxQueue} requests queued. Try again shortly.`);
    this.name = "QueueFullError";
  }
}

// ─── Shared Queues ───────────────────────────────────────────

/** Queue for AI/LLM operations — most expensive */
export const aiQueue = new RequestQueue({
  name: "ai",
  concurrency: Number(process.env.AI_CONCURRENCY || 50),
  maxQueue: Number(process.env.AI_MAX_QUEUE || 2000),
  timeout: 60_000,
});

/** Queue for heavy upstream fetches (e.g. DeFiLlama protocols list) */
export const heavyFetchQueue = new RequestQueue({
  name: "heavyFetch",
  concurrency: Number(process.env.HEAVY_FETCH_CONCURRENCY || 40),
  maxQueue: 2000,
  timeout: 15_000,
});

logger.info(
  { aiConcurrency: aiQueue.stats().concurrency, heavyConcurrency: heavyFetchQueue.stats().concurrency },
  "Request queues initialized",
);
