/**
 * PumpFun x402 Module — Premium Analytics Client
 *
 * Calls the x402-paywalled PumpFun Analytics API.
 * When the API returns HTTP 402, the x402 client middleware
 * auto-signs a USDC payment and retries — transparent to the caller.
 *
 * @author nirholas
 * @license Apache-2.0
 *
 * @example
 * ```typescript
 * const client = await createPumpAnalyticsClient()
 * // This call auto-pays $0.03 USDC if the API returns 402
 * const analysis = await client.getDeepAnalysis("TokenMintAddress...")
 * ```
 */

import { createPaymentFetch, createX402Client, type X402ClientWrapper } from "@/x402/client.js"
import Logger from "@/utils/logger.js"
import type {
  PumpToken,
  TokenDeepAnalysis,
  SniperDetectionResult,
  SmartMoneyFlow,
  GraduationOdds,
  WhaleHolder,
  PumpApiResponse,
} from "./types.js"

// ============================================================================
// Configuration
// ============================================================================

const PUMP_API_BASE = process.env.PUMP_ANALYTICS_API_URL || "https://pump-analytics.example.com"
const PUMP_FUN_PUBLIC_API = "https://frontend-api-v3.pump.fun"

// ============================================================================
// Public API Client (free, no x402)
// ============================================================================

/**
 * Fetch basic token data from pump.fun's public API (no payment needed)
 */
export async function fetchPumpToken(mint: string): Promise<PumpToken | null> {
  try {
    const response = await fetch(`${PUMP_FUN_PUBLIC_API}/coins/${mint}`)
    if (!response.ok) {
      Logger.warn(`pump.fun API returned ${response.status} for ${mint}`)
      return null
    }
    const data = await response.json()
    return mapPumpResponse(data)
  } catch (error) {
    Logger.error("Failed to fetch pump.fun token:", error)
    return null
  }
}

/**
 * Fetch recently created tokens from pump.fun (no payment needed)
 */
export async function fetchNewTokens(limit = 20): Promise<PumpToken[]> {
  try {
    const response = await fetch(
      `${PUMP_FUN_PUBLIC_API}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`
    )
    if (!response.ok) return []
    const data = await response.json()
    return Array.isArray(data) ? data.map(mapPumpResponse) : []
  } catch (error) {
    Logger.error("Failed to fetch new tokens:", error)
    return []
  }
}

// ============================================================================
// Premium Analytics Client (x402-gated)
// ============================================================================

/**
 * Creates a PumpFun analytics client with x402 payment capability.
 *
 * The returned client wraps `fetch` with the x402 middleware.
 * When any premium endpoint returns HTTP 402, the middleware:
 *   1. Reads the payment requirements from the 402 response
 *   2. Signs a USDC transfer using the agent's embedded wallet
 *   3. Retries the request with the payment proof header
 *   4. Returns the response transparently
 *
 * The caller never sees the 402 — they just get the data.
 */
export async function createPumpAnalyticsClient(): Promise<PumpAnalyticsClient> {
  const x402 = await createX402Client()
  const paymentFetch = x402.wrapFetch()
  return new PumpAnalyticsClient(paymentFetch, x402)
}

export class PumpAnalyticsClient {
  private readonly fetch: typeof globalThis.fetch
  private readonly x402: X402ClientWrapper

  constructor(paymentFetch: typeof globalThis.fetch, x402: X402ClientWrapper) {
    this.fetch = paymentFetch
    this.x402 = x402
  }

  /**
   * Deep token analysis — $0.03 USDC via x402
   *
   * Returns bonding curve health, whale concentration, rug pull risk,
   * graduation probability, and trading signals.
   *
   * Flow:
   *   1. Agent calls GET /api/pump/analysis/{mint}
   *   2. Server returns HTTP 402 + payment requirements
   *   3. x402 middleware signs 0.03 USDC payment
   *   4. Server verifies payment on-chain → returns data
   */
  async getDeepAnalysis(mint: string): Promise<TokenDeepAnalysis> {
    const response = await this.fetch(`${PUMP_API_BASE}/api/pump/analysis/${mint}`)
    const body = (await response.json()) as PumpApiResponse<TokenDeepAnalysis>
    if (!body.success) throw new Error(`Analysis failed: ${JSON.stringify(body)}`)
    return body.data
  }

  /**
   * Whale holder tracking — $0.05 USDC via x402
   *
   * Returns top holders, their buy history, P&L, and labels
   * (sniper, whale, smart money, dev, insider).
   */
  async getWhaleHolders(mint: string, limit = 20): Promise<WhaleHolder[]> {
    const response = await this.fetch(
      `${PUMP_API_BASE}/api/pump/whales/${mint}?limit=${limit}`
    )
    const body = (await response.json()) as PumpApiResponse<WhaleHolder[]>
    if (!body.success) throw new Error(`Whale tracking failed: ${JSON.stringify(body)}`)
    return body.data
  }

  /**
   * Smart money flow analysis — $0.05 USDC via x402
   *
   * Tracks wallets with high historical win rates and shows
   * their net position changes on a token.
   */
  async getSmartMoneyFlow(mint: string, period = "24h"): Promise<SmartMoneyFlow> {
    const response = await this.fetch(
      `${PUMP_API_BASE}/api/pump/smart-money/${mint}?period=${period}`
    )
    const body = (await response.json()) as PumpApiResponse<SmartMoneyFlow>
    if (!body.success) throw new Error(`Smart money analysis failed: ${JSON.stringify(body)}`)
    return body.data
  }

  /**
   * Sniper bot detection — $0.02 USDC via x402
   *
   * Detects wallets that bought in the first few blocks
   * after token creation and cross-references known bot addresses.
   */
  async detectSnipers(mint: string): Promise<SniperDetectionResult> {
    const response = await this.fetch(
      `${PUMP_API_BASE}/api/pump/snipers/${mint}`
    )
    const body = (await response.json()) as PumpApiResponse<SniperDetectionResult>
    if (!body.success) throw new Error(`Sniper detection failed: ${JSON.stringify(body)}`)
    return body.data
  }

  /**
   * Graduation probability — $0.03 USDC via x402
   *
   * ML-based prediction of whether a token will graduate
   * from the bonding curve to the AMM, based on historical
   * patterns of similar tokens.
   */
  async getGraduationOdds(mint: string): Promise<GraduationOdds> {
    const response = await this.fetch(
      `${PUMP_API_BASE}/api/pump/graduation-odds/${mint}`
    )
    const body = (await response.json()) as PumpApiResponse<GraduationOdds>
    if (!body.success) throw new Error(`Graduation odds failed: ${JSON.stringify(body)}`)
    return body.data
  }
}

// ============================================================================
// Helpers
// ============================================================================

function mapPumpResponse(raw: Record<string, unknown>): PumpToken {
  return {
    mint: String(raw.mint ?? ""),
    name: String(raw.name ?? ""),
    symbol: String(raw.symbol ?? ""),
    description: String(raw.description ?? ""),
    imageUri: String(raw.image_uri ?? raw.imageUri ?? ""),
    creator: String(raw.creator ?? ""),
    createdAt: String(raw.created_timestamp ?? raw.createdAt ?? ""),
    bondingCurveAddress: String(raw.bonding_curve ?? raw.bondingCurveAddress ?? ""),
    associatedBondingCurve: String(raw.associated_bonding_curve ?? raw.associatedBondingCurve ?? ""),
    virtualSolReserves: String(raw.virtual_sol_reserves ?? raw.virtualSolReserves ?? "0"),
    virtualTokenReserves: String(raw.virtual_token_reserves ?? raw.virtualTokenReserves ?? "0"),
    realSolReserves: String(raw.real_sol_reserves ?? raw.realSolReserves ?? "0"),
    realTokenReserves: String(raw.real_token_reserves ?? raw.realTokenReserves ?? "0"),
    totalSupply: String(raw.total_supply ?? raw.totalSupply ?? "1000000000"),
    marketCapSol: Number(raw.market_cap ?? raw.marketCapSol ?? 0),
    marketCapUsd: Number(raw.usd_market_cap ?? raw.marketCapUsd ?? 0),
    priceUsd: Number(raw.usd_price ?? raw.priceUsd ?? 0),
    priceSol: Number(raw.price ?? raw.priceSol ?? 0),
    isGraduated: Boolean(raw.complete ?? raw.is_graduated ?? raw.isGraduated ?? false),
    graduatedAt: raw.graduated_at ? String(raw.graduated_at) : undefined,
    ammPoolAddress: raw.amm_pool_address ? String(raw.amm_pool_address) : undefined,
    volume24h: raw.volume_24h ? Number(raw.volume_24h) : undefined,
    holders: raw.holder_count ? Number(raw.holder_count) : undefined,
    txCount24h: raw.tx_count_24h ? Number(raw.tx_count_24h) : undefined,
  }
}
