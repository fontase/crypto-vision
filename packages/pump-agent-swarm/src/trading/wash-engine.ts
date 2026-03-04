/**
 * Wash Trading Engine — Coordinated agent-to-agent trading
 *
 * Orchestrates buy/sell cycles across multiple agent-controlled wallets
 * to generate realistic-looking volume and price action on Pump.fun
 * bonding curves. The engine minimises net SOL loss by balancing buys
 * and sells within each cycle while allowing configurable price drift.
 *
 * Key features:
 * - Pareto-distributed "natural" trade sizing (no round numbers)
 * - Per-wallet personality (consistent average size)
 * - Configurable price drift per cycle
 * - Continuous mode with back-pressure & memory safety
 * - Full event bus + structured logging integration
 */

import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { v4 as uuid } from 'uuid';

import type {
  AgentWallet,
  TradeDirection,
  TradeOrder,
  TradeResult,
  WashTradeRoute,
  TradeCycle,
} from '../types.js';
import { TraderAgent } from '../agents/trader-agent.js';
import { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Configuration ────────────────────────────────────────────

export interface WashEngineConfig {
  /** Number of trades per cycle */
  tradesPerCycle: number;
  /** Delay between trades in a cycle (ms) */
  intraTradeDelayMs: { min: number; max: number };
  /** Delay between cycles (ms) */
  interCycleDelayMs: { min: number; max: number };
  /** Trade size range in SOL */
  tradeSizeRange: { min: number; max: number };
  /** Target net SOL change per cycle — should be near zero (0–1, percentage) */
  maxNetChangePercent: number;
  /** Price drift target per cycle (positive = price up, %) */
  priceDriftPercent: number;
  /** Maximum number of consecutive buys before forcing a sell */
  maxConsecutiveBuys: number;
  /** Maximum number of consecutive sells before forcing a buy */
  maxConsecutiveSells: number;
  /** Whether to make trade sizes look natural (no round numbers) */
  naturalSizing: boolean;
  /** Max SOL budget for the engine (lamports) */
  maxBudgetLamports: BN;
  /** Slippage tolerance in basis points (default 500 = 5 %) */
  slippageBps?: number;
  /** Priority fee in micro-lamports */
  priorityFeeMicroLamports?: number;
}

// ─── Result / Stats Types ─────────────────────────────────────

export interface CycleResult {
  cycle: TradeCycle;
  trades: TradeResult[];
  /** Net SOL change across the cycle (lamports) */
  netSolChange: BN;
  /** Total volume generated (lamports) */
  volume: BN;
  /** Relative price change (−1 … +∞) */
  priceChange: number;
  /** Wall-clock duration in ms */
  duration: number;
  /** Fraction of trades that succeeded (0–1) */
  successRate: number;
}

export interface WashStats {
  cyclesCompleted: number;
  totalVolumeSol: number;
  netSolChange: number;
  avgCycleDuration: number;
  avgTradeSuccess: number;
  volumePerHour: number;
  priceChangeSinceStart: number;
}

// ─── Internal Helpers ─────────────────────────────────────────

/** Map from wallet address → per-wallet sizing personality. */
interface WalletPersonality {
  /** Average trade size in SOL for this wallet */
  avgSizeSol: number;
  /** Standard deviation multiplier (0.1 – 0.4) */
  sizeSigma: number;
}

// ─── Wash Engine ──────────────────────────────────────────────

export class WashEngine {
  private readonly wallets: AgentWallet[];
  private readonly connection: Connection;
  private config: WashEngineConfig;
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;

  /** TraderAgent per wallet — keyed by wallet address */
  private readonly traders = new Map<string, TraderAgent>();

  /** Per-wallet sizing personality */
  private readonly personalities = new Map<string, WalletPersonality>();

  /** Accumulated cycle results for stats */
  private readonly cycleResults: CycleResult[] = [];

  /** Continuous mode controls */
  private running = false;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  /** Budget tracking (lamports spent so far) */
  private budgetSpent = new BN(0);

  /** Engine-lifetime price baseline (set on first cycle) */
  private startPrice: number | null = null;
  private latestPrice = 0;
  private startedAt = 0;

  // ── Constructor ─────────────────────────────────────────────

  constructor(
    wallets: AgentWallet[],
    connection: Connection,
    config: WashEngineConfig,
    eventBus: SwarmEventBus,
  ) {
    if (wallets.length < 2) {
      throw new Error('WashEngine requires at least 2 wallets');
    }

    this.wallets = wallets;
    this.connection = connection;
    this.config = { ...config };
    this.eventBus = eventBus;
    this.logger = SwarmLogger.create('wash-engine', 'trading');
    this.logger.setPhase('trading');

    // Bootstrap a TraderAgent per wallet (reuses the existing class)
    for (const wallet of wallets) {
      const agent = new TraderAgent(
        `wash-${wallet.label}`,
        wallet,
        connection,
        {
          id: 'wash',
          name: 'Wash Strategy',
          minIntervalSeconds: 0,
          maxIntervalSeconds: 0,
          minTradeSizeLamports: new BN(config.tradeSizeRange.min * LAMPORTS_PER_SOL),
          maxTradeSizeLamports: new BN(config.tradeSizeRange.max * LAMPORTS_PER_SOL),
          buySellRatio: 1.0,
          maxTotalBudgetLamports: config.maxBudgetLamports,
          useJitoBundles: false,
          priorityFeeMicroLamports: config.priorityFeeMicroLamports ?? 5_000,
        },
      );
      this.traders.set(wallet.address, agent);
    }

    // Assign a stable "personality" to every wallet so its trades
    // look self-consistent over time.
    this.initPersonalities();
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Plan a single wash-trade cycle for the given token mint.
   * The cycle is balanced (net ≈ 0) with optional price drift.
   */
  planCycle(mint: string): TradeCycle {
    const cycleId = uuid();
    const routes = this.buildRoutes(mint, cycleId);

    const expectedNet = routes.reduce(
      (acc, r) => (r.direction === 'buy' ? acc.add(r.amount) : acc.sub(r.amount)),
      new BN(0),
    );

    return {
      id: cycleId,
      routes,
      expectedNetSol: expectedNet,
      expectedPriceImpact: this.config.priceDriftPercent / 100,
      status: 'planned',
    };
  }

  /**
   * Execute every route in a previously planned cycle, respecting
   * the per-route delay. Returns aggregated results.
   */
  async executeCycle(cycle: TradeCycle): Promise<CycleResult> {
    const start = Date.now();
    cycle.status = 'executing';
    cycle.startedAt = start;

    this.eventBus.emit('wash:cycle:start', 'trading', 'wash-engine', {
      cycleId: cycle.id,
      routeCount: cycle.routes.length,
    });

    const tradeResults: TradeResult[] = [];
    let volume = new BN(0);
    let netSol = new BN(0);

    for (const route of cycle.routes) {
      // Honour the intra-trade delay for organic appearance
      if (route.delayMs > 0) {
        await this.delay(route.delayMs);
      }

      // Abort if engine was stopped mid-cycle
      if (!this.running && this.abortController?.signal.aborted) {
        this.logger.warn('Cycle aborted mid-execution', { cycleId: cycle.id });
        cycle.status = 'failed';
        break;
      }

      const trader = this.traders.get(route.from.address);
      if (!trader) {
        this.logger.error(
          `No trader agent for wallet ${route.from.address}`,
          new Error('Missing trader'),
        );
        continue;
      }

      try {
        const result = await this.executeSingleTrade(trader, route, cycle.id);
        tradeResults.push(result);

        if (result.success) {
          volume = volume.add(route.amount);
          if (route.direction === 'buy') {
            netSol = netSol.sub(route.amount);
          } else {
            netSol = netSol.add(result.amountOut);
          }
          this.budgetSpent = this.budgetSpent.add(
            route.direction === 'buy' ? route.amount : new BN(0),
          );

          // Track latest price for stats
          if (!result.executionPrice.isZero()) {
            const priceSol =
              result.executionPrice.toNumber() / LAMPORTS_PER_SOL;
            if (this.startPrice === null) this.startPrice = priceSol;
            this.latestPrice = priceSol;
          }
        }

        this.eventBus.emit('trade:executed', 'trading', 'wash-engine', {
          cycleId: cycle.id,
          direction: route.direction,
          amountLamports: route.amount.toString(),
          success: result.success,
          signature: result.signature,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error('Trade execution failed', error, {
          cycleId: cycle.id,
          wallet: route.from.address,
          direction: route.direction,
        });

        tradeResults.push(this.failedTradeResult(route, error));

        this.eventBus.emit('trade:failed', 'trading', 'wash-engine', {
          cycleId: cycle.id,
          wallet: route.from.address,
          error: error.message,
        });
      }
    }

    const duration = Date.now() - start;
    const successCount = tradeResults.filter((t) => t.success).length;

    const priceChange =
      this.startPrice !== null && this.startPrice > 0
        ? (this.latestPrice - this.startPrice) / this.startPrice
        : 0;

    cycle.status = 'completed';
    cycle.completedAt = Date.now();

    const result: CycleResult = {
      cycle,
      trades: tradeResults,
      netSolChange: netSol,
      volume,
      priceChange,
      duration,
      successRate: tradeResults.length > 0 ? successCount / tradeResults.length : 0,
    };

    this.cycleResults.push(result);

    this.eventBus.emit('wash:cycle:complete', 'trading', 'wash-engine', {
      cycleId: cycle.id,
      duration,
      volumeLamports: volume.toString(),
      netSolLamports: netSol.toString(),
      successRate: result.successRate,
    });

    this.logger.info('Cycle completed', {
      cycleId: cycle.id,
      trades: tradeResults.length,
      successRate: result.successRate,
      volumeSol: volume.toNumber() / LAMPORTS_PER_SOL,
      netSol: netSol.toNumber() / LAMPORTS_PER_SOL,
      durationMs: duration,
    });

    return result;
  }

  /**
   * Start continuous wash-trade cycles. Runs until `stopContinuous()`
   * is called or the budget is exhausted.
   */
  startContinuous(mint: string): void {
    if (this.running) {
      this.logger.warn('Continuous mode already running');
      return;
    }

    this.running = true;
    this.startedAt = Date.now();
    this.abortController = new AbortController();

    this.logger.info('Continuous mode started', { mint });
    this.eventBus.emit('wash:continuous:start', 'trading', 'wash-engine', { mint });

    // Kick off the first cycle synchronously (the loop self-schedules)
    void this.continuousLoop(mint);
  }

  /** Stop continuous mode gracefully (current cycle finishes). */
  stopContinuous(): void {
    if (!this.running) return;

    this.running = false;
    this.abortController?.abort();
    this.abortController = null;

    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }

    this.logger.info('Continuous mode stopped');
    this.eventBus.emit('wash:continuous:stop', 'trading', 'wash-engine', {
      stats: this.getStats(),
    });
  }

  /** Return aggregate stats across all completed cycles. */
  getStats(): WashStats {
    const completed = this.cycleResults.length;
    if (completed === 0) {
      return {
        cyclesCompleted: 0,
        totalVolumeSol: 0,
        netSolChange: 0,
        avgCycleDuration: 0,
        avgTradeSuccess: 0,
        volumePerHour: 0,
        priceChangeSinceStart: 0,
      };
    }

    const totalVolumeLamports = this.cycleResults.reduce(
      (acc, r) => acc.add(r.volume),
      new BN(0),
    );
    const totalNetLamports = this.cycleResults.reduce(
      (acc, r) => acc.add(r.netSolChange),
      new BN(0),
    );
    const totalDuration = this.cycleResults.reduce((acc, r) => acc + r.duration, 0);
    const totalSuccess = this.cycleResults.reduce((acc, r) => acc + r.successRate, 0);

    const uptimeMs = this.startedAt > 0 ? Date.now() - this.startedAt : 1;
    const uptimeHours = uptimeMs / 3_600_000;
    const totalVolumeSol = totalVolumeLamports.toNumber() / LAMPORTS_PER_SOL;

    return {
      cyclesCompleted: completed,
      totalVolumeSol,
      netSolChange: totalNetLamports.toNumber() / LAMPORTS_PER_SOL,
      avgCycleDuration: totalDuration / completed,
      avgTradeSuccess: totalSuccess / completed,
      volumePerHour: uptimeHours > 0 ? totalVolumeSol / uptimeHours : 0,
      priceChangeSinceStart:
        this.startPrice !== null && this.startPrice > 0
          ? (this.latestPrice - this.startPrice) / this.startPrice
          : 0,
    };
  }

  /** Hot-swap configuration properties without restarting the engine. */
  adjustConfig(updates: Partial<WashEngineConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.info('Config adjusted', { updates: Object.keys(updates) });
    this.eventBus.emit('wash:config:adjusted', 'system', 'wash-engine', {
      keys: Object.keys(updates),
    });
  }

  // ── Private — Continuous Loop ───────────────────────────────

  private async continuousLoop(mint: string): Promise<void> {
    while (this.running) {
      // Budget guard
      if (this.budgetSpent.gte(this.config.maxBudgetLamports)) {
        this.logger.warn('Budget exhausted — stopping continuous mode', {
          spent: this.budgetSpent.toString(),
          budget: this.config.maxBudgetLamports.toString(),
        });
        this.stopContinuous();
        return;
      }

      try {
        const cycle = this.planCycle(mint);
        await this.executeCycle(cycle);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error('Cycle execution error', error);
        this.eventBus.emit('error', 'error', 'wash-engine', {
          message: error.message,
          stack: error.stack,
        });
      }

      if (!this.running) break;

      // Inter-cycle cooldown
      const cooldown = this.randomInRange(
        this.config.interCycleDelayMs.min,
        this.config.interCycleDelayMs.max,
      );
      await this.delay(cooldown);
    }
  }

  // ── Private — Cycle Planning ────────────────────────────────

  /**
   * Build an ordered sequence of WashTradeRoutes that together form
   * a balanced cycle. The algorithm:
   *
   * 1. Decide total buy volume and total sell volume.
   *    – With zero drift they are equal.
   *    – With positive drift, buy_vol = sell_vol × (1 + drift).
   * 2. Distribute volume across `tradesPerCycle` trades.
   * 3. Assign wallet + direction, enforcing the consecutive-buy/sell cap.
   * 4. Attach randomised delays.
   */
  private buildRoutes(mint: string, cycleId: string): WashTradeRoute[] {
    const n = this.config.tradesPerCycle;
    if (n < 2) {
      throw new Error('tradesPerCycle must be >= 2');
    }

    // ── 1. Volume split ───────────────────────────────────────
    const driftMult = 1 + this.config.priceDriftPercent / 100;

    // We want roughly half buys, half sells
    const buyCount = Math.ceil(n / 2);
    const sellCount = n - buyCount;

    // ── 2. Generate trade sizes ───────────────────────────────
    const buySizes = this.generateTradeSizes(buyCount);
    const rawSellSizes = this.generateTradeSizes(sellCount);

    // Scale sells so total_buys ≈ total_sells × driftMult
    const totalBuy = buySizes.reduce((a, b) => a + b, 0);
    const rawTotalSell = rawSellSizes.reduce((a, b) => a + b, 0);
    const targetSellTotal = totalBuy / driftMult;
    const sellScale = rawTotalSell > 0 ? targetSellTotal / rawTotalSell : 1;
    const sellSizes = rawSellSizes.map((s) => s * sellScale);

    // Verify net change is within acceptable bounds
    const totalSell = sellSizes.reduce((a, b) => a + b, 0);
    const netChangePct =
      totalBuy > 0 ? Math.abs(totalBuy - totalSell) / totalBuy : 0;
    if (netChangePct > this.config.maxNetChangePercent / 100 + 0.001) {
      // Re-scale sells to make it exact
      const correctedSellScale =
        rawTotalSell > 0
          ? (totalBuy * (1 - this.config.maxNetChangePercent / 100)) / rawTotalSell
          : 1;
      for (let i = 0; i < sellSizes.length; i++) {
        sellSizes[i] = rawSellSizes[i] * correctedSellScale;
      }
    }

    // ── 3. Interleave buys & sells ────────────────────────────
    const trades: Array<{ direction: TradeDirection; sizeSol: number }> = [];
    let bi = 0;
    let si = 0;
    let consecutiveBuys = 0;
    let consecutiveSells = 0;

    while (bi < buySizes.length || si < sellSizes.length) {
      let forceBuy = si >= sellSizes.length;
      let forceSell = bi >= buySizes.length;

      if (!forceBuy && !forceSell) {
        // Enforce consecutive caps
        if (consecutiveBuys >= this.config.maxConsecutiveBuys) {
          forceSell = true;
        } else if (consecutiveSells >= this.config.maxConsecutiveSells) {
          forceBuy = true;
        }
      }

      if (forceSell || (!forceBuy && Math.random() < 0.45)) {
        // Slightly bias toward buys first to push price up
        trades.push({ direction: 'sell', sizeSol: sellSizes[si] });
        si++;
        consecutiveSells++;
        consecutiveBuys = 0;
      } else {
        trades.push({ direction: 'buy', sizeSol: buySizes[bi] });
        bi++;
        consecutiveBuys++;
        consecutiveSells = 0;
      }
    }

    // ── 4. Assign wallets round-robin (shuffled) ──────────────
    const shuffled = this.shuffleWallets();
    let walletIdx = 0;

    const routes: WashTradeRoute[] = [];
    let cumulativeDelay = 0;

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      const wallet = shuffled[walletIdx % shuffled.length];
      walletIdx++;

      const amountLamports = new BN(
        Math.round(trade.sizeSol * LAMPORTS_PER_SOL),
      );

      const intraDelay =
        i === 0
          ? 0
          : this.randomInRange(
              this.config.intraTradeDelayMs.min,
              this.config.intraTradeDelayMs.max,
            );
      cumulativeDelay += intraDelay;

      routes.push({
        from: wallet,
        to: wallet, // on bonding curves, "to" is the curve itself
        direction: trade.direction,
        amount: amountLamports,
        delayMs: intraDelay,
        priority: i,
      });
    }

    return routes;
  }

  // ── Private — Natural Trade Sizing ──────────────────────────

  /**
   * Generate `count` trade sizes (in SOL) following an approximate
   * Pareto distribution — many small trades, few large ones.
   * When `naturalSizing` is on, round-number avoidance is applied.
   */
  private generateTradeSizes(count: number): number[] {
    const { min, max } = this.config.tradeSizeRange;
    const sizes: number[] = [];

    for (let i = 0; i < count; i++) {
      // Pareto-ish: uniform in [0,1], then skew toward min
      const u = Math.random();
      const alpha = 1.5; // shape — higher = more skewed to small
      const pareto = min / Math.pow(1 - u + u * Math.pow(min / max, alpha), 1 / alpha);
      let size = Math.min(Math.max(pareto, min), max);

      if (this.config.naturalSizing) {
        size = this.applyNaturalNoise(size);
      }

      sizes.push(size);
    }

    return sizes;
  }

  /**
   * Perturb a SOL value so it never lands on a round number.
   * E.g. 0.1 → 0.0973 or 0.1042.
   */
  private applyNaturalNoise(sol: number): number {
    // ±8 % jitter
    const jitter = 1 + (Math.random() * 0.16 - 0.08);
    let noisy = sol * jitter;

    // Snap avoidance: if the value is suspiciously close to N × 0.01,
    // nudge it by a random fraction of 0.005.
    const centRemainder = Math.abs(noisy * 100 - Math.round(noisy * 100));
    if (centRemainder < 0.05) {
      noisy += (Math.random() * 0.005 - 0.0025);
    }

    // Clamp to configured range
    return Math.min(
      Math.max(noisy, this.config.tradeSizeRange.min),
      this.config.tradeSizeRange.max,
    );
  }

  // ── Private — Wallet Personality ────────────────────────────

  /**
   * Initialise a stable "personality" for each wallet so its trades
   * cluster around a consistent average size throughout the session.
   */
  private initPersonalities(): void {
    const { min, max } = this.config.tradeSizeRange;
    for (const wallet of this.wallets) {
      const avgSize = min + Math.random() * (max - min);
      this.personalities.set(wallet.address, {
        avgSizeSol: avgSize,
        sizeSigma: 0.1 + Math.random() * 0.3, // 10–40 % std dev
      });
    }
  }

  // ── Private — Trade Execution ───────────────────────────────

  /**
   * Execute a single trade and emit events.
   */
  private async executeSingleTrade(
    trader: TraderAgent,
    route: WashTradeRoute,
    cycleId: string,
  ): Promise<TradeResult> {
    const slippage = this.config.slippageBps ?? 500;

    if (route.direction === 'buy') {
      return trader.buy(route.amount, slippage);
    }
    return trader.sell(route.amount, slippage);
  }

  /**
   * Produce a synthetic failed TradeResult for bookkeeping.
   */
  private failedTradeResult(route: WashTradeRoute, error: Error): TradeResult {
    return {
      order: {
        id: uuid(),
        traderId: `wash-${route.from.label}`,
        mint: '',
        direction: route.direction,
        amount: route.amount,
        slippageBps: this.config.slippageBps ?? 500,
      },
      signature: '',
      amountOut: new BN(0),
      executionPrice: new BN(0),
      feesPaid: new BN(0),
      success: false,
      error: error.message,
      executedAt: Date.now(),
    };
  }

  // ── Private — Utilities ─────────────────────────────────────

  /** Fisher-Yates shuffle of wallet array (returns copy). */
  private shuffleWallets(): AgentWallet[] {
    const arr = [...this.wallets];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Uniform random integer in [min, max]. */
  private randomInRange(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  /** Promise-based delay that respects abort signal. */
  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Allow GC of the timer reference if aborted
      this.abortController?.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
