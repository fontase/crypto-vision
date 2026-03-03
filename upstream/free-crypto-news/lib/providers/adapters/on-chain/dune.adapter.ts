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
 * Dune Analytics On-Chain Adapter
 *
 * Dune provides SQL-based on-chain analytics:
 * - Pre-built queries for common metrics
 * - DEX volume, stablecoin supply, bridge flows
 * - Requires DUNE_API_KEY
 *
 * Note: Dune queries can be slow (30s+). Cache aggressively.
 *
 * @module providers/adapters/on-chain/dune
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { OnChainMetric } from './types';

const BASE = 'https://api.dune.com/api/v1';
const API_KEY = process.env.DUNE_API_KEY ?? '';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: API_KEY ? 10 : 0,
  windowMs: 60_000,
};

// Pre-built Dune query IDs for common metrics
const QUERIES: Record<string, { queryId: number; name: string; unit: string }> = {
  dex_volume: { queryId: 1847605, name: 'dex_volume_24h', unit: 'USD' },
  stablecoin_supply: { queryId: 2420298, name: 'stablecoin_total_supply', unit: 'USD' },
  eth_burned: { queryId: 1908386, name: 'eth_burned_24h', unit: 'ETH' },
  bridge_volume: { queryId: 2661884, name: 'bridge_volume_24h', unit: 'USD' },
  nft_volume: { queryId: 2095042, name: 'nft_volume_24h', unit: 'USD' },
};

export const duneAdapter: DataProvider<OnChainMetric[]> = {
  name: 'dune',
  description: 'Dune Analytics — SQL on-chain queries for DEX volume, stablecoin supply, bridge flows',
  priority: 5,
  weight: 0.20,
  rateLimit: RATE_LIMIT,
  capabilities: ['on-chain'],

  async fetch(params: FetchParams): Promise<OnChainMetric[]> {
    if (!API_KEY) throw new Error('DUNE_API_KEY not configured');

    // Determine which queries to run
    const queryKeys = params.extra?.metrics
      ? (params.extra.metrics as string[]).filter((k) => k in QUERIES)
      : Object.keys(QUERIES);

    const results = await Promise.allSettled(
      queryKeys.map(async (key): Promise<OnChainMetric> => {
        const query = QUERIES[key];

        // Get latest results (don't execute — use cached results)
        const res = await fetch(`${BASE}/query/${query.queryId}/results?limit=1`, {
          headers: { 'x-dune-api-key': API_KEY },
        });

        if (!res.ok) throw new Error(`Dune query ${key}: ${res.status}`);

        const json = await res.json();
        const rows = json.result?.rows ?? [];
        const latest = rows[0] ?? {};

        // Dune returns column names dynamically. Try common patterns.
        const value =
          latest.volume ?? latest.total ?? latest.supply ?? latest.value ?? latest.amount ?? 0;

        return {
          metricId: query.name,
          name: query.name.replace(/_/g, ' '),
          asset: 'multi',
          value: typeof value === 'number' ? value : parseFloat(value) || 0,
          unit: query.unit,
          resolution: '24h',
          change: 0,
          source: 'dune',
          timestamp: json.result?.metadata?.execution_ended_at ?? new Date().toISOString(),
        };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<OnChainMetric> => r.status === 'fulfilled')
      .map((r) => r.value);
  },

  async healthCheck(): Promise<boolean> {
    if (!API_KEY) return false;
    try {
      const res = await fetch(`${BASE}/query/${QUERIES.dex_volume.queryId}/results?limit=1`, {
        headers: { 'x-dune-api-key': API_KEY },
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: OnChainMetric[]): boolean {
    return Array.isArray(data) && data.length > 0;
  },
};
