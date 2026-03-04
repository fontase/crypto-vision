/**
 * Price Trajectory Controller
 *
 * Plans and executes price trajectories on the Pump.fun bonding curve.
 * Calculates the exact buy/sell imbalance needed to move price from
 * point A to point B over a given duration, supporting multiple curve
 * shapes (linear, exponential, step, s-curve).
 *
 * Bonding curve math:
 *   Pump.fun uses a constant-product AMM: virtualSolReserves × virtualTokenReserves = k
 *   Price = virtualSolReserves / virtualTokenReserves
 *   After a buy of Δsol:  tokensOut = virtualTokenReserves - k / (virtualSolReserves + Δsol)
 *   After a sell of Δtoken: solOut = virtualSolReserves - k / (virtualTokenReserves + Δtoken)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { v4 as uuidv4 } from 'uuid';

import type { SwarmEventBus } from '../infra/event-bus.js';
import type { BondingCurveState } from '../types.js';

// Re-export the bonding curve PDA helper from pump-sdk
import { bondingCurvePda } from '@pump-fun/pump-sdk';

// ─── Constants ────────────────────────────────────────────────

/** Default number of checkpoints per trajectory plan */
const DEFAULT_CHECKPOINT_COUNT = 20;

/** Platform fee BPS charged on buys/sells (1%) */
const PLATFORM_FEE_BPS = 100;

/** Minimum meaningful SOL amount for a trade (0.001 SOL in lamports) */
const MIN_TRADE_LAMPORTS = new BN(1_000_000);

/** Tolerance multiplier for SOL estimation accuracy buffer */
const ESTIMATION_BUFFER = 1.15;

// ─── Interfaces ───────────────────────────────────────────────

export type TrajectoryCurve = 'linear' | 'exponential' | 'step' | 's-curve';

export interface PriceTrajectoryPlan {
  /** Unique plan identifier */
  id: string;
  /** Token mint address */
  mint: string;
  /** Starting price in SOL per token */
  startPrice: number;
  /** Target price in SOL per token */
  targetPrice: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** The curve shape used */
  curve: TrajectoryCurve;
  /** Ordered checkpoints along the trajectory */
  checkpoints: PriceCheckpoint[];
  /** Total net SOL needed (positive = buys dominate, negative = sells dominate) */
  totalNetBuySol: BN;
  /** Timestamp when the plan was created */
  createdAt: number;
}

export interface PriceCheckpoint {
  /** Absolute timestamp (ms) when this checkpoint should be reached */
  timestampMs: number;
  /** Target price at this checkpoint (SOL per token) */
  targetPrice: number;
  /** Net buy pressure in lamports (positive → buy, negative → sell) */
  netBuyPressureSol: BN;
  /** Acceptable deviation from target price (as a ratio, e.g. 0.05 = 5%) */
  tolerance: number;
}

export interface TrajectoryProgress {
  /** The plan being tracked */
  planId: string;
  /** Current checkpoint index */
  currentCheckpointIndex: number;
  /** Total checkpoints */
  totalCheckpoints: number;
  /** Latest recorded price */
  currentPrice: number;
  /** Expected price at current time based on plan */
  expectedPrice: number;
  /** Deviation from expected price (ratio: actual/expected - 1) */
  deviation: number;
  /** Whether price is within tolerance of expected */
  withinTolerance: boolean;
  /** Elapsed time in ms since plan creation */
  elapsedMs: number;
  /** Progress as a fraction (0–1) */
  progressFraction: number;
  /** Suggested adjustment: positive = buy more, negative = sell more (lamports) */
  suggestedAdjustmentLamports: BN;
  /** Whether the plan is complete (past final checkpoint) */
  complete: boolean;
}

// ─── Bonding Curve Math ───────────────────────────────────────

/**
 * Calculate tokens received for a given SOL input on a constant-product curve.
 *
 * Formula: tokensOut = virtualTokenReserves - k / (virtualSolReserves + solInputAfterFee)
 * Where k = virtualSolReserves × virtualTokenReserves
 *
 * @param virtualSolReserves  Current virtual SOL reserves
 * @param virtualTokenReserves Current virtual token reserves
 * @param solInput  SOL amount in lamports (before platform fee)
 * @returns Tokens received
 */
export function calculateBuyOutput(
  virtualSolReserves: BN,
  virtualTokenReserves: BN,
  solInput: BN,
): BN {
  if (solInput.isZero() || solInput.isNeg()) return new BN(0);

  // Deduct platform fee (1%)
  const feeAmount = solInput.mul(new BN(PLATFORM_FEE_BPS)).div(new BN(10_000));
  const solAfterFee = solInput.sub(feeAmount);

  // k = x * y
  const k = virtualSolReserves.mul(virtualTokenReserves);
  // new_x = x + solAfterFee
  const newSolReserves = virtualSolReserves.add(solAfterFee);
  // new_y = k / new_x
  const newTokenReserves = k.div(newSolReserves);
  // tokens_out = y - new_y
  const tokensOut = virtualTokenReserves.sub(newTokenReserves);

  return tokensOut.isNeg() ? new BN(0) : tokensOut;
}

/**
 * Calculate SOL received for a given token input on a constant-product curve.
 *
 * Formula: solOut = virtualSolReserves - k / (virtualTokenReserves + tokenInput)
 * Then deduct platform fee.
 *
 * @param virtualSolReserves  Current virtual SOL reserves
 * @param virtualTokenReserves Current virtual token reserves
 * @param tokenInput  Token amount to sell
 * @returns SOL received in lamports (after platform fee)
 */
export function calculateSellOutput(
  virtualSolReserves: BN,
  virtualTokenReserves: BN,
  tokenInput: BN,
): BN {
  if (tokenInput.isZero() || tokenInput.isNeg()) return new BN(0);

  // k = x * y
  const k = virtualSolReserves.mul(virtualTokenReserves);
  // new_y = y + tokenInput
  const newTokenReserves = virtualTokenReserves.add(tokenInput);
  // new_x = k / new_y
  const newSolReserves = k.div(newTokenReserves);
  // sol_out_before_fee = x - new_x
  const solOutBeforeFee = virtualSolReserves.sub(newSolReserves);

  if (solOutBeforeFee.isNeg()) return new BN(0);

  // Deduct platform fee
  const feeAmount = solOutBeforeFee.mul(new BN(PLATFORM_FEE_BPS)).div(new BN(10_000));
  return solOutBeforeFee.sub(feeAmount);
}

/**
 * Calculate SOL needed to move the bonding curve price to a target.
 *
 * Price = virtualSolReserves / virtualTokenReserves
 * After buying Δsol (after fee), new price = (x + Δsol_net) / (y - tokensOut)
 * We solve for Δsol such that the new price equals targetPriceSol.
 *
 * For a price increase (buy):
 *   targetPrice = (x + d) / (y - x*d/(x+d)*1/x)  ... simplified via k invariant
 *   targetPrice = (x + d)^2 / k  →  d = sqrt(k * targetPrice) - x
 *   Where d is the net SOL added (after fees).
 *
 * For a price decrease (sell → net negative SOL):
 *   We need to calculate how many tokens to sell to reach the target.
 *   targetPrice = (x - solOut) / (y + tokensSold)
 *   Using k invariant: targetPrice = (x - solOut)^2 / k  →  solOut = x - sqrt(k * targetPrice)
 *
 * @returns Positive BN for net buy needed, negative BN for net sell needed
 */
export function calculateSolForPriceTarget(
  currentState: BondingCurveState,
  targetPriceSol: number,
): BN {
  const { virtualSolReserves, virtualTokenReserves } = currentState;

  // Current k = x * y
  const k = virtualSolReserves.mul(virtualTokenReserves);

  // Current price = x / y
  const currentPrice =
    virtualSolReserves.toNumber() / virtualTokenReserves.toNumber();

  if (Math.abs(targetPriceSol - currentPrice) / currentPrice < 0.001) {
    // Already at target
    return new BN(0);
  }

  // For constant product: price = x^2 / k  →  x_target = sqrt(k * targetPrice)
  // We use floating point for the sqrt then convert back to BN
  const kFloat = Number(k.toString());
  const xTarget = Math.sqrt(kFloat * targetPriceSol);
  const xCurrent = virtualSolReserves.toNumber();

  if (targetPriceSol > currentPrice) {
    // Need to buy → add SOL to reserves
    const netSolNeeded = xTarget - xCurrent;
    // Account for platform fee: actual SOL = netSolNeeded / (1 - fee)
    const grossSolNeeded = netSolNeeded / (1 - PLATFORM_FEE_BPS / 10_000);
    // Apply estimation buffer for safety
    const bufferedSol = grossSolNeeded * ESTIMATION_BUFFER;
    return new BN(Math.ceil(bufferedSol));
  } else {
    // Need to sell → remove SOL from reserves
    const netSolToRemove = xCurrent - xTarget;
    // When selling, we receive SOL minus fee. The gross SOL movement is larger.
    const grossSolMovement = netSolToRemove / (1 - PLATFORM_FEE_BPS / 10_000);
    const bufferedSol = grossSolMovement * ESTIMATION_BUFFER;
    // Negative indicates sell pressure needed
    return new BN(Math.ceil(bufferedSol)).neg();
  }
}

/**
 * Simulate what the price would be after a hypothetical trade.
 *
 * @param currentState Current bonding curve state
 * @param direction    'buy' or 'sell'
 * @param amount       SOL lamports for buys, token amount for sells
 * @returns Projected price (SOL per token) after the trade
 */
export function simulatePriceAfterTrade(
  currentState: BondingCurveState,
  direction: 'buy' | 'sell',
  amount: BN,
): number {
  const { virtualSolReserves, virtualTokenReserves } = currentState;

  if (direction === 'buy') {
    // Fee deduction
    const feeAmount = amount.mul(new BN(PLATFORM_FEE_BPS)).div(new BN(10_000));
    const solAfterFee = amount.sub(feeAmount);
    const k = virtualSolReserves.mul(virtualTokenReserves);
    const newSol = virtualSolReserves.add(solAfterFee);
    const newTokens = k.div(newSol);
    return newSol.toNumber() / newTokens.toNumber();
  } else {
    const k = virtualSolReserves.mul(virtualTokenReserves);
    const newTokens = virtualTokenReserves.add(amount);
    const newSol = k.div(newTokens);
    return newSol.toNumber() / newTokens.toNumber();
  }
}

// ─── Trajectory Curve Generators ──────────────────────────────

/**
 * Generate interpolation values for a trajectory curve.
 * Returns an array of fractions [0, 1] representing where the price
 * should be at each checkpoint relative to the total move.
 *
 * @param curve      The curve shape
 * @param numPoints  Number of interpolation points
 * @returns Array of fractions (length = numPoints), each in [0, 1]
 */
function generateCurveInterpolation(
  curve: TrajectoryCurve,
  numPoints: number,
): number[] {
  const points: number[] = [];

  for (let i = 0; i < numPoints; i++) {
    // t goes from 0 to 1 but we skip 0 (start price is known)
    const t = (i + 1) / numPoints;
    let fraction: number;

    switch (curve) {
      case 'linear':
        // Constant rate of price change
        fraction = t;
        break;

      case 'exponential':
        // Slow start, accelerating: f(t) = t^3
        fraction = t * t * t;
        break;

      case 'step': {
        // Price jumps at intervals with plateaus between
        // 5 steps by default
        const numSteps = 5;
        const step = Math.ceil(t * numSteps);
        fraction = step / numSteps;
        break;
      }

      case 's-curve':
        // Logistic function: slow → fast → slow
        // f(t) = 1 / (1 + e^(-12*(t-0.5)))
        // Normalized so f(0)≈0 and f(1)≈1
        fraction = 1 / (1 + Math.exp(-12 * (t - 0.5)));
        // Normalize to ensure exact 0→1 range
        {
          const fMin = 1 / (1 + Math.exp(-12 * (0 - 0.5)));
          const fMax = 1 / (1 + Math.exp(-12 * (1 - 0.5)));
          fraction = (fraction - fMin) / (fMax - fMin);
        }
        break;

      default: {
        // Exhaustive check
        const _exhaustive: never = curve;
        throw new Error(`Unknown trajectory curve: ${String(_exhaustive)}`);
      }
    }

    points.push(Math.max(0, Math.min(1, fraction)));
  }

  return points;
}

// ─── Price Trajectory Controller ──────────────────────────────

export class PriceTrajectoryController {
  private readonly connection: Connection;
  private readonly eventBus: SwarmEventBus;

  /** Recorded actual prices for feedback loop */
  private readonly priceHistory: Array<{ timestamp: number; price: number }> = [];

  /** Active plans indexed by plan ID */
  private readonly activePlans = new Map<string, PriceTrajectoryPlan>();

  constructor(connection: Connection, eventBus: SwarmEventBus) {
    this.connection = connection;
    this.eventBus = eventBus;
  }

  // ── Plan a trajectory ─────────────────────────────────────

  /**
   * Plan a price trajectory from the current price to a target over a duration.
   *
   * @param mint           Token mint address (base58)
   * @param targetPriceSol Target price in SOL per token
   * @param durationMs     Duration over which to execute the trajectory
   * @param curve          Curve shape for the price movement
   * @returns Fully populated PriceTrajectoryPlan
   */
  async planTrajectory(
    mint: string,
    targetPriceSol: number,
    durationMs: number,
    curve: TrajectoryCurve = 'linear',
  ): Promise<PriceTrajectoryPlan> {
    if (durationMs <= 0) {
      throw new Error('Trajectory duration must be positive');
    }
    if (targetPriceSol <= 0) {
      throw new Error('Target price must be positive');
    }

    const startPrice = await this.getCurrentPrice(mint);
    const bondingCurveState = await this.fetchBondingCurveState(mint);

    const now = Date.now();
    const numCheckpoints = DEFAULT_CHECKPOINT_COUNT;
    const interpolation = generateCurveInterpolation(curve, numCheckpoints);
    const priceRange = targetPriceSol - startPrice;

    // Compute base tolerance — tighter for smaller moves, looser for bigger swings
    const baseTolerance =
      Math.abs(priceRange / startPrice) > 0.5 ? 0.10 : 0.05;

    // Build checkpoints
    const checkpoints: PriceCheckpoint[] = [];
    let prevCheckpointPrice = startPrice;
    let totalNetBuy = new BN(0);

    for (let i = 0; i < numCheckpoints; i++) {
      const fraction = interpolation[i];
      const checkpointPrice = startPrice + priceRange * fraction;
      const checkpointTime = now + Math.round(durationMs * ((i + 1) / numCheckpoints));

      // Build an intermediate state reflecting the price at the previous checkpoint
      const intermediateState: BondingCurveState = {
        ...bondingCurveState,
        currentPriceSol: prevCheckpointPrice,
        virtualSolReserves: this.deriveReservesForPrice(
          bondingCurveState,
          prevCheckpointPrice,
        ).virtualSolReserves,
        virtualTokenReserves: this.deriveReservesForPrice(
          bondingCurveState,
          prevCheckpointPrice,
        ).virtualTokenReserves,
      };

      const netBuy = calculateSolForPriceTarget(intermediateState, checkpointPrice);

      // Adjust tolerance: steps get more tolerance since they jump
      const tolerance = curve === 'step' ? baseTolerance * 1.5 : baseTolerance;

      checkpoints.push({
        timestampMs: checkpointTime,
        targetPrice: checkpointPrice,
        netBuyPressureSol: netBuy,
        tolerance,
      });

      totalNetBuy = totalNetBuy.add(netBuy);
      prevCheckpointPrice = checkpointPrice;
    }

    const plan: PriceTrajectoryPlan = {
      id: uuidv4(),
      mint,
      startPrice,
      targetPrice: targetPriceSol,
      durationMs,
      curve,
      checkpoints,
      totalNetBuySol: totalNetBuy,
      createdAt: now,
    };

    // Store active plan
    this.activePlans.set(plan.id, plan);

    // Emit event
    this.eventBus.emit(
      'trajectory:planned',
      'trading',
      'PriceTrajectoryController',
      {
        planId: plan.id,
        mint,
        startPrice,
        targetPrice: targetPriceSol,
        durationMs,
        curve,
        totalNetBuySol: totalNetBuy.toString(),
        checkpointCount: numCheckpoints,
      },
    );

    return plan;
  }

  // ── Current Price ─────────────────────────────────────────

  /**
   * Read the current token price from the bonding curve on-chain.
   *
   * @param mint Token mint address (base58)
   * @returns Price in SOL per token
   */
  async getCurrentPrice(mint: string): Promise<number> {
    const state = await this.fetchBondingCurveState(mint);
    return state.currentPriceSol;
  }

  // ── SOL Estimation ────────────────────────────────────────

  /**
   * Estimate the SOL needed to move price from current to target.
   *
   * Uses the bonding curve math with an estimation buffer to account
   * for slippage and fee rounding. Accuracy target: within 15% of
   * actual cost.
   *
   * @param mint         Token mint address
   * @param currentPrice Current token price (SOL per token)
   * @param targetPrice  Target token price (SOL per token)
   * @returns Estimated SOL in lamports (positive = buy, negative = sell)
   */
  async estimateSolNeeded(
    mint: string,
    currentPrice: number,
    targetPrice: number,
  ): Promise<BN> {
    const state = await this.fetchBondingCurveState(mint);

    // Override current price in state if the caller has a more recent value
    const adjustedState: BondingCurveState = {
      ...state,
      currentPriceSol: currentPrice,
      virtualSolReserves: this.deriveReservesForPrice(state, currentPrice).virtualSolReserves,
      virtualTokenReserves: this.deriveReservesForPrice(state, currentPrice).virtualTokenReserves,
    };

    return calculateSolForPriceTarget(adjustedState, targetPrice);
  }

  // ── Progress Tracking ─────────────────────────────────────

  /**
   * Get the current progress of a trajectory plan.
   *
   * Compares the latest recorded price against the plan's expected
   * value at the current time, computing deviation and suggesting
   * corrective buy/sell pressure.
   *
   * @param plan The active trajectory plan
   * @returns Progress snapshot with feedback loop adjustments
   */
  getTrajectoryProgress(plan: PriceTrajectoryPlan): TrajectoryProgress {
    const now = Date.now();
    const elapsedMs = now - plan.createdAt;
    const progressFraction = Math.min(1, elapsedMs / plan.durationMs);
    const complete = progressFraction >= 1;

    // Find current and next checkpoint
    let currentCheckpointIndex = 0;
    for (let i = 0; i < plan.checkpoints.length; i++) {
      if (plan.checkpoints[i].timestampMs <= now) {
        currentCheckpointIndex = i;
      } else {
        break;
      }
    }

    const checkpoint = plan.checkpoints[currentCheckpointIndex];

    // Interpolate expected price at exact current time
    const expectedPrice = this.interpolateExpectedPrice(plan, now);

    // Get latest recorded price (fallback to start price)
    const latestPrice =
      this.priceHistory.length > 0
        ? this.priceHistory[this.priceHistory.length - 1].price
        : plan.startPrice;

    // Deviation: ratio of actual vs expected
    const deviation = expectedPrice > 0
      ? (latestPrice - expectedPrice) / expectedPrice
      : 0;

    const withinTolerance = Math.abs(deviation) <= checkpoint.tolerance;

    // Feedback loop: calculate corrective pressure
    const suggestedAdjustmentLamports = this.calculateFeedbackAdjustment(
      plan,
      latestPrice,
      expectedPrice,
      checkpoint,
    );

    // Emit progress event
    this.eventBus.emit(
      'trajectory:progress',
      'trading',
      'PriceTrajectoryController',
      {
        planId: plan.id,
        currentCheckpointIndex,
        expectedPrice,
        actualPrice: latestPrice,
        deviation,
        withinTolerance,
        progressFraction,
        complete,
      },
    );

    return {
      planId: plan.id,
      currentCheckpointIndex,
      totalCheckpoints: plan.checkpoints.length,
      currentPrice: latestPrice,
      expectedPrice,
      deviation,
      withinTolerance,
      elapsedMs,
      progressFraction,
      suggestedAdjustmentLamports,
      complete,
    };
  }

  // ── Price Recording ───────────────────────────────────────

  /**
   * Record an actual price observation for the feedback loop.
   * Called by external systems (e.g. trader agents or WebSocket price feeds)
   * to keep the controller informed of real market state.
   *
   * @param price Current observed price (SOL per token)
   */
  recordPriceUpdate(price: number): void {
    if (price <= 0) return;

    this.priceHistory.push({
      timestamp: Date.now(),
      price,
    });

    // Keep history bounded (last 10,000 entries)
    if (this.priceHistory.length > 10_000) {
      this.priceHistory.splice(0, this.priceHistory.length - 10_000);
    }

    // Emit price update event
    this.eventBus.emit(
      'trajectory:price-update',
      'trading',
      'PriceTrajectoryController',
      {
        price,
        historyLength: this.priceHistory.length,
        timestamp: Date.now(),
      },
    );
  }

  // ── Active Plan Management ────────────────────────────────

  /**
   * Retrieve an active plan by ID.
   */
  getActivePlan(planId: string): PriceTrajectoryPlan | undefined {
    return this.activePlans.get(planId);
  }

  /**
   * Remove a completed or cancelled plan.
   */
  removePlan(planId: string): boolean {
    const removed = this.activePlans.delete(planId);
    if (removed) {
      this.eventBus.emit(
        'trajectory:removed',
        'trading',
        'PriceTrajectoryController',
        { planId },
      );
    }
    return removed;
  }

  /**
   * Get all active plan IDs.
   */
  getActivePlanIds(): string[] {
    return [...this.activePlans.keys()];
  }

  // ── Private Helpers ───────────────────────────────────────

  /**
   * Fetch the bonding curve state from on-chain.
   */
  private async fetchBondingCurveState(mint: string): Promise<BondingCurveState> {
    const mintPubkey = new PublicKey(mint);
    const curvePda = bondingCurvePda(mintPubkey);
    const accountInfo = await this.connection.getAccountInfo(curvePda);

    if (!accountInfo) {
      throw new Error(
        `Bonding curve not found for mint ${mint}. The token may not exist or may have graduated.`,
      );
    }

    // Decode the bonding curve account data
    // Layout (based on pump-sdk DecodedBondingCurve):
    //   8 bytes discriminator
    //   8 bytes virtualTokenReserves (u64 LE)
    //   8 bytes virtualSolReserves (u64 LE)
    //   8 bytes realTokenReserves (u64 LE)
    //   8 bytes realSolReserves (u64 LE)
    //   8 bytes tokenTotalSupply (u64 LE)
    //   1 byte  complete (bool)
    const data = accountInfo.data;
    const DISCRIMINATOR_SIZE = 8;

    const virtualTokenReserves = new BN(
      data.subarray(DISCRIMINATOR_SIZE, DISCRIMINATOR_SIZE + 8),
      'le',
    );
    const virtualSolReserves = new BN(
      data.subarray(DISCRIMINATOR_SIZE + 8, DISCRIMINATOR_SIZE + 16),
      'le',
    );
    const realTokenReserves = new BN(
      data.subarray(DISCRIMINATOR_SIZE + 16, DISCRIMINATOR_SIZE + 24),
      'le',
    );
    const realSolReserves = new BN(
      data.subarray(DISCRIMINATOR_SIZE + 24, DISCRIMINATOR_SIZE + 32),
      'le',
    );
    const complete = data[DISCRIMINATOR_SIZE + 40] === 1;

    // Derive price: SOL per token = virtualSolReserves / virtualTokenReserves
    const currentPriceSol =
      virtualSolReserves.toNumber() / virtualTokenReserves.toNumber();

    // Graduation target: ~85 SOL in real reserves
    const GRADUATION_SOL_TARGET = 85 * 1e9; // lamports
    const graduationProgress = Math.min(
      100,
      (realSolReserves.toNumber() / GRADUATION_SOL_TARGET) * 100,
    );

    // Market cap: price × total supply (1 billion tokens)
    const ONE_BILLION = 1_000_000_000;
    const TOKEN_DECIMALS = 1e6; // 6 decimals
    const marketCapSol = currentPriceSol * ONE_BILLION * TOKEN_DECIMALS;

    return {
      mint,
      virtualSolReserves,
      virtualTokenReserves,
      realSolReserves,
      realTokenReserves,
      complete,
      currentPriceSol,
      marketCapSol,
      graduationProgress,
    };
  }

  /**
   * Derive what the virtual reserves would be at a given price,
   * maintaining the constant product k.
   */
  private deriveReservesForPrice(
    state: BondingCurveState,
    price: number,
  ): { virtualSolReserves: BN; virtualTokenReserves: BN } {
    const k = state.virtualSolReserves.mul(state.virtualTokenReserves);
    const kFloat = Number(k.toString());

    // price = x / y  and  x * y = k
    // → x = sqrt(k * price),  y = sqrt(k / price)
    const newSol = Math.sqrt(kFloat * price);
    const newTokens = Math.sqrt(kFloat / price);

    return {
      virtualSolReserves: new BN(Math.round(newSol)),
      virtualTokenReserves: new BN(Math.round(newTokens)),
    };
  }

  /**
   * Interpolate the expected price at an arbitrary timestamp within the plan.
   * Uses the curve shape to determine the fraction at the given time.
   */
  private interpolateExpectedPrice(
    plan: PriceTrajectoryPlan,
    timestamp: number,
  ): number {
    const elapsed = timestamp - plan.createdAt;
    const t = Math.max(0, Math.min(1, elapsed / plan.durationMs));

    if (t <= 0) return plan.startPrice;
    if (t >= 1) return plan.targetPrice;

    // Generate a single interpolation point for this t value
    const fraction = this.evaluateCurve(plan.curve, t);
    const priceRange = plan.targetPrice - plan.startPrice;
    return plan.startPrice + priceRange * fraction;
  }

  /**
   * Evaluate the curve function at a given t ∈ [0, 1].
   */
  private evaluateCurve(curve: TrajectoryCurve, t: number): number {
    switch (curve) {
      case 'linear':
        return t;
      case 'exponential':
        return t * t * t;
      case 'step': {
        const numSteps = 5;
        const step = Math.ceil(t * numSteps);
        return step / numSteps;
      }
      case 's-curve': {
        const raw = 1 / (1 + Math.exp(-12 * (t - 0.5)));
        const fMin = 1 / (1 + Math.exp(-12 * (0 - 0.5)));
        const fMax = 1 / (1 + Math.exp(-12 * (1 - 0.5)));
        return (raw - fMin) / (fMax - fMin);
      }
      default: {
        const _exhaustive: never = curve;
        throw new Error(`Unknown curve: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Feedback loop: calculate how much additional buy or sell pressure
   * is needed to bring the actual price back toward the expected price.
   *
   * Strategy:
   * - If behind target → increase buy pressure proportionally to deviation
   * - If ahead of target → apply gentle sell pressure (or reduce buys)
   * - Within tolerance → no adjustment needed
   */
  private calculateFeedbackAdjustment(
    plan: PriceTrajectoryPlan,
    actualPrice: number,
    expectedPrice: number,
    checkpoint: PriceCheckpoint,
  ): BN {
    const deviation = (actualPrice - expectedPrice) / expectedPrice;

    // Within tolerance — no adjustment
    if (Math.abs(deviation) <= checkpoint.tolerance) {
      return new BN(0);
    }

    // Calculate how much SOL is needed to close the gap
    // Use simplified estimation based on the deviation magnitude
    const gapPrice = expectedPrice - actualPrice; // positive = need to buy

    // Estimate reserves at current price using k invariant
    const numCheckpoints = plan.checkpoints.length;
    const avgCheckpointBudget =
      Math.abs(plan.totalNetBuySol.toNumber()) / numCheckpoints;

    // Scale adjustment proportionally to deviation
    const adjustmentRatio = Math.abs(deviation) / checkpoint.tolerance;
    const clampedRatio = Math.min(adjustmentRatio, 3); // cap at 3× correction

    // Direction: negative deviation means price is below target → need buys
    const direction = gapPrice > 0 ? 1 : -1;
    const adjustmentLamports = Math.round(
      avgCheckpointBudget * clampedRatio * direction,
    );

    // Floor at minimum trade size
    if (Math.abs(adjustmentLamports) < MIN_TRADE_LAMPORTS.toNumber()) {
      return direction > 0 ? MIN_TRADE_LAMPORTS : MIN_TRADE_LAMPORTS.neg();
    }

    return new BN(adjustmentLamports);
  }
}
