/**
 * Dev Buy Optimizer — Bonding Curve Analysis for Optimal Token Creation Buys
 *
 * Calculates the optimal dev buy size at token creation on Pump.fun.
 * The dev buy is the atomic purchase that occurs in the same transaction
 * as token creation. This analyzer considers bonding curve parameters,
 * target supply ownership, SOL budget constraints, and price impact to
 * recommend the ideal amount.
 *
 * Bonding curve math:
 *   Pump.fun uses constant product: virtualSolReserves × virtualTokenReserves = k
 *   Buy formula:  tokensOut = virtualTokenReserves - (k / (virtualSolReserves + solIn))
 *   Price:        price = virtualSolReserves / virtualTokenReserves  (SOL per token)
 *   Graduation:   when ~85 SOL real in curve, token migrates to Raydium
 */

import BN from 'bn.js';

import { SwarmLogger } from '../infra/logger.js';
import type { BondingCurveState } from '../types.js';

// ─── Constants ────────────────────────────────────────────────

/** Lamports per SOL */
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Token decimals on Pump.fun */
const TOKEN_DECIMALS = 6;

/** One token in raw units (10^6) */
const ONE_TOKEN_RAW = BigInt(10 ** TOKEN_DECIMALS);

/** Initial virtual SOL reserves: 30 SOL in lamports */
const DEFAULT_VIRTUAL_SOL_RESERVES = BigInt(30) * BigInt(LAMPORTS_PER_SOL);

/** Initial virtual token reserves: 1.073B tokens in raw units (with 6 decimals) */
const DEFAULT_VIRTUAL_TOKEN_RESERVES = BigInt(1_073_000_000) * ONE_TOKEN_RAW;

/** Total token supply: 1B tokens in raw units */
const DEFAULT_TOTAL_SUPPLY = BigInt(1_000_000_000) * ONE_TOKEN_RAW;

/** Graduation threshold: ~85 SOL real in curve (in lamports) */
const DEFAULT_GRADUATION_THRESHOLD = BigInt(85) * BigInt(LAMPORTS_PER_SOL);

/** Pump.fun trading fee: 1% = 100 basis points */
const DEFAULT_FEE_BPS = 100;

/** Solana transaction fee in SOL */
const TRANSACTION_FEE_SOL = 0.000005;

/** Warning threshold: price impact percent */
const PRICE_IMPACT_WARNING_THRESHOLD = 20;

/** Warning threshold: supply percent acquisition */
const SUPPLY_PERCENT_WARNING_THRESHOLD = 10;

/** Warning threshold: SOL amount */
const SOL_AMOUNT_WARNING_THRESHOLD = 5;

/** Safety cap: don't exceed 80% of graduation threshold */
const GRADUATION_SAFETY_CAP_PERCENT = 80;

/** Binary search iterations for balanced optimization */
const BINARY_SEARCH_ITERATIONS = 64;

/** Step count for alternative generation */
const ALTERNATIVE_STEPS = 5;

// ─── Interfaces ───────────────────────────────────────────────

export interface PumpFunCurveParams {
  /** Virtual SOL reserves in lamports (default: 30 SOL) */
  virtualSolReserves: bigint;
  /** Virtual token reserves in raw units (default: 1.073B tokens) */
  virtualTokenReserves: bigint;
  /** Real tokens available for purchase */
  realTokenReserves: bigint;
  /** Total token supply in raw units */
  totalSupply: bigint;
  /** Token decimals (6 on Pump.fun) */
  tokenDecimals: number;
  /** Graduation threshold in lamports (~85 SOL) */
  graduationThreshold: bigint;
  /** Trading fee in basis points (100 = 1%) */
  feeBasisPoints: number;
}

export interface DevBuyParams {
  /** Maximum SOL budget for dev buy */
  maxSOLBudget: number;
  /** Target percentage of supply to acquire (1-10 recommended) */
  targetSupplyPercent: number;
  /** Maximum acceptable price impact percent */
  maxPriceImpactPercent: number;
  /** Whether this is the first buy (token creation) or buying into existing */
  isCreationBuy: boolean;
  /** If buying existing, current curve state */
  currentCurveState?: BondingCurveState;
  /** Strategy: minimize cost, maximize supply, or balance */
  optimizationGoal: 'minimize-cost' | 'maximize-supply' | 'balanced';
}

export interface DevBuyRecommendation {
  /** Recommended SOL amount to spend */
  recommendedSOL: number;
  /** Expected tokens received (raw units) */
  expectedTokens: bigint;
  /** Expected supply percentage acquired */
  expectedSupplyPercent: number;
  /** Price impact as a percentage */
  priceImpactPercent: number;
  /** Average price per token (SOL) */
  effectivePrice: number;
  /** Price after dev buy (SOL per token) */
  postBuyPrice: number;
  /** Ratio: postBuyPrice / initialPrice */
  priceMultiple: number;
  /** Cost breakdown */
  costBreakdown: {
    solForTokens: number;
    platformFee: number;
    transactionFee: number;
    total: number;
  };
  /** Human-readable reasoning for the recommendation */
  reasoning: string;
  /** Alternative buy amounts with trade-offs */
  alternatives: Array<{
    sol: number;
    tokens: bigint;
    supplyPercent: number;
    priceImpact: number;
    note: string;
  }>;
}

export interface DevBuySimulation {
  /** SOL input amount */
  solIn: number;
  /** Tokens received (raw units) */
  tokensOut: bigint;
  /** Percentage of total supply acquired */
  supplyPercent: number;
  /** Price impact as a percentage */
  priceImpact: number;
  /** Price before the buy (SOL per token) */
  preBuyPrice: number;
  /** Price after the buy (SOL per token) */
  postBuyPrice: number;
  /** New virtual SOL reserves after buy */
  newVirtualSolReserves: bigint;
  /** New virtual token reserves after buy */
  newVirtualTokenReserves: bigint;
  /** Remaining real tokens after buy */
  remainingRealTokens: bigint;
  /** Progress toward graduation threshold (0-100) */
  percentToGraduation: number;
}

export interface DevBuyOptimizerConfig {
  /** Override default curve params */
  curveParams?: Partial<PumpFunCurveParams>;
  /** Log level for the optimizer */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// ─── DevBuyOptimizer ──────────────────────────────────────────

/**
 * Calculates optimal dev buy sizes for Pump.fun token creation.
 *
 * Uses real Pump.fun bonding curve parameters (constant product AMM)
 * to simulate token purchases and recommend ideal buy amounts based
 * on constraints and optimization goals.
 *
 * ```typescript
 * const optimizer = new DevBuyOptimizer();
 * const rec = optimizer.calculateOptimalDevBuy({
 *   maxSOLBudget: 2,
 *   targetSupplyPercent: 5,
 *   maxPriceImpactPercent: 15,
 *   isCreationBuy: true,
 *   optimizationGoal: 'balanced',
 * });
 * console.log(`Buy ${rec.recommendedSOL} SOL → ${rec.expectedSupplyPercent}% supply`);
 * ```
 */
export class DevBuyOptimizer {
  private readonly params: PumpFunCurveParams;
  private readonly logger: SwarmLogger;

  constructor(config?: DevBuyOptimizerConfig) {
    this.params = {
      virtualSolReserves: config?.curveParams?.virtualSolReserves ?? DEFAULT_VIRTUAL_SOL_RESERVES,
      virtualTokenReserves: config?.curveParams?.virtualTokenReserves ?? DEFAULT_VIRTUAL_TOKEN_RESERVES,
      realTokenReserves: config?.curveParams?.realTokenReserves ?? DEFAULT_TOTAL_SUPPLY,
      totalSupply: config?.curveParams?.totalSupply ?? DEFAULT_TOTAL_SUPPLY,
      tokenDecimals: config?.curveParams?.tokenDecimals ?? TOKEN_DECIMALS,
      graduationThreshold: config?.curveParams?.graduationThreshold ?? DEFAULT_GRADUATION_THRESHOLD,
      feeBasisPoints: config?.curveParams?.feeBasisPoints ?? DEFAULT_FEE_BPS,
    };
    this.logger = SwarmLogger.create('dev-buy-optimizer', 'bundle');
    if (config?.logLevel) {
      this.logger.setLevel(config.logLevel);
    }
    this.logger.info('DevBuyOptimizer initialized', {
      virtualSolReserves: this.params.virtualSolReserves.toString(),
      virtualTokenReserves: this.params.virtualTokenReserves.toString(),
      totalSupply: this.params.totalSupply.toString(),
      graduationThreshold: this.params.graduationThreshold.toString(),
      feeBasisPoints: this.params.feeBasisPoints,
    });
  }

  // ─── Core Bonding Curve Math ──────────────────────────────

  /**
   * Calculate tokens received for a given SOL input.
   * Uses constant product formula: tokensOut = vTokenRes - (k / (vSolRes + solIn))
   * Applies fee deduction before the swap.
   */
  calculateTokensForSOL(
    solAmount: number,
    virtualSolReserves?: bigint,
    virtualTokenReserves?: bigint,
  ): bigint {
    const vSolRes = virtualSolReserves ?? this.params.virtualSolReserves;
    const vTokenRes = virtualTokenReserves ?? this.params.virtualTokenReserves;
    const realTokenRes = this.params.realTokenReserves;

    if (solAmount <= 0) return BigInt(0);

    // Apply fee: amount after fee = solAmount * (10000 - feeBps) / 10000
    const solLamports = BigInt(Math.round(solAmount * LAMPORTS_PER_SOL));
    const feeDeducted = (solLamports * BigInt(10_000 - this.params.feeBasisPoints)) / BigInt(10_000);

    // Constant product: k = vSolRes * vTokenRes
    const k = vSolRes * vTokenRes;

    // New virtual SOL reserves after adding the buy amount
    const newVSolRes = vSolRes + feeDeducted;

    // Tokens out = vTokenRes - (k / newVSolRes)
    // Use floor division for conservative estimate
    const tokensOut = vTokenRes - k / newVSolRes;

    // Cap at real token reserves (can't buy more than available)
    return tokensOut < realTokenRes ? tokensOut : realTokenRes;
  }

  /**
   * Calculate SOL cost for a desired token amount.
   * Inverse of the constant product formula.
   * Returns the SOL amount (before fees) needed to acquire the given tokens.
   */
  calculateSOLForTokens(
    tokenAmount: bigint,
    virtualSolReserves?: bigint,
    virtualTokenReserves?: bigint,
  ): number {
    const vSolRes = virtualSolReserves ?? this.params.virtualSolReserves;
    const vTokenRes = virtualTokenReserves ?? this.params.virtualTokenReserves;

    if (tokenAmount <= BigInt(0)) return 0;
    if (tokenAmount >= vTokenRes) {
      // Can't buy more than virtual reserves
      return Number.POSITIVE_INFINITY;
    }

    // k = vSolRes * vTokenRes
    const k = vSolRes * vTokenRes;

    // To get `tokenAmount` tokens: newVTokenRes = vTokenRes - tokenAmount
    // newVSolRes = k / newVTokenRes
    // solNeeded = newVSolRes - vSolRes  (this is the fee-deducted amount)
    const newVTokenRes = vTokenRes - tokenAmount;
    const newVSolRes = k / newVTokenRes;
    const solNeededAfterFee = newVSolRes - vSolRes;

    // Reverse the fee to get the pre-fee SOL amount
    // feeDeducted = solIn * (10000 - feeBps) / 10000
    // solIn = feeDeducted * 10000 / (10000 - feeBps)
    const solInLamports =
      (solNeededAfterFee * BigInt(10_000)) / BigInt(10_000 - this.params.feeBasisPoints);

    return Number(solInLamports) / LAMPORTS_PER_SOL;
  }

  /**
   * Calculate price impact as a percentage for a given SOL buy.
   * Price impact = (postPrice - prePrice) / prePrice * 100
   */
  calculatePriceImpact(solAmount: number): number {
    const preBuyPrice = this.getSpotPrice();
    const sim = this.simulateDevBuy(solAmount);
    return ((sim.postBuyPrice - preBuyPrice) / preBuyPrice) * 100;
  }

  /**
   * Get the maximum SOL that can be spent to acquire at most
   * `maxSupplyPercent` of the total supply.
   */
  getMaxDevBuy(maxSupplyPercent: number): number {
    const targetTokens =
      (this.params.totalSupply * BigInt(Math.round(maxSupplyPercent * 100))) / BigInt(10_000);
    const sol = this.calculateSOLForTokens(targetTokens);
    return Number.isFinite(sol) ? sol : this.graduationCapSOL();
  }

  /**
   * Return the current bonding curve parameters.
   */
  getBondingCurveParams(): PumpFunCurveParams {
    return { ...this.params };
  }

  // ─── Simulation ───────────────────────────────────────────

  /**
   * Simulate a dev buy without executing — returns full post-state.
   */
  simulateDevBuy(solAmount: number): DevBuySimulation {
    const vSolRes = this.params.virtualSolReserves;
    const vTokenRes = this.params.virtualTokenReserves;

    const preBuyPrice = this.getSpotPrice(vSolRes, vTokenRes);
    const tokensOut = this.calculateTokensForSOL(solAmount, vSolRes, vTokenRes);

    // After fee deduction
    const solLamports = BigInt(Math.round(solAmount * LAMPORTS_PER_SOL));
    const feeDeducted = (solLamports * BigInt(10_000 - this.params.feeBasisPoints)) / BigInt(10_000);

    const newVSolRes = vSolRes + feeDeducted;
    const newVTokenRes = vTokenRes - tokensOut;
    const postBuyPrice = this.getSpotPrice(newVSolRes, newVTokenRes);

    const supplyPercent =
      Number((tokensOut * BigInt(10_000)) / this.params.totalSupply) / 100;

    const priceImpact =
      preBuyPrice > 0 ? ((postBuyPrice - preBuyPrice) / preBuyPrice) * 100 : 0;

    const remainingRealTokens =
      this.params.realTokenReserves > tokensOut
        ? this.params.realTokenReserves - tokensOut
        : BigInt(0);

    // Graduation progress: real SOL deposited / threshold * 100
    const realSolDeposited = feeDeducted; // On first buy, all real SOL comes from this buy
    const percentToGraduation =
      Number((realSolDeposited * BigInt(10_000)) / this.params.graduationThreshold) / 100;

    return {
      solIn: solAmount,
      tokensOut,
      supplyPercent,
      priceImpact,
      preBuyPrice,
      postBuyPrice,
      newVirtualSolReserves: newVSolRes,
      newVirtualTokenReserves: newVTokenRes,
      remainingRealTokens,
      percentToGraduation,
    };
  }

  // ─── Optimization ─────────────────────────────────────────

  /**
   * Calculate the optimal dev buy based on constraints and strategy.
   */
  calculateOptimalDevBuy(params: DevBuyParams): DevBuyRecommendation {
    this.logger.info('Calculating optimal dev buy', {
      maxSOLBudget: params.maxSOLBudget,
      targetSupplyPercent: params.targetSupplyPercent,
      maxPriceImpactPercent: params.maxPriceImpactPercent,
      isCreationBuy: params.isCreationBuy,
      optimizationGoal: params.optimizationGoal,
    });

    // Resolve virtual reserves: use current curve state if buying into existing token
    const vSolRes = params.isCreationBuy
      ? this.params.virtualSolReserves
      : this.bnToBigint(params.currentCurveState?.virtualSolReserves);
    const vTokenRes = params.isCreationBuy
      ? this.params.virtualTokenReserves
      : this.bnToBigint(params.currentCurveState?.virtualTokenReserves);

    // Apply safety cap: never exceed 80% of graduation threshold
    const graduationCapSOL = this.graduationCapSOL();
    const effectiveBudget = Math.min(params.maxSOLBudget, graduationCapSOL);

    let recommendedSOL: number;

    switch (params.optimizationGoal) {
      case 'minimize-cost':
        recommendedSOL = this.optimizeMinimizeCost(
          params.targetSupplyPercent,
          params.maxPriceImpactPercent,
          effectiveBudget,
          vSolRes,
          vTokenRes,
        );
        break;
      case 'maximize-supply':
        recommendedSOL = this.optimizeMaximizeSupply(
          effectiveBudget,
          params.maxPriceImpactPercent,
          vSolRes,
          vTokenRes,
        );
        break;
      case 'balanced':
        recommendedSOL = this.optimizeBalanced(
          params.targetSupplyPercent,
          params.maxPriceImpactPercent,
          effectiveBudget,
          vSolRes,
          vTokenRes,
        );
        break;
    }

    // Clamp to budget
    recommendedSOL = Math.min(recommendedSOL, effectiveBudget);
    recommendedSOL = Math.max(recommendedSOL, 0);

    // Simulate the recommended buy
    const sim = this.simulateDevBuyWithReserves(recommendedSOL, vSolRes, vTokenRes);
    const preBuyPrice = this.getSpotPrice(vSolRes, vTokenRes);

    // Build cost breakdown
    const platformFee = recommendedSOL * (this.params.feeBasisPoints / 10_000);
    const costBreakdown = {
      solForTokens: recommendedSOL - platformFee,
      platformFee,
      transactionFee: TRANSACTION_FEE_SOL,
      total: recommendedSOL + TRANSACTION_FEE_SOL,
    };

    // Build reasoning
    const reasoning = this.buildReasoning(params, recommendedSOL, sim, costBreakdown);

    // Generate alternatives
    const alternatives = this.generateAlternatives(
      recommendedSOL,
      effectiveBudget,
      vSolRes,
      vTokenRes,
    );

    // Log warnings
    this.emitWarnings(recommendedSOL, sim);

    const recommendation: DevBuyRecommendation = {
      recommendedSOL,
      expectedTokens: sim.tokensOut,
      expectedSupplyPercent: sim.supplyPercent,
      priceImpactPercent: sim.priceImpact,
      effectivePrice:
        sim.tokensOut > BigInt(0)
          ? recommendedSOL / (Number(sim.tokensOut) / Number(ONE_TOKEN_RAW))
          : 0,
      postBuyPrice: sim.postBuyPrice,
      priceMultiple: preBuyPrice > 0 ? sim.postBuyPrice / preBuyPrice : 1,
      costBreakdown,
      reasoning,
      alternatives,
    };

    this.logger.info('Dev buy recommendation computed', {
      recommendedSOL: recommendation.recommendedSOL,
      expectedSupplyPercent: recommendation.expectedSupplyPercent,
      priceImpactPercent: recommendation.priceImpactPercent,
      priceMultiple: recommendation.priceMultiple,
      goal: params.optimizationGoal,
    });

    return recommendation;
  }

  // ─── Optimization Strategies ──────────────────────────────

  /**
   * Minimize cost: find the least SOL to reach the target supply percent.
   * If price impact exceeds the cap, reduce to the impact-capped amount.
   */
  private optimizeMinimizeCost(
    targetSupplyPercent: number,
    maxPriceImpactPercent: number,
    maxBudget: number,
    vSolRes: bigint,
    vTokenRes: bigint,
  ): number {
    // Calculate exact SOL for target supply
    const targetTokens =
      (this.params.totalSupply * BigInt(Math.round(targetSupplyPercent * 100))) / BigInt(10_000);
    const solForTarget = this.calculateSOLForTokens(targetTokens, vSolRes, vTokenRes);

    if (!Number.isFinite(solForTarget)) {
      this.logger.warn('Target supply percent unreachable — capping at budget', {
        targetSupplyPercent,
      });
      return maxBudget;
    }

    // Clamp to budget
    let sol = Math.min(solForTarget, maxBudget);

    // Check price impact at this level
    const sim = this.simulateDevBuyWithReserves(sol, vSolRes, vTokenRes);
    if (sim.priceImpact > maxPriceImpactPercent) {
      // Binary search for the SOL amount that hits exactly maxPriceImpactPercent
      sol = this.findSOLForMaxImpact(maxPriceImpactPercent, maxBudget, vSolRes, vTokenRes);
    }

    return sol;
  }

  /**
   * Maximize supply: spend the full budget (up to price impact cap).
   */
  private optimizeMaximizeSupply(
    maxBudget: number,
    maxPriceImpactPercent: number,
    vSolRes: bigint,
    vTokenRes: bigint,
  ): number {
    // Check if full budget exceeds price impact
    const sim = this.simulateDevBuyWithReserves(maxBudget, vSolRes, vTokenRes);
    if (sim.priceImpact <= maxPriceImpactPercent) {
      return maxBudget;
    }

    // Binary search for max SOL within price impact limit
    return this.findSOLForMaxImpact(maxPriceImpactPercent, maxBudget, vSolRes, vTokenRes);
  }

  /**
   * Balanced: find the "sweet spot" where marginal cost of the next 1%
   * supply begins rising significantly. Uses binary search on the
   * marginal cost curve.
   *
   * The sweet spot is where the second derivative of (SOL cost vs supply %)
   * inflects — i.e., buying more starts getting disproportionately expensive.
   */
  private optimizeBalanced(
    targetSupplyPercent: number,
    maxPriceImpactPercent: number,
    maxBudget: number,
    vSolRes: bigint,
    vTokenRes: bigint,
  ): number {
    // Compute marginal cost at the target supply percent and at half the target
    const targetTokens =
      (this.params.totalSupply * BigInt(Math.round(targetSupplyPercent * 100))) / BigInt(10_000);
    const solForTarget = this.calculateSOLForTokens(targetTokens, vSolRes, vTokenRes);

    if (!Number.isFinite(solForTarget) || solForTarget > maxBudget) {
      // Target is unreachable or too expensive — fallback to marginal-cost search
      return this.findMarginalCostInflection(maxBudget, maxPriceImpactPercent, vSolRes, vTokenRes);
    }

    // Check if target is within price impact
    const sim = this.simulateDevBuyWithReserves(solForTarget, vSolRes, vTokenRes);
    if (sim.priceImpact <= maxPriceImpactPercent) {
      return solForTarget;
    }

    // Target exceeds price impact — find balance between cost and supply
    return this.findMarginalCostInflection(maxBudget, maxPriceImpactPercent, vSolRes, vTokenRes);
  }

  // ─── Helper Methods ───────────────────────────────────────

  /**
   * Binary search for the SOL amount that produces exactly `targetImpactPercent`
   * price impact.
   */
  private findSOLForMaxImpact(
    targetImpactPercent: number,
    maxBudget: number,
    vSolRes: bigint,
    vTokenRes: bigint,
  ): number {
    let lo = 0;
    let hi = maxBudget;

    for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i++) {
      const mid = (lo + hi) / 2;
      const sim = this.simulateDevBuyWithReserves(mid, vSolRes, vTokenRes);
      if (sim.priceImpact > targetImpactPercent) {
        hi = mid;
      } else {
        lo = mid;
      }
    }

    return lo;
  }

  /**
   * Find the SOL amount where marginal cost per 1% supply inflects.
   * Walk up from 0 to maxBudget in small steps, compute the marginal
   * cost of each incremental 0.5% supply, and stop when the next
   * increment costs 2× more than the first increment.
   */
  private findMarginalCostInflection(
    maxBudget: number,
    maxPriceImpactPercent: number,
    vSolRes: bigint,
    vTokenRes: bigint,
  ): number {
    const incrementPercent = 0.5;
    const incrementTokens =
      (this.params.totalSupply * BigInt(Math.round(incrementPercent * 100))) / BigInt(10_000);

    // Cost of the first increment (at initial reserves)
    const baseCost = this.calculateSOLForTokens(incrementTokens, vSolRes, vTokenRes);
    if (!Number.isFinite(baseCost) || baseCost <= 0) return maxBudget;

    let totalSOL = 0;
    let currentVSolRes = vSolRes;
    let currentVTokenRes = vTokenRes;

    // Walk along the curve
    for (let pct = 0; pct < 100; pct += incrementPercent) {
      const incrementCost = this.calculateSOLForTokens(
        incrementTokens,
        currentVSolRes,
        currentVTokenRes,
      );

      if (!Number.isFinite(incrementCost)) break;

      const nextTotalSOL = totalSOL + incrementCost;

      // Stop if exceeding budget
      if (nextTotalSOL > maxBudget) break;

      // Stop if marginal cost is 2× the base cost (diminishing returns)
      if (incrementCost > baseCost * 2) break;

      // Stop if price impact at this level exceeds max
      const sim = this.simulateDevBuyWithReserves(nextTotalSOL, vSolRes, vTokenRes);
      if (sim.priceImpact > maxPriceImpactPercent) break;

      // Advance the reserves
      const solLamports = BigInt(Math.round(incrementCost * LAMPORTS_PER_SOL));
      const feeDeducted =
        (solLamports * BigInt(10_000 - this.params.feeBasisPoints)) / BigInt(10_000);
      currentVSolRes = currentVSolRes + feeDeducted;
      currentVTokenRes = currentVTokenRes - incrementTokens;
      totalSOL = nextTotalSOL;
    }

    return totalSOL > 0 ? totalSOL : Math.min(0.1, maxBudget);
  }

  /**
   * Simulate a dev buy with custom reserves (for buying into existing curves).
   */
  private simulateDevBuyWithReserves(
    solAmount: number,
    vSolRes: bigint,
    vTokenRes: bigint,
  ): DevBuySimulation {
    const preBuyPrice = this.getSpotPrice(vSolRes, vTokenRes);
    const tokensOut = this.calculateTokensForSOL(solAmount, vSolRes, vTokenRes);

    const solLamports = BigInt(Math.round(solAmount * LAMPORTS_PER_SOL));
    const feeDeducted = (solLamports * BigInt(10_000 - this.params.feeBasisPoints)) / BigInt(10_000);

    const newVSolRes = vSolRes + feeDeducted;
    const newVTokenRes = vTokenRes - tokensOut;
    const postBuyPrice = this.getSpotPrice(newVSolRes, newVTokenRes);

    const supplyPercent =
      Number((tokensOut * BigInt(10_000)) / this.params.totalSupply) / 100;

    const priceImpact =
      preBuyPrice > 0 ? ((postBuyPrice - preBuyPrice) / preBuyPrice) * 100 : 0;

    const remainingRealTokens =
      this.params.realTokenReserves > tokensOut
        ? this.params.realTokenReserves - tokensOut
        : BigInt(0);

    const percentToGraduation =
      Number((feeDeducted * BigInt(10_000)) / this.params.graduationThreshold) / 100;

    return {
      solIn: solAmount,
      tokensOut,
      supplyPercent,
      priceImpact,
      preBuyPrice,
      postBuyPrice,
      newVirtualSolReserves: newVSolRes,
      newVirtualTokenReserves: newVTokenRes,
      remainingRealTokens,
      percentToGraduation,
    };
  }

  /**
   * Spot price: virtualSolReserves / virtualTokenReserves (SOL per token, human-readable).
   */
  private getSpotPrice(vSolRes?: bigint, vTokenRes?: bigint): number {
    const sol = vSolRes ?? this.params.virtualSolReserves;
    const tok = vTokenRes ?? this.params.virtualTokenReserves;
    // Convert to human units: (sol/LAMPORTS) / (tok/ONE_TOKEN_RAW)
    return (Number(sol) / LAMPORTS_PER_SOL) / (Number(tok) / Number(ONE_TOKEN_RAW));
  }

  /**
   * Maximum SOL that stays within the graduation safety cap.
   */
  private graduationCapSOL(): number {
    const capLamports =
      (this.params.graduationThreshold * BigInt(GRADUATION_SAFETY_CAP_PERCENT)) / BigInt(100);
    return Number(capLamports) / LAMPORTS_PER_SOL;
  }

  /**
   * Convert BN (from types.ts) to native bigint.
   */
  private bnToBigint(bn: BN | undefined): bigint {
    if (!bn) return this.params.virtualSolReserves;
    return BigInt(bn.toString());
  }

  /**
   * Generate alternative buy amounts around the recommendation.
   */
  private generateAlternatives(
    recommendedSOL: number,
    maxBudget: number,
    vSolRes: bigint,
    vTokenRes: bigint,
  ): DevBuyRecommendation['alternatives'] {
    const alternatives: DevBuyRecommendation['alternatives'] = [];
    const stepSize = Math.max(recommendedSOL / ALTERNATIVE_STEPS, 0.05);

    // Smaller amounts
    for (let i = ALTERNATIVE_STEPS; i >= 1; i--) {
      const sol = Math.max(recommendedSOL - stepSize * i, 0.01);
      if (sol >= recommendedSOL) continue;
      const sim = this.simulateDevBuyWithReserves(sol, vSolRes, vTokenRes);
      alternatives.push({
        sol: Math.round(sol * 10_000) / 10_000,
        tokens: sim.tokensOut,
        supplyPercent: sim.supplyPercent,
        priceImpact: sim.priceImpact,
        note: `Lower cost — ${sim.supplyPercent.toFixed(2)}% supply at ${sim.priceImpact.toFixed(1)}% impact`,
      });
    }

    // Larger amounts (up to budget)
    for (let i = 1; i <= ALTERNATIVE_STEPS; i++) {
      const sol = Math.min(recommendedSOL + stepSize * i, maxBudget);
      if (sol <= recommendedSOL) continue;
      const sim = this.simulateDevBuyWithReserves(sol, vSolRes, vTokenRes);
      alternatives.push({
        sol: Math.round(sol * 10_000) / 10_000,
        tokens: sim.tokensOut,
        supplyPercent: sim.supplyPercent,
        priceImpact: sim.priceImpact,
        note: `More supply — ${sim.supplyPercent.toFixed(2)}% supply at ${sim.priceImpact.toFixed(1)}% impact`,
      });
    }

    // Deduplicate alternatives that are too close to the recommendation
    return alternatives.filter(
      (alt) => Math.abs(alt.sol - recommendedSOL) > 0.005,
    );
  }

  /**
   * Build a human-readable reasoning string.
   */
  private buildReasoning(
    params: DevBuyParams,
    sol: number,
    sim: DevBuySimulation,
    costBreakdown: DevBuyRecommendation['costBreakdown'],
  ): string {
    const parts: string[] = [];

    parts.push(
      `Strategy: ${params.optimizationGoal}. ` +
      `Budget: ${params.maxSOLBudget} SOL. ` +
      `Target supply: ${params.targetSupplyPercent}%.`,
    );

    parts.push(
      `Recommended ${sol.toFixed(4)} SOL → ` +
      `${sim.supplyPercent.toFixed(2)}% of supply ` +
      `(${(Number(sim.tokensOut) / Number(ONE_TOKEN_RAW)).toLocaleString()} tokens).`,
    );

    parts.push(
      `Price impact: ${sim.priceImpact.toFixed(2)}%. ` +
      `Platform fee: ${costBreakdown.platformFee.toFixed(6)} SOL. ` +
      `Total cost: ${costBreakdown.total.toFixed(6)} SOL.`,
    );

    if (sim.priceImpact > PRICE_IMPACT_WARNING_THRESHOLD) {
      parts.push(`⚠ High price impact (>${PRICE_IMPACT_WARNING_THRESHOLD}%) — consider reducing buy size.`);
    }

    if (sim.supplyPercent > SUPPLY_PERCENT_WARNING_THRESHOLD) {
      parts.push(`⚠ Acquiring >${SUPPLY_PERCENT_WARNING_THRESHOLD}% supply may appear suspicious to other traders.`);
    }

    if (sol > SOL_AMOUNT_WARNING_THRESHOLD) {
      parts.push(`⚠ Dev buy exceeds ${SOL_AMOUNT_WARNING_THRESHOLD} SOL — significant capital at risk in a new token.`);
    }

    parts.push(
      `Graduation progress: ${sim.percentToGraduation.toFixed(1)}% of ~85 SOL threshold.`,
    );

    return parts.join(' ');
  }

  /**
   * Emit safety warnings via logger.
   */
  private emitWarnings(sol: number, sim: DevBuySimulation): void {
    if (sim.priceImpact > PRICE_IMPACT_WARNING_THRESHOLD) {
      this.logger.warn('Dev buy price impact exceeds warning threshold', {
        priceImpact: sim.priceImpact,
        threshold: PRICE_IMPACT_WARNING_THRESHOLD,
        solAmount: sol,
      });
    }

    if (sim.supplyPercent > SUPPLY_PERCENT_WARNING_THRESHOLD) {
      this.logger.warn('Dev buy acquires large supply percentage', {
        supplyPercent: sim.supplyPercent,
        threshold: SUPPLY_PERCENT_WARNING_THRESHOLD,
        solAmount: sol,
      });
    }

    if (sol > SOL_AMOUNT_WARNING_THRESHOLD) {
      this.logger.warn('Dev buy exceeds SOL amount warning threshold', {
        solAmount: sol,
        threshold: SOL_AMOUNT_WARNING_THRESHOLD,
      });
    }

    if (sim.percentToGraduation > GRADUATION_SAFETY_CAP_PERCENT) {
      this.logger.warn('Dev buy approaches graduation threshold', {
        percentToGraduation: sim.percentToGraduation,
        cap: GRADUATION_SAFETY_CAP_PERCENT,
        solAmount: sol,
      });
    }
  }
}
