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
 * Alpha Vantage Adapter — Stocks, commodities & indices
 *
 * Free tier: 25 requests/day, 5/min. Provides:
 * - S&P 500 (SPY), NASDAQ (QQQ), VIX, Gold (GLD), Oil (USO)
 *
 * @see https://www.alphavantage.co/documentation/
 * @module providers/adapters/macro/alpha-vantage
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { MacroData, MacroIndicator, MacroIndicatorId } from './types';

const AV_BASE = 'https://www.alphavantage.co/query';
const AV_API_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? '';

const RATE_LIMIT: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };

/** Symbols to fetch and their indicator mappings */
const SYMBOLS: Record<string, { id: MacroIndicatorId; name: string; unit: string }> = {
  SPY:  { id: 'SP500',  name: 'S&P 500 (SPY)', unit: 'USD' },
  QQQ:  { id: 'NASDAQ', name: 'NASDAQ 100 (QQQ)', unit: 'USD' },
  GLD:  { id: 'GOLD',   name: 'Gold (GLD ETF)', unit: 'USD' },
  USO:  { id: 'OIL',    name: 'Oil (USO ETF)', unit: 'USD' },
};

async function fetchQuote(symbol: string): Promise<{
  price: number; prevClose: number; changePercent: number;
} | null> {
  if (!AV_API_KEY) return null;

  const url = `${AV_BASE}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${AV_API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;

  const json = await res.json();
  const q = json['Global Quote'];
  if (!q?.['05. price']) return null;

  return {
    price: parseFloat(q['05. price']),
    prevClose: parseFloat(q['08. previous close']),
    changePercent: parseFloat((q['10. change percent'] ?? '0').replace('%', '')),
  };
}

export const alphaVantageAdapter: DataProvider<MacroData> = {
  name: 'alpha-vantage',
  description: 'Alpha Vantage — US equity indices, commodities, VIX',
  priority: 2,
  weight: 0.30,
  rateLimit: RATE_LIMIT,
  capabilities: ['macro-data'],

  async fetch(_params: FetchParams): Promise<MacroData> {
    const symbols = Object.keys(SYMBOLS);
    // Serial fetch to respect 5/min rate limit (500ms spacing)
    const indicators: MacroIndicator[] = [];

    for (const sym of symbols) {
      const quote = await fetchQuote(sym);
      if (quote) {
        const meta = SYMBOLS[sym];
        indicators.push({
          id: meta.id,
          name: meta.name,
          value: quote.price,
          previousValue: quote.prevClose,
          change: quote.price - quote.prevClose,
          changePercent: quote.changePercent,
          unit: meta.unit,
          source: 'alpha-vantage',
          timestamp: new Date().toISOString(),
        });
      }
      // Rate-limit spacing
      await new Promise(r => setTimeout(r, 500));
    }

    if (indicators.length === 0) throw new Error('No Alpha Vantage data returned');

    // Risk appetite from equity momentum
    const spyChange = indicators.find(i => i.id === 'SP500')?.changePercent ?? 0;
    const equityScore = Math.max(0, Math.min(100, 50 + spyChange * 10));

    return {
      indicators,
      riskAppetite: {
        score: Math.round(equityScore),
        label: equityScore < 35 ? 'risk-off' : equityScore > 65 ? 'risk-on' : 'neutral',
        components: { vix: 50, dxy: 50, yieldSpread: 50, equityMomentum: equityScore },
      },
      source: 'alpha-vantage',
      timestamp: new Date().toISOString(),
    };
  },

  async healthCheck(): Promise<boolean> {
    if (!AV_API_KEY) return false;
    try {
      const res = await fetch(
        `${AV_BASE}?function=GLOBAL_QUOTE&symbol=SPY&apikey=${AV_API_KEY}`,
        { signal: AbortSignal.timeout(5000) },
      );
      return res.ok;
    } catch { return false; }
  },

  validate(data: MacroData): boolean {
    return Array.isArray(data.indicators) && data.indicators.length > 0;
  },
};
