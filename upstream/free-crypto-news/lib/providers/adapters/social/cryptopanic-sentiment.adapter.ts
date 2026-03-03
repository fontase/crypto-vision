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
 * CryptoPanic Sentiment Adapter
 *
 * Derives social sentiment from CryptoPanic's news aggregator:
 * - Community votes (bullish/bearish)
 * - Hot/rising post detection
 * - Multi-source news coverage as proxy for social volume
 *
 * Requires CRYPTOPANIC_API_KEY.
 *
 * @module providers/adapters/social/cryptopanic-sentiment
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { SocialMetric } from './types';

const BASE = 'https://cryptopanic.com/api/v1';
const API_KEY = process.env.CRYPTOPANIC_API_KEY ?? '';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: API_KEY ? 30 : 0,
  windowMs: 60_000,
};

export const cryptopanicSentimentAdapter: DataProvider<SocialMetric[]> = {
  name: 'cryptopanic-sentiment',
  description: 'CryptoPanic — sentiment derived from community votes on crypto news',
  priority: 3,
  weight: 0.15,
  rateLimit: RATE_LIMIT,
  capabilities: ['social-metrics'],

  async fetch(params: FetchParams): Promise<SocialMetric[]> {
    if (!API_KEY) throw new Error('CRYPTOPANIC_API_KEY not configured');

    const currencies = params.symbols?.join(',') || 'BTC,ETH,SOL';
    const res = await fetch(
      `${BASE}/posts/?auth_token=${API_KEY}&currencies=${currencies}&filter=hot&kind=news`,
    );

    if (!res.ok) throw new Error(`CryptoPanic API error: ${res.status}`);

    const json = await res.json();
    const posts: CPPost[] = json.results ?? [];

    // Aggregate votes by currency
    const currencyMap = new Map<string, { bullish: number; bearish: number; count: number }>();

    for (const post of posts) {
      const votes = post.votes ?? {};
      for (const curr of post.currencies ?? []) {
        const symbol = curr.code?.toUpperCase();
        if (!symbol) continue;

        const existing = currencyMap.get(symbol) ?? { bullish: 0, bearish: 0, count: 0 };
        existing.bullish += votes.positive ?? 0;
        existing.bearish += votes.negative ?? 0;
        existing.count++;
        currencyMap.set(symbol, existing);
      }
    }

    const now = new Date().toISOString();
    return [...currencyMap.entries()].map(([symbol, data]): SocialMetric => {
      const total = data.bullish + data.bearish;
      const sentiment = total > 0 ? (data.bullish - data.bearish) / total : 0;

      return {
        symbol,
        name: symbol,
        socialScore: Math.min(100, data.count * 5),
        socialVolume: data.count,
        socialDominance: 0,
        sentiment: Math.round(sentiment * 1000) / 1000,
        source: 'cryptopanic',
        timestamp: now,
      };
    });
  },

  async healthCheck(): Promise<boolean> {
    if (!API_KEY) return false;
    try {
      const res = await fetch(`${BASE}/posts/?auth_token=${API_KEY}&filter=hot&limit=1`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: SocialMetric[]): boolean {
    return Array.isArray(data) && data.length > 0;
  },
};

interface CPPost {
  currencies?: Array<{ code: string }>;
  votes?: { positive?: number; negative?: number; important?: number; liked?: number };
}
