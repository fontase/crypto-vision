/**
 * Crypto Vision — Advanced Analytics Routes
 *
 * Existing:
 * GET /api/analytics/correlation        — Cross-asset correlation matrix
 * GET /api/analytics/volatility         — Historical volatility rankings
 * GET /api/analytics/l2                 — Layer 2 comparison data
 * GET /api/analytics/revenue            — Protocol revenue rankings
 * GET /api/analytics/tt/*               — Token Terminal endpoints
 *
 * New (Prompt 035):
 * GET /api/analytics/market-regime      — Current market regime classification
 * GET /api/analytics/sector-performance — Sector/category performance
 * GET /api/analytics/correlation-matrix — Top coin correlation matrix
 * GET /api/analytics/volatility-ranking — Coins ranked by volatility
 * GET /api/analytics/momentum-scanner   — Momentum signal scanner
 * GET /api/analytics/value-metrics      — Value metrics (NVT proxies, etc.)
 * GET /api/analytics/seasonality/:id    — Monthly/daily seasonality patterns
 * GET /api/analytics/sharpe-ranking     — Coins ranked by Sharpe ratio
 * GET /api/analytics/drawdown-analysis  — Max drawdown analysis
 * GET /api/analytics/altcoin-season     — Altcoin season index
 * GET /api/analytics/market-breadth     — Market breadth indicators
 * GET /api/analytics/heat-map           — Performance heat map by timeframe
 *
 * @copyright 2024-2026 nirholas. All rights reserved.
 */

import { Hono } from "hono";
import { cache } from "../lib/cache.js";
import * as cg from "../sources/coingecko.js";
import * as alt from "../sources/alternative.js";
import * as l2beat from "../sources/l2beat.js";
import * as llama from "../sources/defillama.js";
import * as tt from "../sources/tokenterminal.js";

export const analyticsRoutes = new Hono();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/** Pearson correlation coefficient between two number arrays */
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;

  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]; sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i]; sumB2 += b[i] * b[i];
  }

  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  return den === 0 ? 0 : Math.round((num / den) * 10000) / 10000;
}

/** Daily log returns from a price series */
function logReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  return returns;
}

/** Annualized volatility from a price series (returns percentage) */
function annualizedVol(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = logReturns(prices);
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.round(Math.sqrt(variance * 365) * 10000) / 100; // percentage
}

/** Annualized vol from returns array (raw, not percentage) */
function annualizedVolFromReturns(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 365);
}

/** Max drawdown from a price series */
function maxDrawdown(prices: number[]): number {
  if (prices.length < 2) return 0;
  let peak = prices[0], maxDD = 0;
  for (const price of prices) {
    if (price > peak) peak = price;
    const dd = (peak - price) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/** Simple Moving Average */
function sma(data: number[], period: number): number {
  if (data.length < period) return data.length > 0 ? data.reduce((s, v) => s + v, 0) / data.length : 0;
  let sum = 0;
  for (let i = data.length - period; i < data.length; i++) sum += data[i];
  return sum / period;
}

/** Risk-free rate (US T-bill ~4.5% annual) */
const RISK_FREE_RATE = 0.045;

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/market-regime — Market Regime Classification
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/market-regime", async (c) => {
  const cacheKey = "analytics:market-regime";

  const result = await cache.wrap(cacheKey, 300, async () => {
    const [globalResult, fearGreedResult, btcChartResult] = await Promise.allSettled([
      cg.getGlobal(),
      alt.getFearGreedIndex(1),
      cg.getMarketChart("bitcoin", 200, "daily"),
    ]);

    // BTC price analysis
    let btcTrend: "above_200sma" | "below_200sma" | "near_200sma" | "unknown" = "unknown";
    let btcAbove50sma = false;
    let goldenCross = false;
    let deathCross = false;

    if (btcChartResult.status === "fulfilled" && btcChartResult.value.prices?.length > 50) {
      const prices = btcChartResult.value.prices.map((p) => p[1]);
      const currentPrice = prices[prices.length - 1];
      const sma50 = sma(prices, 50);
      const sma200 = prices.length >= 200 ? sma(prices, 200) : sma(prices, prices.length);

      btcAbove50sma = currentPrice > sma50;
      if (currentPrice > sma200 * 1.05) btcTrend = "above_200sma";
      else if (currentPrice < sma200 * 0.95) btcTrend = "below_200sma";
      else btcTrend = "near_200sma";

      // Golden/death cross: 50 SMA vs 200 SMA
      if (prices.length >= 200) {
        // Check if 50 SMA recently crossed above 200 SMA
        const prevSma50 = (() => {
          const slice = prices.slice(0, -1);
          return sma(slice, 50);
        })();
        const prevSma200 = (() => {
          const slice = prices.slice(0, -1);
          return sma(slice, slice.length >= 200 ? 200 : slice.length);
        })();
        goldenCross = prevSma50 <= prevSma200 && sma50 > sma200;
        deathCross = prevSma50 >= prevSma200 && sma50 < sma200;
      }
    }

    // Fear & Greed
    let fgValue = 50;
    let fgClassification = "neutral";
    if (fearGreedResult.status === "fulfilled" && fearGreedResult.value.data?.[0]) {
      fgValue = Number(fearGreedResult.value.data[0].value);
      fgClassification = fearGreedResult.value.data[0].value_classification.toLowerCase();
    }

    // Global market data
    let marketCapChange24h = 0;
    let btcDominance = 0;
    if (globalResult.status === "fulfilled") {
      marketCapChange24h = globalResult.value.data.market_cap_change_percentage_24h_usd;
      btcDominance = globalResult.value.data.market_cap_percentage.btc ?? 0;
    }

    // Volatility from recent BTC prices
    let volatilityLevel: "low" | "normal" | "high" | "extreme" = "normal";
    if (btcChartResult.status === "fulfilled" && btcChartResult.value.prices?.length > 30) {
      const recentPrices = btcChartResult.value.prices.slice(-30).map((p) => p[1]);
      const vol = annualizedVol(recentPrices);
      if (vol > 120) volatilityLevel = "extreme";
      else if (vol > 80) volatilityLevel = "high";
      else if (vol < 30) volatilityLevel = "low";
    }

    // Classify regime
    let regime: "bull_market" | "bear_market" | "accumulation" | "distribution" | "ranging";
    let confidence = 0;
    const signals = {
      btcTrend,
      btcAbove50sma,
      goldenCross,
      deathCross,
      fearGreed: fgClassification,
      fearGreedValue: fgValue,
      marketCapTrend: marketCapChange24h > 0 ? "up" as const : "down" as const,
      marketCapChange24h,
      btcDominance: Math.round(btcDominance * 100) / 100,
      btcDominanceTrend: btcDominance > 55 ? "rising" as const : btcDominance < 45 ? "declining" as const : "stable" as const,
      volatility: volatilityLevel,
    };

    // Score-based regime classification
    let bullScore = 0, bearScore = 0;

    if (btcTrend === "above_200sma") bullScore += 2;
    else if (btcTrend === "below_200sma") bearScore += 2;

    if (btcAbove50sma) bullScore += 1;
    else bearScore += 1;

    if (goldenCross) bullScore += 2;
    if (deathCross) bearScore += 2;

    if (fgValue > 60) bullScore += 1;
    else if (fgValue < 30) bearScore += 1;

    if (marketCapChange24h > 2) bullScore += 1;
    else if (marketCapChange24h < -2) bearScore += 1;

    const totalSignals = bullScore + bearScore;
    const netScore = bullScore - bearScore;

    if (netScore >= 4) { regime = "bull_market"; confidence = Math.min(0.95, 0.6 + netScore * 0.05); }
    else if (netScore <= -4) { regime = "bear_market"; confidence = Math.min(0.95, 0.6 + Math.abs(netScore) * 0.05); }
    else if (netScore >= 2 && fgValue < 40) { regime = "accumulation"; confidence = 0.6; }
    else if (netScore <= -1 && fgValue > 70) { regime = "distribution"; confidence = 0.6; }
    else { regime = "ranging"; confidence = 0.5 + (totalSignals > 0 ? 0.1 : 0); }

    confidence = Math.round(confidence * 100) / 100;

    // Recommendation
    const recommendations: Record<typeof regime, string> = {
      bull_market: "Risk-on environment. Favor altcoin exposure with BTC core. Consider taking partial profits at resistance levels.",
      bear_market: "Risk-off environment. Increase stablecoin allocation. Dollar-cost average into quality assets.",
      accumulation: "Smart money accumulating. Good time to build positions gradually with DCA strategy.",
      distribution: "Late-stage rally. Consider de-risking and securing profits. Watch for trend reversal signals.",
      ranging: "Sideways market. Range-trade around support/resistance. Accumulate on dips near support.",
    };

    return {
      regime,
      confidence,
      signals,
      recommendation: recommendations[regime],
    };
  });

  return c.json({
    data: result,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/sector-performance — Sector/Category Performance
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/sector-performance", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 30), 100);
  const cacheKey = `analytics:sector-perf:${limit}`;

  const result = await cache.wrap(cacheKey, 300, async () => {
    const categories = await cg.getCategories();

    return categories
      .slice(0, limit)
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        marketCap: cat.market_cap,
        marketCapChange24h: cat.market_cap_change_24h,
        volume24h: cat.volume_24h,
        topCoins: cat.top_3_coins,
      }))
      .sort((a, b) => (b.marketCapChange24h ?? 0) - (a.marketCapChange24h ?? 0));
  });

  return c.json({
    data: result,
    count: result.length,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/correlation-matrix — Top Coin Correlation Matrix
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/correlation-matrix", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 10), 20);
  const days = Math.min(Number(c.req.query("days") || 30), 365);

  const cacheKey = `analytics:corr-matrix:${limit}:${days}`;

  const result = await cache.wrap(cacheKey, 900, async () => {
    // Get top coins
    const coins = await cg.getCoins({ perPage: limit, sparkline: false });
    const ids = coins.map((c2) => c2.id);

    // Fetch price histories in parallel
    const histories = await Promise.allSettled(
      ids.map((id) => cg.getMarketChart(id, days, "daily")),
    );

    const priceMap: Record<string, number[]> = {};
    const symbolMap: Record<string, string> = {};
    for (let i = 0; i < ids.length; i++) {
      const h = histories[i];
      if (h.status === "fulfilled" && h.value.prices?.length > 5) {
        priceMap[ids[i]] = h.value.prices.map((p) => p[1]);
        symbolMap[ids[i]] = coins[i].symbol.toUpperCase();
      }
    }

    const validIds = Object.keys(priceMap);

    // Build N×N correlation matrix using log returns
    const returnMap: Record<string, number[]> = {};
    for (const id of validIds) {
      returnMap[id] = logReturns(priceMap[id]);
    }

    const matrix: Record<string, Record<string, number>> = {};
    for (const a of validIds) {
      matrix[a] = {};
      for (const b of validIds) {
        matrix[a][b] = a === b ? 1 : pearson(returnMap[a], returnMap[b]);
      }
    }

    // Find strongest correlations
    const pairs: Array<{ a: string; b: string; symbolA: string; symbolB: string; correlation: number }> = [];
    for (let i = 0; i < validIds.length; i++) {
      for (let j = i + 1; j < validIds.length; j++) {
        pairs.push({
          a: validIds[i],
          b: validIds[j],
          symbolA: symbolMap[validIds[i]],
          symbolB: symbolMap[validIds[j]],
          correlation: matrix[validIds[i]][validIds[j]],
        });
      }
    }
    pairs.sort((x, y) => Math.abs(y.correlation) - Math.abs(x.correlation));

    return {
      assets: validIds.map((id) => ({ id, symbol: symbolMap[id] })),
      days,
      matrix,
      strongestCorrelations: pairs.slice(0, 10),
      weakestCorrelations: [...pairs].sort((x, y) => Math.abs(x.correlation) - Math.abs(y.correlation)).slice(0, 5),
    };
  });

  return c.json({
    data: result,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/volatility-ranking — Coins Ranked by Volatility
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/volatility-ranking", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const days = Math.min(Number(c.req.query("days") || 30), 365);
  const order = c.req.query("order") === "asc" ? "asc" : "desc";

  const cacheKey = `analytics:vol-rank:${limit}:${days}:${order}`;

  const result = await cache.wrap(cacheKey, 600, async () => {
    const coins = await cg.getCoins({ perPage: limit, sparkline: false });
    const histories = await Promise.allSettled(
      coins.map((coin) => cg.getMarketChart(coin.id, days, "daily")),
    );

    const rankings: Array<{
      id: string;
      symbol: string;
      name: string;
      volatility: number;
      priceChange24h: number;
      marketCap: number;
      riskCategory: string;
    }> = [];

    for (let i = 0; i < coins.length; i++) {
      const h = histories[i];
      if (h.status === "fulfilled" && h.value.prices?.length > 5) {
        const prices = h.value.prices.map((p) => p[1]);
        const vol = annualizedVol(prices);
        rankings.push({
          id: coins[i].id,
          symbol: coins[i].symbol,
          name: coins[i].name,
          volatility: vol,
          priceChange24h: coins[i].price_change_percentage_24h,
          marketCap: coins[i].market_cap,
          riskCategory: vol > 150 ? "extreme" : vol > 100 ? "very_high" : vol > 60 ? "high" : vol > 30 ? "medium" : "low",
        });
      }
    }

    if (order === "asc") rankings.sort((a, b) => a.volatility - b.volatility);
    else rankings.sort((a, b) => b.volatility - a.volatility);

    return { period: `${days}d`, order, rankings };
  });

  return c.json({
    data: result,
    count: result.rankings.length,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/momentum-scanner — Momentum Signal Scanner
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/momentum-scanner", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);

  const cacheKey = `analytics:momentum:${limit}`;

  const result = await cache.wrap(cacheKey, 300, async () => {
    const coins = await cg.getCoins({ perPage: limit, sparkline: true, priceChangePct: "1h,24h,7d,14d,30d" });

    const signals: Array<{
      id: string;
      symbol: string;
      name: string;
      price: number;
      marketCap: number;
      change24h: number;
      change7d: number | null;
      change30d: number | null;
      rsi14: number | null;
      trend: "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";
      momentumScore: number;
      signals: string[];
    }> = [];

    for (const coin of coins) {
      const sparkline = coin.sparkline_in_7d?.price ?? [];
      const change24h = coin.price_change_percentage_24h ?? 0;
      const change7d = coin.price_change_percentage_7d_in_currency ?? null;
      const change30d = coin.price_change_percentage_30d_in_currency ?? null;

      // Calculate RSI-14 from sparkline (hourly data, ~168 points for 7d)
      let rsi14: number | null = null;
      if (sparkline.length >= 24) {
        // Downsample to daily-ish intervals for RSI
        const dailyPrices: number[] = [];
        for (let i = 0; i < sparkline.length; i += 24) {
          dailyPrices.push(sparkline[i]);
        }
        if (sparkline.length > 0) dailyPrices.push(sparkline[sparkline.length - 1]);

        if (dailyPrices.length >= 3) {
          const gains: number[] = [];
          const losses: number[] = [];
          for (let i = 1; i < dailyPrices.length; i++) {
            const change = dailyPrices[i] - dailyPrices[i - 1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? -change : 0);
          }
          const avgGain = gains.reduce((s, g) => s + g, 0) / gains.length;
          const avgLoss = losses.reduce((s, l) => s + l, 0) / losses.length;
          rsi14 = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
        }
      }

      // Momentum score (-100 to +100)
      let score = 0;
      const coinSignals: string[] = [];

      if (change24h > 5) { score += 20; coinSignals.push("Strong 24h momentum"); }
      else if (change24h > 2) { score += 10; }
      else if (change24h < -5) { score -= 20; coinSignals.push("Heavy 24h selling"); }
      else if (change24h < -2) { score -= 10; }

      if (change7d != null) {
        if (change7d > 15) { score += 25; coinSignals.push("Strong weekly trend"); }
        else if (change7d > 5) { score += 15; }
        else if (change7d < -15) { score -= 25; coinSignals.push("Weak weekly trend"); }
        else if (change7d < -5) { score -= 15; }
      }

      if (change30d != null) {
        if (change30d > 30) { score += 20; coinSignals.push("Strong monthly uptrend"); }
        else if (change30d > 10) { score += 10; }
        else if (change30d < -30) { score -= 20; coinSignals.push("Major monthly decline"); }
        else if (change30d < -10) { score -= 10; }
      }

      if (rsi14 != null) {
        if (rsi14 > 70) { score += 10; coinSignals.push("RSI overbought (>70)"); }
        else if (rsi14 < 30) { score -= 10; coinSignals.push("RSI oversold (<30)"); }
      }

      // Price relative to ATH
      if (coin.ath_change_percentage > -10) { score += 10; coinSignals.push("Near ATH"); }
      else if (coin.ath_change_percentage < -80) { score -= 10; coinSignals.push("Down >80% from ATH"); }

      const clampedScore = Math.max(-100, Math.min(100, score));
      const trend = clampedScore >= 40 ? "strong_bullish"
        : clampedScore >= 15 ? "bullish"
        : clampedScore <= -40 ? "strong_bearish"
        : clampedScore <= -15 ? "bearish"
        : "neutral";

      signals.push({
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        price: coin.current_price,
        marketCap: coin.market_cap,
        change24h,
        change7d,
        change30d,
        rsi14,
        trend,
        momentumScore: clampedScore,
        signals: coinSignals,
      });
    }

    // Sort by momentum score descending
    signals.sort((a, b) => b.momentumScore - a.momentumScore);

    const bullish = signals.filter((s) => s.momentumScore >= 15).length;
    const bearish = signals.filter((s) => s.momentumScore <= -15).length;
    const neutral = signals.length - bullish - bearish;

    return {
      summary: { total: signals.length, bullish, bearish, neutral },
      signals,
    };
  });

  return c.json({
    data: result,
    count: result.signals.length,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/value-metrics — Value Metrics (NVT proxies, etc.)
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/value-metrics", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 20), 50);
  const cacheKey = `analytics:value-metrics:${limit}`;

  const result = await cache.wrap(cacheKey, 600, async () => {
    // Fetch coins with market data plus global data
    const [coins, globalData] = await Promise.all([
      cg.getCoins({ perPage: limit, sparkline: false }),
      cg.getGlobal(),
    ]);

    const metrics = coins.map((coin) => {
      const marketCap = coin.market_cap ?? 0;
      const volume24h = coin.total_volume ?? 0;
      const circulatingSupply = coin.circulating_supply ?? 0;
      const totalSupply = coin.total_supply ?? circulatingSupply;
      const maxSupply = coin.max_supply ?? null;
      const price = coin.current_price ?? 0;

      // NVT Ratio proxy: Market Cap / 24h Volume (lower = more transactional value)
      const nvtRatio = volume24h > 0 ? Math.round((marketCap / volume24h) * 100) / 100 : null;

      // Supply metrics
      const circulatingPct = totalSupply > 0 ? Math.round((circulatingSupply / totalSupply) * 10000) / 100 : null;
      const inflationProxy = maxSupply != null && circulatingSupply > 0
        ? Math.round(((maxSupply - circulatingSupply) / circulatingSupply) * 10000) / 100
        : null;

      // Market cap dominance
      const totalMarketCap = globalData.data.total_market_cap.usd ?? 1;
      const dominance = Math.round((marketCap / totalMarketCap) * 10000) / 100;

      // ATH discount: how far from ATH
      const athDiscount = coin.ath > 0 ? Math.round(((coin.ath - price) / coin.ath) * 10000) / 100 : null;

      // Volume/MCap ratio (higher = more liquid/active)
      const volumeToMcap = marketCap > 0 ? Math.round((volume24h / marketCap) * 10000) / 100 : null;

      // Value score (0-100): composite heuristic
      let valueScore = 50; // baseline
      if (nvtRatio != null && nvtRatio < 10) valueScore += 10; // high transaction volume
      if (nvtRatio != null && nvtRatio > 50) valueScore -= 10; // low transaction volume
      if (athDiscount != null && athDiscount > 50) valueScore += 15; // deep discount from ATH
      if (athDiscount != null && athDiscount < 10) valueScore -= 10; // near ATH = potentially expensive
      if (circulatingPct != null && circulatingPct > 80) valueScore += 5; // most supply already circulating
      if (volumeToMcap != null && volumeToMcap > 10) valueScore += 5;

      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        price,
        marketCap,
        volume24h,
        nvtRatio,
        volumeToMcapPct: volumeToMcap,
        circulatingSupplyPct: circulatingPct,
        remainingInflationPct: inflationProxy,
        dominancePct: dominance,
        athDiscountPct: athDiscount,
        valueScore: Math.max(0, Math.min(100, valueScore)),
      };
    });

    // Sort by value score
    metrics.sort((a, b) => b.valueScore - a.valueScore);

    return metrics;
  });

  return c.json({
    data: result,
    count: result.length,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/seasonality/:id — Monthly/Daily Seasonality
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/seasonality/:id", async (c) => {
  const id = c.req.param("id");
  const cacheKey = `analytics:seasonality:${id}`;

  const result = await cache.wrap(cacheKey, 3600, async () => {
    // Get max available data (365 days for free tier)
    const chart = await cg.getMarketChart(id, 365, "daily");
    const prices = chart.prices;

    if (!prices || prices.length < 30) {
      return { months: [], dayOfWeek: [], note: "Insufficient data for seasonality analysis" };
    }

    // Monthly seasonality: average return by month
    const monthlyReturns: Record<number, number[]> = {};
    for (let i = 1; i < prices.length; i++) {
      const date = new Date(prices[i][0]);
      const month = date.getMonth(); // 0-11
      const ret = prices[i - 1][1] > 0
        ? ((prices[i][1] - prices[i - 1][1]) / prices[i - 1][1]) * 100
        : 0;
      if (!monthlyReturns[month]) monthlyReturns[month] = [];
      monthlyReturns[month].push(ret);
    }

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const months = monthNames.map((name, idx) => {
      const returns = monthlyReturns[idx] ?? [];
      const avg = returns.length > 0
        ? Math.round((returns.reduce((s, r) => s + r, 0) / returns.length) * 100) / 100
        : null;
      const positive = returns.filter((r) => r > 0).length;
      return {
        month: name,
        avgDailyReturn: avg,
        sampleSize: returns.length,
        positiveRatio: returns.length > 0 ? Math.round((positive / returns.length) * 10000) / 100 : null,
      };
    });

    // Day-of-week seasonality
    const dowReturns: Record<number, number[]> = {};
    for (let i = 1; i < prices.length; i++) {
      const date = new Date(prices[i][0]);
      const dow = date.getDay(); // 0=Sun, 6=Sat
      const ret = prices[i - 1][1] > 0
        ? ((prices[i][1] - prices[i - 1][1]) / prices[i - 1][1]) * 100
        : 0;
      if (!dowReturns[dow]) dowReturns[dow] = [];
      dowReturns[dow].push(ret);
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeek = dayNames.map((name, idx) => {
      const returns = dowReturns[idx] ?? [];
      const avg = returns.length > 0
        ? Math.round((returns.reduce((s, r) => s + r, 0) / returns.length) * 100) / 100
        : null;
      const positive = returns.filter((r) => r > 0).length;
      return {
        day: name,
        avgDailyReturn: avg,
        sampleSize: returns.length,
        positiveRatio: returns.length > 0 ? Math.round((positive / returns.length) * 10000) / 100 : null,
      };
    });

    return {
      coinId: id,
      dataPoints: prices.length,
      period: "365d",
      months,
      dayOfWeek,
      bestMonth: months.reduce((best, m) =>
        (m.avgDailyReturn ?? -Infinity) > (best.avgDailyReturn ?? -Infinity) ? m : best, months[0]),
      worstMonth: months.reduce((worst, m) =>
        (m.avgDailyReturn ?? Infinity) < (worst.avgDailyReturn ?? Infinity) ? m : worst, months[0]),
      bestDay: dayOfWeek.reduce((best, d) =>
        (d.avgDailyReturn ?? -Infinity) > (best.avgDailyReturn ?? -Infinity) ? d : best, dayOfWeek[0]),
    };
  });

  return c.json({
    data: result,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/sharpe-ranking — Coins Ranked by Sharpe Ratio
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/sharpe-ranking", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const days = Math.min(Number(c.req.query("days") || 90), 365);

  const cacheKey = `analytics:sharpe:${limit}:${days}`;

  const result = await cache.wrap(cacheKey, 600, async () => {
    const coins = await cg.getCoins({ perPage: limit, sparkline: false });
    const histories = await Promise.allSettled(
      coins.map((coin) => cg.getMarketChart(coin.id, days, "daily")),
    );

    const rankings: Array<{
      id: string;
      symbol: string;
      name: string;
      sharpeRatio: number;
      annualizedReturn: number;
      annualizedVolatility: number;
      marketCap: number;
    }> = [];

    for (let i = 0; i < coins.length; i++) {
      const h = histories[i];
      if (h.status === "fulfilled" && h.value.prices?.length > 10) {
        const prices = h.value.prices.map((p) => p[1]);
        const returns = logReturns(prices);
        if (returns.length < 5) continue;

        const vol = annualizedVolFromReturns(returns);
        const meanDailyReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
        const annReturn = (1 + meanDailyReturn) ** 365 - 1;
        const sharpe = vol > 0 ? Math.round(((annReturn - RISK_FREE_RATE) / vol) * 10000) / 10000 : 0;

        rankings.push({
          id: coins[i].id,
          symbol: coins[i].symbol,
          name: coins[i].name,
          sharpeRatio: sharpe,
          annualizedReturn: Math.round(annReturn * 10000) / 100,
          annualizedVolatility: Math.round(vol * 10000) / 100,
          marketCap: coins[i].market_cap,
        });
      }
    }

    rankings.sort((a, b) => b.sharpeRatio - a.sharpeRatio);

    return { period: `${days}d`, riskFreeRate: RISK_FREE_RATE, rankings };
  });

  return c.json({
    data: result,
    count: result.rankings.length,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/drawdown-analysis — Max Drawdown Analysis
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/drawdown-analysis", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const days = Math.min(Number(c.req.query("days") || 90), 365);

  const cacheKey = `analytics:drawdown:${limit}:${days}`;

  const result = await cache.wrap(cacheKey, 600, async () => {
    const coins = await cg.getCoins({ perPage: limit, sparkline: false });
    const histories = await Promise.allSettled(
      coins.map((coin) => cg.getMarketChart(coin.id, days, "daily")),
    );

    const rankings: Array<{
      id: string;
      symbol: string;
      name: string;
      maxDrawdown: number;
      currentDrawdown: number;
      recoveryPct: number | null;
      athDrawdown: number;
      marketCap: number;
    }> = [];

    for (let i = 0; i < coins.length; i++) {
      const h = histories[i];
      if (h.status === "fulfilled" && h.value.prices?.length > 5) {
        const prices = h.value.prices.map((p) => p[1]);
        const mdd = maxDrawdown(prices);

        // Current drawdown from period high
        const periodHigh = Math.max(...prices);
        const currentPrice = prices[prices.length - 1];
        const currentDD = periodHigh > 0 ? (periodHigh - currentPrice) / periodHigh : 0;

        // Recovery from max drawdown trough
        let recoveryPct: number | null = null;
        const trough = Math.min(...prices);
        if (trough > 0 && mdd > 0.01) {
          recoveryPct = Math.round(((currentPrice - trough) / trough) * 10000) / 100;
        }

        rankings.push({
          id: coins[i].id,
          symbol: coins[i].symbol,
          name: coins[i].name,
          maxDrawdown: Math.round(mdd * 10000) / 100,
          currentDrawdown: Math.round(currentDD * 10000) / 100,
          recoveryPct,
          athDrawdown: Math.abs(coins[i].ath_change_percentage),
          marketCap: coins[i].market_cap,
        });
      }
    }

    // Sort by max drawdown descending (worst first)
    rankings.sort((a, b) => b.maxDrawdown - a.maxDrawdown);

    return { period: `${days}d`, rankings };
  });

  return c.json({
    data: result,
    count: result.rankings.length,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/altcoin-season — Altcoin Season Index
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/altcoin-season", async (c) => {
  const cacheKey = "analytics:altcoin-season";

  const result = await cache.wrap(cacheKey, 300, async () => {
    // Get top 100 coins with 90d price change
    const coins = await cg.getCoins({
      perPage: 100,
      sparkline: false,
      priceChangePct: "24h,7d,30d",
    });

    // Fetch 90-day data for BTC to calculate its 90d return
    const btcChart = await cg.getMarketChart("bitcoin", 90, "daily");
    const btcPrices = btcChart.prices?.map((p) => p[1]) ?? [];
    const btcChange90d = btcPrices.length >= 2
      ? ((btcPrices[btcPrices.length - 1] - btcPrices[0]) / btcPrices[0]) * 100
      : 0;

    // Calculate how many top coins outperformed BTC over 90 days
    // We'll use 30d as a proxy when 90d isn't directly available from the /markets endpoint
    const btc = coins.find((c2) => c2.id === "bitcoin");
    const nonBtcCoins = coins.filter((c2) => c2.id !== "bitcoin");

    // We need to estimate 90d changes — use the chart data approach for precision
    const outperformers: Array<{
      id: string;
      symbol: string;
      change: number;
    }> = [];

    // For each non-BTC coin, check 30d change as a proxy (CoinGecko markets endpoint gives us 30d)
    const btcChange30d = btc?.price_change_percentage_30d_in_currency ?? 0;

    for (const coin of nonBtcCoins) {
      const coinChange30d = coin.price_change_percentage_30d_in_currency ?? 0;
      if (coinChange30d > btcChange30d) {
        outperformers.push({
          id: coin.id,
          symbol: coin.symbol,
          change: coinChange30d,
        });
      }
    }

    const altcoinSeasonIndex = nonBtcCoins.length > 0
      ? Math.round((outperformers.length / nonBtcCoins.length) * 10000) / 100
      : 0;

    const season = altcoinSeasonIndex > 75
      ? "altcoin_season"
      : altcoinSeasonIndex < 25
        ? "bitcoin_season"
        : "neutral";

    // Top outperformers
    outperformers.sort((a, b) => b.change - a.change);

    return {
      index: altcoinSeasonIndex,
      season,
      outperformers: outperformers.length,
      total: nonBtcCoins.length,
      btcChange90d: Math.round(btcChange90d * 100) / 100,
      btcChange30d: Math.round(btcChange30d * 100) / 100,
      methodology: "Percentage of top coins outperforming BTC over 30d (proxy for 90d). >75 = altcoin season, <25 = bitcoin season.",
      topOutperformers: outperformers.slice(0, 10).map((op) => ({
        id: op.id,
        symbol: op.symbol,
        change30d: Math.round(op.change * 100) / 100,
      })),
    };
  });

  return c.json({
    data: result,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/market-breadth — Market Breadth Indicators
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/market-breadth", async (c) => {
  const cacheKey = "analytics:market-breadth";

  const result = await cache.wrap(cacheKey, 300, async () => {
    const [coins, globalData] = await Promise.all([
      cg.getCoins({ perPage: 100, sparkline: false, priceChangePct: "24h,7d,30d" }),
      cg.getGlobal(),
    ]);

    // Advance/Decline ratio
    const advancing24h = coins.filter((c2) => c2.price_change_percentage_24h > 0).length;
    const declining24h = coins.filter((c2) => c2.price_change_percentage_24h < 0).length;
    const unchanged24h = coins.length - advancing24h - declining24h;
    const adRatio24h = declining24h > 0
      ? Math.round((advancing24h / declining24h) * 10000) / 10000
      : advancing24h;

    // 7d breadth
    const advancing7d = coins.filter((c2) => (c2.price_change_percentage_7d_in_currency ?? 0) > 0).length;
    const declining7d = coins.filter((c2) => (c2.price_change_percentage_7d_in_currency ?? 0) < 0).length;

    // 30d breadth
    const advancing30d = coins.filter((c2) => (c2.price_change_percentage_30d_in_currency ?? 0) > 0).length;
    const declining30d = coins.filter((c2) => (c2.price_change_percentage_30d_in_currency ?? 0) < 0).length;

    // Market cap weighted breadth
    const totalMcap = coins.reduce((s, c2) => s + (c2.market_cap ?? 0), 0);
    const weightedAdvancing = coins
      .filter((c2) => c2.price_change_percentage_24h > 0)
      .reduce((s, c2) => s + (c2.market_cap ?? 0), 0);
    const mcapWeightedBreadth = totalMcap > 0
      ? Math.round((weightedAdvancing / totalMcap) * 10000) / 100
      : 50;

    // New highs/lows proxy (within 10% of ATH / down >90% from ATH)
    const nearATH = coins.filter((c2) => c2.ath_change_percentage > -10).length;
    const deepDiscount = coins.filter((c2) => c2.ath_change_percentage < -90).length;

    // Average performance
    const avg24h = coins.length > 0
      ? Math.round((coins.reduce((s, c2) => s + c2.price_change_percentage_24h, 0) / coins.length) * 100) / 100
      : 0;
    const avg7d = coins.length > 0
      ? Math.round((coins.reduce((s, c2) => s + (c2.price_change_percentage_7d_in_currency ?? 0), 0) / coins.length) * 100) / 100
      : 0;

    // Breadth sentiment
    const breadthSentiment = adRatio24h > 2 ? "very_bullish"
      : adRatio24h > 1.2 ? "bullish"
      : adRatio24h < 0.5 ? "very_bearish"
      : adRatio24h < 0.8 ? "bearish"
      : "neutral";

    return {
      breadth24h: {
        advancing: advancing24h,
        declining: declining24h,
        unchanged: unchanged24h,
        advanceDeclineRatio: adRatio24h,
        avgChange: avg24h,
      },
      breadth7d: {
        advancing: advancing7d,
        declining: declining7d,
        advanceDeclineRatio: declining7d > 0 ? Math.round((advancing7d / declining7d) * 10000) / 10000 : advancing7d,
        avgChange: avg7d,
      },
      breadth30d: {
        advancing: advancing30d,
        declining: declining30d,
      },
      mcapWeightedBreadth,
      nearATH,
      deepDiscount,
      sentiment: breadthSentiment,
      totalMarketCap: globalData.data.total_market_cap.usd ?? 0,
      marketCapChange24h: globalData.data.market_cap_change_percentage_24h_usd,
      sampleSize: coins.length,
    };
  });

  return c.json({
    data: result,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/analytics/heat-map — Performance Heat Map by Timeframe
// ═══════════════════════════════════════════════════════════════

analyticsRoutes.get("/heat-map", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const cacheKey = `analytics:heat-map:${limit}`;

  const result = await cache.wrap(cacheKey, 300, async () => {
    const coins = await cg.getCoins({
      perPage: limit,
      sparkline: false,
      priceChangePct: "1h,24h,7d,14d,30d",
    });

    return coins.map((coin) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      marketCap: coin.market_cap,
      marketCapRank: coin.market_cap_rank,
      changes: {
        "24h": Math.round((coin.price_change_percentage_24h ?? 0) * 100) / 100,
        "7d": Math.round((coin.price_change_percentage_7d_in_currency ?? 0) * 100) / 100,
        "30d": Math.round((coin.price_change_percentage_30d_in_currency ?? 0) * 100) / 100,
      },
      athChange: Math.round((coin.ath_change_percentage ?? 0) * 100) / 100,
      volume24h: coin.total_volume,
    }));
  });

  return c.json({
    data: result,
    count: result.length,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// EXISTING ENDPOINTS (preserved from original)
// ═══════════════════════════════════════════════════════════════

// GET /api/analytics/correlation — Cross-asset correlation matrix

analyticsRoutes.get("/correlation", async (c) => {
  const idsParam =
    c.req.query("ids") || "bitcoin,ethereum,solana,cardano,avalanche-2";
  const days = Math.min(Number(c.req.query("days") || 90), 365);
  const ids = idsParam.split(",").slice(0, 10).map((s) => s.trim());

  const cacheKey = `analytics:corr:${ids.join(",")}:${days}`;

  const result = await cache.wrap(cacheKey, 900, async () => {
    // Fetch price history for each coin in parallel
    const histories = await Promise.allSettled(
      ids.map((id) => cg.getMarketChart(id, days, "daily")),
    );

    // Extract daily close prices, keyed by coin id
    const priceMap: Record<string, number[]> = {};
    for (let i = 0; i < ids.length; i++) {
      const h = histories[i];
      if (h.status === "fulfilled" && h.value.prices?.length > 0) {
        priceMap[ids[i]] = h.value.prices.map((p) => p[1]);
      }
    }

    const validIds = Object.keys(priceMap);

    // Build correlation matrix
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of validIds) {
      matrix[a] = {};
      for (const b of validIds) {
        matrix[a][b] = a === b ? 1 : pearson(priceMap[a], priceMap[b]);
      }
    }

    return {
      assets: validIds,
      days,
      matrix,
    };
  });

  return c.json({
    data: result,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/analytics/volatility — Historical volatility rankings

analyticsRoutes.get("/volatility", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const days = Math.min(Number(c.req.query("days") || 30), 365);

  const cacheKey = `analytics:vol:${limit}:${days}`;

  const result = await cache.wrap(cacheKey, 600, async () => {
    // Get top coins by market cap
    const coins = await cg.getCoins({ perPage: limit, sparkline: false });

    // Fetch daily price history for each coin in parallel
    const histories = await Promise.allSettled(
      coins.map((coin) => cg.getMarketChart(coin.id, days, "daily")),
    );

    const rankings: Array<{
      id: string;
      symbol: string;
      name: string;
      volatility: number;
      priceChange24h: number;
      marketCap: number;
    }> = [];

    for (let i = 0; i < coins.length; i++) {
      const h = histories[i];
      if (h.status === "fulfilled" && h.value.prices?.length > 5) {
        const prices = h.value.prices.map((p) => p[1]);
        rankings.push({
          id: coins[i].id,
          symbol: coins[i].symbol,
          name: coins[i].name,
          volatility: annualizedVol(prices),
          priceChange24h: coins[i].price_change_percentage_24h,
          marketCap: coins[i].market_cap,
        });
      }
    }

    // Sort by volatility descending
    rankings.sort((a, b) => b.volatility - a.volatility);

    return {
      period: `${days}d`,
      rankings,
    };
  });

  return c.json({
    data: result,
    count: result.rankings.length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/analytics/l2 — Layer 2 comparison data

analyticsRoutes.get("/l2", async (c) => {
  const sortBy = c.req.query("sort") || "tvl";
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);

  const cacheKey = `analytics:l2:${sortBy}:${limit}`;

  const result = await cache.wrap(cacheKey, 600, async () => {
    // Fetch L2Beat summary and DeFiLlama chains in parallel
    const [l2Summary, llamaChains] = await Promise.all([
      l2beat.getScalingSummary(),
      llama.getChainsTVL(),
    ]);

    // Build a DeFiLlama TVL lookup for cross-referencing
    const llamaTvlMap: Record<string, number> = {};
    for (const ch of llamaChains) {
      llamaTvlMap[ch.name.toLowerCase()] = ch.tvl;
    }

    // Parse L2Beat projects (it's a Record<string, project>)
    const projects = Object.entries(l2Summary.projects).map(
      ([key, p]) => {
        const l2Tvl = p.tvl?.value ?? null;
        const llamaTvl = llamaTvlMap[p.name?.toLowerCase()] ?? null;

        return {
          id: key,
          name: p.name,
          slug: p.slug,
          category: p.category,
          provider: p.provider ?? null,
          stage: p.stage?.stage ?? null,
          purposes: p.purposes,
          tvlL2Beat: l2Tvl,
          tvlDeFiLlama: llamaTvl,
        };
      },
    );

    // Sort
    if (sortBy === "name") {
      projects.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      projects.sort(
        (a, b) => (b.tvlL2Beat ?? b.tvlDeFiLlama ?? 0) - (a.tvlL2Beat ?? a.tvlDeFiLlama ?? 0),
      );
    }

    return projects.slice(0, limit);
  });

  return c.json({
    data: result,
    count: result.length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/analytics/revenue — Protocol revenue rankings

analyticsRoutes.get("/revenue", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const period = c.req.query("period") || "24h"; // 24h | 7d | 30d

  const cacheKey = `analytics:revenue:${period}:${limit}`;

  const result = await cache.wrap(cacheKey, 300, async () => {
    // Fetch from both DeFiLlama and Token Terminal in parallel
    const [llamaFees, llamaRevenue] = await Promise.allSettled([
      llama.getFeesRevenue(),
      llama.getRevenue(),
    ]);

    // Try Token Terminal (may fail if no API key)
    let ttData: tt.ProtocolMetrics[] = [];
    try {
      const ttRevenue = await tt.getProtocolRevenue();
      ttData = ttRevenue.data ?? [];
    } catch {
      // Token Terminal unavailable — continue with DeFiLlama only
    }

    // Build unified revenue list from DeFiLlama fees endpoint
    type RevenueEntry = {
      name: string;
      fees24h: number | null;
      fees7d: number | null;
      fees30d: number | null;
      revenue24h: number | null;
      revenue7d: number | null;
      revenue30d: number | null;
      category: string | null;
      source: string;
    };

    const entries: RevenueEntry[] = [];

    // DeFiLlama fees data
    if (llamaFees.status === "fulfilled") {
      for (const p of llamaFees.value.protocols ?? []) {
        entries.push({
          name: p.name,
          fees24h: p.total24h ?? null,
          fees7d: p.total7d ?? null,
          fees30d: p.total30d ?? null,
          revenue24h: null,
          revenue7d: null,
          revenue30d: null,
          category: p.category ?? null,
          source: "defillama",
        });
      }
    }

    // Merge DeFiLlama revenue data
    if (llamaRevenue.status === "fulfilled") {
      const revenueByName = new Map(
        (llamaRevenue.value.protocols ?? []).map((p) => [p.name, p]),
      );
      for (const entry of entries) {
        const rev = revenueByName.get(entry.name);
        if (rev) {
          entry.revenue24h = rev.total24h ?? null;
          entry.revenue7d = rev.total7d ?? null;
          entry.revenue30d = rev.total30d ?? null;
        }
      }
    }

    // Enrich with Token Terminal data if available
    if (ttData.length > 0) {
      const ttByName = new Map(
        ttData.map((p) => [p.project_name?.toLowerCase(), p]),
      );
      for (const entry of entries) {
        const ttEntry = ttByName.get(entry.name.toLowerCase());
        if (ttEntry) {
          entry.revenue24h = entry.revenue24h ?? ttEntry.revenue_24h ?? null;
          entry.revenue7d = entry.revenue7d ?? ttEntry.revenue_7d ?? null;
          entry.revenue30d = entry.revenue30d ?? ttEntry.revenue_30d ?? null;
        }
      }
    }

    // Sort by selected period
    const sortKey =
      period === "7d"
        ? "fees7d"
        : period === "30d"
          ? "fees30d"
          : "fees24h";

    entries.sort(
      (a, b) => (b[sortKey as keyof RevenueEntry] as number ?? 0) - (a[sortKey as keyof RevenueEntry] as number ?? 0),
    );

    return entries.slice(0, limit);
  });

  return c.json({
    data: result,
    count: result.length,
    period,
    timestamp: new Date().toISOString(),
  });
});

// ─── Token Terminal Endpoints ────────────────────────────────

analyticsRoutes.get("/tt/projects", async (c) => {
  const data = await tt.getProjects();

  return c.json({
    data: (data.data || []).map((p) => ({
      id: p.project_id,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
    })),
    count: data.data?.length || 0,
    source: "tokenterminal",
    timestamp: new Date().toISOString(),
  });
});

analyticsRoutes.get("/tt/project/:id", async (c) => {
  const projectId = c.req.param("id");
  const data = await tt.getProjectMetrics(projectId);

  return c.json({
    data: data.data,
    projectId,
    source: "tokenterminal",
    timestamp: new Date().toISOString(),
  });
});

analyticsRoutes.get("/tt/fees", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const data = await tt.getProtocolFees();

  return c.json({
    data: (data.data || []).slice(0, limit),
    count: Math.min(data.data?.length || 0, limit),
    source: "tokenterminal",
    timestamp: new Date().toISOString(),
  });
});

analyticsRoutes.get("/tt/active-users", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const data = await tt.getActiveUsers();

  return c.json({
    data: (data.data || []).slice(0, limit),
    count: Math.min(data.data?.length || 0, limit),
    source: "tokenterminal",
    timestamp: new Date().toISOString(),
  });
});

analyticsRoutes.get("/tt/market/:metric", async (c) => {
  const metric = c.req.param("metric");
  const days = Math.min(Number(c.req.query("days") || 30), 365);
  const data = await tt.getMarketMetric(metric, days);

  return c.json({
    data: {
      metricId: data.metric_id,
      values: (data.data || []).map((v) => ({
        timestamp: v.timestamp,
        value: v.value,
      })),
    },
    metric,
    days,
    source: "tokenterminal",
    timestamp: new Date().toISOString(),
  });
});
