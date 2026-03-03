/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

/**
 * CoinGlass Liquidations Adapter — Real-time Derivatives Liquidation Data
 *
 * CoinGlass provides the market's best liquidation data:
 * - Aggregated liquidations across all major exchanges
 * - Long vs. short breakdowns
 * - Time-windowed data (1h, 4h, 12h, 24h)
 * - Per-exchange and per-token breakdowns
 *
 * Liquidation data is critical for:
 * - Detecting cascade liquidation events (flash crashes)
 * - Gauging leverage sentiment (over-leveraged longs/shorts)
 * - Market structure analysis
 *
 * Free tier: Set COINGLASS_API_KEY for access.
 *
 * API: https://coinglass.com/api
 * env: COINGLASS_API_KEY (required)
 *
 * @module providers/adapters/liquidations/coinglass-liquidations
 */

import type { DataProvider, FetchParams, RateLimitConfig } from "../../types";
import type { LiquidationData } from "./types";

const BASE = "https://open-api-v3.coinglass.com/api";
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY ?? "";

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60_000,
};

export const coinglassLiquidationsAdapter: DataProvider<LiquidationData[]> = {
  name: "coinglass-liquidations",
  description:
    "CoinGlass — Aggregated liquidation data across exchanges (long/short breakdowns)",
  priority: 1,
  weight: 0.6,
  rateLimit: RATE_LIMIT,
  capabilities: ["liquidations"],

  async fetch(params: FetchParams): Promise<LiquidationData[]> {
    if (!COINGLASS_API_KEY) {
      throw new Error("CoinGlass API key not configured (COINGLASS_API_KEY)");
    }

    const limit = params.limit ?? 25;
    const period = (params.extra?.period as string) ?? "24h";
    const now = new Date().toISOString();

    // Map period to CoinGlass time parameter
    const timeType = PERIOD_MAP[period] ?? 2; // default 24h

    const res = await fetch(
      `${BASE}/futures/liquidation/info?time_type=${timeType}`,
      {
        headers: {
          "CoinGlass-API-Key": COINGLASS_API_KEY,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (res.status === 429) {
      throw new Error("CoinGlass rate limit exceeded (429)");
    }
    if (!res.ok) {
      throw new Error(`CoinGlass Liquidations API error: ${res.status}`);
    }

    const json = await res.json();
    const data: CGLiquidationItem[] = json?.data ?? [];

    return data.slice(0, limit).map((item): LiquidationData => {
      const longUsd = item.longVolUsd ?? 0;
      const shortUsd = item.shortVolUsd ?? 0;

      return {
        symbol: (item.symbol ?? "").toUpperCase(),
        longLiquidationsUsd: longUsd,
        shortLiquidationsUsd: shortUsd,
        totalLiquidationsUsd: longUsd + shortUsd,
        longLiquidationCount: item.longCount ?? 0,
        shortLiquidationCount: item.shortCount ?? 0,
        largestLiquidationUsd: item.largestLiquidation ?? 0,
        topExchange: item.topExchange ?? "unknown",
        period,
        price: item.price ?? 0,
        priceChange24h: item.priceChangePercent24h ?? 0,
        source: "coinglass-liquidations",
        timestamp: now,
      };
    });
  },

  async healthCheck(): Promise<boolean> {
    if (!COINGLASS_API_KEY) return false;
    try {
      const res = await fetch(`${BASE}/futures/liquidation/info?time_type=2`, {
        headers: { "CoinGlass-API-Key": COINGLASS_API_KEY },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: LiquidationData[]): boolean {
    return Array.isArray(data) && data.length > 0;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Map period string to CoinGlass time_type */
const PERIOD_MAP: Record<string, number> = {
  "1h": 0,
  "4h": 1,
  "12h": 3,
  "24h": 2,
};

// ────────────────────────────────────────────────────────────────────────────
// Internal types
// ────────────────────────────────────────────────────────────────────────────

interface CGLiquidationItem {
  symbol?: string;
  longVolUsd?: number;
  shortVolUsd?: number;
  longCount?: number;
  shortCount?: number;
  largestLiquidation?: number;
  topExchange?: string;
  price?: number;
  priceChangePercent24h?: number;
}
