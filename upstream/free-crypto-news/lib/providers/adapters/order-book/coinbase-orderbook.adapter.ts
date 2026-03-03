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
 * Coinbase Order Book Adapter — Real-time order book from Coinbase Exchange
 *
 * Coinbase (Advanced Trade API) provides:
 * - Deep liquidity for major pairs
 * - Free public endpoint, no API key needed
 * - 10 requests/second rate limit
 * - US-regulated exchange data
 *
 * @module providers/adapters/order-book/coinbase
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { OrderBookData, OrderBookLevel } from './types';

const COINBASE_BASE = 'https://api.exchange.coinbase.com';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 600,
  windowMs: 60_000,
};

// Map common symbols to Coinbase product IDs
function toCoinbaseProductId(symbol: string): string {
  // Already in Coinbase format (e.g., BTC-USD)
  if (symbol.includes('-')) return symbol;
  // BTCUSDT → BTC-USD, ETHUSDT → ETH-USD
  const base = symbol.replace(/USDT$|USD$|BUSD$/, '');
  return `${base}-USD`;
}

export const coinbaseOrderBookAdapter: DataProvider<OrderBookData[]> = {
  name: 'coinbase-orderbook',
  description: 'Coinbase — US-regulated exchange order book depth, deep liquidity for major pairs',
  priority: 2,
  weight: 0.45,
  rateLimit: RATE_LIMIT,
  capabilities: ['order-book'],

  async fetch(params: FetchParams): Promise<OrderBookData[]> {
    const symbols = params.symbols ?? ['BTC-USD'];
    const depthLevel = (params.extra?.depth as number) ?? 2; // Level 2 = aggregated
    const results: OrderBookData[] = [];

    for (const symbol of symbols) {
      const productId = toCoinbaseProductId(symbol);
      const level = depthLevel > 50 ? 3 : 2; // Level 3 = full book, Level 2 = top 50

      const url = `${COINBASE_BASE}/products/${productId}/book?level=${level}`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'free-crypto-news/2.0' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        if (response.status === 404) continue; // Pair not found, skip
        throw new Error(`Coinbase order book error: ${response.status}`);
      }

      const raw: CoinbaseBook = await response.json();

      const bids: OrderBookLevel[] = (raw.bids ?? [])
        .map(([price, size]: [string, string, string]) => ({
          price: parseFloat(price),
          quantity: parseFloat(size),
        }))
        .sort((a: OrderBookLevel, b: OrderBookLevel) => b.price - a.price);

      const asks: OrderBookLevel[] = (raw.asks ?? [])
        .map(([price, size]: [string, string, string]) => ({
          price: parseFloat(price),
          quantity: parseFloat(size),
        }))
        .sort((a: OrderBookLevel, b: OrderBookLevel) => a.price - b.price);

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
        symbol: productId,
        exchange: 'coinbase',
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
      const res = await fetch(`${COINBASE_BASE}/products/BTC-USD/book?level=1`, {
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

// =============================================================================
// INTERNAL
// =============================================================================

interface CoinbaseBook {
  bids: [string, string, string][]; // [price, size, num_orders]
  asks: [string, string, string][];
  sequence: number;
}
