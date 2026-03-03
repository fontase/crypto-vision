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
 * DEX Chain — Pre-wired provider chain for DEX pair data
 *
 * | Provider        | Priority | Weight | Rate Limit | Coverage           |
 * |-----------------|----------|--------|------------|--------------------|
 * | DexScreener     | 1        | 0.50   | 60/min     | 80+ DEXes, 30+ chains |
 * | GeckoTerminal   | 2        | 0.50   | 30/min     | 100+ networks      |
 *
 * Default strategy: `fallback` (DexScreener → GeckoTerminal)
 *
 * @module providers/adapters/dex
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { DexPair } from './dexscreener.adapter';
import { dexscreenerAdapter } from './dexscreener.adapter';
import { geckoTerminalAdapter } from './geckoterminal.adapter';

export type { DexPair } from './dexscreener.adapter';

export interface DexChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
  includeGeckoTerminal?: boolean;
}

export function createDexChain(options: DexChainOptions = {}): ProviderChain<DexPair[]> {
  const {
    strategy = 'fallback',
    cacheTtlSeconds = 30,
    staleWhileError = true,
    includeGeckoTerminal = true,
  } = options;

  const config: Partial<ProviderChainConfig> = {
    strategy,
    cacheTtlSeconds,
    staleWhileError,
  };

  const chain = new ProviderChain<DexPair[]>('dex-pairs', config);
  chain.addProvider(dexscreenerAdapter);

  if (includeGeckoTerminal) {
    chain.addProvider(geckoTerminalAdapter);
  }

  return chain;
}

export const dexChain = createDexChain();
