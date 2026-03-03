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
 * CryptoCompare OHLCV Adapter — Historical price data from CryptoCompare
 *
 * CryptoCompare provides:
 * - 7,000+ coins
 * - Historical data going back years
 * - Free tier: 100K calls/month
 * - Supports minute/hour/day aggregations
 *
 * @module providers/adapters/ohlcv/cryptocompare
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { OHLCVData, OHLCVCandle, CandleInterval } from './types';

const CC_BASE = 'https://min-api.cryptocompare.com/data/v2';
const CC_API_KEY = process.env.CRYPTOCOMPARE_API_KEY ?? '';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: CC_API_KEY ? 100 : 50,
  windowMs: 60_000,
};

function getEndpoint(interval: CandleInterval): { path: string; aggregate: number } {
  switch (interval) {
    case '1m': return { path: 'histominute', aggregate: 1 };
    case '5m': return { path: 'histominute', aggregate: 5 };
    case '15m': return { path: 'histominute', aggregate: 15 };
    case '30m': return { path: 'histominute', aggregate: 30 };
    case '1h': return { path: 'histohour', aggregate: 1 };
    case '4h': return { path: 'histohour', aggregate: 4 };
    case '6h': return { path: 'histohour', aggregate: 6 };
    case '12h': return { path: 'histohour', aggregate: 12 };
    case '1d': return { path: 'histoday', aggregate: 1 };
    case '1w': return { path: 'histoday', aggregate: 7 };
    case '1M': return { path: 'histoday', aggregate: 30 };
    default: return { path: 'histohour', aggregate: 1 };
  }
}

export const cryptocompareOhlcvAdapter: DataProvider<OHLCVData[]> = {
  name: 'cryptocompare-ohlcv',
  description: 'CryptoCompare — historical OHLCV data for 7,000+ coins',
  priority: 2,
  weight: 0.4,
  rateLimit: RATE_LIMIT,
  capabilities: ['ohlcv'],

  async fetch(params: FetchParams): Promise<OHLCVData[]> {
    const symbols = params.symbols ?? ['BTC'];
    const interval = (params.extra?.interval as CandleInterval) ?? '1h';
    const limit = Math.min(params.limit ?? 100, 2000);
    const vsCurrency = params.vsCurrency?.toUpperCase() ?? 'USD';

    const { path, aggregate } = getEndpoint(interval);
    const results: OHLCVData[] = [];

    for (const symbol of symbols) {
      const fsym = symbol.replace(/USDT$|USD$|BTC$/, '').toUpperCase();
      const url = `${CC_BASE}/${path}?fsym=${fsym}&tsym=${vsCurrency}&limit=${limit}&aggregate=${aggregate}`;

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (CC_API_KEY) {
        headers.authorization = `Apikey ${CC_API_KEY}`;
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`CryptoCompare OHLCV error: ${response.status}`);
      }

      const json = await response.json();
      const data: CCOHLCVItem[] = json.Data?.Data ?? [];

      const candles: OHLCVCandle[] = data.map(d => ({
        timestamp: d.time * 1000,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volumefrom,
        quoteVolume: d.volumeto,
      }));

      results.push({
        symbol,
        interval,
        exchange: 'cryptocompare',
        candles,
        lastUpdated: new Date().toISOString(),
      });
    }

    return results;
  },

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=1', {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: OHLCVData[]): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(d => d.candles.length > 0);
  },
};

interface CCOHLCVItem {
  time: number;
  high: number;
  low: number;
  open: number;
  close: number;
  volumefrom: number;
  volumeto: number;
}
