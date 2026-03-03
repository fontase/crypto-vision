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
 * Social Provider Chains — Centralized chain exports for social/sentiment data
 *
 * Chains:
 * - `socialChain` — Social metrics from LunarCrush, Santiment, CryptoPanic, Farcaster
 * - `fearGreedChain` — Fear & Greed Index from Alternative.me, CoinStats, Composite
 *
 * @module providers/chains/social
 */

export {
  socialChain,
  socialConsensusChain,
  createSocialChain,
} from '../adapters/social';

export {
  fearGreedChain,
  fearGreedConsensusChain,
  createFearGreedChain,
} from '../adapters/fear-greed';

export type { SocialMetric } from '../adapters/social';
export type { FearGreedIndex } from '../adapters/fear-greed';
