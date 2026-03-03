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
 * Derivatives Chain — Provider chain for derivatives market data
 *
 * | Provider             | Priority | Weight | Rate Limit      | Coverage              |
 * |----------------------|----------|--------|-----------------|-----------------------|
 * | Hyperliquid          | 1        | 0.40   | 120/min (free)  | 100+ perp markets     |
 * | CoinGlass            | 2        | 0.35   | 30/min (key)    | 10+ exchange aggregate|
 * | Binance Liquidations | 1        | 0.45   | 300/min (free)  | $50B+ daily volume    |
 *
 * Default strategy: `fallback` (Hyperliquid → CoinGlass)
 *
 * For aggregated multi-exchange data, use `consensus` strategy.
 *
 * @module providers/adapters/derivatives
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { OpenInterest, LiquidationSummary } from './types';
import { hyperliquidAdapter } from './hyperliquid.adapter';
import { coinglassAdapter } from './coinglass.adapter';
import { binanceLiquidationsAdapter } from './binance-liquidations.adapter';

export type { OpenInterest, LiquidationSummary, Liquidation, ExchangeOI } from './types';

// =============================================================================
// OPEN INTEREST CHAIN
// =============================================================================

export interface DerivativesChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
  includeCoinglass?: boolean;
}

export function createDerivativesChain(
  options: DerivativesChainOptions = {},
): ProviderChain<OpenInterest[]> {
  const {
    strategy = 'fallback',
    cacheTtlSeconds = 30,
    staleWhileError = true,
    includeCoinglass = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<OpenInterest[]>('derivatives', config);

  chain.addProvider(hyperliquidAdapter);

  if (includeCoinglass) {
    chain.addProvider(coinglassAdapter);
  }

  return chain;
}

/** Default derivatives chain (fallback: Hyperliquid → CoinGlass) */
export const derivativesChain = createDerivativesChain();

/** Consensus chain for cross-exchange OI verification */
export const derivativesConsensusChain = createDerivativesChain({
  strategy: 'consensus',
  cacheTtlSeconds: 15,
});

// =============================================================================
// LIQUIDATIONS CHAIN
// =============================================================================

export interface LiquidationsChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createLiquidationsChain(
  options: LiquidationsChainOptions = {},
): ProviderChain<LiquidationSummary[]> {
  const {
    strategy = 'fallback',
    cacheTtlSeconds = 15,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = { strategy, cacheTtlSeconds, staleWhileError };
  const chain = new ProviderChain<LiquidationSummary[]>('liquidations', config);
  chain.addProvider(binanceLiquidationsAdapter);
  return chain;
}

/** Default liquidations chain */
export const liquidationsChain = createLiquidationsChain();
