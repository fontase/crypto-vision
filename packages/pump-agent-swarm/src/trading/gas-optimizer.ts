/**
 * Gas Optimizer — Dynamic Solana Priority Fee & Compute Budget Manager
 *
 * Dynamically optimizes Solana transaction priority fees and compute budgets
 * based on real-time network conditions, balancing speed of inclusion vs cost.
 *
 * Features:
 * - Real-time priority fee sampling via getRecentPrioritizationFees()
 * - Percentile-based fee calculation (p25/p50/p75/p95)
 * - Compute unit estimation via simulateTransaction()
 * - Network congestion detection from slot-level metrics
 * - Continuous background monitoring with configurable intervals
 * - Fee capping to prevent excessive spending
 * - Urgency-based fee multipliers
 *
 * @example
 * ```typescript
 * import { Connection } from '@solana/web3.js';
 * import { GasOptimizer, DEFAULT_GAS_CONFIG } from './trading/gas-optimizer.js';
 *
 * const connection = new Connection('https://api.mainnet-beta.solana.com');
 * const optimizer = new GasOptimizer(connection, DEFAULT_GAS_CONFIG);
 *
 * optimizer.startMonitoring();
 *
 * const fee = await optimizer.getOptimalPriorityFee('high');
 * const congestion = await optimizer.getNetworkCongestion();
 * console.log(`Fee: ${fee} µlam, congestion: ${congestion}`);
 *
 * optimizer.stopMonitoring();
 * ```
 */

import {
  type Connection,
  ComputeBudgetProgram,
  type Transaction,
  type TransactionInstruction,
  type VersionedTransaction,
} from '@solana/web3.js';

// ─── Types ────────────────────────────────────────────────────

/** Urgency levels for priority fee calculation */
export type FeeUrgency = 'low' | 'normal' | 'high' | 'critical';

/** Network congestion levels */
export type CongestionLevel = 'low' | 'medium' | 'high' | 'extreme';

/** Configuration for the gas optimizer */
export interface GasConfig {
  /** Cap on priority fees in micro-lamports */
  maxPriorityFeeMicroLamports: number;
  /** Default compute units if estimation fails */
  defaultComputeUnits: number;
  /** Multiplier buffer for estimated CU (e.g. 1.2 = 20% buffer) */
  computeUnitBuffer: number;
  /** Number of fee data points to retain in history */
  feeHistorySize: number;
  /** How often to sample fees in milliseconds */
  monitorIntervalMs: number;
  /** Multiplier per urgency level */
  urgencyMultipliers: Record<FeeUrgency, number>;
}

/** A single fee sample snapshot */
export interface FeeDataPoint {
  /** Unix timestamp (ms) when this sample was taken */
  timestamp: number;
  /** 25th percentile priority fee (micro-lamports) */
  p25: number;
  /** 50th percentile priority fee (micro-lamports) */
  p50: number;
  /** 75th percentile priority fee (micro-lamports) */
  p75: number;
  /** 95th percentile priority fee (micro-lamports) */
  p95: number;
  /** Congestion level at sample time */
  congestion: CongestionLevel;
  /** Slot number at sample time */
  slot: number;
}

/** Transaction cost breakdown */
export interface TransactionCostEstimate {
  /** Base fee in SOL (5000 lamports per signature) */
  baseFee: number;
  /** Priority fee in SOL */
  priorityFee: number;
  /** Total estimated cost in SOL */
  total: number;
}

// ─── Constants ────────────────────────────────────────────────

/** Lamports per SOL */
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Base fee per signature in lamports */
const BASE_FEE_PER_SIGNATURE_LAMPORTS = 5_000;

/** Micro-lamports per lamport */
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000;

/** Typical CU for Pump.fun buy/sell instructions */
const PUMP_FUN_TYPICAL_CU = 200_000;

/** Minimum compute units to set (avoid underestimation) */
const MIN_COMPUTE_UNITS = 50_000;

/** Maximum compute units per transaction */
const MAX_COMPUTE_UNITS = 1_400_000;

/**
 * Approximate max transactions per slot on Solana mainnet.
 * Solana targets ~710 TPS × 0.4s slot time ≈ 284 txs/slot; we use a round
 * number that aligns with empirical observations under moderate load.
 */
const APPROX_MAX_TXS_PER_SLOT = 300;

/** Fallback priority fees (micro-lamports) when RPC data is unavailable */
const FALLBACK_FEES: Record<FeeUrgency, number> = {
  low: 1_000,
  normal: 10_000,
  high: 100_000,
  critical: 500_000,
};

/** Default gas optimizer configuration */
export const DEFAULT_GAS_CONFIG: GasConfig = {
  maxPriorityFeeMicroLamports: 2_000_000, // 2 lamports max per CU
  defaultComputeUnits: 200_000,
  computeUnitBuffer: 1.2,
  feeHistorySize: 100,
  monitorIntervalMs: 10_000, // 10 seconds
  urgencyMultipliers: {
    low: 0.5,
    normal: 1.0,
    high: 1.5,
    critical: 3.0,
  },
};

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Calculate a specific percentile from a sorted numeric array.
 * Uses nearest-rank method: ceil(percentile / 100 × length) - 1, clamped.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.max(Math.ceil((p / 100) * sorted.length) - 1, 0),
    sorted.length - 1,
  );
  return sorted[idx];
}

// ─── GasOptimizer ─────────────────────────────────────────────

/**
 * Dynamically optimizes Solana transaction priority fees and compute budgets
 * based on real-time network conditions.
 */
export class GasOptimizer {
  private readonly connection: Connection;
  private readonly config: GasConfig;
  private feeHistory: FeeDataPoint[] = [];
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private latestPercentiles: { p25: number; p50: number; p75: number; p95: number } | null = null;

  constructor(connection: Connection, config: Partial<GasConfig> = {}) {
    this.connection = connection;
    this.config = { ...DEFAULT_GAS_CONFIG, ...config };
  }

  // ─── Priority Fee ─────────────────────────────────────────

  /**
   * Returns the optimal priority fee in micro-lamports for the given urgency.
   *
   * Fetches recent prioritization fee data, computes percentiles, applies the
   * urgency multiplier, and caps at the configured maximum.
   */
  async getOptimalPriorityFee(urgency: FeeUrgency = 'normal'): Promise<number> {
    const percentiles = await this.fetchFeePercentiles();
    if (!percentiles) {
      return Math.min(
        FALLBACK_FEES[urgency],
        this.config.maxPriorityFeeMicroLamports,
      );
    }

    const baseFee = this.selectPercentileFee(percentiles, urgency);
    const multiplier = this.config.urgencyMultipliers[urgency];
    const adjusted = Math.round(baseFee * multiplier);

    return Math.min(adjusted, this.config.maxPriorityFeeMicroLamports);
  }

  // ─── Compute Units ────────────────────────────────────────

  /**
   * Estimates optimal compute units for a set of instructions by simulating
   * the transaction. Adds a configurable buffer to prevent CU exhaustion.
   *
   * Falls back to the default CU count or Pump.fun-specific heuristics if
   * simulation fails.
   */
  async getOptimalComputeUnits(instructions: TransactionInstruction[]): Promise<number> {
    // Check for Pump.fun instructions as a heuristic
    const hasPumpInstruction = instructions.some((ix) =>
      this.isPumpFunInstruction(ix),
    );

    try {
      const simulated = await this.simulateForComputeUnits(instructions);
      if (simulated !== null) {
        const buffered = Math.ceil(simulated * this.config.computeUnitBuffer);
        return Math.min(Math.max(buffered, MIN_COMPUTE_UNITS), MAX_COMPUTE_UNITS);
      }
    } catch {
      // Simulation failed — fall through to heuristic
    }

    // Heuristic fallback
    const base = hasPumpInstruction
      ? PUMP_FUN_TYPICAL_CU
      : this.config.defaultComputeUnits;
    const buffered = Math.ceil(base * this.config.computeUnitBuffer);
    return Math.min(Math.max(buffered, MIN_COMPUTE_UNITS), MAX_COMPUTE_UNITS);
  }

  // ─── Add Priority Instructions ────────────────────────────

  /**
   * Prepends ComputeBudgetProgram instructions (setComputeUnitLimit and
   * setComputeUnitPrice) to a Transaction or VersionedTransaction.
   *
   * For VersionedTransaction instances, the caller should build the message
   * with budget instructions included before signing; this method logs a
   * warning and no-ops since versioned transactions are immutable after
   * construction.
   */
  async addPriorityInstructions(
    tx: Transaction | VersionedTransaction,
    urgency: FeeUrgency = 'normal',
  ): Promise<void> {
    const priorityFee = await this.getOptimalPriorityFee(urgency);

    if (this.isVersionedTransaction(tx)) {
      // VersionedTransaction messages are immutable after construction.
      // The caller must include ComputeBudget instructions at message build time.
      console.warn(
        '[GasOptimizer] Cannot modify a VersionedTransaction after construction. ' +
        'Include ComputeBudget instructions when building the TransactionMessage.',
      );
      return;
    }

    // Extract non-ComputeBudget instructions for CU estimation
    const userInstructions = tx.instructions.filter(
      (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
    );

    const computeUnits = await this.getOptimalComputeUnits(userInstructions);

    // Remove existing ComputeBudget instructions to avoid duplicates
    tx.instructions = tx.instructions.filter(
      (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
    );

    // Prepend budget instructions (must be first in the transaction)
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    );
  }

  // ─── Cost Estimation ──────────────────────────────────────

  /**
   * Estimates the full cost of a transaction: base fee + priority fee.
   * Returns values in SOL.
   */
  async estimateTransactionCost(
    tx: Transaction,
    urgency: FeeUrgency = 'normal',
  ): Promise<TransactionCostEstimate> {
    const signatureCount = tx.signatures.length || 1;
    const baseFeelamports = signatureCount * BASE_FEE_PER_SIGNATURE_LAMPORTS;

    const userInstructions = tx.instructions.filter(
      (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
    );
    const computeUnits = await this.getOptimalComputeUnits(userInstructions);
    const priorityFeeMicroLamports = await this.getOptimalPriorityFee(urgency);

    // Priority fee = (microLamports per CU) × CU / 1_000_000
    const priorityFeeLamports = (priorityFeeMicroLamports * computeUnits) / MICRO_LAMPORTS_PER_LAMPORT;

    const baseFee = baseFeelamports / LAMPORTS_PER_SOL;
    const priorityFee = priorityFeeLamports / LAMPORTS_PER_SOL;

    return {
      baseFee,
      priorityFee,
      total: baseFee + priorityFee,
    };
  }

  // ─── Congestion ───────────────────────────────────────────

  /**
   * Returns the current network congestion level based on recent slot
   * performance metrics.
   *
   * Low:     <50% of estimated capacity
   * Medium:  50-75%
   * High:    75-90%
   * Extreme: >90%
   */
  async getNetworkCongestion(): Promise<CongestionLevel> {
    try {
      const samples = await this.connection.getRecentPerformanceSamples(4);
      if (samples.length === 0) return 'medium';

      // Average transactions per slot across recent samples
      let totalTxs = 0;
      let totalSlots = 0;
      for (const sample of samples) {
        totalTxs += sample.numTransactions;
        totalSlots += sample.numSlots;
      }

      if (totalSlots === 0) return 'medium';
      const avgTxsPerSlot = totalTxs / totalSlots;
      const utilizationRatio = avgTxsPerSlot / APPROX_MAX_TXS_PER_SLOT;

      if (utilizationRatio < 0.5) return 'low';
      if (utilizationRatio < 0.75) return 'medium';
      if (utilizationRatio < 0.9) return 'high';
      return 'extreme';
    } catch {
      // If RPC call fails, assume medium congestion
      return 'medium';
    }
  }

  // ─── Fee History ──────────────────────────────────────────

  /**
   * Returns the collected fee history data points, newest first.
   */
  getFeeHistory(): FeeDataPoint[] {
    return [...this.feeHistory];
  }

  // ─── Monitoring ───────────────────────────────────────────

  /**
   * Starts continuous background monitoring of priority fees and congestion.
   * Each interval, a new FeeDataPoint is sampled and stored.
   */
  startMonitoring(): void {
    if (this.monitorTimer !== null) return; // Already running

    // Take an initial sample immediately
    void this.sampleFeeData();

    this.monitorTimer = setInterval(() => {
      void this.sampleFeeData();
    }, this.config.monitorIntervalMs);
  }

  /**
   * Stops background fee monitoring.
   */
  stopMonitoring(): void {
    if (this.monitorTimer !== null) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  // ─── Private: Fee Percentile Calculation ──────────────────

  /**
   * Fetches recent prioritization fees from the RPC and computes percentiles.
   * Caches the result for use by getOptimalPriorityFee.
   */
  private async fetchFeePercentiles(): Promise<{
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  } | null> {
    try {
      const recentFees = await this.connection.getRecentPrioritizationFees();

      if (recentFees.length === 0) return this.latestPercentiles;

      // Extract non-zero fees and sort ascending
      const fees = recentFees
        .map((f) => f.prioritizationFee)
        .filter((f) => f > 0)
        .sort((a, b) => a - b);

      if (fees.length === 0) {
        // All fees were zero — network is cheap
        const result = { p25: 0, p50: 0, p75: 0, p95: 0 };
        this.latestPercentiles = result;
        return result;
      }

      const result = {
        p25: percentile(fees, 25),
        p50: percentile(fees, 50),
        p75: percentile(fees, 75),
        p95: percentile(fees, 95),
      };

      this.latestPercentiles = result;
      return result;
    } catch {
      // RPC failure — return cached or null
      return this.latestPercentiles;
    }
  }

  /**
   * Selects the appropriate percentile fee for the given urgency level.
   */
  private selectPercentileFee(
    percentiles: { p25: number; p50: number; p75: number; p95: number },
    urgency: FeeUrgency,
  ): number {
    switch (urgency) {
      case 'low':
        return percentiles.p25;
      case 'normal':
        return percentiles.p50;
      case 'high':
        return percentiles.p75;
      case 'critical':
        return percentiles.p95;
    }
  }

  // ─── Private: Compute Unit Simulation ─────────────────────

  /**
   * Simulates a transaction containing the given instructions and returns
   * the consumed compute units. Returns null if simulation fails or
   * unitsConsumed is not available.
   */
  private async simulateForComputeUnits(
    instructions: TransactionInstruction[],
  ): Promise<number | null> {
    if (instructions.length === 0) return null;

    try {
      // Build a minimal transaction for simulation
      const { Transaction: TxClass } = await import('@solana/web3.js');
      const tx = new TxClass();
      tx.add(...instructions);

      // Set a recent blockhash for simulation (doesn't need to be valid for sim)
      const { blockhash } = await this.connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;

      // We need a fee payer for simulation; use the first account in the first instruction
      const firstKey = instructions[0].keys[0];
      if (firstKey) {
        tx.feePayer = firstKey.pubkey;
      }

      const simResult = await this.connection.simulateTransaction(tx);
      if (simResult.value.err) {
        // Transaction would fail — still use unitsConsumed if available
        return simResult.value.unitsConsumed ?? null;
      }

      return simResult.value.unitsConsumed ?? null;
    } catch {
      return null;
    }
  }

  // ─── Private: Fee Sampling ────────────────────────────────

  /**
   * Collects a single fee data point: percentiles, congestion, and slot.
   * Appends to history, trimming to configured max size.
   */
  private async sampleFeeData(): Promise<void> {
    try {
      const [percentiles, congestion, slot] = await Promise.all([
        this.fetchFeePercentiles(),
        this.getNetworkCongestion(),
        this.connection.getSlot().catch(() => 0),
      ]);

      const dataPoint: FeeDataPoint = {
        timestamp: Date.now(),
        p25: percentiles?.p25 ?? 0,
        p50: percentiles?.p50 ?? 0,
        p75: percentiles?.p75 ?? 0,
        p95: percentiles?.p95 ?? 0,
        congestion,
        slot,
      };

      this.feeHistory.push(dataPoint);

      // Trim history to configured size
      if (this.feeHistory.length > this.config.feeHistorySize) {
        this.feeHistory = this.feeHistory.slice(-this.config.feeHistorySize);
      }
    } catch {
      // Sampling failure is non-critical — skip this interval
    }
  }

  // ─── Private: Instruction Detection ───────────────────────

  /**
   * Heuristic check for Pump.fun program instructions.
   * Pump.fun uses a known program ID on mainnet.
   */
  private isPumpFunInstruction(ix: TransactionInstruction): boolean {
    const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    return ix.programId.toBase58() === PUMP_FUN_PROGRAM_ID;
  }

  /**
   * Type guard to distinguish VersionedTransaction from Transaction.
   */
  private isVersionedTransaction(
    tx: Transaction | VersionedTransaction,
  ): tx is VersionedTransaction {
    return 'version' in tx;
  }
}
