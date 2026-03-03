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
 * CryptoPanic Adapter — News & Social Sentiment Aggregator
 *
 * CryptoPanic aggregates crypto news from 100+ sources and provides:
 * - Bullish/bearish vote sentiment from community
 * - Social media activity signals
 * - Trending topics and coins
 * - News impact scoring
 *
 * Free tier: 60 requests/minute (no key needed for basic).
 * Pro tier: Set CRYPTOPANIC_API_KEY for higher limits.
 *
 * API: https://cryptopanic.com/developers/api/
 * env: CRYPTOPANIC_API_KEY (optional)
 *
 * @module providers/adapters/social/cryptopanic
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { SocialMetric } from './types';

const BASE = 'https://cryptopanic.com/api/free/v1';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY ?? '';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: CRYPTOPANIC_API_KEY ? 120 : 60,
  windowMs: 60_000,
};

export const cryptoPanicAdapter: DataProvider<SocialMetric[]> = {
  name: 'cryptopanic',
  description: 'CryptoPanic — News sentiment aggregator with community voting from 100+ sources',
  priority: 3,
  weight: 0.30,
  rateLimit: RATE_LIMIT,
  capabilities: ['social-metrics'],

  async fetch(params: FetchParams): Promise<SocialMetric[]> {
    const limit = Math.min(params.limit ?? 50, 200);

    // Build URL with optional auth token
    let url = `${BASE}/posts/?filter=trending&public=true&metadata=true`;
    if (CRYPTOPANIC_API_KEY) {
      url = `https://cryptopanic.com/api/v1/posts/?auth_token=${CRYPTOPANIC_API_KEY}&filter=trending&public=true&metadata=true`;
    }

    // Filter by currencies if specified
    if (params.symbols && params.symbols.length > 0) {
      url += `&currencies=${params.symbols.join(',')}`;
    }

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429) {
      throw new Error('CryptoPanic rate limit exceeded (429)');
    }

    if (!response.ok) {
      throw new Error(`CryptoPanic API error: ${response.status}`);
    }

    const json = await response.json();
    const posts: CPPost[] = json?.results ?? [];
    const now = new Date().toISOString();

    // Aggregate sentiment by currency
    const currencyMap = new Map<string, {
      symbol: string;
      name: string;
      bullish: number;
      bearish: number;
      total: number;
      mentions: number;
    }>();

    for (const post of posts.slice(0, limit)) {
      const currencies: CPCurrency[] = post.currencies ?? [];
      const votes = post.votes ?? {};

      for (const currency of currencies) {
        const existing = currencyMap.get(currency.code) ?? {
          symbol: currency.code,
          name: currency.title,
          bullish: 0,
          bearish: 0,
          total: 0,
          mentions: 0,
        };

        existing.bullish += votes.positive ?? 0;
        existing.bearish += votes.negative ?? 0;
        existing.total += (votes.positive ?? 0) + (votes.negative ?? 0) + (votes.important ?? 0);
        existing.mentions += 1;

        currencyMap.set(currency.code, existing);
      }
    }

    // Calculate total mentions across all currencies for dominance metric
    const totalMentions = Array.from(currencyMap.values()).reduce((s, c) => s + c.mentions, 0);

    // Convert to SocialMetric format
    const results: SocialMetric[] = Array.from(currencyMap.values())
      .map((c): SocialMetric => {
        const sentimentTotal = c.bullish + c.bearish;
        const sentiment = sentimentTotal > 0
          ? (c.bullish - c.bearish) / sentimentTotal
          : 0;

        return {
          symbol: c.symbol,
          name: c.name,
          socialScore: Math.min(100, Math.round(c.mentions * 10 + c.total)),
          socialVolume: c.mentions,
          socialDominance: totalMentions > 0
            ? Math.round((c.mentions / totalMentions) * 10000) / 100
            : 0,
          sentiment: Math.round(sentiment * 1000) / 1000,
          twitterMentions: c.mentions, // Approximation from news mentions
          source: 'cryptopanic',
          timestamp: now,
        };
      })
      .sort((a, b) => b.socialScore - a.socialScore);

    return results;
  },

  async healthCheck(): Promise<boolean> {
    try {
      let url = `${BASE}/posts/?filter=trending&public=true`;
      if (CRYPTOPANIC_API_KEY) {
        url = `https://cryptopanic.com/api/v1/posts/?auth_token=${CRYPTOPANIC_API_KEY}&filter=trending&public=true`;
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: SocialMetric[]): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(m =>
      typeof m.symbol === 'string' &&
      typeof m.socialScore === 'number',
    );
  },
};

// =============================================================================
// INTERNAL
// =============================================================================

interface CPPost {
  title: string;
  published_at: string;
  currencies: CPCurrency[] | null;
  votes: {
    negative: number;
    positive: number;
    important: number;
    liked: number;
    disliked: number;
    lol: number;
    toxic: number;
    saved: number;
    comments: number;
  };
}

interface CPCurrency {
  code: string;
  title: string;
  slug: string;
}
