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
 * Prediction Markets Types
 *
 * @module providers/adapters/prediction-markets/types
 */

export interface PredictionMarket {
  id: string;
  title: string;
  /** URL to the market */
  url: string;
  /** Probability of resolution (0-1) */
  probability: number;
  /** Total volume in USD */
  volumeUsd: number;
  /** Current liquidity in USD */
  liquidityUsd: number;
  /** Number of unique traders */
  numTraders: number;
  /** Market category (crypto, politics, sports, etc.) */
  category: string;
  /** End date for this market */
  endDate: string;
  /** Resolution status */
  status: 'open' | 'resolved' | 'closed';
  /** Resolution value if resolved */
  resolution?: 'YES' | 'NO' | 'INVALID';
  source: string;
  timestamp: string;
}
