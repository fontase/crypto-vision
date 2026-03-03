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
 * Market Provider Chains — Centralized chain exports for CEX/market data
 *
 * Chains:
 * - `marketPriceChain` — Prices from 10+ exchanges (CoinGecko, Binance, Coinbase, etc.)
 * - `orderBookChain` — Order books from Binance, Coinbase, Kraken, OKX, Bybit
 * - `ohlcvChain` — Candlestick data from Binance, CryptoCompare, CoinGecko
 *
 * @module providers/chains/market
 */

export {
  marketPriceChain,
  marketPriceConsensusChain,
  createMarketPriceChain,
} from '../adapters/market-price';

export {
  orderBookChain,
  orderBookConsensusChain,
  createOrderBookChain,
} from '../adapters/order-book';

export {
  ohlcvChain,
  createOHLCVChain,
} from '../adapters/ohlcv';

export type { MarketPrice } from '../adapters/market-price';
export type { OrderBookData } from '../adapters/order-book';
export type { OHLCVData, OHLCVCandle, CandleInterval } from '../adapters/ohlcv';
