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
 * Stablecoin Provider Chains — Centralized chain exports for stablecoin data
 *
 * Chains:
 * - `stablecoinFlowsChain` — Stablecoin flows from DefiLlama, Glassnode, Artemis, Dune
 *
 * @module providers/chains/stablecoins
 */

export {
  stablecoinFlowsChain,
  createStablecoinFlowsChain,
} from '../adapters/stablecoin-flows';

export type { StablecoinFlow, StablecoinMarketStats } from '../adapters/stablecoin-flows';
