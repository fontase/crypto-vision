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
 * Blockchain Gaming Data Types
 * @module providers/adapters/gaming-data/types
 */

export interface GameData {
  name: string;
  slug: string;
  chain: string;
  dau: number;              // daily active users
  transactions24h: number;
  volume24h: number;        // USD
  category: string;         // 'game' | 'metaverse' | 'gambling'
  balance: number;          // smart contract balance USD
  timestamp: string;
}

export interface GamingOverview {
  totalDau: number;
  totalVolume24h: number;
  topGames: GameData[];
  byChain: Record<string, number>;
  timestamp: string;
}
