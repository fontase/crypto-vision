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
 * Santiment On-Chain Adapter
 *
 * Santiment combines on-chain + social data via GraphQL:
 * - Daily active addresses
 * - Exchange inflow/outflow
 * - Development activity (GitHub-based)
 * - Network growth
 *
 * Uses free public endpoint. SANTIMENT_API_KEY unlocks more metrics.
 *
 * @module providers/adapters/on-chain/santiment
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { OnChainMetric } from './types';

const SANTIMENT_API = 'https://api.santiment.net/graphql';
const API_KEY = process.env.SANTIMENT_API_KEY ?? '';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: API_KEY ? 30 : 10,
  windowMs: 60_000,
};

const SLUG_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binance-coin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche',
  DOT: 'polkadot',
  LINK: 'chainlink',
  UNI: 'uniswap',
  AAVE: 'aave',
};

const METRICS = [
  { metric: 'daily_active_addresses', name: 'active_addresses', unit: 'addresses' },
  { metric: 'exchange_inflow', name: 'exchange_inflow', unit: 'coins' },
  { metric: 'exchange_outflow', name: 'exchange_outflow', unit: 'coins' },
  { metric: 'dev_activity', name: 'dev_activity', unit: 'events' },
  { metric: 'network_growth', name: 'network_growth', unit: 'addresses' },
  { metric: 'transaction_volume', name: 'transaction_volume', unit: 'USD' },
];

function buildQuery(slug: string, from: string, to: string): string {
  const metricQueries = METRICS.map(
    (m, i) => `
    m${i}: getMetric(metric: "${m.metric}") {
      timeseriesData(slug: "${slug}", from: "${from}", to: "${to}", interval: "1d") {
        datetime
        value
      }
    }`,
  ).join('\n');

  return JSON.stringify({ query: `{ ${metricQueries} }` });
}

export const santimentOnChainAdapter: DataProvider<OnChainMetric[]> = {
  name: 'santiment-onchain',
  description: 'Santiment — on-chain metrics via GraphQL: active addresses, exchange flows, dev activity',
  priority: 3,
  weight: 0.25,
  rateLimit: RATE_LIMIT,
  capabilities: ['on-chain'],

  async fetch(params: FetchParams): Promise<OnChainMetric[]> {
    const symbol = params.symbols?.[0]?.toUpperCase() || 'BTC';
    const slug = SLUG_MAP[symbol] || symbol.toLowerCase();
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const res = await fetch(SANTIMENT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY && { Authorization: `Apikey ${API_KEY}` }),
      },
      body: buildQuery(slug, from, to),
    });

    if (!res.ok) throw new Error(`Santiment API error: ${res.status}`);

    const json = await res.json();
    const data = json.data || {};
    const results: OnChainMetric[] = [];

    METRICS.forEach((metric, i) => {
      const series = data[`m${i}`]?.timeseriesData ?? [];
      const latest = series[series.length - 1];
      const previous = series.length > 1 ? series[series.length - 2] : null;

      if (latest) {
        const value = latest.value ?? 0;
        const prevValue = previous?.value ?? value;
        const change = prevValue !== 0 ? ((value - prevValue) / prevValue) * 100 : 0;

        results.push({
          metricId: metric.name,
          name: metric.name.replace(/_/g, ' '),
          asset: symbol,
          value,
          unit: metric.unit,
          resolution: '24h',
          change: Math.round(change * 100) / 100,
          source: 'santiment',
          timestamp: latest.datetime,
        });
      }
    });

    return results;
  },

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(SANTIMENT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ currentUser { id } }' }),
        signal: AbortSignal.timeout(5000),
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
