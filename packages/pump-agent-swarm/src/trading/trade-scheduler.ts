/**
 * Trade Scheduler — Central Trade Coordination Engine
 *
 * Coordinates timing across all trading agents, preventing conflicts,
 * managing a priority queue, and ensuring slot-aware execution.
 *
 * Features:
 * - Priority queue: critical > high > normal > low, then earliest time, then FIFO
 * - Conflict detection: same-wallet, direction, and slot-level collisions
 * - Execution windowing: groups trades into configurable windows (max 1 per wallet per window)
 * - Dependency chains: executeAfter links to deferred execution
 * - Pause/resume without losing orders
 * - Drain mode: execute all pending then stop gracefully
 */

import BN from 'bn.js';
import { randomUUID } from 'node:crypto';

import type { Connection } from '@solana/web3.js';

import type { SwarmEventBus } from '../infra/event-bus.js';
import type { TradeDirection } from '../types.js';

// ─── Types ────────────────────────────────────────────────────

export interface ScheduledOrder {
  id: string;
  agentId: string;
  walletAddress: string;
  mint: string;
  direction: TradeDirection;
  amount: BN;
  priority: 'low' | 'normal' | 'high' | 'critical';
  /** Specific timestamp (epoch ms) to execute. ASAP if undefined. */
  executeAt?: number;
  /** Execute after this schedule ID completes. */
  executeAfter?: string;
  /** Max acceptable delay from executeAt (ms). */
  maxDelayMs?: number;
  conflictPolicy: 'queue' | 'skip' | 'replace';
  metadata?: Record<string, unknown>;
}

export interface SchedulerConfig {
  /** Max simultaneous TX submissions */
  maxConcurrentTrades: number;
  /** Min gap between any two trades (ms) */
  minInterTradeDelayMs: number;
  /** Time window for grouping (ms) */
  executionWindowMs: number;
  /** Whether to detect and resolve conflicts */
  enableConflictDetection: boolean;
  /** Max orders in queue before rejecting */
  maxQueueSize: number;
  /** Auto-cancel orders older than this (ms) */
  staleOrderTimeoutMs: number;
}

export interface SchedulerStats {
  pending: number;
  executing: number;
  completed: number;
  cancelled: number;
  conflicts: number;
  avgWaitTimeMs: number;
  avgExecutionTimeMs: number;
}

// ─── Internal Types ───────────────────────────────────────────

const PRIORITY_WEIGHT: Record<ScheduledOrder['priority'], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

type OrderState = 'pending' | 'executing' | 'completed' | 'cancelled';

interface InternalOrder {
  order: ScheduledOrder;
  state: OrderState;
  enqueuedAt: number;
  executionStartedAt?: number;
  executionEndedAt?: number;
  /** Monotonic sequence counter for FIFO tie-breaking */
  seq: number;
}

// ─── Default Config ───────────────────────────────────────────

const DEFAULT_CONFIG: SchedulerConfig = {
  maxConcurrentTrades: 4,
  minInterTradeDelayMs: 400,
  executionWindowMs: 2_000,
  enableConflictDetection: true,
  maxQueueSize: 500,
  staleOrderTimeoutMs: 300_000, // 5 minutes
};

// ─── Trade Scheduler ─────────────────────────────────────────

export class TradeScheduler {
  private readonly config: SchedulerConfig;
  private readonly orders = new Map<string, InternalOrder>();
  private seq = 0;

  private running = false;
  private paused = false;
  private draining = false;
  private drainResolve: (() => void) | null = null;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastExecutionAt = 0;

  // Stats accumulators
  private completedCount = 0;
  private cancelledCount = 0;
  private conflictCount = 0;
  private totalWaitMs = 0;
  private totalExecMs = 0;
  private executingCount = 0;

  constructor(
    private readonly connection: Connection,
    private readonly eventBus: SwarmEventBus,
    config?: Partial<SchedulerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Public API ───────────────────────────────────────────

  /**
   * Add an order to the queue.
   * Returns a schedule ID that can be used to cancel or depend on this order.
   */
  schedule(order: ScheduledOrder): string {
    if (this.orders.size >= this.config.maxQueueSize) {
      throw new Error(
        `TradeScheduler: queue full (${this.config.maxQueueSize}). Cannot schedule order.`,
      );
    }

    const id = order.id || randomUUID();
    const enriched: ScheduledOrder = { ...order, id };

    // Conflict detection on schedule time
    if (this.config.enableConflictDetection) {
      const resolution = this.resolveConflicts(enriched);
      if (resolution === 'skip') {
        this.conflictCount++;
        this.emitEvent('trade-scheduler:conflict-skipped', {
          orderId: id,
          agentId: order.agentId,
          reason: 'conflict detected, policy=skip',
        });
        // Return ID but mark as cancelled immediately
        this.orders.set(id, {
          order: enriched,
          state: 'cancelled',
          enqueuedAt: Date.now(),
          seq: this.seq++,
        });
        this.cancelledCount++;
        return id;
      }
      // 'replace' handled inside resolveConflicts (cancels existing)
      // 'queue' is the default — just enqueue normally
    }

    this.orders.set(id, {
      order: enriched,
      state: 'pending',
      enqueuedAt: Date.now(),
      seq: this.seq++,
    });

    this.emitEvent('trade-scheduler:order-scheduled', {
      orderId: id,
      agentId: order.agentId,
      priority: order.priority,
      mint: order.mint,
      direction: order.direction,
    });

    return id;
  }

  /**
   * Cancel a scheduled order. Returns true if the order was found and cancelled.
   */
  cancel(scheduleId: string): boolean {
    const entry = this.orders.get(scheduleId);
    if (!entry || entry.state !== 'pending') {
      return false;
    }
    entry.state = 'cancelled';
    this.cancelledCount++;
    this.emitEvent('trade-scheduler:order-cancelled', {
      orderId: scheduleId,
      agentId: entry.order.agentId,
    });
    return true;
  }

  /**
   * Return all currently pending orders, sorted by execution priority.
   */
  getQueue(): ScheduledOrder[] {
    return this.getPendingOrders().map((e) => e.order);
  }

  /**
   * Return the next order that would be executed along with its target execution time.
   */
  getNextExecution(): { order: ScheduledOrder; executeAt: number } | null {
    const pending = this.getPendingOrders();
    if (pending.length === 0) return null;
    const next = pending[0];
    return {
      order: next.order,
      executeAt: next.order.executeAt ?? Date.now(),
    };
  }

  /**
   * Start processing the queue on a recurring tick.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.draining = false;

    // Tick every 50ms — fast enough to hit sub-second windows
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, 50);

    this.emitEvent('trade-scheduler:started', {});
  }

  /**
   * Stop the scheduler immediately. Pending orders remain in queue.
   */
  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.emitEvent('trade-scheduler:stopped', { pendingCount: this.pendingCount() });
  }

  /**
   * Pause processing without losing orders.
   */
  pause(): void {
    this.paused = true;
    this.emitEvent('trade-scheduler:paused', { pendingCount: this.pendingCount() });
  }

  /**
   * Resume processing from a paused state.
   */
  resume(): void {
    this.paused = false;
    this.emitEvent('trade-scheduler:resumed', { pendingCount: this.pendingCount() });
  }

  /**
   * Execute all pending orders then stop. Returns a promise that resolves
   * when the queue is fully drained.
   */
  drain(): Promise<void> {
    if (this.pendingCount() === 0 && this.executingCount === 0) {
      this.stop();
      return Promise.resolve();
    }

    this.draining = true;
    this.paused = false;

    // Ensure the scheduler is running so it can process the queue
    if (!this.running) {
      this.start();
      this.draining = true; // re-set after start() clears it
    }

    return new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }

  /**
   * Return current scheduler statistics.
   */
  getStats(): SchedulerStats {
    const totalCompleted = this.completedCount || 1; // avoid div-by-zero
    return {
      pending: this.pendingCount(),
      executing: this.executingCount,
      completed: this.completedCount,
      cancelled: this.cancelledCount,
      conflicts: this.conflictCount,
      avgWaitTimeMs: this.completedCount > 0
        ? Math.round(this.totalWaitMs / totalCompleted)
        : 0,
      avgExecutionTimeMs: this.completedCount > 0
        ? Math.round(this.totalExecMs / totalCompleted)
        : 0,
    };
  }

  // ─── Internal: Tick Loop ──────────────────────────────────

  private async tick(): Promise<void> {
    if (this.paused) return;

    // Prune stale orders
    this.pruneStaleOrders();

    // Check drain completion
    if (this.draining && this.pendingCount() === 0 && this.executingCount === 0) {
      this.stop();
      if (this.drainResolve) {
        const resolve = this.drainResolve;
        this.drainResolve = null;
        resolve();
      }
      return;
    }

    // Respect concurrency cap
    if (this.executingCount >= this.config.maxConcurrentTrades) return;

    // Respect inter-trade delay
    const now = Date.now();
    if (now - this.lastExecutionAt < this.config.minInterTradeDelayMs) return;

    // Find the next eligible order
    const candidate = this.pickNextCandidate(now);
    if (!candidate) return;

    // Execute
    void this.executeOrder(candidate);
  }

  /**
   * Pick the highest-priority, ready-to-execute order that has no conflicts
   * with currently executing trades.
   */
  private pickNextCandidate(now: number): InternalOrder | null {
    const pending = this.getPendingOrders();

    for (const entry of pending) {
      const order = entry.order;

      // Not yet time?
      if (order.executeAt && order.executeAt > now) continue;

      // Expired (past max delay)?
      if (order.executeAt && order.maxDelayMs) {
        if (now > order.executeAt + order.maxDelayMs) {
          entry.state = 'cancelled';
          this.cancelledCount++;
          this.emitEvent('trade-scheduler:order-expired', {
            orderId: order.id,
            agentId: order.agentId,
          });
          continue;
        }
      }

      // Dependency not yet complete?
      if (order.executeAfter) {
        const dep = this.orders.get(order.executeAfter);
        if (!dep || dep.state !== 'completed') continue;
      }

      // Conflict check with currently executing orders
      if (this.config.enableConflictDetection && this.hasActiveConflict(order)) {
        continue;
      }

      // Execution windowing — max 1 trade per wallet per window
      if (this.violatesExecutionWindow(order, now)) {
        continue;
      }

      return entry;
    }

    return null;
  }

  /**
   * Execute a single order. Marks it executing, simulates TX submission,
   * and tracks stats.
   */
  private async executeOrder(entry: InternalOrder): Promise<void> {
    const now = Date.now();
    entry.state = 'executing';
    entry.executionStartedAt = now;
    this.executingCount++;
    this.lastExecutionAt = now;

    const waitMs = now - entry.enqueuedAt;

    this.emitEvent('trade-scheduler:order-executing', {
      orderId: entry.order.id,
      agentId: entry.order.agentId,
      direction: entry.order.direction,
      mint: entry.order.mint,
      waitMs,
    });

    try {
      // Fetch a recent blockhash to validate liveness.
      // The actual trade execution is handled by the agent that submitted
      // the order — the scheduler's job is coordination and timing.
      await this.connection.getLatestBlockhash('confirmed');

      const execMs = Date.now() - now;
      entry.state = 'completed';
      entry.executionEndedAt = Date.now();
      this.completedCount++;
      this.totalWaitMs += waitMs;
      this.totalExecMs += execMs;

      this.emitEvent('trade-scheduler:order-completed', {
        orderId: entry.order.id,
        agentId: entry.order.agentId,
        direction: entry.order.direction,
        execMs,
        waitMs,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      entry.state = 'cancelled';
      entry.executionEndedAt = Date.now();
      this.cancelledCount++;

      this.emitEvent('trade-scheduler:order-failed', {
        orderId: entry.order.id,
        agentId: entry.order.agentId,
        error: message,
      });
    } finally {
      this.executingCount--;
    }
  }

  // ─── Internal: Priority Queue ─────────────────────────────

  /**
   * Return all pending orders sorted by priority queue rules:
   * 1. Priority weight (critical=0 < low=3)
   * 2. Scheduled time (earliest first; ASAP treated as 0)
   * 3. FIFO sequence for ties
   */
  private getPendingOrders(): InternalOrder[] {
    const pending: InternalOrder[] = [];
    for (const entry of this.orders.values()) {
      if (entry.state === 'pending') {
        pending.push(entry);
      }
    }

    pending.sort((a, b) => {
      // Priority first
      const pa = PRIORITY_WEIGHT[a.order.priority];
      const pb = PRIORITY_WEIGHT[b.order.priority];
      if (pa !== pb) return pa - pb;

      // Then scheduled time (ASAP → 0)
      const ta = a.order.executeAt ?? 0;
      const tb = b.order.executeAt ?? 0;
      if (ta !== tb) return ta - tb;

      // Then FIFO
      return a.seq - b.seq;
    });

    return pending;
  }

  // ─── Internal: Conflict Resolution ────────────────────────

  /**
   * Called at schedule time. Checks whether the new order conflicts with
   * existing pending/executing orders and applies the conflict policy.
   *
   * Returns the effective policy action: 'queue' (proceed normally),
   * 'skip' (drop this order), or 'queue' after replacing existing.
   */
  private resolveConflicts(
    order: ScheduledOrder,
  ): 'queue' | 'skip' {
    const conflicting = this.findConflicting(order);
    if (conflicting.length === 0) return 'queue';

    this.conflictCount++;

    switch (order.conflictPolicy) {
      case 'skip':
        return 'skip';

      case 'replace':
        // Cancel all conflicting pending orders
        for (const existing of conflicting) {
          if (existing.state === 'pending') {
            existing.state = 'cancelled';
            this.cancelledCount++;
            this.emitEvent('trade-scheduler:order-replaced', {
              replacedOrderId: existing.order.id,
              replacedByOrderId: order.id,
            });
          }
        }
        return 'queue';

      case 'queue':
      default:
        // Just enqueue — conflicts will be resolved at execution time
        return 'queue';
    }
  }

  /**
   * Find orders that conflict with the given order.
   *
   * Conflict conditions:
   * - Same wallet: can't submit two TXs from same wallet simultaneously
   * - Direction collision: two agents buying at the exact same moment spikes price
   */
  private findConflicting(order: ScheduledOrder): InternalOrder[] {
    const results: InternalOrder[] = [];

    for (const entry of this.orders.values()) {
      if (entry.order.id === order.id) continue;
      if (entry.state !== 'pending' && entry.state !== 'executing') continue;

      // Same wallet conflict
      if (entry.order.walletAddress === order.walletAddress) {
        results.push(entry);
        continue;
      }

      // Same mint + same direction at overlapping time window → price spike risk
      if (
        entry.order.mint === order.mint &&
        entry.order.direction === order.direction
      ) {
        const entryTime = entry.order.executeAt ?? 0;
        const orderTime = order.executeAt ?? 0;
        const window = this.config.executionWindowMs;
        if (Math.abs(entryTime - orderTime) < window) {
          results.push(entry);
        }
      }
    }

    return results;
  }

  /**
   * Check whether an order conflicts with any *currently executing* order.
   * Used at execution-time to prevent same-wallet collisions.
   */
  private hasActiveConflict(order: ScheduledOrder): boolean {
    for (const entry of this.orders.values()) {
      if (entry.state !== 'executing') continue;

      // Same wallet — absolute conflict
      if (entry.order.walletAddress === order.walletAddress) {
        return true;
      }

      // Same mint + direction — slot conflict (space them out)
      if (
        entry.order.mint === order.mint &&
        entry.order.direction === order.direction
      ) {
        return true;
      }
    }
    return false;
  }

  // ─── Internal: Execution Windowing ────────────────────────

  /**
   * Enforce max 1 trade per wallet per execution window.
   * Looks at recently completed orders for the same wallet.
   */
  private violatesExecutionWindow(order: ScheduledOrder, now: number): boolean {
    const windowStart = now - this.config.executionWindowMs;

    for (const entry of this.orders.values()) {
      if (entry.order.walletAddress !== order.walletAddress) continue;
      if (entry.state !== 'completed' && entry.state !== 'executing') continue;

      const execTime = entry.executionStartedAt ?? 0;
      if (execTime >= windowStart) {
        return true;
      }
    }

    return false;
  }

  // ─── Internal: Stale Order Pruning ────────────────────────

  /**
   * Auto-cancel pending orders that exceed the stale timeout.
   */
  private pruneStaleOrders(): void {
    const cutoff = Date.now() - this.config.staleOrderTimeoutMs;

    for (const entry of this.orders.values()) {
      if (entry.state !== 'pending') continue;
      if (entry.enqueuedAt < cutoff) {
        entry.state = 'cancelled';
        this.cancelledCount++;
        this.emitEvent('trade-scheduler:order-stale', {
          orderId: entry.order.id,
          agentId: entry.order.agentId,
          ageMs: Date.now() - entry.enqueuedAt,
        });
      }
    }
  }

  // ─── Internal: Helpers ────────────────────────────────────

  private pendingCount(): number {
    let count = 0;
    for (const entry of this.orders.values()) {
      if (entry.state === 'pending') count++;
    }
    return count;
  }

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    this.eventBus.emit(type, 'trading', 'trade-scheduler', payload);
  }
}
