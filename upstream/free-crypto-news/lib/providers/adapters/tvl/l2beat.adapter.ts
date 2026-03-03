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
 * L2Beat TVL Adapter — Layer 2 Total Value Locked provider
 *
 * L2Beat is the authoritative source for Ethereum Layer 2 TVL data:
 * - Tracks all major L2s (Arbitrum, Optimism, Base, zkSync, etc.)
 * - Free, no API key needed
 * - Canonical bridge + external bridge + native TVL breakdowns
 *
 * Endpoints used:
 * - /tvl — Aggregate L2 TVL data
 *
 * @module providers/adapters/tvl/l2beat
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { TVLData } from './defillama.adapter';

// =============================================================================
// CONSTANTS
// =============================================================================

const L2BEAT_BASE = 'https://l2beat.com/api';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60_000,
};

// =============================================================================
// INTERNAL — Raw API types
// =============================================================================

interface L2BeatProject {
  name: string;
  slug?: string;
  tvl: number;
  tvlChange7d?: number | null;
  tvlChange24h?: number | null;
  tvlChange1h?: number | null;
  canonical?: number;
  external?: number;
  native?: number;
  category?: string;
  symbol?: string;
}

interface L2BeatTvlResponse {
  projects?: Record<string, L2BeatProject>;
  layers2s?: L2BeatProject[];
  result?: L2BeatProject[];
  [key: string]: unknown;
}

// =============================================================================
// NORMALIZATION
// =============================================================================

function normalizeProject(raw: L2BeatProject, key?: string): TVLData {
  const slug = raw.slug ?? key ?? raw.name.toLowerCase().replace(/\s+/g, '-');
  return {
    name: raw.name,
    slug,
    chains: ['Ethereum'],
    category: raw.category ?? 'Layer 2',
    tvl: raw.tvl ?? 0,
    change24h: null,
    change7d: null,
    changePercent1h: raw.tvlChange1h ?? null,
    changePercent24h: raw.tvlChange24h ?? null,
    changePercent7d: raw.tvlChange7d ?? null,
    mcapTvl: null,
    symbol: raw.symbol ?? null,
    logo: null,
    lastUpdated: new Date().toISOString(),
  };
}

// =============================================================================
// ADAPTER
// =============================================================================

export const l2beatTvlAdapter: DataProvider<TVLData[]> = {
  name: 'l2beat-tvl',
  description: 'L2Beat — Layer 2 TVL data for Ethereum rollups and validiums',
  priority: 2,
  weight: 0.2,
  rateLimit: RATE_LIMIT,
  capabilities: ['tvl', 'l2-tvl'],

  async fetch(params: FetchParams): Promise<TVLData[]> {
    const limit = params.limit ?? 100;

    const res = await fetch(`${L2BEAT_BASE}/tvl`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`L2Beat TVL API error: ${res.status}`);

    const body: L2BeatTvlResponse = await res.json();

    let projects: TVLData[] = [];

    // L2Beat API may return projects as a record or an array
    if (body.projects && typeof body.projects === 'object') {
      projects = Object.entries(body.projects).map(([key, project]) =>
        normalizeProject(project, key),
      );
    } else if (Array.isArray(body.layers2s)) {
      projects = body.layers2s.map(p => normalizeProject(p));
    } else if (Array.isArray(body.result)) {
      projects = body.result.map(p => normalizeProject(p));
    }

    // Filter by chain name if requested (useful for specific L2)
    if (params.chain) {
      const target = params.chain.toLowerCase();
      projects = projects.filter(
        p => p.name.toLowerCase() === target || p.slug.toLowerCase() === target,
      );
    }

    // Sort by TVL descending and limit
    projects.sort((a, b) => b.tvl - a.tvl);
    return projects.slice(0, limit);
  },

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${L2BEAT_BASE}/tvl`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: TVLData[]): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(
      item => typeof item.tvl === 'number' && item.tvl >= 0 && typeof item.name === 'string',
    );
  },
};
