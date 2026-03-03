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
 * Staking Data Types — Shared types for staking yield/reward data
 *
 * @module providers/adapters/staking-data/types
 */

/** Staking yield data for a specific asset */
export interface StakingYield {
  /** Asset name */
  name: string;
  /** Asset symbol */
  symbol: string;
  /** Annual staking reward rate (%) */
  rewardRate: number;
  /** Adjusted reward rate accounting for inflation (%) */
  adjustedRewardRate: number;
  /** Staking ratio (% of supply staked) */
  stakingRatio: number;
  /** Total value staked (USD) */
  stakedValueUsd: number;
  /** Market cap (USD) */
  marketCap: number;
  /** Token price (USD) */
  price: number;
  /** Inflation rate (%) */
  inflationRate: number;
  /** Lock-up period in days (0 = liquid) */
  lockupDays: number;
  /** Minimum staking amount */
  minStake: number;
  /** Number of validators */
  validatorCount: number;
  /** Staking type (PoS, DPoS, liquid staking, etc.) */
  stakingType: string;
  /** Chain name */
  chain: string;
  /** Data source */
  source: string;
  /** Data timestamp */
  timestamp: string;
}
