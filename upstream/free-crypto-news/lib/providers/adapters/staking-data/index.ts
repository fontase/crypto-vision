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
 * Staking Data Chain — Pre-wired provider for staking yields
 *
 * | Provider        | Priority | Weight | Rate Limit       | Coverage        |
 * |-----------------|----------|--------|------------------|-----------------|
 * | StakingRewards  | 1        | 0.55   | 20/min (free)    | 200+ PoS chains |
 *
 * Provides comprehensive staking yield data across all major PoS networks.
 * Essential for yield comparison, validator analysis, and staking strategy.
 *
 * @module providers/adapters/staking-data
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { StakingYield } from './types';
import { stakingRewardsAdapter } from './stakingrewards.adapter';

export type { StakingYield } from './types';

export interface StakingDataChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createStakingDataChain(
  options: StakingDataChainOptions = {},
): ProviderChain<StakingYield[]> {
  const {
    strategy = 'fallback',
    cacheTtlSeconds = 600,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<StakingYield[]>('staking-data', config);
  chain.addProvider(stakingRewardsAdapter);

  return chain;
}

/** Default staking data chain */
export const stakingDataChain = createStakingDataChain();
