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
 * NFT Market Data Types
 * @module providers/adapters/nft-market/types
 */

export interface NFTCollectionSummary {
  slug: string;
  name: string;
  floorPrice: number;
  floorPriceUsd: number;
  volume24h: number;
  volumeChange24h: number;
  salesCount24h: number;
  numOwners: number;
  totalSupply: number;
  chain: string;
  imageUrl?: string;
}

export interface NFTMarketOverview {
  totalVolume24h: number;
  totalVolumeUsd24h: number;
  totalSales24h: number;
  uniqueBuyers24h: number;
  uniqueSellers24h: number;
  topCollections: NFTCollectionSummary[];
  timestamp: string;
}
