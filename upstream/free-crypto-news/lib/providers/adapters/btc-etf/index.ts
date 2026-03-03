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
 * BTC ETF — Provider chain index
 *
 * @module providers/adapters/btc-etf
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { BTCETFAggregate } from './types';
import { coinglassETFAdapter } from './coinglass-etf.adapter';
import { sosovalueETFAdapter } from './sosovalue.adapter';

export type { BTCETFFlow, BTCETFAggregate } from './types';

export interface BTCETFChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createBTCETFChain(
  options: BTCETFChainOptions = {},
): ProviderChain<BTCETFAggregate> {
  const {
    strategy = 'fallback',
    cacheTtlSeconds = 600,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<BTCETFAggregate>('btc-etf', config);
  chain.addProvider(coinglassETFAdapter);
  chain.addProvider(sosovalueETFAdapter);
  return chain;
}

export const btcETFChain = createBTCETFChain();
