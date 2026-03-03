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
 * Pearson Correlation Engine
 *
 * Computes rolling BTC ↔ macro correlations (S&P500, NASDAQ, Gold, DXY, VIX).
 * Used by /api/macro/correlations.
 *
 * Statistical approach:
 *  - 30d and 90d rolling windows over daily close prices
 *  - Pearson r ∈ [-1, 1]
 *  - p-value from t-distribution approximation
 *
 * @module lib/macro/correlation
 */

import type { CryptoMacroCorrelation } from '../providers/adapters/macro/types';

// ─── Pearson Correlation ────────────────────────────────────────────────────

/**
 * Compute Pearson correlation coefficient between two arrays of equal length.
 * Returns NaN if input is invalid.
 */
export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Approximate two-tailed p-value for a Pearson correlation using
 * the t-statistic: t = r * sqrt(n-2) / sqrt(1-r²)
 */
export function pearsonPValue(r: number, n: number): number {
  if (n < 3 || isNaN(r)) return 1;
  const absR = Math.abs(r);
  if (absR >= 1) return 0;

  const t = absR * Math.sqrt((n - 2) / (1 - absR * absR));
  const df = n - 2;

  // Approximate p-value using the regularized incomplete beta function shortcut
  // For large df this is reasonably accurate
  const x = df / (df + t * t);
  // Use a simple series expansion for the beta CDF
  return betaIncomplete(df / 2, 0.5, x);
}

/**
 * Simple regularized incomplete beta function via continued fraction.
 * Good enough for p-value approximation.
 */
function betaIncomplete(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use 30 iterations of the continued fraction
  const MAX_ITER = 30;
  let f = 1, c = 1, d = 1;

  for (let i = 1; i <= MAX_ITER; i++) {
    const m = i;
    let num: number;

    // Even step
    num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= d * c;

    // Odd step
    num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= d * c;
  }

  // x^a * (1-x)^b / (a * Beta(a,b)) * f
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const prefix = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;

  return Math.min(1, prefix * f);
}

/** Stirling approximation of ln(Gamma(x)) */
function lnGamma(x: number): number {
  // Lanczos approximation
  const g = 7;
  const coefs = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }

  x -= 1;
  let a = coefs[0];
  const t = x + g + 0.5;
  for (let i = 1; i < coefs.length; i++) {
    a += coefs[i] / (x + i);
  }

  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ─── Rolling Correlation Computation ────────────────────────────────────────

export interface TimeSeries {
  dates: string[];
  values: number[];
}

/**
 * Compute BTC ↔ macro correlations for a set of pairs.
 *
 * @param btcPrices - Daily BTC closing prices { dates, values }
 * @param macroPrices - Map of indicator → { dates, values }
 * @returns CryptoMacroCorrelation[] for 30d and 90d windows
 */
export function computeCorrelations(
  btcPrices: TimeSeries,
  macroPrices: Record<string, TimeSeries>,
): CryptoMacroCorrelation[] {
  const results: CryptoMacroCorrelation[] = [];
  const now = new Date().toISOString();

  for (const [indicatorId, macro] of Object.entries(macroPrices)) {
    // Align by date
    const dateSet = new Set(macro.dates);
    const aligned = { btc: [] as number[], macro: [] as number[] };

    for (let i = 0; i < btcPrices.dates.length; i++) {
      const d = btcPrices.dates[i];
      const idx = macro.dates.indexOf(d);
      if (idx !== -1 && dateSet.has(d)) {
        aligned.btc.push(btcPrices.values[i]);
        aligned.macro.push(macro.values[idx]);
      }
    }

    // 30d window
    const n30 = Math.min(30, aligned.btc.length);
    const btc30 = aligned.btc.slice(0, n30);
    const mac30 = aligned.macro.slice(0, n30);
    const r30 = pearson(btc30, mac30);
    const p30 = pearsonPValue(r30, n30);

    // 90d window
    const n90 = Math.min(90, aligned.btc.length);
    const btc90 = aligned.btc.slice(0, n90);
    const mac90 = aligned.macro.slice(0, n90);
    const r90 = pearson(btc90, mac90);
    const p90 = pearsonPValue(r90, n90);

    results.push({
      pair: `BTC-${indicatorId}`,
      correlation30d: isNaN(r30) ? 0 : Math.round(r30 * 1000) / 1000,
      correlation90d: isNaN(r90) ? 0 : Math.round(r90 * 1000) / 1000,
      pValue30d: isNaN(p30) ? 1 : Math.round(p30 * 10000) / 10000,
      pValue90d: isNaN(p90) ? 1 : Math.round(p90 * 10000) / 10000,
      updatedAt: now,
    });
  }

  return results;
}
