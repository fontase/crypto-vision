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
 * Funding Rate Types — Shared types for all funding rate adapters
 *
 * Funding rates are ephemeral data that must be collected in real-time:
 * - Reset every 8 hours on most exchanges
 * - Historical data is only available for limited periods
 * - Cross-exchange comparison reveals arbitrage opportunities
 *
 * @module providers/adapters/funding-rate/types
 */

/** Normalized funding rate data from any exchange */
export interface FundingRate {
  /** Trading pair symbol (e.g., 'BTCUSDT') */
  symbol: string;
  /** Base asset (e.g., 'BTC') */
  baseAsset: string;
  /** Exchange name */
  exchange: string;
  /** Current funding rate as decimal (e.g., 0.0001 = 0.01%) */
  fundingRate: number;
  /** Annualized funding rate (approximate) */
  annualizedRate: number;
  /** Next funding time (ISO 8601) */
  nextFundingTime: string;
  /** Mark price at time of funding */
  markPrice: number;
  /** Index price (spot reference) */
  indexPrice: number;
  /** Open interest in USD */
  openInterestUsd: number;
  /** Timestamp of this data point */
  timestamp: string;
}

/** Historical funding rate entry */
export interface FundingRateHistory {
  symbol: string;
  exchange: string;
  fundingRate: number;
  fundingTime: string;
}
