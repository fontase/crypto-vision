/**
 * P&L Tracker — Real-time profit and loss tracking across all agent wallets
 *
 * Features:
 * - Realized/unrealized P&L breakdown per agent and swarm-wide
 * - FIFO cost basis matching for accurate realized P&L
 * - Time-series history for charting
 * - Drawdown tracking with max drawdown detection
 * - Sharpe ratio and ROI calculations
 * - Per-agent attribution and win/loss metrics
 * - CSV export for post-mortem analysis
 *
 * @example
 * ```typescript
 * import { SwarmEventBus } from '../infra/event-bus.js';
 * import { PnLTracker } from './pnl-tracker.js';
 *
 * const eventBus = SwarmEventBus.getInstance();
 * const tracker = new PnLTracker(eventBus);
 *
 * tracker.recordFunding('agent-1', new BN(1_000_000_000)); // 1 SOL
 * tracker.recordTrade({
 *   id: 'trade-1',
 *   agentId: 'agent-1',
 *   walletAddress: 'ABC...',
 *   mint: 'TOKEN...',
 *   direction: 'buy',
 *   solAmount: new BN(500_000_000),
 *   tokenAmount: new BN(1_000_000),
 *   price: 0.0005,
 *   fee: new BN(5_000),
 *   signature: 'sig...',
 *   timestamp: Date.now(),
 *   slippage: 0.5,
 * });
 *
 * const pnl = tracker.getSwarmPnL();
 * console.log('Total P&L:', pnl.totalPnl.toString());
 * ```
 */

import BN from 'bn.js';
import { v4 as uuidv4 } from 'uuid';

import { SwarmEventBus } from '../infra/event-bus.js';
import type { TradeDirection, SwarmEventCategory } from '../types.js';

// ─── Constants ────────────────────────────────────────────────

/** Source identifier for event bus emissions */
const EVENT_SOURCE = 'pnl-tracker';

/** Default time-series snapshot interval (1 minute) */
const DEFAULT_SNAPSHOT_INTERVAL_MS = 60_000;

/** Maximum time-series data points retained (24 hours at 1-min intervals) */
const MAX_TIME_SERIES_POINTS = 1_440;

/** Annualization factor (365 days in milliseconds) */
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1_000;

/** SOL decimals (1 SOL = 1e9 lamports) */
const LAMPORTS_PER_SOL = 1_000_000_000;

// ─── Types ────────────────────────────────────────────────────

/** A single executed trade record */
export interface TradeRecord {
  /** Unique trade identifier */
  id: string;
  /** Agent that executed the trade */
  agentId: string;
  /** Wallet address used */
  walletAddress: string;
  /** Token mint address */
  mint: string;
  /** Buy or sell */
  direction: TradeDirection;
  /** SOL amount in lamports */
  solAmount: BN;
  /** Token amount (raw integer units) */
  tokenAmount: BN;
  /** SOL per token at execution */
  price: number;
  /** Transaction fee paid in lamports */
  fee: BN;
  /** On-chain transaction signature */
  signature: string;
  /** Execution timestamp (ms since epoch) */
  timestamp: number;
  /** Slippage percentage experienced */
  slippage: number;
}

/** Per-agent P&L summary */
export interface AgentPnL {
  /** Agent identifier */
  agentId: string;
  /** Initial SOL allocated to this agent */
  solDeployed: BN;
  /** Total SOL spent on buys (including fees) */
  solSpent: BN;
  /** Total SOL received from sells */
  solReceived: BN;
  /** SOL received minus SOL spent for completed round-trips */
  realizedPnl: BN;
  /** Market value of remaining tokens minus their cost basis */
  unrealizedPnl: BN;
  /** realized + unrealized */
  totalPnl: BN;
  /** Total P&L as percentage of SOL deployed */
  totalPnlPercent: number;
  /** Tokens currently held (aggregate across mints) */
  tokensHeld: BN;
  /** Total cost basis of held tokens */
  costBasis: BN;
  /** Current market value of held tokens */
  currentValue: BN;
  /** Total number of trades */
  tradesCount: number;
  /** Number of winning round-trips */
  winCount: number;
  /** Number of losing round-trips */
  lossCount: number;
  /** Win rate (0-1) */
  winRate: number;
  /** Average winning trade P&L in lamports */
  avgWin: number;
  /** Average losing trade P&L in lamports (negative) */
  avgLoss: number;
  /** Best single trade by realized P&L */
  bestTrade: TradeRecord | null;
  /** Worst single trade by realized P&L */
  worstTrade: TradeRecord | null;
  /** Maximum drawdown in lamports */
  maxDrawdown: BN;
  /** Maximum drawdown as percentage */
  maxDrawdownPercent: number;
}

/** Swarm-wide P&L aggregation */
export interface SwarmPnL {
  /** Total SOL deployed across all agents */
  totalSolDeployed: BN;
  /** Aggregate realized P&L */
  totalRealizedPnl: BN;
  /** Aggregate unrealized P&L */
  totalUnrealizedPnl: BN;
  /** Total P&L (realized + unrealized) */
  totalPnl: BN;
  /** Total P&L as percentage of deployed */
  totalPnlPercent: number;
  /** Total number of trades across all agents */
  totalTrades: number;
  /** Total SOL volume traded */
  totalVolume: BN;
  /** Swarm-wide ROI percentage */
  swarmROI: number;
  /** Timestamp when tracking started */
  startedAt: number;
  /** Duration in ms since tracking started */
  duration: number;
  /** Per-agent breakdown */
  agentBreakdown: AgentPnL[];
}

/** A single time-series data point */
export interface PnLDataPoint {
  /** Timestamp of the snapshot */
  timestamp: number;
  /** Total P&L at this point */
  totalPnl: BN;
  /** Realized P&L at this point */
  realizedPnl: BN;
  /** Unrealized P&L at this point */
  unrealizedPnl: BN;
  /** Portfolio value at this point */
  portfolioValue: BN;
  /** Number of active agents at this point */
  activeAgents: number;
}

/** Drawdown information */
export interface DrawdownInfo {
  /** Current portfolio value */
  currentValue: BN;
  /** Peak portfolio value seen */
  peakValue: BN;
  /** Current drawdown amount */
  currentDrawdown: BN;
  /** Current drawdown as percentage */
  currentDrawdownPercent: number;
  /** Maximum drawdown amount ever observed */
  maxDrawdown: BN;
  /** Maximum drawdown as percentage */
  maxDrawdownPercent: number;
  /** Timestamp when peak was reached */
  peakTimestamp: number;
  /** Duration in ms since peak (current drawdown duration) */
  drawdownDuration: number;
  /** Maximum drawdown duration in ms */
  maxDrawdownDuration: number;
}

/** Full P&L snapshot for serialization */
export interface PnLSnapshot {
  /** Snapshot timestamp */
  timestamp: number;
  /** Swarm-wide P&L */
  swarmPnL: SwarmPnL;
  /** Drawdown state */
  drawdown: DrawdownInfo;
  /** ROI metrics */
  roi: { absolute: BN; percent: number; annualized: number };
  /** Sharpe ratio */
  sharpeRatio: number;
  /** Time-series data */
  timeSeries: PnLDataPoint[];
  /** All trade records */
  trades: TradeRecord[];
}

/** FIFO lot for cost basis tracking */
interface FIFOLot {
  /** Tokens remaining in this lot */
  tokensRemaining: BN;
  /** Original token amount in this lot */
  originalTokens: BN;
  /** SOL cost per token for this lot (lamports, scaled by 1e9 for precision) */
  costPerTokenScaled: BN;
  /** Total SOL cost for original purchase */
  totalCost: BN;
  /** Timestamp of the buy */
  timestamp: number;
  /** Trade ID that created this lot */
  tradeId: string;
}

/** Internal per-agent state */
interface AgentState {
  agentId: string;
  solDeployed: BN;
  solSpent: BN;
  solReceived: BN;
  realizedPnl: BN;
  /** FIFO lots per mint: mint → FIFOLot[] */
  fifoLots: Map<string, FIFOLot[]>;
  /** Current price per mint */
  currentPrices: Map<string, number>;
  trades: TradeRecord[];
  /** Realized P&L per sell trade for win/loss tracking */
  sellPnLs: Array<{ pnl: BN; trade: TradeRecord }>;
  /** Peak portfolio value for per-agent drawdown */
  peakValue: BN;
  maxDrawdown: BN;
}

// ─── Helpers ──────────────────────────────────────────────────

/** Convert BN lamports to a floating-point SOL number */
function bnToSol(lamports: BN): number {
  return lamports.toNumber() / LAMPORTS_PER_SOL;
}

/** Safe percentage: (numerator / denominator) * 100, returns 0 if denominator is zero */
function safePercent(numerator: BN, denominator: BN): number {
  if (denominator.isZero()) return 0;
  // Scale numerator by 10000 for 2 decimal precision, then divide
  const scaled = numerator.mul(new BN(10_000)).div(denominator);
  return scaled.toNumber() / 100;
}

/** Compute standard deviation of an array of numbers */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance =
    squaredDiffs.reduce((sum, d) => sum + d, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ─── PnLTracker ───────────────────────────────────────────────

export class PnLTracker {
  private readonly eventBus: SwarmEventBus;
  private readonly agents = new Map<string, AgentState>();
  private readonly allTrades: TradeRecord[] = [];
  private readonly timeSeries: PnLDataPoint[] = [];
  private readonly startedAt: number;

  // Drawdown state
  private peakPortfolioValue: BN = new BN(0);
  private peakTimestamp: number = 0;
  private maxDrawdown: BN = new BN(0);
  private maxDrawdownPercent: number = 0;
  private maxDrawdownDuration: number = 0;
  private drawdownStartTimestamp: number = 0;

  // Time-series auto-snapshot timer
  private snapshotTimer: ReturnType<typeof setInterval> | undefined;

  constructor(eventBus: SwarmEventBus) {
    this.eventBus = eventBus;
    this.startedAt = Date.now();
    this.peakTimestamp = this.startedAt;

    this.subscribeToEvents();
    this.startAutoSnapshot(DEFAULT_SNAPSHOT_INTERVAL_MS);
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Record a completed trade for P&L tracking.
   * Updates FIFO cost basis, realized/unrealized P&L, and drawdown state.
   */
  recordTrade(trade: TradeRecord): void {
    const agent = this.getOrCreateAgent(trade.agentId);
    agent.trades.push(trade);
    this.allTrades.push(trade);

    // Update current price for this mint
    agent.currentPrices.set(trade.mint, trade.price);

    if (trade.direction === 'buy') {
      this.processBuy(agent, trade);
    } else {
      this.processSell(agent, trade);
    }

    this.updateDrawdown();
    this.emitTradeEvent(trade);
  }

  /**
   * Record initial SOL funding for an agent.
   * This establishes the capital base for ROI calculations.
   */
  recordFunding(agentId: string, solAmount: BN): void {
    const agent = this.getOrCreateAgent(agentId);
    agent.solDeployed = agent.solDeployed.add(solAmount);

    this.eventBus.emit({
      id: uuidv4(),
      type: 'pnl:funding',
      category: 'trading' as SwarmEventCategory,
      source: EVENT_SOURCE,
      payload: {
        agentId,
        solAmount: solAmount.toString(),
        totalDeployed: agent.solDeployed.toString(),
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Get P&L breakdown for a single agent.
   */
  getAgentPnL(agentId: string): AgentPnL {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return this.emptyAgentPnL(agentId);
    }
    return this.computeAgentPnL(agent);
  }

  /**
   * Get swarm-wide aggregated P&L across all agents.
   */
  getSwarmPnL(): SwarmPnL {
    const agentBreakdown = Array.from(this.agents.values()).map((a) =>
      this.computeAgentPnL(a),
    );

    const totalSolDeployed = agentBreakdown.reduce(
      (sum, a) => sum.add(a.solDeployed),
      new BN(0),
    );
    const totalRealizedPnl = agentBreakdown.reduce(
      (sum, a) => sum.add(a.realizedPnl),
      new BN(0),
    );
    const totalUnrealizedPnl = agentBreakdown.reduce(
      (sum, a) => sum.add(a.unrealizedPnl),
      new BN(0),
    );
    const totalPnl = totalRealizedPnl.add(totalUnrealizedPnl);
    const totalTrades = agentBreakdown.reduce(
      (sum, a) => sum + a.tradesCount,
      0,
    );
    const totalVolume = this.allTrades.reduce(
      (sum, t) => sum.add(t.solAmount),
      new BN(0),
    );

    const now = Date.now();
    return {
      totalSolDeployed,
      totalRealizedPnl,
      totalUnrealizedPnl,
      totalPnl,
      totalPnlPercent: safePercent(totalPnl, totalSolDeployed),
      totalTrades,
      totalVolume,
      swarmROI: safePercent(totalPnl, totalSolDeployed),
      startedAt: this.startedAt,
      duration: now - this.startedAt,
      agentBreakdown,
    };
  }

  /**
   * Get time-series P&L data for charting.
   * @param intervalMs Bucket interval in milliseconds
   * @param since Only return points after this timestamp (ms)
   */
  getTimeSeries(intervalMs: number, since?: number): PnLDataPoint[] {
    let points = this.timeSeries;

    if (since !== undefined) {
      points = points.filter((p) => p.timestamp >= since);
    }

    if (intervalMs <= 0) return points;

    // Downsample by selecting the last point in each interval bucket
    if (points.length === 0) return [];

    const firstTs = points[0].timestamp;
    const buckets = new Map<number, PnLDataPoint>();

    for (const point of points) {
      const bucketKey = Math.floor((point.timestamp - firstTs) / intervalMs);
      buckets.set(bucketKey, point);
    }

    return Array.from(buckets.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  /**
   * Get current drawdown information.
   */
  getDrawdown(): DrawdownInfo {
    const currentValue = this.computePortfolioValue();
    const now = Date.now();
    const currentDrawdown = this.peakPortfolioValue.gt(currentValue)
      ? this.peakPortfolioValue.sub(currentValue)
      : new BN(0);
    const currentDrawdownPercent = safePercent(
      currentDrawdown,
      this.peakPortfolioValue,
    );

    const drawdownDuration =
      currentDrawdown.gtn(0) && this.drawdownStartTimestamp > 0
        ? now - this.drawdownStartTimestamp
        : 0;

    return {
      currentValue,
      peakValue: this.peakPortfolioValue,
      currentDrawdown,
      currentDrawdownPercent,
      maxDrawdown: this.maxDrawdown,
      maxDrawdownPercent: this.maxDrawdownPercent,
      peakTimestamp: this.peakTimestamp,
      drawdownDuration,
      maxDrawdownDuration: this.maxDrawdownDuration,
    };
  }

  /**
   * Get ROI metrics.
   */
  getROI(): { absolute: BN; percent: number; annualized: number } {
    const swarm = this.getSwarmPnL();
    const absolute = swarm.totalPnl;
    const percent = safePercent(absolute, swarm.totalSolDeployed);
    const durationMs = Date.now() - this.startedAt;

    // Annualized return: (1 + r)^(365d / duration) - 1
    let annualized = 0;
    if (durationMs > 0 && !swarm.totalSolDeployed.isZero()) {
      const rawReturn = percent / 100;
      const yearFraction = durationMs / MS_PER_YEAR;
      if (yearFraction > 0 && rawReturn > -1) {
        annualized = (Math.pow(1 + rawReturn, 1 / yearFraction) - 1) * 100;
      }
    }

    return { absolute, percent, annualized };
  }

  /**
   * Calculate Sharpe ratio using time-series returns.
   * @param riskFreeRate Annual risk-free rate (default 0.05 = 5%)
   */
  getSharpeRatio(riskFreeRate: number = 0.05): number {
    if (this.timeSeries.length < 2) return 0;

    // Calculate period returns from time-series
    const returns: number[] = [];
    for (let i = 1; i < this.timeSeries.length; i++) {
      const prevValue = this.timeSeries[i - 1].portfolioValue;
      const curValue = this.timeSeries[i].portfolioValue;
      if (prevValue.gtn(0)) {
        const periodReturn =
          (curValue.toNumber() - prevValue.toNumber()) / prevValue.toNumber();
        returns.push(periodReturn);
      }
    }

    if (returns.length < 2) return 0;

    // Average interval between snapshots
    const totalDuration =
      this.timeSeries[this.timeSeries.length - 1].timestamp -
      this.timeSeries[0].timestamp;
    const avgIntervalMs = totalDuration / (this.timeSeries.length - 1);
    const periodsPerYear = MS_PER_YEAR / avgIntervalMs;

    // Per-period risk-free rate
    const rfPerPeriod = Math.pow(1 + riskFreeRate, 1 / periodsPerYear) - 1;

    const excessReturns = returns.map((r) => r - rfPerPeriod);
    const meanExcess =
      excessReturns.reduce((s, r) => s + r, 0) / excessReturns.length;
    const stdDev = standardDeviation(excessReturns);

    if (stdDev === 0) return meanExcess > 0 ? Infinity : 0;

    // Annualize Sharpe ratio
    return (meanExcess / stdDev) * Math.sqrt(periodsPerYear);
  }

  /**
   * Get filtered trade history.
   */
  getTradeHistory(options?: {
    agentId?: string;
    direction?: string;
    limit?: number;
  }): TradeRecord[] {
    let trades = [...this.allTrades];

    if (options?.agentId) {
      trades = trades.filter((t) => t.agentId === options.agentId);
    }
    if (options?.direction) {
      trades = trades.filter((t) => t.direction === options.direction);
    }

    // Sort newest first
    trades.sort((a, b) => b.timestamp - a.timestamp);

    if (options?.limit !== undefined && options.limit > 0) {
      trades = trades.slice(0, options.limit);
    }

    return trades;
  }

  /**
   * Export all trade data as CSV for post-mortem analysis.
   */
  exportCSV(): string {
    const headers = [
      'id',
      'agentId',
      'walletAddress',
      'mint',
      'direction',
      'solAmount',
      'tokenAmount',
      'price',
      'fee',
      'signature',
      'timestamp',
      'slippage',
      'realizedPnl',
    ].join(',');

    const rows = this.allTrades.map((t) => {
      // Look up realized P&L for sells
      let realizedPnl = '0';
      if (t.direction === 'sell') {
        const agent = this.agents.get(t.agentId);
        if (agent) {
          const sellEntry = agent.sellPnLs.find(
            (s) => s.trade.id === t.id,
          );
          if (sellEntry) {
            realizedPnl = sellEntry.pnl.toString();
          }
        }
      }

      return [
        t.id,
        t.agentId,
        t.walletAddress,
        t.mint,
        t.direction,
        t.solAmount.toString(),
        t.tokenAmount.toString(),
        t.price.toFixed(12),
        t.fee.toString(),
        t.signature,
        t.timestamp,
        t.slippage.toFixed(4),
        realizedPnl,
      ].join(',');
    });

    return [headers, ...rows].join('\n');
  }

  /**
   * Create a full serializable snapshot of the current P&L state.
   */
  snapshot(): PnLSnapshot {
    return {
      timestamp: Date.now(),
      swarmPnL: this.getSwarmPnL(),
      drawdown: this.getDrawdown(),
      roi: this.getROI(),
      sharpeRatio: this.getSharpeRatio(),
      timeSeries: [...this.timeSeries],
      trades: [...this.allTrades],
    };
  }

  /**
   * Update the current market price for a mint across all agents holding it.
   * Call this periodically with live price data for accurate unrealized P&L.
   */
  updatePrice(mint: string, price: number): void {
    for (const agent of this.agents.values()) {
      if (agent.fifoLots.has(mint)) {
        agent.currentPrices.set(mint, price);
      }
    }
    this.updateDrawdown();
  }

  /**
   * Stop auto-snapshot timer. Call on shutdown to prevent leaks.
   */
  destroy(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  // ─── FIFO Cost Basis Engine ─────────────────────────────────

  /**
   * Process a buy trade: create a new FIFO lot.
   */
  private processBuy(agent: AgentState, trade: TradeRecord): void {
    const totalCost = trade.solAmount.add(trade.fee);
    agent.solSpent = agent.solSpent.add(totalCost);

    // Create FIFO lot
    const lots = agent.fifoLots.get(trade.mint) ?? [];

    // Cost per token scaled by 1e9 for precision: (totalCost * 1e9) / tokenAmount
    const costPerTokenScaled = trade.tokenAmount.gtn(0)
      ? totalCost.mul(new BN(LAMPORTS_PER_SOL)).div(trade.tokenAmount)
      : new BN(0);

    lots.push({
      tokensRemaining: trade.tokenAmount.clone(),
      originalTokens: trade.tokenAmount.clone(),
      costPerTokenScaled,
      totalCost,
      timestamp: trade.timestamp,
      tradeId: trade.id,
    });

    agent.fifoLots.set(trade.mint, lots);
  }

  /**
   * Process a sell trade: match against FIFO lots and compute realized P&L.
   */
  private processSell(agent: AgentState, trade: TradeRecord): void {
    const solReceived = trade.solAmount.sub(trade.fee);
    agent.solReceived = agent.solReceived.add(solReceived);

    const lots = agent.fifoLots.get(trade.mint) ?? [];
    let tokensToMatch = trade.tokenAmount.clone();
    let costBasisMatched = new BN(0);

    // FIFO: consume oldest lots first
    while (tokensToMatch.gtn(0) && lots.length > 0) {
      const oldest = lots[0];

      if (oldest.tokensRemaining.lte(tokensToMatch)) {
        // Consume entire lot
        const lotCost = oldest.tokensRemaining
          .mul(oldest.costPerTokenScaled)
          .div(new BN(LAMPORTS_PER_SOL));
        costBasisMatched = costBasisMatched.add(lotCost);
        tokensToMatch = tokensToMatch.sub(oldest.tokensRemaining);
        lots.shift();
      } else {
        // Partially consume lot
        const lotCost = tokensToMatch
          .mul(oldest.costPerTokenScaled)
          .div(new BN(LAMPORTS_PER_SOL));
        costBasisMatched = costBasisMatched.add(lotCost);
        oldest.tokensRemaining = oldest.tokensRemaining.sub(tokensToMatch);
        tokensToMatch = new BN(0);
      }
    }

    // Realized P&L for this sell = SOL received - cost basis of matched tokens
    const realized = solReceived.sub(costBasisMatched);
    agent.realizedPnl = agent.realizedPnl.add(realized);

    agent.sellPnLs.push({ pnl: realized, trade });

    agent.fifoLots.set(trade.mint, lots);
  }

  // ─── Agent P&L Computation ──────────────────────────────────

  private computeAgentPnL(agent: AgentState): AgentPnL {
    // Calculate unrealized P&L across all mints
    let totalTokensHeld = new BN(0);
    let totalCostBasis = new BN(0);
    let totalCurrentValue = new BN(0);

    for (const [mint, lots] of agent.fifoLots) {
      const price = agent.currentPrices.get(mint) ?? 0;

      for (const lot of lots) {
        totalTokensHeld = totalTokensHeld.add(lot.tokensRemaining);

        // Cost basis for remaining tokens
        const lotCost = lot.tokensRemaining
          .mul(lot.costPerTokenScaled)
          .div(new BN(LAMPORTS_PER_SOL));
        totalCostBasis = totalCostBasis.add(lotCost);

        // Current value: tokens * price (convert price from SOL to lamports)
        const priceLamports = new BN(
          Math.round(price * LAMPORTS_PER_SOL),
        );
        const value = lot.tokensRemaining.mul(priceLamports).div(new BN(LAMPORTS_PER_SOL));
        totalCurrentValue = totalCurrentValue.add(value);
      }
    }

    const unrealizedPnl = totalCurrentValue.sub(totalCostBasis);
    const totalPnl = agent.realizedPnl.add(unrealizedPnl);

    // Win/loss analysis from completed sells
    let winCount = 0;
    let lossCount = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;
    let bestTrade: TradeRecord | null = null;
    let worstTrade: TradeRecord | null = null;
    let bestPnl = new BN(0);
    let worstPnl = new BN(0);

    for (const entry of agent.sellPnLs) {
      if (entry.pnl.gtn(0)) {
        winCount++;
        totalWinAmount += entry.pnl.toNumber();
        if (entry.pnl.gt(bestPnl)) {
          bestPnl = entry.pnl;
          bestTrade = entry.trade;
        }
      } else if (entry.pnl.ltn(0)) {
        lossCount++;
        totalLossAmount += entry.pnl.toNumber();
        if (entry.pnl.lt(worstPnl)) {
          worstPnl = entry.pnl;
          worstTrade = entry.trade;
        }
      }
    }

    const totalRoundTrips = winCount + lossCount;
    const winRate = totalRoundTrips > 0 ? winCount / totalRoundTrips : 0;
    const avgWin = winCount > 0 ? totalWinAmount / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLossAmount / lossCount : 0;

    // Per-agent drawdown
    const portfolioValue = agent.solDeployed.add(totalPnl);
    if (portfolioValue.gt(agent.peakValue)) {
      agent.peakValue = portfolioValue.clone();
    }
    const drawdown = agent.peakValue.gt(portfolioValue)
      ? agent.peakValue.sub(portfolioValue)
      : new BN(0);
    if (drawdown.gt(agent.maxDrawdown)) {
      agent.maxDrawdown = drawdown.clone();
    }
    const maxDrawdownPercent = safePercent(agent.maxDrawdown, agent.peakValue);

    return {
      agentId: agent.agentId,
      solDeployed: agent.solDeployed,
      solSpent: agent.solSpent,
      solReceived: agent.solReceived,
      realizedPnl: agent.realizedPnl,
      unrealizedPnl,
      totalPnl,
      totalPnlPercent: safePercent(totalPnl, agent.solDeployed),
      tokensHeld: totalTokensHeld,
      costBasis: totalCostBasis,
      currentValue: totalCurrentValue,
      tradesCount: agent.trades.length,
      winCount,
      lossCount,
      winRate,
      avgWin,
      avgLoss,
      bestTrade,
      worstTrade,
      maxDrawdown: agent.maxDrawdown,
      maxDrawdownPercent,
    };
  }

  private emptyAgentPnL(agentId: string): AgentPnL {
    return {
      agentId,
      solDeployed: new BN(0),
      solSpent: new BN(0),
      solReceived: new BN(0),
      realizedPnl: new BN(0),
      unrealizedPnl: new BN(0),
      totalPnl: new BN(0),
      totalPnlPercent: 0,
      tokensHeld: new BN(0),
      costBasis: new BN(0),
      currentValue: new BN(0),
      tradesCount: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      bestTrade: null,
      worstTrade: null,
      maxDrawdown: new BN(0),
      maxDrawdownPercent: 0,
    };
  }

  // ─── Portfolio & Drawdown ───────────────────────────────────

  /**
   * Compute total portfolio value: sum of (solDeployed + totalPnl) per agent
   */
  private computePortfolioValue(): BN {
    let value = new BN(0);
    for (const agent of this.agents.values()) {
      const pnl = this.computeAgentPnL(agent);
      value = value.add(pnl.solDeployed.add(pnl.totalPnl));
    }
    return value;
  }

  /**
   * Update global drawdown tracking after any trade or price change.
   */
  private updateDrawdown(): void {
    const currentValue = this.computePortfolioValue();
    const now = Date.now();

    if (currentValue.gt(this.peakPortfolioValue)) {
      this.peakPortfolioValue = currentValue.clone();
      this.peakTimestamp = now;
      // Reset drawdown start since we hit new peak
      this.drawdownStartTimestamp = 0;
    }

    if (this.peakPortfolioValue.gtn(0)) {
      const drawdown = this.peakPortfolioValue.sub(currentValue);
      const drawdownPercent = safePercent(drawdown, this.peakPortfolioValue);

      if (drawdown.gtn(0) && this.drawdownStartTimestamp === 0) {
        this.drawdownStartTimestamp = now;
      }

      if (drawdown.gt(this.maxDrawdown)) {
        this.maxDrawdown = drawdown.clone();
        this.maxDrawdownPercent = drawdownPercent;
      }

      // Track max drawdown duration
      if (drawdown.gtn(0) && this.drawdownStartTimestamp > 0) {
        const duration = now - this.drawdownStartTimestamp;
        if (duration > this.maxDrawdownDuration) {
          this.maxDrawdownDuration = duration;
        }
      }

      // Emit alert on significant drawdown (>10%)
      if (drawdownPercent > 10) {
        this.eventBus.emit({
          id: uuidv4(),
          type: 'pnl:drawdown-alert',
          category: 'trading' as SwarmEventCategory,
          source: EVENT_SOURCE,
          payload: {
            currentValue: currentValue.toString(),
            peakValue: this.peakPortfolioValue.toString(),
            drawdownPercent,
            maxDrawdownPercent: this.maxDrawdownPercent,
          },
          timestamp: now,
        });
      }
    }
  }

  // ─── Time-Series ────────────────────────────────────────────

  /**
   * Start auto-capture of time-series snapshots at the given interval.
   */
  private startAutoSnapshot(intervalMs: number): void {
    this.snapshotTimer = setInterval(() => {
      this.captureTimeSeriesPoint();
    }, intervalMs);
  }

  /**
   * Capture a single time-series data point with current state.
   */
  private captureTimeSeriesPoint(): void {
    const swarm = this.getSwarmPnL();
    const portfolioValue = this.computePortfolioValue();
    const activeAgents = Array.from(this.agents.values()).filter(
      (a) => a.trades.length > 0,
    ).length;

    const point: PnLDataPoint = {
      timestamp: Date.now(),
      totalPnl: swarm.totalPnl,
      realizedPnl: swarm.totalRealizedPnl,
      unrealizedPnl: swarm.totalUnrealizedPnl,
      portfolioValue,
      activeAgents,
    };

    this.timeSeries.push(point);

    // Trim to maximum capacity
    while (this.timeSeries.length > MAX_TIME_SERIES_POINTS) {
      this.timeSeries.shift();
    }
  }

  // ─── Event Bus Integration ──────────────────────────────────

  /**
   * Subscribe to trade events on the event bus for automatic tracking.
   */
  private subscribeToEvents(): void {
    this.eventBus.subscribe('trade:executed', {
      handler: (event) => {
        const payload = event.payload as Record<string, unknown>;
        // Auto-ingest trades from the event bus if they include our fields
        if (
          payload['tradeRecord'] &&
          typeof payload['tradeRecord'] === 'object'
        ) {
          const record = payload['tradeRecord'] as TradeRecord;
          // Avoid duplicate processing if already recorded via direct call
          if (!this.allTrades.some((t) => t.id === record.id)) {
            this.recordTrade(record);
          }
        }
      },
      source: EVENT_SOURCE,
    });

    this.eventBus.subscribe('wallet:funded', {
      handler: (event) => {
        const payload = event.payload as Record<string, unknown>;
        if (
          typeof payload['agentId'] === 'string' &&
          payload['solAmount']
        ) {
          const agentId = payload['agentId'] as string;
          const solAmount = new BN(payload['solAmount'] as string);
          // Avoid duplicate processing
          const agent = this.agents.get(agentId);
          if (!agent || agent.solDeployed.isZero()) {
            this.recordFunding(agentId, solAmount);
          }
        }
      },
      source: EVENT_SOURCE,
    });
  }

  /**
   * Emit a P&L update event after each trade.
   */
  private emitTradeEvent(trade: TradeRecord): void {
    const agentPnl = this.getAgentPnL(trade.agentId);
    this.eventBus.emit({
      id: uuidv4(),
      type: 'pnl:updated',
      category: 'trading' as SwarmEventCategory,
      source: EVENT_SOURCE,
      payload: {
        tradeId: trade.id,
        agentId: trade.agentId,
        direction: trade.direction,
        realizedPnl: agentPnl.realizedPnl.toString(),
        unrealizedPnl: agentPnl.unrealizedPnl.toString(),
        totalPnl: agentPnl.totalPnl.toString(),
        totalPnlPercent: agentPnl.totalPnlPercent,
        winRate: agentPnl.winRate,
      },
      timestamp: Date.now(),
    });
  }

  // ─── Internal Helpers ───────────────────────────────────────

  /**
   * Get or create internal state for an agent.
   */
  private getOrCreateAgent(agentId: string): AgentState {
    let agent = this.agents.get(agentId);
    if (!agent) {
      agent = {
        agentId,
        solDeployed: new BN(0),
        solSpent: new BN(0),
        solReceived: new BN(0),
        realizedPnl: new BN(0),
        fifoLots: new Map(),
        currentPrices: new Map(),
        trades: [],
        sellPnLs: [],
        peakValue: new BN(0),
        maxDrawdown: new BN(0),
      };
      this.agents.set(agentId, agent);
    }
    return agent;
  }
}
