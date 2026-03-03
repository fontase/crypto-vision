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
 * PlayToEarn Adapter — Community-driven blockchain gaming data
 *
 * PlayToEarn.online provides free gaming metrics:
 * - Curated list of play-to-earn and blockchain games
 * - User activity and ranking data
 * - No API key required
 * - Rate limit: 60 requests/minute
 *
 * @module providers/adapters/gaming-data/playtoearn
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { GamingOverview, GameData } from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

const PLAYTOEARN_BASE = 'https://api.playtoearn.online/v1';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 60,
  windowMs: 60_000,
};

// =============================================================================
// ADAPTER
// =============================================================================

/**
 * PlayToEarn gaming data provider.
 *
 * Priority: 2 (secondary — community-driven, free, no API key)
 * Weight: 0.4 (good supplementary data source)
 */
export const playtoearnAdapter: DataProvider<GamingOverview> = {
  name: 'playtoearn',
  description: 'PlayToEarn API — free community-driven blockchain gaming data',
  priority: 2,
  weight: 0.4,
  rateLimit: RATE_LIMIT,
  capabilities: ['gaming-data'],

  async fetch(params: FetchParams): Promise<GamingOverview> {
    const limit = params.limit ?? 25;

    const response = await fetch(
      `${PLAYTOEARN_BASE}/games/top?sort=users_24h&limit=${limit}`,
      {
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`PlayToEarn API error: ${response.status} ${response.statusText}`);
    }

    const data: PlayToEarnResponse = await response.json();
    const games = (data.games ?? data.data ?? []).map(normalizeGame);

    const totalDau = games.reduce((sum, g) => sum + g.dau, 0);
    const totalVolume24h = games.reduce((sum, g) => sum + g.volume24h, 0);

    // Aggregate volume by chain
    const byChain: Record<string, number> = {};
    for (const game of games) {
      byChain[game.chain] = (byChain[game.chain] ?? 0) + game.volume24h;
    }

    return {
      totalDau,
      totalVolume24h,
      topGames: games,
      byChain,
      timestamp: new Date().toISOString(),
    };
  },

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${PLAYTOEARN_BASE}/games/top?limit=1`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  validate(data: GamingOverview): boolean {
    if (!data || !Array.isArray(data.topGames)) return false;
    if (data.topGames.length === 0) return false;
    return data.topGames.every(
      (g) => typeof g.name === 'string' && g.name.length > 0,
    );
  },
};

// =============================================================================
// INTERNAL — Raw types and normalization
// =============================================================================

interface PlayToEarnGame {
  id?: number;
  name?: string;
  slug?: string;
  image?: string;
  blockchain?: string;
  genre?: string;
  category?: string;
  users_24h?: number;
  transactions_24h?: number;
  volume_24h?: number;
  balance?: number;
  status?: string;
}

interface PlayToEarnResponse {
  games?: PlayToEarnGame[];
  data?: PlayToEarnGame[];
  total?: number;
  page?: number;
}

function normalizeGame(raw: PlayToEarnGame): GameData {
  return {
    name: raw.name ?? '',
    slug: raw.slug ?? String(raw.id ?? ''),
    chain: raw.blockchain ?? 'unknown',
    dau: raw.users_24h ?? 0,
    transactions24h: raw.transactions_24h ?? 0,
    volume24h: raw.volume_24h ?? 0,
    category: raw.category ?? raw.genre ?? 'game',
    balance: raw.balance ?? 0,
    timestamp: new Date().toISOString(),
  };
}
