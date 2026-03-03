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
 * DePIN Data Types — Shared types for Decentralized Physical Infrastructure data
 *
 * @module providers/adapters/depin-data/types
 */

/** A DePIN (Decentralized Physical Infrastructure) project with metrics */
export interface DePINProject {
  /** Project name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Project slug/ID */
  slug: string;
  /** DePIN sub-category */
  category:
    | "wireless"
    | "compute"
    | "storage"
    | "sensor"
    | "energy"
    | "mapping"
    | "cdn"
    | "other";
  /** Market cap (USD) */
  marketCap: number;
  /** Fully diluted valuation (USD) */
  fdv: number;
  /** Token price (USD) */
  price: number;
  /** 24h price change (%) */
  priceChange24h: number;
  /** Number of active devices / nodes */
  activeDevices: number;
  /** 30-day device growth (%) */
  deviceGrowth30d: number;
  /** Monthly protocol revenue (USD) */
  monthlyRevenue: number;
  /** Total revenue earned (USD) */
  totalRevenue: number;
  /** Chain(s) deployed on */
  chains: string[];
  /** Project website */
  website?: string;
  /** Data source */
  source: string;
  /** Data timestamp */
  timestamp: string;
}
