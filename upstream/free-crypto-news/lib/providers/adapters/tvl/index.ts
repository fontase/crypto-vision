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
 * TVL Chain — Pre-wired provider chain for Total Value Locked data
 *
 * | Provider      | Priority | Weight | Rate Limit     | Coverage          |
 * |---------------|----------|--------|----------------|-------------------|
 * | DefiLlama     | 1        | 0.60   | 300/min (free) | 2,000+ protocols  |
 * | L2Beat        | 2        | 0.20   | 30/min (free)  | L2 rollups        |
 *
 * @module providers/adapters/tvl
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { TVLData } from './defillama.adapter';
import { defillamaTvlAdapter } from './defillama.adapter';
import { l2beatTvlAdapter } from './l2beat.adapter';

export type { TVLData } from './defillama.adapter';

export interface TVLChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createTVLChain(options: TVLChainOptions = {}): ProviderChain<TVLData[]> {
  const {
    strategy = 'fallback',
    cacheTtlSeconds = 60,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = {
    strategy,
    cacheTtlSeconds,
    staleWhileError,
  };

  const chain = new ProviderChain<TVLData[]>('tvl', config);
  chain.addProvider(defillamaTvlAdapter);
  chain.addProvider(l2beatTvlAdapter);
  return chain;
}

export const tvlChain = createTVLChain();
