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
 * OHLCV Chain — Pre-wired provider chain for candlestick data
 *
 * | Provider       | Priority | Weight | Rate Limit      | Coverage       |
 * |----------------|----------|--------|-----------------|----------------|
 * | Binance        | 1        | 0.50   | 1200/min (free) | 600+ pairs     |
 * | CryptoCompare  | 2        | 0.40   | 50-100/min      | 7,000+ coins   |
 *
 * @module providers/adapters/ohlcv
 */

import type { ProviderChainConfig, ResolutionStrategy } from '../../types';
import { ProviderChain } from '../../provider-chain';
import type { OHLCVData } from './types';
import { binanceOhlcvAdapter } from './binance-ohlcv.adapter';
import { cryptocompareOhlcvAdapter } from './cryptocompare-ohlcv.adapter';
import { coingeckoOhlcvAdapter } from './coingecko-ohlcv.adapter';

export type { OHLCVData, OHLCVCandle, CandleInterval } from './types';

export interface OHLCVChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createOHLCVChain(options: OHLCVChainOptions = {}): ProviderChain<OHLCVData[]> {
  const {
    strategy = 'fallback',
    cacheTtlSeconds = 60,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = {
    strategy,
    cacheTtlSeconds,
    staleWhileError,
  };

  const chain = new ProviderChain<OHLCVData[]>('ohlcv', config);
  chain.addProvider(binanceOhlcvAdapter);
  chain.addProvider(cryptocompareOhlcvAdapter);
  chain.addProvider(coingeckoOhlcvAdapter);
  return chain;
}

export const ohlcvChain = createOHLCVChain();
