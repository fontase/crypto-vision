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
 * Protocol Revenue Types
 *
 * @module providers/adapters/protocol-revenue/types
 */

export interface ProtocolRevenue {
  /** Protocol name */
  name: string;
  /** Slug for URL construction */
  slug: string;
  /** Daily fees collected in USD */
  dailyFees: number;
  /** Daily revenue (protocol's share of fees) in USD */
  dailyRevenue: number;
  /** Total cumulative fees in USD */
  totalFees: number;
  /** Total cumulative revenue in USD */
  totalRevenue: number;
  /** 7-day aggregate fees */
  weeklyFees: number;
  /** 30-day aggregate fees */
  monthlyFees: number;
  /** Category (DEX, Lending, NFT, etc.) */
  category: string;
  /** chains the protocol operates on */
  chains: string[];
  source: string;
  timestamp: string;
}
