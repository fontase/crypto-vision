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
 * Hyperliquid Funding Rate Adapter
 *
 * Hyperliquid is the fastest-growing decentralized perp exchange:
 * - 100+ perpetual markets
 * - No API key required
 * - POST-based info API
 * - Sub-second finality on its own L1
 *
 * API: https://api.hyperliquid.xyz/info
 *
 * @module providers/adapters/funding-rate/hyperliquid
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { FundingRate } from './types';

const BASE = 'https://api.hyperliquid.xyz/info';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 120,
  windowMs: 60_000,
};

export const hyperliquidFundingAdapter: DataProvider<FundingRate[]> = {
  name: 'hyperliquid',
  description: 'Hyperliquid — high-performance decentralized perp exchange',
  priority: 5,
  weight: 0.15,
  rateLimit: RATE_LIMIT,
  capabilities: ['funding-rate', 'open-interest'],

  async fetch(params: FetchParams): Promise<FundingRate[]> {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });

    if (!res.ok) throw new Error(`Hyperliquid API error: ${res.status}`);

    const json: [HLMeta, HLAssetCtx[]] = await res.json();
    const [meta, assetCtxs] = json;

    let results: FundingRate[] = [];

    for (let i = 0; i < meta.universe.length && i < assetCtxs.length; i++) {
      const coin = meta.universe[i];
      const ctx = assetCtxs[i];

      results.push({
        symbol: `${coin.name}USD`,
        baseAsset: coin.name,
        exchange: 'hyperliquid',
        fundingRate: parseFloat(ctx.funding) || 0,
        annualizedRate: (parseFloat(ctx.funding) || 0) * 24 * 365,
        nextFundingTime: new Date(Date.now() + 3600_000).toISOString(), // Hourly
        markPrice: parseFloat(ctx.markPx) || 0,
        indexPrice: parseFloat(ctx.oraclePx) || 0,
        openInterestUsd: parseFloat(ctx.openInterest) || 0,
        timestamp: new Date().toISOString(),
      });
    }

    if (params.symbols?.length) {
      const syms = new Set(params.symbols.map((s) => s.toUpperCase()));
      results = results.filter(
        (r) => syms.has(r.baseAsset) || syms.has(r.symbol),
      );
    }

    return results.slice(0, params.limit ?? 100);
  },

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: FundingRate[]): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every((d) => typeof d.fundingRate === 'number');
  },
};

interface HLMeta {
  universe: Array<{ name: string; szDecimals: number }>;
}

interface HLAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  markPx: string;
  midPx: string;
  oraclePx: string;
}
