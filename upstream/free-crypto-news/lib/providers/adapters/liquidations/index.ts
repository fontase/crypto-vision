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
 * Liquidations Chain — Pre-wired provider for derivatives liquidation data
 *
 * | Provider              | Priority | Weight | Rate Limit     | Coverage              |
 * |-----------------------|----------|--------|----------------|-----------------------|
 * | CoinGlass Liquidations| 1        | 0.60   | 30/min (key)   | All major exchanges   |
 *
 * Liquidation data tracks forced closures of leveraged positions.
 * Essential for detecting market structure shifts and cascade events.
 *
 * @module providers/adapters/liquidations
 */

import type { ProviderChainConfig, ResolutionStrategy } from "../../types";
import { ProviderChain } from "../../provider-chain";
import type { LiquidationData } from "./types";
import { coinglassLiquidationsAdapter } from "./coinglass-liquidations.adapter";

export type { LiquidationData } from "./types";

export interface LiquidationsChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createLiquidationsChain(
  options: LiquidationsChainOptions = {},
): ProviderChain<LiquidationData[]> {
  const {
    strategy = "fallback",
    cacheTtlSeconds = 30,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = {
    strategy,
    cacheTtlSeconds,
    staleWhileError,
  };
  const chain = new ProviderChain<LiquidationData[]>("liquidations", config);
  chain.addProvider(coinglassLiquidationsAdapter);

  return chain;
}

/** Default liquidations chain */
export const liquidationsChain = createLiquidationsChain();
