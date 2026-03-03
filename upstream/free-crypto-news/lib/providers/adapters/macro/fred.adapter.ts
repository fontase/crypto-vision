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
 * FRED Adapter — Federal Reserve Economic Data
 *
 * Free API (500 req/day with key) providing:
 * - Federal Funds Rate (DFF)
 * - 10-Year Treasury Yield (DGS10)
 * - 2-Year Treasury Yield (DGS2)
 * - 30-Year Treasury Yield (DGS30)
 * - Consumer Price Index (CPIAUCSL)
 * - M2 Money Supply (M2SL)
 * - US Dollar Index (DTWEXBGS — broad trade-weighted)
 *
 * @see https://fred.stlouisfed.org/docs/api/fred/
 * @module providers/adapters/macro/fred
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { MacroData, MacroIndicator } from './types';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const FRED_API_KEY = process.env.FRED_API_KEY ?? '';

const RATE_LIMIT: RateLimitConfig = { maxRequests: 120, windowMs: 60_000 };

/** FRED series IDs mapped to our indicator IDs */
const SERIES_MAP: Record<string, { id: string; name: string; unit: string }> = {
  DFF:      { id: 'FED_RATE', name: 'Federal Funds Rate', unit: '%' },
  DGS10:    { id: 'US10Y',   name: '10-Year Treasury Yield', unit: '%' },
  DGS2:     { id: 'US2Y',    name: '2-Year Treasury Yield', unit: '%' },
  DGS30:    { id: 'US30Y',   name: '30-Year Treasury Yield', unit: '%' },
  DTWEXBGS: { id: 'DXY',     name: 'US Dollar Index (Broad)', unit: 'index' },
};

async function fetchSeries(seriesId: string): Promise<{ date: string; value: string }[]> {
  if (!FRED_API_KEY) throw new Error('FRED_API_KEY not configured');

  const url =
    `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}` +
    `&file_type=json&sort_order=desc&limit=5&observation_start=` +
    new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const json = await res.json();
  return (json.observations ?? []).filter(
    (o: { value: string }) => o.value !== '.',
  );
}

export const fredAdapter: DataProvider<MacroData> = {
  name: 'fred',
  description: 'Federal Reserve Economic Data — rates, yields, dollar index',
  priority: 1,
  weight: 0.40,
  rateLimit: RATE_LIMIT,
  capabilities: ['macro-data'],

  async fetch(_params: FetchParams): Promise<MacroData> {
    const seriesIds = Object.keys(SERIES_MAP);
    const results = await Promise.allSettled(seriesIds.map(fetchSeries));

    const indicators: MacroIndicator[] = [];

    for (let i = 0; i < seriesIds.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled' || r.value.length === 0) continue;

      const obs = r.value;
      const current = parseFloat(obs[0].value);
      const previous = obs.length > 1 ? parseFloat(obs[1].value) : null;
      const meta = SERIES_MAP[seriesIds[i]];

      indicators.push({
        id: meta.id as MacroIndicator['id'],
        name: meta.name,
        value: current,
        previousValue: previous,
        change: previous !== null ? current - previous : null,
        changePercent: previous !== null && previous !== 0
          ? ((current - previous) / Math.abs(previous)) * 100
          : null,
        unit: meta.unit,
        source: 'fred',
        timestamp: obs[0].date,
      });
    }

    if (indicators.length === 0) throw new Error('No FRED data returned');

    // Compute simple risk appetite from available data
    const dxy = indicators.find(i => i.id === 'DXY')?.value ?? 100;
    const us10y = indicators.find(i => i.id === 'US10Y')?.value ?? 4;
    const us2y = indicators.find(i => i.id === 'US2Y')?.value ?? 4;
    const yieldSpread = us10y - us2y;

    // DXY rising = risk-off, yield curve inversion = risk-off
    const dxyScore = Math.max(0, Math.min(100, 50 + (105 - dxy) * 5));
    const spreadScore = Math.max(0, Math.min(100, 50 + yieldSpread * 20));

    const riskScore = Math.round((dxyScore + spreadScore) / 2);

    return {
      indicators,
      riskAppetite: {
        score: riskScore,
        label: riskScore < 35 ? 'risk-off' : riskScore > 65 ? 'risk-on' : 'neutral',
        components: { vix: 50, dxy: dxyScore, yieldSpread: spreadScore, equityMomentum: 50 },
      },
      source: 'fred',
      timestamp: new Date().toISOString(),
    };
  },

  async healthCheck(): Promise<boolean> {
    if (!FRED_API_KEY) return false;
    try {
      const res = await fetch(
        `${FRED_BASE}?series_id=DFF&api_key=${FRED_API_KEY}&file_type=json&limit=1`,
        { signal: AbortSignal.timeout(5000) },
      );
      return res.ok;
    } catch { return false; }
  },

  validate(data: MacroData): boolean {
    return Array.isArray(data.indicators) && data.indicators.length > 0;
  },
};
