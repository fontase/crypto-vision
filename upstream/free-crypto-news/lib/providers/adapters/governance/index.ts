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
 * Governance — Provider chain index
 *
 * @module providers/adapters/governance
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { GovernanceProposal } from './types';
import { tallyAdapter } from './tally.adapter';
import { snapshotAdapter } from './snapshot.adapter';

export type { GovernanceProposal, GovernanceStats } from './types';

export interface GovernanceChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createGovernanceChain(
  options: GovernanceChainOptions = {},
): ProviderChain<GovernanceProposal[]> {
  const {
    strategy = 'broadcast',
    cacheTtlSeconds = 300,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<GovernanceProposal[]>('governance', config);
  chain.addProvider(tallyAdapter);
  chain.addProvider(snapshotAdapter);
  return chain;
}

export const governanceChain = createGovernanceChain();
