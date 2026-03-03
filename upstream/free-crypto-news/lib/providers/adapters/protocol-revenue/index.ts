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
 * Protocol Revenue — Provider chain index
 *
 * @module providers/adapters/protocol-revenue
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { ProtocolRevenue } from './types';
import { defillamaFeesAdapter } from './defillama-fees.adapter';

export type { ProtocolRevenue } from './types';

export interface ProtocolRevenueChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createProtocolRevenueChain(
  options: ProtocolRevenueChainOptions = {},
): ProviderChain<ProtocolRevenue[]> {
  const {
    strategy = 'fallback',
    cacheTtlSeconds = 600,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<ProtocolRevenue[]>('protocol-revenue', config);
  chain.addProvider(defillamaFeesAdapter);
  return chain;
}

export const protocolRevenueChain = createProtocolRevenueChain();
