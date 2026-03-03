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
 * L2 Data — Provider chain index
 *
 * @module providers/adapters/l2-data
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { L2Stats } from './types';
import { l2beatAdapter } from './l2beat.adapter';
import { defillamaChainsAdapter } from './defillama-chains.adapter';

export type { L2Stats } from './types';

export interface L2DataChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createL2DataChain(
  options: L2DataChainOptions = {},
): ProviderChain<L2Stats[]> {
  const {
    strategy = 'broadcast',
    cacheTtlSeconds = 300,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<L2Stats[]>('l2-data', config);
  chain.addProvider(l2beatAdapter);
  chain.addProvider(defillamaChainsAdapter);
  return chain;
}

export const l2DataChain = createL2DataChain();
