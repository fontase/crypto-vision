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
 * Order Book Types — Shared types for order book adapters
 *
 * @module providers/adapters/order-book/types
 */

/** A single order (bid or ask) */
export interface OrderBookLevel {
  /** Price level */
  price: number;
  /** Quantity at this price */
  quantity: number;
}

/** Full order book snapshot */
export interface OrderBookData {
  /** Trading pair symbol */
  symbol: string;
  /** Exchange name */
  exchange: string;
  /** Bid (buy) orders, sorted by price descending */
  bids: OrderBookLevel[];
  /** Ask (sell) orders, sorted by price ascending */
  asks: OrderBookLevel[];
  /** Mid-market price */
  midPrice: number;
  /** Spread (best ask - best bid) */
  spread: number;
  /** Spread percentage */
  spreadPercent: number;
  /** Depth: total bid value within 2% of mid */
  bidDepth2Pct: number;
  /** Depth: total ask value within 2% of mid */
  askDepth2Pct: number;
  /** Bid/ask imbalance ratio (> 1 = more bids) */
  imbalanceRatio: number;
  /** Timestamp of the snapshot */
  timestamp: number;
  /** Last updated ISO string */
  lastUpdated: string;
}
