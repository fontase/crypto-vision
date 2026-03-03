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
 * Macro Provider Chains — Centralized chain exports for macro/tradfi data
 *
 * Chains:
 * - `macroChain` — Macro indicators from FRED, Alpha Vantage, Twelve Data
 *
 * @module providers/chains/macro
 */

export {
  macroChain,
  createMacroChain,
} from '../adapters/macro';

export type { MacroData, MacroIndicator, MacroIndicatorId, CryptoMacroCorrelation } from '../adapters/macro';
