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
 * Solana Ecosystem Types
 *
 * @module providers/adapters/solana-ecosystem/types
 */

export interface SolanaToken {
  /** Mint address */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Price in USD */
  priceUsd: number;
  /** 24h volume in USD */
  volume24h: number;
  /** Market cap USD */
  marketCap: number;
  /** 24h price change % */
  priceChange24h: number;
  /** Number of holders */
  holders?: number;
  /** Token verification status */
  verified: boolean;
  source: string;
  timestamp: string;
}

export interface SolanaDeFiProtocol {
  name: string;
  slug: string;
  tvl: number;
  tvlChange24h: number;
  volume24h: number;
  category: string;
  chains: string[];
  source: string;
  timestamp: string;
}

export interface SolanaNetworkStats {
  /** Current TPS */
  tps: number;
  /** Slot height */
  slot: number;
  /** Epoch info */
  epoch: number;
  /** Active validators */
  validatorCount: number;
  /** Total staked SOL */
  totalStaked: number;
  /** Average slot time (ms) */
  slotTimeMs: number;
  source: string;
  timestamp: string;
}
