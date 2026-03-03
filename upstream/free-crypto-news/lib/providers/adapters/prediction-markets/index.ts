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
 * Prediction Markets — Provider chain index
 *
 * @module providers/adapters/prediction-markets
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { PredictionMarket } from './types';
import { polymarketAdapter } from './polymarket.adapter';
import { metaculusAdapter } from './metaculus.adapter';

export type { PredictionMarket } from './types';

export interface PredictionMarketsChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createPredictionMarketsChain(
  options: PredictionMarketsChainOptions = {},
): ProviderChain<PredictionMarket[]> {
  const {
    strategy = 'broadcast',
    cacheTtlSeconds = 120,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<PredictionMarket[]>('prediction-markets', config);
  chain.addProvider(polymarketAdapter);
  chain.addProvider(metaculusAdapter);
  return chain;
}

export const predictionMarketsChain = createPredictionMarketsChain();
