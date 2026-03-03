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
 * Liquidation Data Types — Shared types for derivatives liquidation data
 *
 * @module providers/adapters/liquidations/types
 */

/** Aggregated liquidation data for a trading pair */
export interface LiquidationData {
  /** Trading pair symbol (e.g., 'BTC', 'ETH') */
  symbol: string;
  /** Total long liquidations in the period (USD) */
  longLiquidationsUsd: number;
  /** Total short liquidations in the period (USD) */
  shortLiquidationsUsd: number;
  /** Total liquidations (long + short, USD) */
  totalLiquidationsUsd: number;
  /** Number of long liquidation events */
  longLiquidationCount: number;
  /** Number of short liquidation events */
  shortLiquidationCount: number;
  /** Largest single liquidation in USD */
  largestLiquidationUsd: number;
  /** Exchange with most liquidations */
  topExchange: string;
  /** Time period: '1h' | '4h' | '12h' | '24h' */
  period: string;
  /** Current price of the asset */
  price: number;
  /** 24h price change (%) */
  priceChange24h: number;
  /** Data source */
  source: string;
  /** Data timestamp */
  timestamp: string;
}
