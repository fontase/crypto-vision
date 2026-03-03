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
 * Stablecoin Flows Chain — Provider chain for stablecoin supply data
 *
 * | Provider              | Priority | Weight | Rate Limit    | Coverage        |
 * |-----------------------|----------|--------|---------------|-----------------|
 * | DefiLlama Stablecoins | 1        | 0.60   | 60/min (free) | 100+ stablecoins|
 *
 * Default strategy: `fallback`
 *
 * @module providers/adapters/stablecoin-flows
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { StablecoinFlow } from './types';
import { defillamaStablecoinsAdapter } from './defillama-stablecoins.adapter';
import { glassnodeStablecoinsAdapter } from './glassnode.adapter';
import { artemisStablecoinsAdapter } from './artemis.adapter';
import { duneStablecoinsAdapter } from './dune.adapter';
import { cryptoquantStablesAdapter } from './cryptoquant-stables.adapter';

export type { StablecoinFlow, StablecoinMarketStats } from './types';

export interface StablecoinFlowsChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createStablecoinFlowsChain(
  options: StablecoinFlowsChainOptions = {},
): ProviderChain<StablecoinFlow[]> {
  const {
    strategy = 'broadcast',
    cacheTtlSeconds = 300,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<StablecoinFlow[]>('stablecoin-flows', config);
  chain.addProvider(defillamaStablecoinsAdapter);
  chain.addProvider(glassnodeStablecoinsAdapter);
  chain.addProvider(artemisStablecoinsAdapter);
  chain.addProvider(duneStablecoinsAdapter);
  chain.addProvider(cryptoquantStablesAdapter);
  return chain;
}

/** Default stablecoin flows chain */
export const stablecoinFlowsChain = createStablecoinFlowsChain();
