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
 * Reddit Crypto Social Adapter
 *
 * Tracks crypto discussion on major subreddits:
 * - r/CryptoCurrency, r/Bitcoin, r/ethereum, r/solana
 * - Post count, comment activity, upvote ratios
 *
 * Uses Reddit OAuth API for higher rate limits.
 * Needs: REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET
 *
 * @module providers/adapters/social/reddit
 */

import type { DataProvider, FetchParams, RateLimitConfig } from '../../types';
import type { SocialMetric } from './types';

const CLIENT_ID = process.env.REDDIT_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET ?? '';

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: CLIENT_ID ? 30 : 10,
  windowMs: 60_000,
};

const SUBREDDITS: Record<string, string[]> = {
  BTC: ['Bitcoin'],
  ETH: ['ethereum'],
  SOL: ['solana'],
  DOGE: ['dogecoin'],
  ADA: ['cardano'],
  DOT: ['polkadot'],
  LINK: ['Chainlink'],
};

const GENERAL_SUBS = ['CryptoCurrency', 'CryptoMarkets'];

let _accessToken: string | null = null;
let _tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'free-crypto-news/2.0',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);

  const json = await res.json();
  _accessToken = json.access_token;
  _tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return _accessToken!;
}

async function fetchSubreddit(
  token: string,
  subreddit: string,
): Promise<{ posts: number; comments: number; upvoteRatio: number }> {
  const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/hot?limit=25`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'free-crypto-news/2.0',
    },
  });

  if (!res.ok) return { posts: 0, comments: 0, upvoteRatio: 0 };

  const json = await res.json();
  const posts = json.data?.children ?? [];

  let totalComments = 0;
  let totalUpvoteRatio = 0;

  for (const post of posts) {
    totalComments += post.data?.num_comments ?? 0;
    totalUpvoteRatio += post.data?.upvote_ratio ?? 0;
  }

  return {
    posts: posts.length,
    comments: totalComments,
    upvoteRatio: posts.length > 0 ? totalUpvoteRatio / posts.length : 0,
  };
}

export const redditAdapter: DataProvider<SocialMetric[]> = {
  name: 'reddit',
  description: 'Reddit — crypto subreddit activity: posts, comments, sentiment',
  priority: 4,
  weight: 0.15,
  rateLimit: RATE_LIMIT,
  capabilities: ['social-metrics'],

  async fetch(params: FetchParams): Promise<SocialMetric[]> {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET not configured');
    }

    const token = await getAccessToken();
    const symbols = params.symbols ?? ['BTC', 'ETH', 'SOL'];
    const now = new Date().toISOString();

    const results = await Promise.allSettled(
      symbols.map(async (symbol): Promise<SocialMetric> => {
        const subs = [...(SUBREDDITS[symbol.toUpperCase()] ?? []), ...GENERAL_SUBS];
        const subResults = await Promise.all(
          subs.map((sub) => fetchSubreddit(token, sub)),
        );

        let totalPosts = 0;
        let totalComments = 0;
        let avgUpvoteRatio = 0;

        for (const sr of subResults) {
          totalPosts += sr.posts;
          totalComments += sr.comments;
          avgUpvoteRatio += sr.upvoteRatio;
        }
        avgUpvoteRatio /= subResults.length || 1;

        // Derive sentiment from upvote ratio (0.5 = neutral, >0.5 = positive)
        const sentiment = (avgUpvoteRatio - 0.5) * 2; // Map 0-1 to -1 to 1

        return {
          symbol: symbol.toUpperCase(),
          name: symbol,
          socialScore: Math.min(100, Math.round(totalPosts * 2 + totalComments * 0.1)),
          socialVolume: totalPosts + totalComments,
          socialDominance: 0,
          sentiment: Math.round(sentiment * 1000) / 1000,
          reddit: {
            subscribers: 0,
            activeUsers: 0,
            posts24h: totalPosts,
          },
          source: 'reddit',
          timestamp: now,
        };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<SocialMetric> => r.status === 'fulfilled')
      .map((r) => r.value);
  },

  async healthCheck(): Promise<boolean> {
    if (!CLIENT_ID || !CLIENT_SECRET) return false;
    try {
      const token = await getAccessToken();
      const res = await fetch('https://oauth.reddit.com/r/CryptoCurrency/hot?limit=1', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'free-crypto-news/2.0' },
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
