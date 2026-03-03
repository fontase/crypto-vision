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
 * dYdX Funding Rate Adapter
 *
 * dYdX v3 is a leading decentralized perpetual exchange:
 * - 30+ perpetual markets
 * - No API key required
 * - Funding every 1 hour (unlike 8h on CEXes)
 *
 * API: https://api.dydx.exchange/v3/markets
 *
 * @module providers/adapters/funding-rate/dydx
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { FundingRate } from './types';

const BASE = 'https://api.dydx.exchange/v3';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 10_000,
};

export const dydxFundingAdapter: DataProvider<FundingRate[]> = {
  name: 'dydx',
  description: 'dYdX v3 — decentralized perpetual exchange, hourly funding',
  priority: 4,
  weight: 0.15,
  rateLimit: RATE_LIMIT,
  capabilities: ['funding-rate'],

  async fetch(params: FetchParams): Promise<FundingRate[]> {
    const res = await fetch(`${BASE}/markets`);
    if (!res.ok) throw new Error(`dYdX API error: ${res.status}`);

    const json = await res.json();
    const markets: Record<string, DydxMarket> = json.markets ?? {};

    let entries = Object.values(markets).filter(
      (m) => m.type === 'PERPETUAL' && m.status === 'ONLINE',
    );

    if (params.symbols?.length) {
      const syms = new Set(params.symbols.map((s) => s.toUpperCase()));
      entries = entries.filter((m) => {
        const base = m.market.replace(/-USD$/, '');
        return syms.has(base) || syms.has(m.market);
      });
    }

    const limit = params.limit ?? 100;
    return entries.slice(0, limit).map(normalize);
  },

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/markets`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: FundingRate[]): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every((d) => typeof d.fundingRate === 'number' && typeof d.symbol === 'string');
  },
};

interface DydxMarket {
  market: string;
  type: string;
  status: string;
  indexPrice: string;
  oraclePrice: string;
  nextFundingRate: string;
  nextFundingAt: string;
  openInterest: string;
}

function normalize(raw: DydxMarket): FundingRate {
  const rate = parseFloat(raw.nextFundingRate) || 0;
  const baseAsset = raw.market.replace(/-USD$/, '');

  return {
    symbol: `${baseAsset}USD`,
    baseAsset,
    exchange: 'dydx',
    fundingRate: rate,
    annualizedRate: rate * 24 * 365, // Hourly funding
    nextFundingTime: raw.nextFundingAt,
    markPrice: parseFloat(raw.oraclePrice) || 0,
    indexPrice: parseFloat(raw.indexPrice) || 0,
    openInterestUsd: parseFloat(raw.openInterest) || 0,
    timestamp: new Date().toISOString(),
  };
}
