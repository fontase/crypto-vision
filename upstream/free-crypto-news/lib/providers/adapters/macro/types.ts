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
 * Macro Data Types — Shared types for macro/tradfi adapters
 *
 * @module providers/adapters/macro/types
 */

/** Macro indicator identifiers */
export type MacroIndicatorId =
  | 'DXY' | 'VIX' | 'SP500' | 'NASDAQ' | 'GOLD' | 'OIL'
  | 'US10Y' | 'US2Y' | 'US30Y' | 'FED_RATE' | 'CPI' | 'M2';

/** A single macro data point */
export interface MacroIndicator {
  id: MacroIndicatorId;
  name: string;
  value: number;
  previousValue: number | null;
  change: number | null;
  changePercent: number | null;
  unit: string;
  source: string;
  timestamp: string;
}

/** Full macro data payload returned by the chain */
export interface MacroData {
  indicators: MacroIndicator[];
  riskAppetite: {
    score: number;        // 0–100 (0 = extreme risk-off, 100 = extreme risk-on)
    label: 'risk-off' | 'neutral' | 'risk-on';
    components: {
      vix: number;
      dxy: number;
      yieldSpread: number;
      equityMomentum: number;
    };
  };
  source: string;
  timestamp: string;
}

/** BTC ↔ macro correlation data */
export interface CryptoMacroCorrelation {
  pair: string;            // e.g. "BTC-SP500"
  correlation30d: number;  // Pearson -1..1
  correlation90d: number;
  pValue30d: number;
  pValue90d: number;
  updatedAt: string;
}
