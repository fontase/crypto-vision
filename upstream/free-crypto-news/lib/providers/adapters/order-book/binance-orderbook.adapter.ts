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
 * Binance Order Book Adapter — Real-time order book depth
 *
 * Binance provides the deepest liquidity globally:
 * - 600+ trading pairs
 * - Up to 5000 levels depth
 * - Free, no API key needed
 *
 * @module providers/adapters/order-book/binance
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { OrderBookData, OrderBookLevel } from './types';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 1200,
  windowMs: 60_000,
};

export const binanceOrderBookAdapter: DataProvider<OrderBookData[]> = {
  name: 'binance-orderbook',
  description: 'Binance — real-time order book depth for 600+ pairs',
  priority: 1,
  weight: 0.5,
  rateLimit: RATE_LIMIT,
  capabilities: ['order-book'],

  async fetch(params: FetchParams): Promise<OrderBookData[]> {
    const symbols = params.symbols ?? ['BTCUSDT'];
    const depthLimit = Math.min((params.extra?.depth as number) ?? 20, 5000);
    const results: OrderBookData[] = [];

    for (const symbol of symbols) {
      const url = `${BINANCE_BASE}/depth?symbol=${symbol}&limit=${depthLimit}`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Binance depth API error: ${response.status}`);
      }

      const raw: BinanceDepth = await response.json();

      const bids: OrderBookLevel[] = raw.bids.map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty),
      }));

      const asks: OrderBookLevel[] = raw.asks.map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty),
      }));

      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 0;
      const midPrice = (bestBid + bestAsk) / 2;
      const spread = bestAsk - bestBid;
      const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

      // Calculate depth within 2% of mid
      const lower2 = midPrice * 0.98;
      const upper2 = midPrice * 1.02;
      const bidDepth2Pct = bids
        .filter(b => b.price >= lower2)
        .reduce((sum, b) => sum + b.price * b.quantity, 0);
      const askDepth2Pct = asks
        .filter(a => a.price <= upper2)
        .reduce((sum, a) => sum + a.price * a.quantity, 0);

      const imbalanceRatio = askDepth2Pct > 0 ? bidDepth2Pct / askDepth2Pct : 1;

      results.push({
        symbol,
        exchange: 'binance',
        bids,
        asks,
        midPrice,
        spread,
        spreadPercent,
        bidDepth2Pct,
        askDepth2Pct,
        imbalanceRatio,
        timestamp: Date.now(),
        lastUpdated: new Date().toISOString(),
      });
    }

    return results;
  },

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BINANCE_BASE}/ping`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: OrderBookData[]): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(d => d.bids.length > 0 && d.asks.length > 0 && d.midPrice > 0);
  },
};

interface BinanceDepth {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}
