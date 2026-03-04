/**
 * Accumulator Agent — Gradual Token Position Builder
 *
 * Slowly accumulates a token position over time using one of four
 * strategies (TWAP, VWAP, Iceberg, Adaptive), minimising price
 * impact on the bonding curve.
 *
 * Each strategy slices the target amount into many small orders,
 * estimates price impact before every trade, and pauses when
 * volatility or impact thresholds are breached.
 */

import {
  Connection,
  Transaction,
  ComputeBudgetProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getTokenPrice,
} from '@pump-fun/pump-sdk';
import type { DecodedBondingCurve } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type { AgentWallet, TradeOrder, TradeResult } from '../types.js';

// ─── Configuration ────────────────────────────────────────────

export type AccumulationStrategy = 'twap' | 'vwap' | 'iceberg' | 'adaptive';

export interface AccumulatorConfig {
  /** Which accumulation algorithm to use */
  strategy: AccumulationStrategy;
  /** Max acceptable price impact per individual trade (e.g. 2 = 2%) */
  maxPriceImpactPercent: number;
  /** Max slippage in basis points for each on-chain swap */
  maxSlippageBps: number;
  /** How many sub-orders to split a large order into when impact is high */
  splitFactor: number;
  /** Pause accumulation when rolling volatility exceeds threshold */
  pauseOnHighVolatility: boolean;
  /** Volatility threshold — pause if price change exceeds this % over the sample window */
  volatilityThreshold: number;
  /** Priority fee in micro-lamports (default: 100 000) */
  priorityFeeMicroLamports?: number;
  /** Size of the rolling window for adaptive / volatility checks */
  rollingWindowSize?: number;
}

// ─── Progress Snapshot ────────────────────────────────────────

export interface AccumulationProgress {
  /** Tokens acquired so far (lamport-scale) */
  acquired: BN;
  /** Total target amount */
  target: BN;
  /** Completion percentage 0-100 */
  percentage: number;
  /** Volume-weighted average price in SOL (lamport-scale) */
  avgPrice: BN;
  /** Milliseconds elapsed since start */
  elapsed: number;
  /** Milliseconds remaining (projected) */
  remaining: number;
  /** Number of successful fills */
  fills: number;
  /** Whether accumulation is currently paused (volatility / impact) */
  paused: boolean;
  /** Reason for pause, if any */
  pauseReason?: string;
}

// ─── Events ───────────────────────────────────────────────────

interface AccumulatorAgentEvents {
  'accumulation:started': (mint: string, target: BN, durationMs: number) => void;
  'accumulation:fill': (result: TradeResult, progress: AccumulationProgress) => void;
  'accumulation:paused': (reason: string) => void;
  'accumulation:resumed': () => void;
  'accumulation:completed': (progress: AccumulationProgress) => void;
  'accumulation:stopped': (reason: string, progress: AccumulationProgress) => void;
  'accumulation:adjusted': (field: 'target' | 'duration', oldValue: BN | number, newValue: BN | number) => void;
  'trade:submitted': (order: TradeOrder) => void;
  'trade:executed': (result: TradeResult) => void;
  'trade:failed': (order: TradeOrder, error: Error) => void;
}

// ─── Internals ────────────────────────────────────────────────

/** A single price observation for the rolling window. */
interface PriceObservation {
  price: number; // SOL per token
  volume: BN;    // SOL-denominated volume observed on-chain
  timestamp: number;
}

// ─── Accumulator Agent ───────────────────────────────────────

export class AccumulatorAgent extends EventEmitter<AccumulatorAgentEvents> {
  readonly id: string;
  readonly wallet: AgentWallet;

  private readonly connection: Connection;
  private readonly config: AccumulatorConfig;
  private onlineSdk: OnlinePumpSdk | null = null;

  // Accumulation state
  private mint: PublicKey | null = null;
  private targetAmount: BN = new BN(0);
  private acquiredAmount: BN = new BN(0);
  private totalSolSpent: BN = new BN(0);
  private durationMs = 0;
  private startedAt = 0;
  private fills = 0;
  private running = false;
  private paused = false;
  private pauseReason: string | undefined;

  // Timers
  private tradeTimer: ReturnType<typeof setTimeout> | null = null;

  // Rolling window for adaptive / volatility tracking
  private priceHistory: PriceObservation[] = [];
  private readonly rollingWindowSize: number;

  // Trade history (for audit / analytics)
  private tradeHistory: TradeResult[] = [];

  constructor(
    wallet: AgentWallet,
    connection: Connection,
    config: AccumulatorConfig,
  ) {
    super();
    this.id = `accumulator-${uuid().slice(0, 8)}`;
    this.wallet = wallet;
    this.connection = connection;
    this.config = config;
    this.rollingWindowSize = config.rollingWindowSize ?? 20;
  }

  // ─── SDK helper ─────────────────────────────────────────

  private getOnlineSdk(): OnlinePumpSdk {
    if (!this.onlineSdk) {
      this.onlineSdk = new OnlinePumpSdk(this.connection);
    }
    return this.onlineSdk;
  }

  // ─── Public API ─────────────────────────────────────────

  /**
   * Begin accumulating `targetAmount` tokens of `mint` over
   * `durationMs` milliseconds using the configured strategy.
   */
  start(mint: string, targetAmount: BN, durationMs: number): void {
    if (this.running) {
      throw new Error('AccumulatorAgent is already running — call stop() first');
    }

    this.mint = new PublicKey(mint);
    this.targetAmount = targetAmount.clone();
    this.durationMs = durationMs;
    this.startedAt = Date.now();
    this.acquiredAmount = new BN(0);
    this.totalSolSpent = new BN(0);
    this.fills = 0;
    this.running = true;
    this.paused = false;
    this.pauseReason = undefined;
    this.priceHistory = [];
    this.tradeHistory = [];

    this.emit('accumulation:started', mint, targetAmount, durationMs);
    console.log(
      `[accumulator:${this.id}] Started ${this.config.strategy} accumulation ` +
        `for ${mint} — target=${targetAmount.toString()} over ${durationMs}ms`,
    );

    this.scheduleNextSlice();
  }

  /** Gracefully stop accumulation. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clearTimer();
    const progress = this.getProgress();
    this.emit('accumulation:stopped', 'manual', progress);
    console.log(
      `[accumulator:${this.id}] Stopped — acquired ${progress.percentage.toFixed(1)}% of target`,
    );
  }

  /** Live progress snapshot. */
  getProgress(): AccumulationProgress {
    const elapsed = this.running || this.fills > 0 ? Date.now() - this.startedAt : 0;
    const percentage =
      this.targetAmount.gtn(0)
        ? Math.min(
            100,
            this.acquiredAmount
              .mul(new BN(10000))
              .div(this.targetAmount)
              .toNumber() / 100,
          )
        : 0;

    const remaining =
      percentage > 0
        ? Math.max(0, (elapsed / percentage) * (100 - percentage))
        : Math.max(0, this.durationMs - elapsed);

    const avgPrice =
      this.acquiredAmount.gtn(0)
        ? this.totalSolSpent.mul(new BN(LAMPORTS_PER_SOL)).div(this.acquiredAmount)
        : new BN(0);

    return {
      acquired: this.acquiredAmount.clone(),
      target: this.targetAmount.clone(),
      percentage,
      avgPrice,
      elapsed,
      remaining,
      fills: this.fills,
      paused: this.paused,
      pauseReason: this.pauseReason,
    };
  }

  /** Adjust the target quantity mid-flight. */
  adjustTarget(newTarget: BN): void {
    const old = this.targetAmount.clone();
    this.targetAmount = newTarget.clone();
    this.emit('accumulation:adjusted', 'target', old, newTarget);
    console.log(
      `[accumulator:${this.id}] Target adjusted ${old.toString()} → ${newTarget.toString()}`,
    );
  }

  /** Adjust the total duration mid-flight. */
  adjustDuration(newDurationMs: number): void {
    const old = this.durationMs;
    this.durationMs = newDurationMs;
    this.emit('accumulation:adjusted', 'duration', old as unknown as BN, newDurationMs as unknown as BN);
    console.log(
      `[accumulator:${this.id}] Duration adjusted ${old}ms → ${newDurationMs}ms`,
    );
    // Reschedule with the new cadence
    if (this.running && !this.paused) {
      this.clearTimer();
      this.scheduleNextSlice();
    }
  }

  /** Read-only trade history. */
  getTradeHistory(): TradeResult[] {
    return [...this.tradeHistory];
  }

  /** Whether the agent is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Scheduling ─────────────────────────────────────────

  private clearTimer(): void {
    if (this.tradeTimer) {
      clearTimeout(this.tradeTimer);
      this.tradeTimer = null;
    }
  }

  /**
   * Compute the interval between slices based on strategy +
   * remaining time / amount, then schedule the next execution.
   */
  private scheduleNextSlice(): void {
    if (!this.running) return;

    // Already reached target — done
    if (this.acquiredAmount.gte(this.targetAmount)) {
      this.running = false;
      const progress = this.getProgress();
      this.emit('accumulation:completed', progress);
      console.log(`[accumulator:${this.id}] Accumulation complete`);
      return;
    }

    const intervalMs = this.computeInterval();

    this.tradeTimer = setTimeout(async () => {
      if (!this.running) return;

      try {
        await this.executeSlice();
      } catch (error) {
        console.error(`[accumulator:${this.id}] Slice error:`, error);
      }

      this.scheduleNextSlice();
    }, intervalMs);
  }

  /**
   * Compute the delay until the next trade based on the active
   * strategy and remaining work.
   */
  private computeInterval(): number {
    const elapsed = Date.now() - this.startedAt;
    const remainingTime = Math.max(1000, this.durationMs - elapsed);
    const remainingAmount = this.targetAmount.sub(this.acquiredAmount);
    if (remainingAmount.lten(0)) return remainingTime;

    // Number of remaining slices — at minimum 1
    const slices = Math.max(1, this.estimateRemainingSlices(remainingAmount));
    const baseInterval = remainingTime / slices;

    switch (this.config.strategy) {
      case 'twap':
        // Even spacing
        return baseInterval;

      case 'vwap':
        // Slightly randomise around base to avoid detection
        return baseInterval * (0.7 + Math.random() * 0.6);

      case 'iceberg':
        // Faster cadence because each visible slice is small
        return baseInterval * 0.5;

      case 'adaptive': {
        // If price is below rolling average → buy sooner; above → delay
        const ratio = this.priceVsRollingAverage();
        if (ratio < 1) {
          // Price is below average — buy sooner
          return baseInterval * Math.max(0.3, ratio);
        }
        // Price elevated — delay
        return baseInterval * Math.min(2.0, ratio);
      }

      default:
        return baseInterval;
    }
  }

  /**
   * Estimate how many more slices we need to reach the target.
   * Uses average fill size from history if available.
   */
  private estimateRemainingSlices(remaining: BN): number {
    if (this.fills === 0) {
      // No history yet — guess based on split factor
      return Math.max(this.config.splitFactor, 10);
    }
    const avgFill = this.acquiredAmount.div(new BN(this.fills));
    if (avgFill.lten(0)) return 10;
    return Math.ceil(remaining.toNumber() / Math.max(1, avgFill.toNumber()));
  }

  // ─── Execution ──────────────────────────────────────────

  /**
   * Execute one accumulation slice — the core trade step.
   *
   * 1. Fetch bonding curve state
   * 2. Check volatility (pause if high)
   * 3. Determine slice size per strategy
   * 4. Estimate price impact — split if too high
   * 5. Execute buy(s) on-chain
   * 6. Update progress
   */
  private async executeSlice(): Promise<void> {
    if (!this.mint || !this.running) return;

    const sdk = this.getOnlineSdk();
    const curve = await sdk.fetchBondingCurve(this.mint);

    // Record price observation
    const currentPrice = getTokenPrice(curve);
    this.recordPriceObservation(currentPrice, curve.realSolReserves);

    // ── Volatility gate ──────────────────────────────────
    if (this.config.pauseOnHighVolatility && this.isVolatilityHigh()) {
      if (!this.paused) {
        this.paused = true;
        this.pauseReason = 'high-volatility';
        this.emit('accumulation:paused', this.pauseReason);
        console.log(`[accumulator:${this.id}] Paused — volatility exceeds ${this.config.volatilityThreshold}%`);
      }
      return;
    }

    // Resume if previously paused for volatility
    if (this.paused && this.pauseReason === 'high-volatility') {
      this.paused = false;
      this.pauseReason = undefined;
      this.emit('accumulation:resumed');
      console.log(`[accumulator:${this.id}] Resumed — volatility normalised`);
    }

    // ── Determine slice size ─────────────────────────────
    const remaining = this.targetAmount.sub(this.acquiredAmount);
    if (remaining.lten(0)) return;

    const sliceTokens = this.computeSliceSize(remaining, curve);
    if (sliceTokens.lten(0)) return;

    // Convert desired token amount → SOL cost on the curve
    const solCost = this.estimateSolCostForTokens(sliceTokens, curve);
    if (solCost.lten(0)) return;

    // ── Price impact check ───────────────────────────────
    const impactPercent = this.estimatePriceImpact(solCost, curve);
    if (impactPercent > this.config.maxPriceImpactPercent) {
      // Split into smaller sub-orders
      const subCount = Math.min(
        this.config.splitFactor,
        Math.ceil(impactPercent / this.config.maxPriceImpactPercent),
      );
      const subSol = solCost.div(new BN(subCount));

      for (let i = 0; i < subCount; i++) {
        if (!this.running) break;
        if (this.acquiredAmount.gte(this.targetAmount)) break;
        await this.executeBuy(subSol);
        // Small inter-slice delay to let the curve settle
        if (i < subCount - 1) {
          await this.sleep(500 + Math.random() * 1000);
        }
      }
      return;
    }

    await this.executeBuy(solCost);
  }

  /**
   * How many tokens to buy this slice, per strategy.
   */
  private computeSliceSize(remaining: BN, _curve: DecodedBondingCurve): BN {
    const elapsed = Date.now() - this.startedAt;
    const remainingTime = Math.max(1, this.durationMs - elapsed);

    switch (this.config.strategy) {
      case 'twap': {
        // Equal portions across remaining time slices
        const slices = Math.max(1, this.estimateRemainingSlices(remaining));
        return remaining.div(new BN(slices));
      }

      case 'vwap': {
        // Scale slice proportional to recent on-chain volume
        const volumeMultiplier = this.recentVolumeMultiplier();
        const slices = Math.max(1, this.estimateRemainingSlices(remaining));
        const base = remaining.div(new BN(slices));
        // volumeMultiplier is 0.5–2.0 — buy more when volume is high
        const scaled = base.muln(Math.round(volumeMultiplier * 100)).divn(100);
        // Clamp to remaining
        return BN.min(scaled, remaining);
      }

      case 'iceberg': {
        // Visible order is 10-20% of the remaining per-slice amount
        const slices = Math.max(1, this.estimateRemainingSlices(remaining));
        const fullSlice = remaining.div(new BN(slices));
        const visibleFraction = 0.1 + Math.random() * 0.1; // 10-20%
        const visible = fullSlice.muln(Math.round(visibleFraction * 1000)).divn(1000);
        return BN.min(visible, remaining);
      }

      case 'adaptive': {
        // Buy more when price is below rolling average
        const ratio = this.priceVsRollingAverage();
        const slices = Math.max(1, this.estimateRemainingSlices(remaining));
        const base = remaining.div(new BN(slices));
        // ratio < 1 → price is cheap → buy more (up to 2×)
        // ratio > 1 → price is high → buy less (down to 0.25×)
        let multiplier: number;
        if (ratio < 1) {
          multiplier = 1 + (1 - ratio); // 1.0 – 2.0
        } else {
          multiplier = Math.max(0.25, 1 / ratio); // 0.25 – 1.0
        }
        const scaled = base.muln(Math.round(multiplier * 100)).divn(100);
        // Also factor in time pressure — if running out of time, go bigger
        const timePressure = 1 + Math.max(0, 1 - remainingTime / this.durationMs);
        const pressured = scaled.muln(Math.round(timePressure * 100)).divn(100);
        return BN.min(pressured, remaining);
      }

      default:
        return remaining.div(new BN(10));
    }
  }

  // ─── On-chain Buy Execution ─────────────────────────────

  /**
   * Execute a single buy against the bonding curve for a given SOL amount.
   */
  private async executeBuy(solAmountLamports: BN): Promise<TradeResult | null> {
    if (!this.mint) return null;

    const order: TradeOrder = {
      id: uuid(),
      traderId: this.id,
      mint: this.mint.toBase58(),
      direction: 'buy',
      amount: solAmountLamports,
      slippageBps: this.config.maxSlippageBps,
      priorityFeeMicroLamports: this.config.priorityFeeMicroLamports ?? 100_000,
    };

    this.emit('trade:submitted', order);

    try {
      const sdk = this.getOnlineSdk();
      const global = await sdk.fetchGlobal();
      const buyState = await sdk.fetchBuyState(
        this.mint,
        this.wallet.keypair.publicKey,
        TOKEN_PROGRAM_ID,
      );

      const buyIxs = await PUMP_SDK.buyInstructions({
        global,
        bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
        bondingCurve: buyState.bondingCurve,
        associatedUserAccountInfo: buyState.associatedUserAccountInfo,
        mint: this.mint,
        user: this.wallet.keypair.publicKey,
        amount: new BN(0),
        solAmount: solAmountLamports,
        slippage: this.config.maxSlippageBps / 100,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      const computeIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFeeMicroLamports ?? 100_000,
        }),
      ];

      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: this.wallet.keypair.publicKey,
      });
      tx.add(...computeIxs, ...buyIxs);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.wallet.keypair],
        { commitment: 'confirmed', maxRetries: 3 },
      );

      // Determine tokens received
      const ata = await getAssociatedTokenAddress(
        this.mint,
        this.wallet.keypair.publicKey,
      );
      let tokensReceived = new BN(0);
      try {
        const tokenAccount = await getAccount(this.connection, ata);
        const newBalance = new BN(tokenAccount.amount.toString());
        tokensReceived = newBalance.sub(this.acquiredAmount);
        if (tokensReceived.ltn(0)) tokensReceived = new BN(0);
      } catch {
        // ATA may not exist yet on first buy
      }

      const result: TradeResult = {
        order,
        signature,
        amountOut: tokensReceived,
        executionPrice:
          tokensReceived.gtn(0)
            ? solAmountLamports.mul(new BN(LAMPORTS_PER_SOL)).div(tokensReceived)
            : new BN(0),
        feesPaid: new BN(5000),
        success: true,
        executedAt: Date.now(),
      };

      // Update running totals
      this.acquiredAmount = this.acquiredAmount.add(tokensReceived);
      this.totalSolSpent = this.totalSolSpent.add(solAmountLamports);
      this.fills++;
      this.tradeHistory.push(result);

      this.emit('trade:executed', result);
      this.emit('accumulation:fill', result, this.getProgress());

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const failedResult: TradeResult = {
        order,
        signature: '',
        amountOut: new BN(0),
        executionPrice: new BN(0),
        feesPaid: new BN(0),
        success: false,
        error: err.message,
        executedAt: Date.now(),
      };
      this.tradeHistory.push(failedResult);
      this.emit('trade:failed', order, err);
      return failedResult;
    }
  }

  // ─── Price Impact & Curve Math ──────────────────────────

  /**
   * Estimate the percentage price impact of buying `solAmount` on
   * the constant-product bonding curve.
   *
   *   impact ≈ solAmount / (virtualSolReserves + solAmount) × 100
   *
   * This is the standard x*y=k impact approximation.
   */
  private estimatePriceImpact(solAmount: BN, curve: DecodedBondingCurve): number {
    const reserves = curve.virtualSolReserves;
    if (reserves.isZero()) return 100;

    // impact% = (solAmount / (reserves + solAmount)) * 100
    const denominator = reserves.add(solAmount);
    return (
      solAmount
        .mul(new BN(10000))
        .div(denominator)
        .toNumber() / 100
    );
  }

  /**
   * Estimate SOL cost for acquiring `tokenAmount` tokens on the
   * constant-product curve.
   *
   *   solCost = virtualSolReserves × tokenAmount
   *             / (virtualTokenReserves − tokenAmount)
   */
  private estimateSolCostForTokens(tokenAmount: BN, curve: DecodedBondingCurve): BN {
    const tokenReserves = curve.virtualTokenReserves;
    const solReserves = curve.virtualSolReserves;

    // Prevent division by zero / underflow
    if (tokenReserves.lte(tokenAmount)) {
      // Asking for more tokens than available — return a very large number
      return solReserves;
    }

    // dx = x * dy / (y - dy)   (constant product formula)
    return solReserves.mul(tokenAmount).div(tokenReserves.sub(tokenAmount));
  }

  // ─── Volatility & Volume Helpers ────────────────────────

  private recordPriceObservation(price: number, volume: BN): void {
    this.priceHistory.push({ price, volume, timestamp: Date.now() });
    // Trim to window
    while (this.priceHistory.length > this.rollingWindowSize) {
      this.priceHistory.shift();
    }
  }

  /**
   * Check whether recent price volatility exceeds the configured threshold.
   * Uses min/max spread over the rolling window.
   */
  private isVolatilityHigh(): boolean {
    if (this.priceHistory.length < 3) return false;

    let min = Infinity;
    let max = -Infinity;
    for (const obs of this.priceHistory) {
      if (obs.price < min) min = obs.price;
      if (obs.price > max) max = obs.price;
    }

    if (min <= 0) return false;
    const volatilityPercent = ((max - min) / min) * 100;
    return volatilityPercent > this.config.volatilityThreshold;
  }

  /**
   * Compute current price relative to rolling average.
   * Returns < 1 when price is below average, > 1 when above.
   */
  private priceVsRollingAverage(): number {
    if (this.priceHistory.length === 0) return 1;

    let sum = 0;
    for (const obs of this.priceHistory) {
      sum += obs.price;
    }
    const avg = sum / this.priceHistory.length;
    const current = this.priceHistory[this.priceHistory.length - 1].price;

    if (avg <= 0) return 1;
    return current / avg;
  }

  /**
   * VWAP multiplier: ratio of most recent observation's volume to the
   * rolling average volume. High volume → multiplier > 1.
   */
  private recentVolumeMultiplier(): number {
    if (this.priceHistory.length < 2) return 1;

    let totalVolume = new BN(0);
    for (const obs of this.priceHistory) {
      totalVolume = totalVolume.add(obs.volume);
    }
    const avgVolume = totalVolume.divn(this.priceHistory.length);
    if (avgVolume.isZero()) return 1;

    const latest = this.priceHistory[this.priceHistory.length - 1].volume;
    const ratio = latest.mul(new BN(100)).div(avgVolume).toNumber() / 100;

    // Clamp to 0.5–2.0 to avoid extreme swings
    return Math.min(2.0, Math.max(0.5, ratio));
  }

  // ─── Utilities ──────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
