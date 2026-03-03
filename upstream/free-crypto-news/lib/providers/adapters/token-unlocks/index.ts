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
 * Token Unlocks Chain — Pre-wired provider chain for token vesting data
 *
 * | Provider             | Priority | Weight | Rate Limit    | Coverage            |
 * |----------------------|----------|--------|---------------|---------------------|
 * | DefiLlama Unlocks    | 1        | 0.60   | 30/min (free) | 100+ protocols      |
 *
 * Default strategy: `fallback`
 *
 * Token unlock data is critical for:
 * - Predicting sell pressure events
 * - Risk assessment for token holders
 * - Macro analysis of supply-side dynamics
 *
 * @module providers/adapters/token-unlocks
 */

import type { ProviderChainConfig, ResolutionStrategy } from "../../types";
import { ProviderChain } from "../../provider-chain";
import type { TokenUnlockEvent } from "./types";
import { defillamaUnlocksAdapter } from "./defillama-unlocks.adapter";

export type { TokenUnlockEvent } from "./types";

export interface TokenUnlocksChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createTokenUnlocksChain(
  options: TokenUnlocksChainOptions = {},
): ProviderChain<TokenUnlockEvent[]> {
  const {
    strategy = "fallback",
    cacheTtlSeconds = 300,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = {
    strategy,
    cacheTtlSeconds,
    staleWhileError,
  };
  const chain = new ProviderChain<TokenUnlockEvent[]>("token-unlocks", config);
  chain.addProvider(defillamaUnlocksAdapter);

  return chain;
}

/** Default token unlocks chain */
export const tokenUnlocksChain = createTokenUnlocksChain();
