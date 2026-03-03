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
 * Binance Futures Liquidations Adapter — Real-time liquidation data
 *
 * Binance Futures provides:
 * - Forced liquidation orders (real-time)
 * - Long/short aggregation
 * - $50B+ daily futures volume
 * - No API key needed
 *
 * Note: Uses the /forceOrders endpoint which returns recent liquidations.
 * For streaming, use WebSocket (wss://fstream.binance.com/ws/!forceOrder@arr).
 *
 * @module providers/adapters/derivatives/binance-liquidations
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { LiquidationSummary, Liquidation } from './types';

const FUTURES_BASE = 'https://fapi.binance.com/fapi/v1';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 300,
  windowMs: 60_000,
};

export const binanceLiquidationsAdapter: DataProvider<LiquidationSummary[]> = {
  name: 'binance-liquidations',
  description: 'Binance Futures — Real-time forced liquidation data, $50B+ daily volume',
  priority: 1,
  weight: 0.45,
  rateLimit: RATE_LIMIT,
  capabilities: ['liquidations'],

  async fetch(params: FetchParams): Promise<LiquidationSummary[]> {
    const symbols = params.symbols ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const limit = Math.min(params.limit ?? 100, 1000);
    const now = new Date().toISOString();

    const results: LiquidationSummary[] = [];

    for (const symbol of symbols) {
      const cleaned = symbol.includes('USDT') ? symbol : `${symbol}USDT`;

      const response = await fetch(
        `${FUTURES_BASE}/allForceOrders?symbol=${cleaned}&limit=${limit}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!response.ok) {
        if (response.status === 400) continue; // Invalid symbol, skip
        throw new Error(`Binance Liquidations API error: ${response.status}`);
      }

      const orders: BinanceForceOrder[] = await response.json();

      if (orders.length === 0) continue;

      // Aggregate liquidations
      let longLiqUsd = 0;
      let shortLiqUsd = 0;
      let count = 0;
      let largestSingle = 0;
      const liquidations: Liquidation[] = [];

      for (const order of orders) {
        const price = parseFloat(order.price);
        const qty = parseFloat(order.origQty);
        const sizeUsd = price * qty;
        const side: 'long' | 'short' = order.side === 'SELL' ? 'long' : 'short';

        if (side === 'long') {
          longLiqUsd += sizeUsd;
        } else {
          shortLiqUsd += sizeUsd;
        }

        count++;
        if (sizeUsd > largestSingle) largestSingle = sizeUsd;

        liquidations.push({
          symbol: cleaned,
          side,
          sizeUsd,
          price,
          exchange: 'Binance',
          timestamp: new Date(order.time).toISOString(),
        });
      }

      results.push({
        symbol: cleaned.replace('USDT', ''),
        longLiquidationsUsd24h: longLiqUsd,
        shortLiquidationsUsd24h: shortLiqUsd,
        count24h: count,
        largestSingleUsd: largestSingle,
        timestamp: now,
      });
    }

    return results.sort((a, b) =>
      (b.longLiquidationsUsd24h + b.shortLiquidationsUsd24h) -
      (a.longLiquidationsUsd24h + a.shortLiquidationsUsd24h),
    );
  },

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${FUTURES_BASE}/allForceOrders?symbol=BTCUSDT&limit=1`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: LiquidationSummary[]): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(item =>
      typeof item.symbol === 'string' &&
      typeof item.longLiquidationsUsd24h === 'number' &&
      typeof item.shortLiquidationsUsd24h === 'number',
    );
  },
};

// =============================================================================
// INTERNAL
// =============================================================================

interface BinanceForceOrder {
  symbol: string;
  price: string;
  origQty: string;
  executedQty: string;
  averagePrice: string;
  status: string;
  timeInForce: string;
  type: string;
  side: 'BUY' | 'SELL'; // SELL = long liquidated, BUY = short liquidated
  time: number;
}

// Re-export Liquidation type for consumers wanting individual events
export type { Liquidation } from './types';
