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
 * OHLCV Types — Candlestick/historical price data
 *
 * @module providers/adapters/ohlcv/types
 */

/** A single OHLCV candlestick data point */
export interface OHLCVCandle {
  /** Unix timestamp (ms) of the candle open */
  timestamp: number;
  /** Opening price */
  open: number;
  /** Highest price in the period */
  high: number;
  /** Lowest price in the period */
  low: number;
  /** Closing price */
  close: number;
  /** Volume traded in the period */
  volume: number;
  /** Quote volume (volume × price) if available */
  quoteVolume?: number;
}

/** OHLCV response with metadata */
export interface OHLCVData {
  /** Trading pair symbol (e.g., 'BTC/USD') */
  symbol: string;
  /** Candle interval (e.g., '1h', '1d') */
  interval: string;
  /** Data source */
  exchange: string;
  /** Candlestick data */
  candles: OHLCVCandle[];
  /** Last updated ISO string */
  lastUpdated: string;
}

/** Supported candle intervals */
export type CandleInterval =
  | '1m' | '5m' | '15m' | '30m'
  | '1h' | '4h' | '6h' | '12h'
  | '1d' | '1w' | '1M';
