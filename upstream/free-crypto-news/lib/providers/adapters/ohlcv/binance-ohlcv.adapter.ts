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
 * Binance OHLCV Adapter — Candlestick data from Binance
 *
 * Binance provides the most liquid OHLCV data:
 * - 600+ trading pairs
 * - 1200 req/min rate limit
 * - No API key needed for public data
 * - Sub-second latency
 *
 * @module providers/adapters/ohlcv/binance
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { OHLCVData, OHLCVCandle, CandleInterval } from './types';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 1200,
  windowMs: 60_000,
};

const INTERVAL_MAP: Record<CandleInterval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '6h': '6h', '12h': '12h',
  '1d': '1d', '1w': '1w', '1M': '1M',
};

export const binanceOhlcvAdapter: DataProvider<OHLCVData[]> = {
  name: 'binance-ohlcv',
  description: 'Binance — OHLCV candlestick data for 600+ trading pairs',
  priority: 1,
  weight: 0.5,
  rateLimit: RATE_LIMIT,
  capabilities: ['ohlcv'],

  async fetch(params: FetchParams): Promise<OHLCVData[]> {
    const symbols = params.symbols ?? ['BTCUSDT'];
    const interval = (params.extra?.interval as CandleInterval) ?? '1h';
    const limit = Math.min(params.limit ?? 100, 1000);
    const binanceInterval = INTERVAL_MAP[interval] ?? '1h';

    const results: OHLCVData[] = [];

    for (const symbol of symbols) {
      const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Binance OHLCV error: ${response.status}`);
      }

      const raw: BinanceKline[] = await response.json();
      const candles: OHLCVCandle[] = raw.map(k => ({
        timestamp: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        quoteVolume: parseFloat(k[7]),
      }));

      results.push({
        symbol,
        interval,
        exchange: 'binance',
        candles,
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

  validate(data: OHLCVData[]): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(d =>
      d.candles.length > 0 &&
      d.candles.every(c => typeof c.close === 'number' && c.close > 0),
    );
  },
};

// Binance kline: [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, buyVol, buyQuoteVol, ignore]
type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];
