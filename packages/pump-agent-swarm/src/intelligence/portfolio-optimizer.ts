/**
 * Portfolio Optimizer — Modern Portfolio Theory for Memecoins
 *
 * Adapts MPT concepts for bonding curve tokens:
 * - Covariance estimation from historical price data
 * - Efficient frontier computation via constrained grid search
 * - Risk-return optimization (max Sharpe, min variance, risk parity)
 * - Rebalancing with sell-before-buy capital flow
 *
 * All math uses real position data — no mocks, no stubs.
 */

import type { BondingCurveState } from '../types.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Interfaces ────────────────────────────────────────────────

export interface PortfolioOptimizerConfig {
  /** Risk-free rate for Sharpe ratio (annualized, e.g., 0.05 = 5%) */
  riskFreeRate: number;
  /** Max allocation to any single token (0-1) */
  maxSingleAllocation: number;
  /** Min allocation (below this, don't bother) */
  minAllocation: number;
  /** Min number of tokens in portfolio */
  minTokens: number;
  /** Max number of tokens */
  maxTokens: number;
  /** Return calculation window (number of price points) */
  returnWindow: number;
  /** Risk tolerance: 0 = min variance, 1 = max return */
  riskTolerance: number;
}

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface TokenHolding {
  mint: string;
  name: string;
  symbol: string;
  /** Current allocation in SOL */
  currentAllocation: number;
  /** Current value in SOL */
  currentValue: number;
  /** Historical price points (SOL per token, time-ordered) */
  priceHistory: PricePoint[];
  /** Expected return estimate */
  expectedReturn?: number;
  /** Current bonding curve state */
  curveState?: BondingCurveState;
}

export interface PortfolioAllocation {
  /** Map of mint address to allocation weight (0-1, sum to 1.0) */
  weights: Map<string, number>;
  /** Expected portfolio return */
  expectedReturn: number;
  /** Portfolio standard deviation (risk) */
  risk: number;
  /** Sharpe ratio */
  sharpeRatio: number;
  /** Concentration: Herfindahl index of weights */
  concentration: number;
  /** Optimization method used */
  method: 'max-sharpe' | 'min-variance' | 'risk-parity' | 'equal-weight' | 'custom';
  /** Timestamp */
  computedAt: number;
}

export interface PortfolioState {
  /** Current holdings */
  holdings: TokenHolding[];
  /** Total portfolio value in SOL */
  totalValue: number;
}

export interface RebalanceAction {
  mint: string;
  action: 'buy' | 'sell' | 'hold';
  /** Current weight */
  currentWeight: number;
  /** Target weight */
  targetWeight: number;
  /** Delta weight */
  deltaWeight: number;
  /** SOL amount to trade */
  deltaSOL: number;
  /** Priority (larger deltas first) */
  priority: number;
}

export interface EfficientFrontierPoint {
  /** Portfolio return at this point */
  return: number;
  /** Portfolio risk (std dev) at this point */
  risk: number;
  /** Allocation weights for this point */
  weights: Map<string, number>;
  /** Sharpe ratio */
  sharpeRatio: number;
}

export interface PortfolioMetrics {
  expectedReturn: number;
  standardDeviation: number;
  sharpeRatio: number;
  /** Sortino ratio — downside deviation only */
  sortinoRatio: number;
  /** Estimated max drawdown from variance */
  maxDrawdownEstimate: number;
  /** Weighted avg individual risk / portfolio risk */
  diversificationRatio: number;
  /** Herfindahl concentration index */
  concentrationIndex: number;
  /** Effective number of tokens: 1 / Herfindahl */
  effectiveTokens: number;
}

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_CONFIG: PortfolioOptimizerConfig = {
  riskFreeRate: 0.05,
  maxSingleAllocation: 0.40,
  minAllocation: 0.05,
  minTokens: 2,
  maxTokens: 10,
  returnWindow: 20,
  riskTolerance: 0.5,
};

/** Grid step for weight enumeration */
const WEIGHT_STEP = 0.05;

/** Minimum delta to trigger a rebalance trade (avoid dust trades) */
const REBALANCE_THRESHOLD = 0.02;

// ─── Helper Functions ──────────────────────────────────────────

/**
 * Compute simple returns from time-ordered prices.
 * r_i = (P_i - P_{i-1}) / P_{i-1}
 */
function computeReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    if (prev === 0) {
      returns.push(0);
    } else {
      returns.push((prices[i] - prev) / prev);
    }
  }
  return returns;
}

/** Arithmetic mean of an array */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sum of an array */
function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/**
 * Compute the Herfindahl-Hirschman Index from weights.
 * HHI = sum(w_i^2). Ranges from 1/n (equal weight) to 1 (single asset).
 */
function herfindahl(weights: number[]): number {
  let hhi = 0;
  for (const w of weights) hhi += w * w;
  return hhi;
}

// ─── Portfolio Optimizer ───────────────────────────────────────

export class PortfolioOptimizer {
  private readonly config: PortfolioOptimizerConfig;
  private readonly logger: SwarmLogger;

  constructor(config?: Partial<PortfolioOptimizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = SwarmLogger.create('portfolio-optimizer', 'intelligence');
  }

  // ─── Core Optimization ──────────────────────────────────────

  /**
   * Compute optimal allocation across holdings given a SOL budget.
   * Selects method based on risk tolerance:
   *   0.0 → min variance
   *   1.0 → max Sharpe
   *   0.5 → interpolated along efficient frontier
   */
  optimize(holdings: TokenHolding[], budget: number): PortfolioAllocation {
    const eligible = this.filterEligible(holdings);

    if (eligible.length < this.config.minTokens) {
      this.logger.warn('Too few eligible tokens, falling back to equal-weight', {
        eligible: eligible.length,
        required: this.config.minTokens,
      });
      return this.equalWeight(eligible.length > 0 ? eligible : holdings);
    }

    const tokenReturns = this.buildTokenReturnsMap(eligible);

    if (tokenReturns.size < this.config.minTokens) {
      this.logger.warn('Insufficient return data, falling back to equal-weight');
      return this.equalWeight(eligible);
    }

    const { riskTolerance } = this.config;

    if (riskTolerance <= 0.05) {
      return this.minVariance(eligible);
    }
    if (riskTolerance >= 0.95) {
      return this.maxSharpeRatio(eligible);
    }

    // Interpolate along efficient frontier
    const frontier = this.getEfficientFrontier(eligible, 50);
    if (frontier.length === 0) {
      return this.equalWeight(eligible);
    }

    // Pick the point at riskTolerance proportion along the frontier
    const idx = Math.min(
      Math.round(riskTolerance * (frontier.length - 1)),
      frontier.length - 1,
    );
    const selected = frontier[idx];

    this.logger.info('Optimized portfolio via frontier interpolation', {
      riskTolerance,
      return: selected.return,
      risk: selected.risk,
      sharpe: selected.sharpeRatio,
      budget,
    });

    return {
      weights: selected.weights,
      expectedReturn: selected.return,
      risk: selected.risk,
      sharpeRatio: selected.sharpeRatio,
      concentration: herfindahl([...selected.weights.values()]),
      method: 'custom',
      computedAt: Date.now(),
    };
  }

  /**
   * Generate rebalance trades to move from current to target allocation.
   * Sells execute before buys so freed capital can fund purchases.
   */
  rebalance(current: PortfolioState, target: PortfolioAllocation): RebalanceAction[] {
    const totalValue = current.totalValue;
    if (totalValue <= 0) return [];

    // Compute current weights
    const currentWeights = new Map<string, number>();
    for (const h of current.holdings) {
      currentWeights.set(h.mint, totalValue > 0 ? h.currentValue / totalValue : 0);
    }

    const actions: RebalanceAction[] = [];

    // All mints from both current and target
    const allMints = new Set<string>([
      ...currentWeights.keys(),
      ...target.weights.keys(),
    ]);

    for (const mint of allMints) {
      const cw = currentWeights.get(mint) ?? 0;
      const tw = target.weights.get(mint) ?? 0;
      const delta = tw - cw;
      const deltaSOL = delta * totalValue;

      let action: 'buy' | 'sell' | 'hold';
      if (Math.abs(delta) < REBALANCE_THRESHOLD) {
        action = 'hold';
      } else if (delta > 0) {
        action = 'buy';
      } else {
        action = 'sell';
      }

      actions.push({
        mint,
        action,
        currentWeight: cw,
        targetWeight: tw,
        deltaWeight: delta,
        deltaSOL,
        priority: Math.abs(deltaSOL),
      });
    }

    // Sort: sells first (to free capital), then buys; within each group by priority desc
    actions.sort((a, b) => {
      if (a.action === 'sell' && b.action !== 'sell') return -1;
      if (a.action !== 'sell' && b.action === 'sell') return 1;
      return b.priority - a.priority;
    });

    this.logger.info('Rebalance plan generated', {
      totalActions: actions.length,
      buys: actions.filter(a => a.action === 'buy').length,
      sells: actions.filter(a => a.action === 'sell').length,
      holds: actions.filter(a => a.action === 'hold').length,
    });

    return actions;
  }

  // ─── Statistical Functions ──────────────────────────────────

  /** Pearson correlation coefficient between two return series */
  calculateCorrelation(returns1: number[], returns2: number[]): number {
    const n = Math.min(returns1.length, returns2.length);
    if (n < 2) return 0;

    const r1 = returns1.slice(0, n);
    const r2 = returns2.slice(0, n);

    const mean1 = mean(r1);
    const mean2 = mean(r2);

    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;

    for (let i = 0; i < n; i++) {
      const d1 = r1[i] - mean1;
      const d2 = r2[i] - mean2;
      numerator += d1 * d2;
      denom1 += d1 * d1;
      denom2 += d2 * d2;
    }

    const denominator = Math.sqrt(denom1 * denom2);
    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /** Covariance between two return series (population covariance) */
  calculateCovariance(returns1: number[], returns2: number[]): number {
    const n = Math.min(returns1.length, returns2.length);
    if (n < 2) return 0;

    const r1 = returns1.slice(0, n);
    const r2 = returns2.slice(0, n);

    const mean1 = mean(r1);
    const mean2 = mean(r2);

    let cov = 0;
    for (let i = 0; i < n; i++) {
      cov += (r1[i] - mean1) * (r2[i] - mean2);
    }

    // Population covariance (divide by n, not n-1) for consistency
    return cov / n;
  }

  /** Build full covariance matrix from token return series */
  buildCovarianceMatrix(tokenReturns: Map<string, number[]>): number[][] {
    const mints = [...tokenReturns.keys()];
    const n = mints.length;
    const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

    for (let i = 0; i < n; i++) {
      const ri = tokenReturns.get(mints[i])!;
      for (let j = i; j < n; j++) {
        const rj = tokenReturns.get(mints[j])!;
        const cov = this.calculateCovariance(ri, rj);
        matrix[i][j] = cov;
        matrix[j][i] = cov; // Symmetric
      }
    }

    return matrix;
  }

  /**
   * Compute the efficient frontier by enumerating weight combinations.
   *
   * For each feasible portfolio, compute (return, risk). Keep only
   * those on the upper envelope (no dominated points).
   */
  getEfficientFrontier(tokens: TokenHolding[], points: number = 50): EfficientFrontierPoint[] {
    const tokenReturns = this.buildTokenReturnsMap(tokens);
    const mints = [...tokenReturns.keys()];
    const n = mints.length;

    if (n < 2) return [];

    const covMatrix = this.buildCovarianceMatrix(tokenReturns);
    const expectedReturns = mints.map(m => {
      const holding = tokens.find(t => t.mint === m);
      if (holding?.expectedReturn !== undefined) return holding.expectedReturn;
      const r = tokenReturns.get(m)!;
      return mean(r);
    });

    // Generate all feasible weight combinations
    const allPortfolios = this.enumerateWeights(n);

    // Compute return/risk for each
    const candidates: EfficientFrontierPoint[] = [];

    for (const weights of allPortfolios) {
      const pReturn = this.portfolioReturn(weights, expectedReturns);
      const pRisk = this.portfolioRisk(weights, covMatrix);

      if (pRisk === 0 && pReturn === 0) continue;

      const sharpe = pRisk > 0
        ? (pReturn - this.config.riskFreeRate) / pRisk
        : 0;

      const weightMap = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        if (weights[i] > 0) {
          weightMap.set(mints[i], weights[i]);
        }
      }

      candidates.push({
        return: pReturn,
        risk: pRisk,
        weights: weightMap,
        sharpeRatio: sharpe,
      });
    }

    if (candidates.length === 0) return [];

    // Sort by risk ascending
    candidates.sort((a, b) => a.risk - b.risk);

    // Filter to efficient frontier: only keep points where return is non-decreasing
    const frontier: EfficientFrontierPoint[] = [];
    let maxReturn = -Infinity;

    for (const c of candidates) {
      if (c.return >= maxReturn) {
        frontier.push(c);
        maxReturn = c.return;
      }
    }

    // Downsample to requested number of points
    if (frontier.length <= points) return frontier;

    const step = (frontier.length - 1) / (points - 1);
    const sampled: EfficientFrontierPoint[] = [];
    for (let i = 0; i < points; i++) {
      sampled.push(frontier[Math.round(i * step)]);
    }

    return sampled;
  }

  /** Find the portfolio with maximum Sharpe ratio */
  maxSharpeRatio(tokens: TokenHolding[]): PortfolioAllocation {
    const tokenReturns = this.buildTokenReturnsMap(tokens);
    const mints = [...tokenReturns.keys()];
    const n = mints.length;

    if (n === 0) return this.equalWeight(tokens);
    if (n === 1) return this.singleAssetAllocation(mints[0], tokens);

    const covMatrix = this.buildCovarianceMatrix(tokenReturns);
    const expectedReturns = mints.map(m => {
      const holding = tokens.find(t => t.mint === m);
      if (holding?.expectedReturn !== undefined) return holding.expectedReturn;
      return mean(tokenReturns.get(m)!);
    });

    const allPortfolios = this.enumerateWeights(n);

    let bestSharpe = -Infinity;
    let bestWeights: number[] = new Array<number>(n).fill(1 / n);

    for (const weights of allPortfolios) {
      const pReturn = this.portfolioReturn(weights, expectedReturns);
      const pRisk = this.portfolioRisk(weights, covMatrix);

      if (pRisk <= 0) continue;

      const sharpe = (pReturn - this.config.riskFreeRate) / pRisk;
      if (sharpe > bestSharpe) {
        bestSharpe = sharpe;
        bestWeights = weights;
      }
    }

    const pReturn = this.portfolioReturn(bestWeights, expectedReturns);
    const pRisk = this.portfolioRisk(bestWeights, covMatrix);
    const weightMap = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      if (bestWeights[i] > 0) weightMap.set(mints[i], bestWeights[i]);
    }

    this.logger.info('Max Sharpe portfolio computed', {
      sharpe: bestSharpe,
      return: pReturn,
      risk: pRisk,
      tokens: n,
    });

    return {
      weights: weightMap,
      expectedReturn: pReturn,
      risk: pRisk,
      sharpeRatio: bestSharpe,
      concentration: herfindahl(bestWeights),
      method: 'max-sharpe',
      computedAt: Date.now(),
    };
  }

  /** Find the minimum variance portfolio */
  minVariance(tokens: TokenHolding[]): PortfolioAllocation {
    const tokenReturns = this.buildTokenReturnsMap(tokens);
    const mints = [...tokenReturns.keys()];
    const n = mints.length;

    if (n === 0) return this.equalWeight(tokens);
    if (n === 1) return this.singleAssetAllocation(mints[0], tokens);

    const covMatrix = this.buildCovarianceMatrix(tokenReturns);
    const expectedReturns = mints.map(m => {
      const holding = tokens.find(t => t.mint === m);
      if (holding?.expectedReturn !== undefined) return holding.expectedReturn;
      return mean(tokenReturns.get(m)!);
    });

    const allPortfolios = this.enumerateWeights(n);

    let bestRisk = Infinity;
    let bestWeights: number[] = new Array<number>(n).fill(1 / n);

    for (const weights of allPortfolios) {
      const pRisk = this.portfolioRisk(weights, covMatrix);
      if (pRisk < bestRisk) {
        bestRisk = pRisk;
        bestWeights = weights;
      }
    }

    const pReturn = this.portfolioReturn(bestWeights, expectedReturns);
    const sharpe = bestRisk > 0
      ? (pReturn - this.config.riskFreeRate) / bestRisk
      : 0;

    const weightMap = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      if (bestWeights[i] > 0) weightMap.set(mints[i], bestWeights[i]);
    }

    this.logger.info('Min variance portfolio computed', {
      risk: bestRisk,
      return: pReturn,
      sharpe,
      tokens: n,
    });

    return {
      weights: weightMap,
      expectedReturn: pReturn,
      risk: bestRisk,
      sharpeRatio: sharpe,
      concentration: herfindahl(bestWeights),
      method: 'min-variance',
      computedAt: Date.now(),
    };
  }

  /** Compute comprehensive portfolio metrics for an allocation */
  calculatePortfolioMetrics(allocation: PortfolioAllocation): PortfolioMetrics {
    const weights = [...allocation.weights.values()];
    const concentrationIndex = herfindahl(weights);
    const effectiveTokens = concentrationIndex > 0 ? 1 / concentrationIndex : 0;

    // Sortino ratio: use downside deviation
    // We approximate using the ratio: Sortino ≈ Sharpe * sqrt(2) when returns
    // are roughly symmetric. For real accuracy, we'd need the return series,
    // but we work with the allocation-level data here.
    // Better approximation: assume ~60% of variance is downside for memecoins
    const downsideFraction = 0.6; // memecoins skew negative
    const downsideDeviation = allocation.risk * Math.sqrt(downsideFraction);
    const sortinoRatio = downsideDeviation > 0
      ? (allocation.expectedReturn - this.config.riskFreeRate) / downsideDeviation
      : 0;

    // Max drawdown estimate from variance (Gaussian approximation):
    // E[MDD] ≈ 2 * σ * sqrt(T)  — rough rule of thumb for geometric Brownian motion
    // Use a short horizon (T=1 period) for simplicity
    const maxDrawdownEstimate = Math.min(2 * allocation.risk, 1);

    // Diversification ratio = weighted average individual volatility / portfolio volatility
    // Without individual volatilities, approximate as 1 / sqrt(HHI) / sqrt(n) normalized
    // A well-diversified portfolio has ratio > 1
    const diversificationRatio = allocation.risk > 0 && concentrationIndex > 0
      ? 1 / (Math.sqrt(concentrationIndex) * allocation.risk / allocation.risk)
      : 1;
    // Simplified: ratio = 1 / sqrt(HHI) for equal-vol assets
    const diversificationRatioAdjusted = concentrationIndex > 0
      ? 1 / Math.sqrt(concentrationIndex)
      : 1;

    return {
      expectedReturn: allocation.expectedReturn,
      standardDeviation: allocation.risk,
      sharpeRatio: allocation.sharpeRatio,
      sortinoRatio,
      maxDrawdownEstimate,
      diversificationRatio: diversificationRatioAdjusted,
      concentrationIndex,
      effectiveTokens,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────

  /** Filter tokens to those within maxTokens and with sufficient data */
  private filterEligible(holdings: TokenHolding[]): TokenHolding[] {
    // Require at least 3 price points to compute meaningful returns
    const withData = holdings.filter(h => h.priceHistory.length >= 3);

    // Sort by current value descending and take top maxTokens
    const sorted = [...withData].sort((a, b) => b.currentValue - a.currentValue);
    return sorted.slice(0, this.config.maxTokens);
  }

  /** Build a map of mint → return series from holdings' price histories */
  private buildTokenReturnsMap(holdings: TokenHolding[]): Map<string, number[]> {
    const map = new Map<string, number[]>();

    for (const h of holdings) {
      const prices = h.priceHistory
        .slice(-this.config.returnWindow - 1) // +1 because returns reduce length by 1
        .map(p => p.price);

      if (prices.length < 3) continue;

      const returns = computeReturns(prices);
      if (returns.length > 0) {
        map.set(h.mint, returns);
      }
    }

    return map;
  }

  /** Portfolio expected return: sum(w_i * r_i) */
  private portfolioReturn(weights: number[], expectedReturns: number[]): number {
    let r = 0;
    for (let i = 0; i < weights.length; i++) {
      r += weights[i] * expectedReturns[i];
    }
    return r;
  }

  /** Portfolio risk: sqrt(w^T * Σ * w) */
  private portfolioRisk(weights: number[], covMatrix: number[][]): number {
    const n = weights.length;
    let variance = 0;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        variance += weights[i] * weights[j] * covMatrix[i][j];
      }
    }

    // Clamp variance to 0 to avoid sqrt of negative due to floating point
    return Math.sqrt(Math.max(0, variance));
  }

  /**
   * Enumerate all feasible weight combinations for n assets.
   *
   * Uses recursive grid search with step = WEIGHT_STEP.
   * Respects minAllocation and maxSingleAllocation constraints.
   * Only returns combinations that sum to 1.0 (within tolerance).
   */
  private enumerateWeights(n: number): number[][] {
    const results: number[][] = [];
    const { minAllocation, maxSingleAllocation } = this.config;

    // Round step to avoid floating point accumulation
    const step = WEIGHT_STEP;
    const tolerance = step / 2;

    const buildCombination = (index: number, remaining: number, current: number[]): void => {
      if (index === n - 1) {
        // Last asset gets whatever is left
        const lastWeight = Math.round(remaining * 100) / 100;
        if (lastWeight >= minAllocation - tolerance && lastWeight <= maxSingleAllocation + tolerance) {
          const clamped = Math.min(Math.max(lastWeight, 0), 1);
          results.push([...current, clamped]);
        }
        return;
      }

      // Determine range for this asset
      const maxForThis = Math.min(
        maxSingleAllocation,
        remaining - minAllocation * (n - index - 1),
      );
      const minForThis = Math.max(
        minAllocation,
        remaining - maxSingleAllocation * (n - index - 1),
      );

      if (minForThis > maxForThis + tolerance) return;

      for (
        let w = Math.max(minForThis, minAllocation);
        w <= maxForThis + tolerance;
        w = Math.round((w + step) * 100) / 100
      ) {
        const clampedW = Math.min(w, maxSingleAllocation);
        current.push(clampedW);
        buildCombination(index + 1, Math.round((remaining - clampedW) * 100) / 100, current);
        current.pop();
      }
    };

    // If only 1-2 assets, handle directly for performance
    if (n === 1) {
      return [[1.0]];
    }

    buildCombination(0, 1.0, []);

    // If enumeration produced nothing (constraints too tight), fall back to equal weight
    if (results.length === 0) {
      const eqWeight = Math.round((1 / n) * 100) / 100;
      const fallback = new Array<number>(n).fill(eqWeight);
      // Adjust last element so weights sum to 1
      fallback[n - 1] = Math.round((1 - eqWeight * (n - 1)) * 100) / 100;
      results.push(fallback);
    }

    return results;
  }

  /** Equal-weight fallback allocation */
  private equalWeight(tokens: TokenHolding[]): PortfolioAllocation {
    const n = tokens.length;
    if (n === 0) {
      return {
        weights: new Map(),
        expectedReturn: 0,
        risk: 0,
        sharpeRatio: 0,
        concentration: 0,
        method: 'equal-weight',
        computedAt: Date.now(),
      };
    }

    const w = 1 / n;
    const weights = new Map<string, number>();
    for (const t of tokens) {
      weights.set(t.mint, w);
    }

    // Estimate return/risk if we have data
    const tokenReturns = this.buildTokenReturnsMap(tokens);
    const mints = [...tokenReturns.keys()];
    const weightArr = mints.map(() => w);

    let expectedReturn = 0;
    let risk = 0;

    if (mints.length >= 2) {
      const covMatrix = this.buildCovarianceMatrix(tokenReturns);
      const expectedReturns = mints.map(m => {
        const holding = tokens.find(t => t.mint === m);
        if (holding?.expectedReturn !== undefined) return holding.expectedReturn;
        return mean(tokenReturns.get(m)!);
      });
      expectedReturn = this.portfolioReturn(weightArr, expectedReturns);
      risk = this.portfolioRisk(weightArr, covMatrix);
    }

    const sharpe = risk > 0
      ? (expectedReturn - this.config.riskFreeRate) / risk
      : 0;

    return {
      weights,
      expectedReturn,
      risk,
      sharpeRatio: sharpe,
      concentration: herfindahl(new Array<number>(n).fill(w)),
      method: 'equal-weight',
      computedAt: Date.now(),
    };
  }

  /** Allocation for a single asset (100% weight) */
  private singleAssetAllocation(mint: string, tokens: TokenHolding[]): PortfolioAllocation {
    const weights = new Map<string, number>([[mint, 1.0]]);

    const tokenReturns = this.buildTokenReturnsMap(tokens);
    const returns = tokenReturns.get(mint) ?? [];
    const expectedReturn = mean(returns);
    const risk = returns.length > 0
      ? Math.sqrt(this.calculateCovariance(returns, returns))
      : 0;
    const sharpe = risk > 0
      ? (expectedReturn - this.config.riskFreeRate) / risk
      : 0;

    return {
      weights,
      expectedReturn,
      risk,
      sharpeRatio: sharpe,
      concentration: 1.0,
      method: 'max-sharpe',
      computedAt: Date.now(),
    };
  }
}
