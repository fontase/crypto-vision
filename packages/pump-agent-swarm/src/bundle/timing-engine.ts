/**
 * Precision Timing Engine for Coordinated Agent Actions
 *
 * Tracks Solana slot boundaries in real-time and coordinates multi-agent
 * transaction submission within narrow timing windows. Critical for bundle
 * buys where all agents must submit within the same 1-2 slots.
 */

import { Connection, type SlotChangeCallback } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';
import { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SlotTracker {
  currentSlot: number;
  slotHistory: Array<{ slot: number; timestamp: number }>;
  avgSlotTime: number;
  slotTimeVariance: number;
  lastUpdate: number;
}

export interface SyncResult {
  synchronized: boolean;
  readyAgents: string[];
  notReadyAgents: string[];
  syncTime: number;
  targetSlot: number;
}

export interface SubmissionWindow {
  submitAt: number;
  targetSlot: number;
  latencyBuffer: number;
  windowSize: number;
  confidence: number;
}

export interface LatencyReport {
  rpcLatency: number;
  slotSubscriptionDelay: number;
  estimatedSubmissionOverhead: number;
  recommendedLeadTime: number;
}

export interface TimingCountdown {
  id: string;
  targetSlot: number;
  executeAt: number;
  status: 'waiting' | 'executing' | 'completed' | 'missed';
  cancel(): void;
  onExecute: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default Solana slot time in ms (~400ms) */
const DEFAULT_SLOT_TIME_MS = 400;

/** Rolling window size for slot history */
const SLOT_HISTORY_SIZE = 100;

/** Number of getSlot pings for latency calibration */
const LATENCY_SAMPLE_COUNT = 5;

/** Minimum valid slot time to filter outliers (ms) */
const MIN_SLOT_TIME_MS = 50;

/** Maximum valid slot time to filter outliers (ms) */
const MAX_SLOT_TIME_MS = 2000;

/** Default synchronisation timeout (ms) */
const DEFAULT_SYNC_TIMEOUT_MS = 10_000;

/** Calibration interval (ms) — re-measure latency every 60s */
const CALIBRATION_INTERVAL_MS = 60_000;

/** Drift-correction threshold (ms) — re-schedule if timer drifted > this */
const DRIFT_CORRECTION_THRESHOLD_MS = 50;

// ---------------------------------------------------------------------------
// TimingEngine
// ---------------------------------------------------------------------------

export class TimingEngine {
  private readonly connection: Connection;
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;

  private tracker: SlotTracker = {
    currentSlot: 0,
    slotHistory: [],
    avgSlotTime: DEFAULT_SLOT_TIME_MS,
    slotTimeVariance: 0,
    lastUpdate: 0,
  };

  /** Latest latency report from calibration */
  private latencySnapshot: LatencyReport = {
    rpcLatency: 0,
    slotSubscriptionDelay: 0,
    estimatedSubmissionOverhead: 0,
    recommendedLeadTime: 0,
  };

  /** Active slot subscription id (for cleanup) */
  private slotSubscriptionId: number | null = null;

  /** External subscriber callbacks keyed by subscription id */
  private slotSubscribers = new Map<string, (slot: number) => void>();

  /** Active countdowns keyed by id */
  private countdowns = new Map<string, { timer: ReturnType<typeof setTimeout>; countdown: TimingCountdown }>();

  /** Pending agent-ready promises for synchronisation */
  private pendingSyncs = new Map<
    string,
    {
      agentIds: string[];
      readySet: Set<string>;
      resolve: (result: SyncResult) => void;
      timer: ReturnType<typeof setTimeout>;
      startedAt: number;
    }
  >();

  /** Event bus subscription ids to clean up on destroy */
  private busSubscriptions: string[] = [];

  /** Calibration interval handle */
  private calibrationTimer: ReturnType<typeof setInterval> | null = null;

  private destroyed = false;

  constructor(connection: Connection, eventBus: SwarmEventBus) {
    this.connection = connection;
    this.eventBus = eventBus;
    this.logger = SwarmLogger.create('timing-engine', 'bundle');
    this.logger.setPhase('init');

    this.startSlotSubscription();
    this.listenForAgentReady();
    this.startCalibrationLoop();

    this.logger.info('TimingEngine initialised');
  }

  // -----------------------------------------------------------------------
  // Public API — Slot queries
  // -----------------------------------------------------------------------

  /** Fetch the current confirmed slot from RPC */
  async getCurrentSlot(): Promise<number> {
    const slot = await this.connection.getSlot('confirmed');
    return slot;
  }

  /** Return the rolling-average milliseconds per slot */
  async getSlotTime(): Promise<number> {
    if (this.tracker.slotHistory.length < 2) {
      // Not enough data yet — do a quick measurement
      const start = Date.now();
      const slot1 = await this.connection.getSlot('confirmed');
      // Wait a few slots
      await this.sleep(DEFAULT_SLOT_TIME_MS * 3);
      const slot2 = await this.connection.getSlot('confirmed');
      const elapsed = Date.now() - start;
      const slotDiff = slot2 - slot1;
      if (slotDiff > 0) {
        return elapsed / slotDiff;
      }
      return DEFAULT_SLOT_TIME_MS;
    }
    return this.tracker.avgSlotTime;
  }

  /** Estimate milliseconds until a target slot, using current slot speed */
  estimateSlotArrival(targetSlot: number): number {
    const slotsAway = targetSlot - this.tracker.currentSlot;
    if (slotsAway <= 0) return 0;
    return slotsAway * this.tracker.avgSlotTime;
  }

  // -----------------------------------------------------------------------
  // Public API — Waiting helpers
  // -----------------------------------------------------------------------

  /** Await a specific slot. Resolves with the actual slot reached. */
  async waitForSlot(targetSlot: number, timeoutMs = 30_000): Promise<number> {
    if (this.tracker.currentSlot >= targetSlot) {
      return this.tracker.currentSlot;
    }

    return new Promise<number>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      const subId = this.subscribeToSlots((slot) => {
        if (slot >= targetSlot) {
          cleanup();
          resolve(slot);
        }
      });

      const timer = setInterval(() => {
        if (Date.now() >= deadline) {
          cleanup();
          reject(new Error(`waitForSlot: timeout waiting for slot ${targetSlot}, current=${this.tracker.currentSlot}`));
        }
      }, 500);

      const cleanup = (): void => {
        subId();
        clearInterval(timer);
      };
    });
  }

  /** Await the next slot boundary. Resolves with the new slot number. */
  async waitForNextSlot(): Promise<number> {
    const current = this.tracker.currentSlot || (await this.getCurrentSlot());
    return this.waitForSlot(current + 1);
  }

  // -----------------------------------------------------------------------
  // Public API — Countdown
  // -----------------------------------------------------------------------

  /** Schedule a callback to execute at (or just before) a target slot */
  createCountdown(executeAtSlot: number, callback: () => Promise<void>): TimingCountdown {
    const id = uuidv4();

    const countdown: TimingCountdown = {
      id,
      targetSlot: executeAtSlot,
      executeAt: Date.now() + this.estimateSlotArrival(executeAtSlot),
      status: 'waiting',
      cancel: () => this.cancelCountdown(id),
      onExecute: callback,
    };

    this.scheduleCountdown(countdown);
    return countdown;
  }

  // -----------------------------------------------------------------------
  // Public API — Agent synchronisation
  // -----------------------------------------------------------------------

  /**
   * Coordinate N agents to be ready simultaneously.
   * Each agent must emit `agent:ready` with its id via the event bus.
   * Resolves when all agents have signalled ready or timeout is reached.
   */
  async synchronizeAgents(agentIds: string[], readyTimeout: number = DEFAULT_SYNC_TIMEOUT_MS): Promise<SyncResult> {
    if (agentIds.length === 0) {
      return {
        synchronized: true,
        readyAgents: [],
        notReadyAgents: [],
        syncTime: 0,
        targetSlot: this.tracker.currentSlot,
      };
    }

    const syncId = uuidv4();
    const startedAt = Date.now();

    this.logger.info('Starting agent synchronisation', {
      syncId,
      agentCount: agentIds.length,
      timeoutMs: readyTimeout,
    });

    // Broadcast sync request so agents know to signal ready
    this.eventBus.emit('agents:sync-request', 'coordination', 'timing-engine', {
      syncId,
      agentIds,
      readyTimeout,
    });

    return new Promise<SyncResult>((resolve) => {
      const readySet = new Set<string>();

      const timer = setTimeout(() => {
        this.pendingSyncs.delete(syncId);
        const notReady = agentIds.filter((id) => !readySet.has(id));
        const result: SyncResult = {
          synchronized: false,
          readyAgents: [...readySet],
          notReadyAgents: notReady,
          syncTime: Date.now() - startedAt,
          targetSlot: this.tracker.currentSlot,
        };
        this.logger.warn('Agent synchronisation timed out', { syncId, result });
        this.eventBus.emit('agents:sync-timeout', 'coordination', 'timing-engine', result);
        resolve(result);
      }, readyTimeout);

      this.pendingSyncs.set(syncId, {
        agentIds,
        readySet,
        resolve: (result: SyncResult) => {
          clearTimeout(timer);
          this.pendingSyncs.delete(syncId);
          resolve(result);
        },
        timer,
        startedAt,
      });
    });
  }

  // -----------------------------------------------------------------------
  // Public API — Slot subscription
  // -----------------------------------------------------------------------

  /** Subscribe to slot updates. Returns an unsubscribe function. */
  subscribeToSlots(callback: (slot: number) => void): () => void {
    const subId = uuidv4();
    this.slotSubscribers.set(subId, callback);
    return () => {
      this.slotSubscribers.delete(subId);
    };
  }

  // -----------------------------------------------------------------------
  // Public API — Latency measurement
  // -----------------------------------------------------------------------

  /** Measure RPC round-trip latency and slot notification delay */
  async measureLatency(): Promise<LatencyReport> {
    this.logger.debug('Measuring RPC latency');

    // 1. RPC round-trip latency via timed getSlot calls
    const rpcSamples: number[] = [];
    for (let i = 0; i < LATENCY_SAMPLE_COUNT; i++) {
      const start = performance.now();
      await this.connection.getSlot('confirmed');
      rpcSamples.push(performance.now() - start);
    }
    const rpcLatency = rpcSamples.reduce((a, b) => a + b, 0) / rpcSamples.length;

    // 2. Slot subscription delay: compare when we receive a slot notification
    //    to when the RPC reports that slot as current.
    let slotSubscriptionDelay = 0;
    if (this.tracker.slotHistory.length >= 2) {
      // Use the delta between consecutive slot timestamps vs expected slot time
      const recent = this.tracker.slotHistory.slice(-10);
      const deltas: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        const slotGap = recent[i].slot - recent[i - 1].slot;
        const timeGap = recent[i].timestamp - recent[i - 1].timestamp;
        if (slotGap > 0) {
          const expectedTime = slotGap * this.tracker.avgSlotTime;
          deltas.push(Math.abs(timeGap - expectedTime));
        }
      }
      slotSubscriptionDelay = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    }

    // 3. Estimated submission overhead = RPC latency + some processing buffer
    const estimatedSubmissionOverhead = rpcLatency * 1.5;

    // 4. Recommended lead time: send TX this many ms before target slot boundary
    const recommendedLeadTime = rpcLatency + estimatedSubmissionOverhead + slotSubscriptionDelay;

    const report: LatencyReport = {
      rpcLatency: Math.round(rpcLatency * 100) / 100,
      slotSubscriptionDelay: Math.round(slotSubscriptionDelay * 100) / 100,
      estimatedSubmissionOverhead: Math.round(estimatedSubmissionOverhead * 100) / 100,
      recommendedLeadTime: Math.round(recommendedLeadTime * 100) / 100,
    };

    this.latencySnapshot = report;
    this.logger.info('Latency report', { report });
    return report;
  }

  // -----------------------------------------------------------------------
  // Public API — Submission window
  // -----------------------------------------------------------------------

  /** Calculate the optimal window for submitting a TX to land in targetSlot */
  getOptimalSubmissionWindow(targetSlot: number): SubmissionWindow {
    const slotsAway = targetSlot - this.tracker.currentSlot;
    const arrivalMs = this.estimateSlotArrival(targetSlot);
    const now = Date.now();

    const latencyBuffer = this.latencySnapshot.recommendedLeadTime || this.latencySnapshot.rpcLatency * 2.5 || 200;

    // Submit this far ahead of the target slot boundary
    const submitAt = now + arrivalMs - latencyBuffer;

    // Window size: how long the valid submission range is
    // Generally about 1 slot time minus latency buffer
    const windowSize = Math.max(this.tracker.avgSlotTime - latencyBuffer, 50);

    // Confidence degrades with slot distance and high variance
    let confidence = 1.0;
    if (slotsAway > 10) {
      confidence -= (slotsAway - 10) * 0.02;
    }
    if (this.tracker.slotTimeVariance > this.tracker.avgSlotTime * 0.3) {
      confidence -= 0.15;
    }
    if (this.latencySnapshot.rpcLatency > 500) {
      confidence -= 0.1;
    }
    confidence = Math.max(0, Math.min(1, confidence));

    return {
      submitAt,
      targetSlot,
      latencyBuffer: Math.round(latencyBuffer * 100) / 100,
      windowSize: Math.round(windowSize * 100) / 100,
      confidence: Math.round(confidence * 1000) / 1000,
    };
  }

  // -----------------------------------------------------------------------
  // Public API — Cleanup
  // -----------------------------------------------------------------------

  /** Tear down all subscriptions and timers */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.logger.info('Destroying TimingEngine');

    // Unsubscribe from slot changes
    if (this.slotSubscriptionId !== null) {
      this.connection.removeSlotChangeListener(this.slotSubscriptionId).catch(() => {
        // ignore cleanup errors
      });
      this.slotSubscriptionId = null;
    }

    // Cancel all countdowns
    for (const [id, entry] of this.countdowns) {
      clearTimeout(entry.timer);
      entry.countdown.status = 'missed';
      this.countdowns.delete(id);
    }

    // Clear pending syncs
    for (const [, sync] of this.pendingSyncs) {
      clearTimeout(sync.timer);
    }
    this.pendingSyncs.clear();

    // Unsubscribe from event bus
    for (const subId of this.busSubscriptions) {
      this.eventBus.unsubscribe(subId);
    }
    this.busSubscriptions = [];

    // Clear calibration timer
    if (this.calibrationTimer !== null) {
      clearInterval(this.calibrationTimer);
      this.calibrationTimer = null;
    }

    // Clear external subscribers
    this.slotSubscribers.clear();

    this.logger.info('TimingEngine destroyed');
  }

  // -----------------------------------------------------------------------
  // Internals — Slot subscription
  // -----------------------------------------------------------------------

  private startSlotSubscription(): void {
    const handler: SlotChangeCallback = (slotInfo) => {
      const now = Date.now();
      const { slot } = slotInfo;

      // Skip if slot went backwards (shouldn't happen but be defensive)
      if (slot <= this.tracker.currentSlot && this.tracker.currentSlot !== 0) {
        return;
      }

      // Detect slot skips
      if (this.tracker.currentSlot > 0 && slot > this.tracker.currentSlot + 1) {
        const skipped = slot - this.tracker.currentSlot - 1;
        this.logger.warn('Slot skip detected', { skipped, from: this.tracker.currentSlot, to: slot });
        this.eventBus.emit('timing:slot-skip', 'system', 'timing-engine', {
          skipped,
          fromSlot: this.tracker.currentSlot,
          toSlot: slot,
        });
      }

      this.tracker.currentSlot = slot;
      this.tracker.lastUpdate = now;

      // Append to history
      this.tracker.slotHistory.push({ slot, timestamp: now });
      if (this.tracker.slotHistory.length > SLOT_HISTORY_SIZE) {
        this.tracker.slotHistory.shift();
      }

      // Recalculate rolling avg and variance
      this.recalculateSlotStats();

      // Notify external subscribers
      for (const cb of this.slotSubscribers.values()) {
        try {
          cb(slot);
        } catch (err) {
          this.logger.error('Slot subscriber threw', err instanceof Error ? err : new Error(String(err)));
        }
      }

      // Check countdowns
      this.evaluateCountdowns(slot);
    };

    this.slotSubscriptionId = this.connection.onSlotChange(handler);
  }

  private recalculateSlotStats(): void {
    const history = this.tracker.slotHistory;
    if (history.length < 2) return;

    const deltas: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const slotGap = history[i].slot - history[i - 1].slot;
      const timeGap = history[i].timestamp - history[i - 1].timestamp;
      if (slotGap > 0) {
        const perSlot = timeGap / slotGap;
        // Filter extreme outliers
        if (perSlot >= MIN_SLOT_TIME_MS && perSlot <= MAX_SLOT_TIME_MS) {
          deltas.push(perSlot);
        }
      }
    }

    if (deltas.length === 0) return;

    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance = deltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / deltas.length;

    this.tracker.avgSlotTime = Math.round(mean * 100) / 100;
    this.tracker.slotTimeVariance = Math.round(Math.sqrt(variance) * 100) / 100;
  }

  // -----------------------------------------------------------------------
  // Internals — Agent synchronisation
  // -----------------------------------------------------------------------

  private listenForAgentReady(): void {
    const subId = this.eventBus.subscribe('agent:ready', (event) => {
      const agentId = event.payload?.agentId as string | undefined;
      const syncId = event.payload?.syncId as string | undefined;

      if (!agentId) return;

      // Signal all matching pending syncs (or a specific syncId if provided)
      for (const [key, sync] of this.pendingSyncs) {
        if (syncId && syncId !== key) continue;
        if (!sync.agentIds.includes(agentId)) continue;

        sync.readySet.add(agentId);
        this.logger.debug('Agent ready', { agentId, syncId: key, ready: sync.readySet.size, total: sync.agentIds.length });

        if (sync.readySet.size === sync.agentIds.length) {
          const result: SyncResult = {
            synchronized: true,
            readyAgents: [...sync.readySet],
            notReadyAgents: [],
            syncTime: Date.now() - sync.startedAt,
            targetSlot: this.tracker.currentSlot,
          };

          this.logger.info('All agents synchronised', { syncId: key, result });
          this.eventBus.emit('agents:synchronized', 'coordination', 'timing-engine', result);
          sync.resolve(result);
        }
      }
    });

    this.busSubscriptions.push(subId);
  }

  // -----------------------------------------------------------------------
  // Internals — Countdown scheduling
  // -----------------------------------------------------------------------

  private scheduleCountdown(countdown: TimingCountdown): void {
    const now = Date.now();
    const msUntilExecution = countdown.executeAt - now;

    // If the target slot already passed, mark as missed
    if (this.tracker.currentSlot >= countdown.targetSlot && this.tracker.currentSlot > 0) {
      countdown.status = 'missed';
      this.logger.warn('Countdown target slot already passed', {
        id: countdown.id,
        targetSlot: countdown.targetSlot,
        currentSlot: this.tracker.currentSlot,
      });
      this.eventBus.emit('timing:countdown-missed', 'bundle', 'timing-engine', {
        countdownId: countdown.id,
        targetSlot: countdown.targetSlot,
        currentSlot: this.tracker.currentSlot,
      });
      return;
    }

    const delay = Math.max(0, msUntilExecution);

    const timer = setTimeout(() => {
      this.executeCountdown(countdown);
    }, delay);

    this.countdowns.set(countdown.id, { timer, countdown });
  }

  private executeCountdown(countdown: TimingCountdown): void {
    // Drift correction: check if we're still on time
    const now = Date.now();
    const drift = now - countdown.executeAt;

    // If we fired too early (shouldn't happen with setTimeout, but be safe)
    if (drift < -DRIFT_CORRECTION_THRESHOLD_MS) {
      this.logger.debug('Countdown fired early, rescheduling', { id: countdown.id, driftMs: drift });
      countdown.executeAt = now + Math.abs(drift);
      this.scheduleCountdown(countdown);
      return;
    }

    // If target slot already passed
    if (this.tracker.currentSlot > countdown.targetSlot) {
      countdown.status = 'missed';
      this.logger.warn('Countdown missed — slot passed during drift correction', {
        id: countdown.id,
        targetSlot: countdown.targetSlot,
        currentSlot: this.tracker.currentSlot,
      });
      this.eventBus.emit('timing:countdown-missed', 'bundle', 'timing-engine', {
        countdownId: countdown.id,
        targetSlot: countdown.targetSlot,
        currentSlot: this.tracker.currentSlot,
      });
      this.countdowns.delete(countdown.id);
      return;
    }

    countdown.status = 'executing';
    this.logger.info('Executing countdown', {
      id: countdown.id,
      targetSlot: countdown.targetSlot,
      currentSlot: this.tracker.currentSlot,
      driftMs: Math.round(drift),
    });

    countdown
      .onExecute()
      .then(() => {
        countdown.status = 'completed';
        this.eventBus.emit('timing:countdown-executed', 'bundle', 'timing-engine', {
          countdownId: countdown.id,
          targetSlot: countdown.targetSlot,
          executedAtSlot: this.tracker.currentSlot,
          driftMs: Math.round(drift),
        });
      })
      .catch((err: unknown) => {
        countdown.status = 'missed';
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error('Countdown callback failed', error, {
          id: countdown.id,
          targetSlot: countdown.targetSlot,
        });
        this.eventBus.emit('timing:countdown-failed', 'bundle', 'timing-engine', {
          countdownId: countdown.id,
          error: error.message,
        });
      })
      .finally(() => {
        this.countdowns.delete(countdown.id);
      });
  }

  private evaluateCountdowns(currentSlot: number): void {
    for (const [id, entry] of this.countdowns) {
      const { countdown } = entry;
      if (countdown.status !== 'waiting') continue;

      // Recalculate executeAt with updated slot data
      const revisedArrival = this.estimateSlotArrival(countdown.targetSlot);
      const revisedExecuteAt = Date.now() + revisedArrival - (this.latencySnapshot.recommendedLeadTime || 0);

      if (currentSlot >= countdown.targetSlot) {
        // Slot already arrived — execute immediately if still waiting
        clearTimeout(entry.timer);
        this.executeCountdown(countdown);
      } else if (Math.abs(revisedExecuteAt - countdown.executeAt) > DRIFT_CORRECTION_THRESHOLD_MS) {
        // Drift correction: reschedule with updated estimate
        clearTimeout(entry.timer);
        countdown.executeAt = revisedExecuteAt;
        const delay = Math.max(0, revisedExecuteAt - Date.now());
        entry.timer = setTimeout(() => this.executeCountdown(countdown), delay);
        this.countdowns.set(id, entry);
      }
    }
  }

  private cancelCountdown(id: string): void {
    const entry = this.countdowns.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.countdown.status = 'missed';
    this.countdowns.delete(id);
    this.logger.debug('Countdown cancelled', { id });
  }

  // -----------------------------------------------------------------------
  // Internals — Calibration loop
  // -----------------------------------------------------------------------

  private startCalibrationLoop(): void {
    // Initial calibration after a short warm-up
    const initialTimer = setTimeout(() => {
      if (!this.destroyed) {
        this.measureLatency().catch((err: unknown) => {
          this.logger.error('Initial calibration failed', err instanceof Error ? err : new Error(String(err)));
        });
      }
    }, 2000);

    this.calibrationTimer = setInterval(() => {
      if (!this.destroyed) {
        this.measureLatency().catch((err: unknown) => {
          this.logger.error('Calibration tick failed', err instanceof Error ? err : new Error(String(err)));
        });
      }
    }, CALIBRATION_INTERVAL_MS);

    // Store the initial timer so destroy can clean it up (overwrite is fine;
    // the interval is the important one to clear).
    // We also stash initial timer as a one-shot that auto-cleans.
    const _ref = initialTimer; // prevent unused-var lint
    void _ref;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
