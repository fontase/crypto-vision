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
 * Twelve Data Adapter — Real-time batch quotes for indices & commodities
 *
 * Free tier: 800 requests/day, 8/min. Provides:
 * - SPX, NDX, VIX, Gold (XAU/USD), Oil (CL), DXY
 *
 * @see https://twelvedata.com/docs
 * @module providers/adapters/macro/twelve-data
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { MacroData, MacroIndicator, MacroIndicatorId } from './types';

const TD_BASE = 'https://api.twelvedata.com';
const TD_API_KEY = process.env.TWELVE_DATA_API_KEY ?? '';

const RATE_LIMIT: RateLimitConfig = { maxRequests: 8, windowMs: 60_000 };

/** Twelve Data symbols mapped to our indicator IDs */
const SYMBOLS: Record<string, { id: MacroIndicatorId; name: string; unit: string }> = {
  'SPX':     { id: 'SP500',  name: 'S&P 500',        unit: 'points' },
  'NDX':     { id: 'NASDAQ', name: 'NASDAQ 100',      unit: 'points' },
  'VIX':     { id: 'VIX',    name: 'CBOE Volatility', unit: 'index' },
  'XAU/USD': { id: 'GOLD',   name: 'Gold Spot',       unit: 'USD/oz' },
  'DX-Y.NYB':{ id: 'DXY',    name: 'US Dollar Index', unit: 'index' },
};

export const twelveDataAdapter: DataProvider<MacroData> = {
  name: 'twelve-data',
  description: 'Twelve Data — real-time indices, VIX, commodities, DXY',
  priority: 3,
  weight: 0.30,
  rateLimit: RATE_LIMIT,
  capabilities: ['macro-data'],

  async fetch(_params: FetchParams): Promise<MacroData> {
    if (!TD_API_KEY) throw new Error('TWELVE_DATA_API_KEY not configured');

    const symbolList = Object.keys(SYMBOLS).join(',');
    const url = `${TD_BASE}/quote?symbol=${encodeURIComponent(symbolList)}&apikey=${TD_API_KEY}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

    const json = await res.json();

    const indicators: MacroIndicator[] = [];

    // Response is a dict keyed by symbol when batch
    for (const [sym, meta] of Object.entries(SYMBOLS)) {
      const q = json[sym];
      if (!q || q.status === 'error') continue;

      const price = parseFloat(q.close ?? q.price ?? '0');
      const prevClose = parseFloat(q.previous_close ?? '0');
      const change = price - prevClose;
      const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

      indicators.push({
        id: meta.id,
        name: meta.name,
        value: price,
        previousValue: prevClose || null,
        change,
        changePercent,
        unit: meta.unit,
        source: 'twelve-data',
        timestamp: q.datetime ?? new Date().toISOString(),
      });
    }

    if (indicators.length === 0) throw new Error('No Twelve Data returned');

    // VIX-based risk score
    const vix = indicators.find(i => i.id === 'VIX')?.value ?? 20;
    const vixScore = Math.max(0, Math.min(100, 100 - (vix - 10) * 2.5));

    const dxy = indicators.find(i => i.id === 'DXY')?.value ?? 100;
    const dxyScore = Math.max(0, Math.min(100, 50 + (105 - dxy) * 5));

    const spxChange = indicators.find(i => i.id === 'SP500')?.changePercent ?? 0;
    const eqScore = Math.max(0, Math.min(100, 50 + spxChange * 10));

    const riskScore = Math.round(vixScore * 0.4 + dxyScore * 0.3 + eqScore * 0.3);

    return {
      indicators,
      riskAppetite: {
        score: riskScore,
        label: riskScore < 35 ? 'risk-off' : riskScore > 65 ? 'risk-on' : 'neutral',
        components: { vix: vixScore, dxy: dxyScore, yieldSpread: 50, equityMomentum: eqScore },
      },
      source: 'twelve-data',
      timestamp: new Date().toISOString(),
    };
  },

  async healthCheck(): Promise<boolean> {
    if (!TD_API_KEY) return false;
    try {
      const res = await fetch(
        `${TD_BASE}/quote?symbol=SPX&apikey=${TD_API_KEY}`,
        { signal: AbortSignal.timeout(5000) },
      );
      return res.ok;
    } catch { return false; }
  },

  validate(data: MacroData): boolean {
    return Array.isArray(data.indicators) && data.indicators.length > 0;
  },
};
