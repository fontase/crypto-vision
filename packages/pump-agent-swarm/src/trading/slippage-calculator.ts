/**
 * Slippage Calculator
 *
 * Accurately calculates expected slippage on Pump.fun bonding curve trades
 * before execution, estimates price impact, warns on excessive slippage,
 * and suggests optimal trade sizes to minimise market impact.
 *
 * Bonding curve math (constant product: x × y = k):
 *   - Price = virtualSolReserves / virtualTokenReserves
 *   - Buy:  tokensOut = virtualTokenReserves - k / (virtualSolReserves + solInAfterFee)
 *   - Sell: solOut    = virtualSolReserves   - k / (virtualTokenReserves + tokensIn)
 *   - Fee is deducted before the swap for buys, after the swap for sells (1%)
 *
 * @example
 * ```typescript
 * import { Connection } from '@solana/web3.js';
 * import BN from 'bn.js';
 * import { SlippageCalculator } from './slippage-calculator.js';
 *
 * const conn = new Connection('https://api.mainnet-beta.solana.com');
 * const calc = new SlippageCalculator(conn);
 *
 * const est = await calc.calculateBuySlippage('So11...mint', new BN(1_000_000_000));
 * console.log(`Slippage: ${est.slippagePercent.toFixed(2)}%`);
 * console.log(`Tokens received: ${est.tokensReceived?.toString()}`);
 * if (est.warning) console.warn(est.warning);
 * ```
 */

import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import { bondingCurvePda } from '@pump-fun/pump-sdk';
import type { BondingCurveState, TradeDirection } from '../types.js';

// ─── Constants ────────────────────────────────────────────────

/** Platform trading fee in basis points (1%) */
const PUMP_FUN_FEE_BPS = 100;

/** Basis-point denominator */
const BPS_DENOMINATOR = 10_000;

/** Token decimals for Pump.fun tokens */
const TOKEN_DECIMALS = 6;

/** Default maximum slippage (bps) before a warning is emitted */
const DEFAULT_WARNING_THRESHOLD_BPS = 200; // 2%

/** Maximum number of chunks to suggest for order splitting */
const MAX_SUGGESTED_CHUNKS = 20;

/** Minimum chunk size in lamports (0.001 SOL) */
const MIN_CHUNK_LAMPORTS = new BN(1_000_000);

/** Minimum chunk size in token base units (1 token) */
const MIN_CHUNK_TOKENS = new BN(1_000_000); // 1 token at 6 decimals

// ─── Interfaces ───────────────────────────────────────────────

/** Detailed slippage estimation for a bonding-curve trade */
export interface SlippageEstimate {
  /** Price before trade (SOL per token, human-readable) */
  spotPrice: number;
  /** Expected average execution price of the trade */
  executionPrice: number;
  /** Slippage in basis points */
  slippageBps: number;
  /** Slippage as a percentage (e.g. 1.5 for 1.5%) */
  slippagePercent: number;
  /** How much the trade moves the price, as a percentage */
  priceImpactPercent: number;
  /** For buys: tokens the trader would receive */
  tokensReceived?: BN;
  /** For sells: SOL the trader would receive (lamports) */
  solReceived?: BN;
  /** New spot price after the trade is executed */
  priceAfterTrade: number;
  /** Pump.fun trading fee (lamports for buys, lamports for sells) */
  fee: BN;
  /** Warning message when slippage is excessive */
  warning?: string;
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Calculate tokens received for a SOL buy on the bonding curve.
 *
 * Fee is deducted from the SOL input before the swap.
 */
function computeBuyOutput(
  virtualSolReserves: BN,
  virtualTokenReserves: BN,
  solInput: BN,
): { tokensOut: BN; fee: BN; solAfterFee: BN } {
  if (solInput.isZero() || solInput.isNeg()) {
    return { tokensOut: new BN(0), fee: new BN(0), solAfterFee: new BN(0) };
  }
  const fee = solInput.mul(new BN(PUMP_FUN_FEE_BPS)).div(new BN(BPS_DENOMINATOR));
  const solAfterFee = solInput.sub(fee);
  const k = virtualSolReserves.mul(virtualTokenReserves);
  const newSolReserves = virtualSolReserves.add(solAfterFee);
  const newTokenReserves = k.div(newSolReserves);
  const tokensOut = virtualTokenReserves.sub(newTokenReserves);
  return {
    tokensOut: tokensOut.isNeg() ? new BN(0) : tokensOut,
    fee,
    solAfterFee,
  };
}

/**
 * Calculate SOL received for a token sell on the bonding curve.
 *
 * Fee is deducted from the SOL output after the swap.
 */
function computeSellOutput(
  virtualSolReserves: BN,
  virtualTokenReserves: BN,
  tokenInput: BN,
): { solOut: BN; fee: BN; solBeforeFee: BN } {
  if (tokenInput.isZero() || tokenInput.isNeg()) {
    return { solOut: new BN(0), fee: new BN(0), solBeforeFee: new BN(0) };
  }
  const k = virtualSolReserves.mul(virtualTokenReserves);
  const newTokenReserves = virtualTokenReserves.add(tokenInput);
  const newSolReserves = k.div(newTokenReserves);
  const solBeforeFee = virtualSolReserves.sub(newSolReserves);
  if (solBeforeFee.isNeg()) {
    return { solOut: new BN(0), fee: new BN(0), solBeforeFee: new BN(0) };
  }
  const fee = solBeforeFee.mul(new BN(PUMP_FUN_FEE_BPS)).div(new BN(BPS_DENOMINATOR));
  const solOut = solBeforeFee.sub(fee);
  return { solOut, fee, solBeforeFee };
}

/**
 * Compute the spot price (SOL per token, human-readable) from virtual reserves.
 */
function spotPriceFromReserves(
  virtualSolReserves: BN,
  virtualTokenReserves: BN,
): number {
  // Convert to human-readable: (solReserves / 10^9) / (tokenReserves / 10^6)
  // = solReserves / tokenReserves × 10^(6-9) = solReserves / tokenReserves × 1e-3
  // Simplified: price in lamports-per-base-unit, then convert.
  return (
    virtualSolReserves.toNumber() /
    virtualTokenReserves.toNumber()
  );
}

/**
 * Generate a human-readable warning for high-slippage trades.
 */
function slippageWarning(slippageBps: number): string | undefined {
  if (slippageBps >= 1_000) {
    return `EXTREME slippage: ${(slippageBps / 100).toFixed(1)}%. This trade will move the price dramatically. Consider splitting or reducing size.`;
  }
  if (slippageBps >= 500) {
    return `HIGH slippage: ${(slippageBps / 100).toFixed(1)}%. Price impact is significant. Consider splitting the trade.`;
  }
  if (slippageBps >= DEFAULT_WARNING_THRESHOLD_BPS) {
    return `Moderate slippage: ${(slippageBps / 100).toFixed(1)}%. You may want to split this trade into smaller chunks.`;
  }
  return undefined;
}

// ─── SlippageCalculator ───────────────────────────────────────

/**
 * Calculates expected slippage, price impact, and optimal trade sizes
 * for Pump.fun bonding-curve trades.
 */
export class SlippageCalculator {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Calculate slippage for a buy trade (SOL → tokens).
   *
   * @param mint    Token mint address
   * @param solAmount  SOL to spend (in lamports)
   * @returns Detailed slippage estimate
   */
  async calculateBuySlippage(mint: string, solAmount: BN): Promise<SlippageEstimate> {
    const state = await this.getBondingCurveState(mint);
    return this.computeBuySlippageFromState(state, solAmount);
  }

  /**
   * Calculate slippage for a sell trade (tokens → SOL).
   *
   * @param mint         Token mint address
   * @param tokenAmount  Tokens to sell (in base units, i.e. with decimals)
   * @returns Detailed slippage estimate
   */
  async calculateSellSlippage(mint: string, tokenAmount: BN): Promise<SlippageEstimate> {
    const state = await this.getBondingCurveState(mint);
    return this.computeSellSlippageFromState(state, tokenAmount);
  }

  /**
   * Estimate the percentage price impact of a trade.
   *
   * @param mint       Token mint address
   * @param direction  'buy' or 'sell'
   * @param amount     SOL (lamports) for buys, tokens (base units) for sells
   * @returns Price impact as a percentage (e.g. 3.2 means 3.2%)
   */
  async estimatePriceImpact(
    mint: string,
    direction: TradeDirection,
    amount: BN,
  ): Promise<number> {
    const state = await this.getBondingCurveState(mint);
    const spotPrice = this.calculateSpotPrice(state);
    const execPrice = this.calculateExecutionPrice(state, direction, amount);

    if (spotPrice === 0) return 0;

    // Price impact = |(executionPrice - spotPrice) / spotPrice| × 100
    return Math.abs((execPrice - spotPrice) / spotPrice) * 100;
  }

  /**
   * Suggest optimal chunk sizes to keep per-chunk slippage under a threshold.
   *
   * Uses binary-search per chunk to find the largest trade that stays within
   * `maxSlippageBps`, then repeats on the updated virtual reserves until the
   * full `totalAmount` is consumed.
   *
   * @param mint            Token mint address
   * @param direction       'buy' or 'sell'
   * @param maxSlippageBps  Maximum acceptable slippage per chunk (bps)
   * @param totalAmount     Total amount to trade (SOL lamports for buy, tokens for sell)
   * @returns Array of chunk amounts that each individually stay under the threshold
   */
  async suggestOptimalSize(
    mint: string,
    direction: TradeDirection,
    maxSlippageBps: number,
    totalAmount: BN,
  ): Promise<BN[]> {
    const state = await this.getBondingCurveState(mint);
    return this.computeOptimalChunks(state, direction, maxSlippageBps, totalAmount);
  }

  /**
   * Fetch the current bonding curve state from on-chain.
   *
   * Derives the PDA using `["bonding-curve", mint]` seeds against the
   * Pump.fun program ID, then decodes the account data.
   *
   * @param mint  Token mint address (base58)
   * @returns Decoded bonding curve state
   * @throws If the bonding curve account does not exist
   */
  async getBondingCurveState(mint: string): Promise<BondingCurveState> {
    const mintPubkey = new PublicKey(mint);
    const curvePda = bondingCurvePda(mintPubkey);
    const accountInfo = await this.connection.getAccountInfo(curvePda);

    if (!accountInfo) {
      throw new Error(
        `Bonding curve not found for mint ${mint}. The token may not exist or may have graduated.`,
      );
    }

    // On-chain layout (Pump.fun bonding curve account):
    //   8  bytes — Anchor discriminator
    //   8  bytes — virtualTokenReserves  (u64 LE)
    //   8  bytes — virtualSolReserves    (u64 LE)
    //   8  bytes — realTokenReserves     (u64 LE)
    //   8  bytes — realSolReserves       (u64 LE)
    //   8  bytes — tokenTotalSupply      (u64 LE)
    //   1  byte  — complete              (bool)
    const data = accountInfo.data;
    const DISC = 8;

    const virtualTokenReserves = new BN(data.subarray(DISC, DISC + 8), 'le');
    const virtualSolReserves = new BN(data.subarray(DISC + 8, DISC + 16), 'le');
    const realTokenReserves = new BN(data.subarray(DISC + 16, DISC + 24), 'le');
    const realSolReserves = new BN(data.subarray(DISC + 24, DISC + 32), 'le');
    const complete = data[DISC + 40] === 1;

    const currentPriceSol = spotPriceFromReserves(virtualSolReserves, virtualTokenReserves);

    // Graduation target: ~85 SOL in real reserves
    const GRADUATION_SOL_TARGET = 85e9; // lamports
    const graduationProgress = Math.min(
      100,
      (realSolReserves.toNumber() / GRADUATION_SOL_TARGET) * 100,
    );

    // Market cap = price(lamports/base-unit) × total supply in base units
    // Total supply is 1 billion tokens × 10^6 base units
    const TOTAL_SUPPLY_BASE = 1_000_000_000 * 10 ** TOKEN_DECIMALS;
    const marketCapSol = currentPriceSol * TOTAL_SUPPLY_BASE;

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
   * Calculate the current spot price in SOL per token (raw, not human-readable).
   *
   * This is the marginal price for an infinitesimally small trade.
   * `spotPrice = virtualSolReserves / virtualTokenReserves`
   */
  calculateSpotPrice(state: BondingCurveState): number {
    return spotPriceFromReserves(state.virtualSolReserves, state.virtualTokenReserves);
  }

  /**
   * Calculate the average execution price for a trade of a given size.
   *
   * @param state      Current bonding curve state
   * @param direction  'buy' or 'sell'
   * @param amount     SOL (lamports) for buy, tokens (base units) for sell
   * @returns Average execution price in raw units (lamports per base-unit)
   */
  calculateExecutionPrice(
    state: BondingCurveState,
    direction: TradeDirection,
    amount: BN,
  ): number {
    if (amount.isZero()) return this.calculateSpotPrice(state);

    if (direction === 'buy') {
      const { tokensOut, solAfterFee } = computeBuyOutput(
        state.virtualSolReserves,
        state.virtualTokenReserves,
        amount,
      );
      if (tokensOut.isZero()) return this.calculateSpotPrice(state);
      // Average price = SOL spent (after fee) / tokens received
      return solAfterFee.toNumber() / tokensOut.toNumber();
    }

    // Sell
    const { solOut } = computeSellOutput(
      state.virtualSolReserves,
      state.virtualTokenReserves,
      amount,
    );
    if (amount.isZero()) return this.calculateSpotPrice(state);
    // Average price = SOL received / tokens sold
    return solOut.toNumber() / amount.toNumber();
  }

  // ── Private Computation ────────────────────────────────────

  /**
   * Build a full SlippageEstimate for a buy from pre-fetched state.
   */
  private computeBuySlippageFromState(state: BondingCurveState, solAmount: BN): SlippageEstimate {
    const spotPrice = this.calculateSpotPrice(state);
    const { tokensOut, fee, solAfterFee } = computeBuyOutput(
      state.virtualSolReserves,
      state.virtualTokenReserves,
      solAmount,
    );

    // Execution price = solAfterFee / tokensOut
    const executionPrice = tokensOut.isZero()
      ? spotPrice
      : solAfterFee.toNumber() / tokensOut.toNumber();

    // Slippage = (executionPrice - spotPrice) / spotPrice
    const slippageRatio = spotPrice === 0 ? 0 : (executionPrice - spotPrice) / spotPrice;
    const slippageBps = Math.round(Math.abs(slippageRatio) * BPS_DENOMINATOR);
    const slippagePercent = Math.abs(slippageRatio) * 100;

    // Post-trade reserves
    const newVirtualSol = state.virtualSolReserves.add(solAfterFee);
    const newVirtualTokens = state.virtualTokenReserves.sub(tokensOut);
    const priceAfterTrade = spotPriceFromReserves(newVirtualSol, newVirtualTokens);

    // Price impact = (priceAfterTrade - spotPrice) / spotPrice × 100
    const priceImpactPercent = spotPrice === 0
      ? 0
      : ((priceAfterTrade - spotPrice) / spotPrice) * 100;

    return {
      spotPrice,
      executionPrice,
      slippageBps,
      slippagePercent,
      priceImpactPercent,
      tokensReceived: tokensOut,
      priceAfterTrade,
      fee,
      warning: slippageWarning(slippageBps),
    };
  }

  /**
   * Build a full SlippageEstimate for a sell from pre-fetched state.
   */
  private computeSellSlippageFromState(state: BondingCurveState, tokenAmount: BN): SlippageEstimate {
    const spotPrice = this.calculateSpotPrice(state);
    const { solOut, fee } = computeSellOutput(
      state.virtualSolReserves,
      state.virtualTokenReserves,
      tokenAmount,
    );

    // For sells, execution price = SOL received / tokens sold
    const executionPrice = tokenAmount.isZero()
      ? spotPrice
      : solOut.toNumber() / tokenAmount.toNumber();

    // Slippage for sells: we receive less per token than spot price
    // slippage = (spotPrice - executionPrice) / spotPrice
    const slippageRatio = spotPrice === 0 ? 0 : (spotPrice - executionPrice) / spotPrice;
    const slippageBps = Math.round(Math.abs(slippageRatio) * BPS_DENOMINATOR);
    const slippagePercent = Math.abs(slippageRatio) * 100;

    // Post-trade reserves
    const k = state.virtualSolReserves.mul(state.virtualTokenReserves);
    const newVirtualTokens = state.virtualTokenReserves.add(tokenAmount);
    const newVirtualSol = k.div(newVirtualTokens);
    const priceAfterTrade = spotPriceFromReserves(newVirtualSol, newVirtualTokens);

    // Price impact = (spotPrice - priceAfterTrade) / spotPrice × 100
    const priceImpactPercent = spotPrice === 0
      ? 0
      : ((spotPrice - priceAfterTrade) / spotPrice) * 100;

    return {
      spotPrice,
      executionPrice,
      slippageBps,
      slippagePercent,
      priceImpactPercent,
      solReceived: solOut,
      priceAfterTrade,
      fee,
      warning: slippageWarning(slippageBps),
    };
  }

  /**
   * Compute optimal chunk sizes that each individually stay below the
   * requested slippage threshold. Simulates sequential execution on
   * a virtual copy of the reserves so that each chunk's slippage is
   * calculated against the post-execution reserves of the previous chunk.
   */
  private computeOptimalChunks(
    state: BondingCurveState,
    direction: TradeDirection,
    maxSlippageBps: number,
    totalAmount: BN,
  ): BN[] {
    // First, check if the total amount already fits under the threshold
    const singleTradeEstimate =
      direction === 'buy'
        ? this.computeBuySlippageFromState(state, totalAmount)
        : this.computeSellSlippageFromState(state, totalAmount);

    if (singleTradeEstimate.slippageBps <= maxSlippageBps) {
      return [totalAmount];
    }

    const chunks: BN[] = [];
    let remaining = totalAmount.clone();
    let virtualSol = state.virtualSolReserves.clone();
    let virtualTokens = state.virtualTokenReserves.clone();

    const minChunk = direction === 'buy' ? MIN_CHUNK_LAMPORTS : MIN_CHUNK_TOKENS;

    for (let i = 0; i < MAX_SUGGESTED_CHUNKS && remaining.gt(new BN(0)); i++) {
      // Binary search for the largest chunk that stays under maxSlippageBps
      let lo = minChunk.clone();
      let hi = remaining.clone();
      let bestChunk = minChunk.clone();

      // If even the minimum chunk exceeds the threshold, use minimum anyway
      const minSlippage = this.computeChunkSlippage(
        virtualSol,
        virtualTokens,
        direction,
        minChunk,
      );
      if (minSlippage > maxSlippageBps) {
        bestChunk = minChunk.clone();
      } else {
        // Binary search: find largest amount with slippage <= maxSlippageBps
        while (lo.lte(hi)) {
          const mid = lo.add(hi).divn(2);
          if (mid.lt(minChunk)) {
            lo = minChunk.add(new BN(1));
            continue;
          }
          const slip = this.computeChunkSlippage(virtualSol, virtualTokens, direction, mid);
          if (slip <= maxSlippageBps) {
            bestChunk = mid.clone();
            lo = mid.add(new BN(1));
          } else {
            hi = mid.sub(new BN(1));
          }
        }
      }

      // Clamp to remaining
      if (bestChunk.gt(remaining)) {
        bestChunk = remaining.clone();
      }

      chunks.push(bestChunk);
      remaining = remaining.sub(bestChunk);

      // Advance virtual reserves for the next iteration
      if (direction === 'buy') {
        const { solAfterFee, tokensOut } = computeBuyOutput(virtualSol, virtualTokens, bestChunk);
        virtualSol = virtualSol.add(solAfterFee);
        virtualTokens = virtualTokens.sub(tokensOut);
      } else {
        const k = virtualSol.mul(virtualTokens);
        const newTokens = virtualTokens.add(bestChunk);
        const newSol = k.div(newTokens);
        virtualSol = newSol;
        virtualTokens = newTokens;
      }

      // Safety: if remaining is less than the minimum chunk, dump into the last chunk
      if (remaining.gt(new BN(0)) && remaining.lt(minChunk)) {
        // Merge remainder into the last chunk
        const lastIdx = chunks.length - 1;
        chunks[lastIdx] = chunks[lastIdx].add(remaining);
        remaining = new BN(0);
      }
    }

    // If we still have remaining after MAX_SUGGESTED_CHUNKS, add it as a final chunk
    if (remaining.gt(new BN(0))) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Compute slippage (in bps) for a single chunk against given reserves.
   */
  private computeChunkSlippage(
    virtualSolReserves: BN,
    virtualTokenReserves: BN,
    direction: TradeDirection,
    amount: BN,
  ): number {
    const spotPrice = spotPriceFromReserves(virtualSolReserves, virtualTokenReserves);
    if (spotPrice === 0) return 0;

    if (direction === 'buy') {
      const { tokensOut, solAfterFee } = computeBuyOutput(
        virtualSolReserves,
        virtualTokenReserves,
        amount,
      );
      if (tokensOut.isZero()) return BPS_DENOMINATOR; // Max slippage if no output
      const execPrice = solAfterFee.toNumber() / tokensOut.toNumber();
      const ratio = (execPrice - spotPrice) / spotPrice;
      return Math.round(Math.abs(ratio) * BPS_DENOMINATOR);
    }

    // Sell
    const { solOut } = computeSellOutput(virtualSolReserves, virtualTokenReserves, amount);
    if (solOut.isZero()) return BPS_DENOMINATOR;
    const execPrice = solOut.toNumber() / amount.toNumber();
    const ratio = (spotPrice - execPrice) / spotPrice;
    return Math.round(Math.abs(ratio) * BPS_DENOMINATOR);
  }
}
