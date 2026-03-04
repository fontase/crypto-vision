/**
 * Market Regime Classifier
 *
 * Classifies current market conditions into regimes (bull, bear, crab, euphoria,
 * capitulation) using data from multiple real sources. Maps each regime to
 * strategy adjustments for the pump-agent swarm.
 *
 * Data Sources:
 *  - Jupiter (SOL price)
 *  - Alternative.me Fear & Greed Index
 *  - DefiLlama (Solana TVL)
 *  - Pump.fun (token launch activity)
 */

import type { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';
import type { TradingStrategy } from '../types.js';
import {
  STRATEGY_ORGANIC,
  STRATEGY_GRADUATION,
  STRATEGY_EXIT,
} from '../strategies.js';
import BN from 'bn.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface RegimeConfig {
  /** Cache TTL for API data (ms) */
  cacheTtl: number;
  /** Weights for each data source (should sum to 1) */
  weights: {
    solPrice: number;
    pumpFunActivity: number;
    fearGreed: number;
    defiTvl: number;
    memeIndex: number;
  };
}

export type RegimeLabel = 'bull' | 'bear' | 'crab' | 'euphoria' | 'capitulation';

export interface RegimeFactor {
  source: string;
  value: number;
  /** Normalized to -1 (bearish) … +1 (bullish) */
  normalizedScore: number;
  weight: number;
  description: string;
}

export interface StrategyAdjustment {
  parameter: string;
  currentValue: number | string;
  adjustedValue: number | string;
  reason: string;
}

export interface RegimeClassification {
  regime: RegimeLabel;
  /** 0-1 confidence in classification */
  confidence: number;
  /** -100 (extreme fear) … +100 (extreme greed) */
  sentimentScore: number;
  factors: RegimeFactor[];
  strategyAdjustments: StrategyAdjustment[];
  /** Is the regime transitioning? */
  transitioning: boolean;
  likelyNextRegime?: string;
  /** ms since oldest data point */
  dataAge: number;
  classifiedAt: number;
}

export interface RegimeEntry {
  regime: string;
  startedAt: number;
  endedAt?: number;
  duration: number;
  sentimentScore: number;
  factors: RegimeFactor[];
}

export interface RegimeDataSources {
  solPrice: { price: number; change24h: number; change7d: number };
  fearGreed: { value: number; classification: string };
  defiTvl: { current: number; change7d: number };
  pumpFunActivity: {
    launchesPerHour: number;
    graduationRate: number;
    avgMarketCap: number;
  };
  memeIndex: { score: number; trend: 'up' | 'down' | 'flat' };
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Jupiter price response
// ---------------------------------------------------------------------------

interface JupiterPriceResponse {
  data: Record<string, { price: string }>;
}

// ---------------------------------------------------------------------------
// Fear & Greed response
// ---------------------------------------------------------------------------

interface FearGreedResponse {
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
  }>;
}

// ---------------------------------------------------------------------------
// DefiLlama TVL response
// ---------------------------------------------------------------------------

interface DefiLlamaTvlEntry {
  date: number;
  tvl: number;
}

// ---------------------------------------------------------------------------
// Pump.fun response
// ---------------------------------------------------------------------------

interface PumpFunCoin {
  mint: string;
  created_timestamp: number;
  market_cap?: number;
  complete?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const DEFAULT_CONFIG: RegimeConfig = {
  cacheTtl: 300_000, // 5 min
  weights: {
    solPrice: 0.25,
    pumpFunActivity: 0.25,
    fearGreed: 0.20,
    defiTvl: 0.15,
    memeIndex: 0.15,
  },
};

const FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// MarketRegime
// ---------------------------------------------------------------------------

export class MarketRegime {
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;
  private readonly config: RegimeConfig;

  /** Cached raw data sources */
  private cachedData: RegimeDataSources | undefined;
  private cacheTimestamp = 0;

  /** Regime history (most-recent first) */
  private history: RegimeEntry[] = [];

  /** Last classification returned */
  private lastClassification: RegimeClassification | undefined;

  /** Monitoring interval handle */
  private monitoringTimer: ReturnType<typeof setInterval> | undefined;

  constructor(eventBus: SwarmEventBus, config?: Partial<RegimeConfig>) {
    this.eventBus = eventBus;
    this.logger = SwarmLogger.create('market-regime', 'intelligence');
    this.config = {
      cacheTtl: config?.cacheTtl ?? DEFAULT_CONFIG.cacheTtl,
      weights: { ...DEFAULT_CONFIG.weights, ...config?.weights },
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Classify the current market regime based on multi-source real data. */
  async classifyRegime(): Promise<RegimeClassification> {
    const sources = await this.getDataSources();
    const factors = this.buildFactors(sources);
    const weightedScore = this.computeWeightedScore(factors);
    const regime = this.scoreToRegime(weightedScore);
    const confidence = this.computeConfidence(sources, factors);

    const transitioning = this.isTransitioning(regime);
    const likelyNextRegime = transitioning
      ? this.predictNextRegime(weightedScore)
      : undefined;

    const strategyAdjustments = this.buildStrategyAdjustments(regime);

    const classification: RegimeClassification = {
      regime,
      confidence,
      sentimentScore: Math.round(weightedScore * 100) / 100,
      factors,
      strategyAdjustments,
      transitioning,
      likelyNextRegime,
      dataAge: Date.now() - sources.fetchedAt,
      classifiedAt: Date.now(),
    };

    this.recordHistory(classification);
    this.lastClassification = classification;

    this.logger.info('Regime classified', {
      regime,
      sentimentScore: classification.sentimentScore,
      confidence,
      transitioning,
    });

    return classification;
  }

  /** Return historical regime changes (most-recent first). */
  getRegimeHistory(): RegimeEntry[] {
    return [...this.history];
  }

  /**
   * Adjust a TradingStrategy for the given regime,
   * returning a new strategy object with modified parameters.
   */
  adjustStrategyForRegime(
    strategy: TradingStrategy,
    regime: RegimeClassification,
  ): TradingStrategy {
    const adjusted = { ...strategy };

    switch (regime.regime) {
      case 'euphoria':
        // Aggressive: fast trades, higher volumes, graduation-like
        adjusted.minIntervalSeconds = Math.max(
          5,
          Math.floor(strategy.minIntervalSeconds * 0.5),
        );
        adjusted.maxIntervalSeconds = Math.max(
          10,
          Math.floor(strategy.maxIntervalSeconds * 0.5),
        );
        adjusted.buySellRatio = Math.min(0.95, strategy.buySellRatio + 0.15);
        adjusted.minTradeSizeLamports = strategy.minTradeSizeLamports.muln(2);
        adjusted.maxTradeSizeLamports = strategy.maxTradeSizeLamports.muln(2);
        adjusted.useJitoBundles = true;
        adjusted.priorityFeeMicroLamports = Math.max(
          strategy.priorityFeeMicroLamports,
          STRATEGY_GRADUATION.priorityFeeMicroLamports,
        );
        break;

      case 'bull':
        // Moderate bullish: slightly faster, larger buys
        adjusted.minIntervalSeconds = Math.max(
          10,
          Math.floor(strategy.minIntervalSeconds * 0.75),
        );
        adjusted.maxIntervalSeconds = Math.max(
          20,
          Math.floor(strategy.maxIntervalSeconds * 0.75),
        );
        adjusted.buySellRatio = Math.min(0.85, strategy.buySellRatio + 0.05);
        break;

      case 'crab':
        // Reduce activity, smaller positions
        adjusted.minIntervalSeconds = Math.floor(
          strategy.minIntervalSeconds * 1.5,
        );
        adjusted.maxIntervalSeconds = Math.floor(
          strategy.maxIntervalSeconds * 1.5,
        );
        adjusted.buySellRatio = 0.5; // balanced
        adjusted.minTradeSizeLamports = new BN(
          strategy.minTradeSizeLamports.toNumber() * 0.7,
        );
        adjusted.maxTradeSizeLamports = new BN(
          strategy.maxTradeSizeLamports.toNumber() * 0.7,
        );
        break;

      case 'bear':
        // Defensive: prefer exits, slow trades
        adjusted.minIntervalSeconds = Math.floor(
          strategy.minIntervalSeconds * 2,
        );
        adjusted.maxIntervalSeconds = Math.floor(
          strategy.maxIntervalSeconds * 2,
        );
        adjusted.buySellRatio = Math.max(0.2, strategy.buySellRatio - 0.25);
        adjusted.minTradeSizeLamports = new BN(
          strategy.minTradeSizeLamports.toNumber() * 0.5,
        );
        adjusted.maxTradeSizeLamports = new BN(
          strategy.maxTradeSizeLamports.toNumber() * 0.5,
        );
        adjusted.useJitoBundles = false;
        adjusted.priorityFeeMicroLamports = Math.min(
          strategy.priorityFeeMicroLamports,
          STRATEGY_EXIT.priorityFeeMicroLamports,
        );
        break;

      case 'capitulation':
        // Halt: stop new launches, exit everything
        adjusted.buySellRatio = 0;
        adjusted.minIntervalSeconds = strategy.minIntervalSeconds * 3;
        adjusted.maxIntervalSeconds = strategy.maxIntervalSeconds * 3;
        adjusted.maxTrades = 0;
        adjusted.minTradeSizeLamports = new BN(0);
        adjusted.maxTradeSizeLamports = new BN(0);
        adjusted.useJitoBundles = false;
        break;
    }

    return adjusted;
  }

  /** Start continuous monitoring that emits events on regime changes. */
  startMonitoring(intervalMs: number): void {
    if (this.monitoringTimer) {
      this.logger.warn('Monitoring already running — restarting');
      this.stopMonitoring();
    }

    this.logger.info('Starting regime monitoring', { intervalMs });

    this.monitoringTimer = setInterval(async () => {
      try {
        const prev = this.lastClassification?.regime;
        const classification = await this.classifyRegime();

        if (prev && prev !== classification.regime) {
          this.logger.info('Regime change detected', {
            from: prev,
            to: classification.regime,
          });
          this.eventBus.emit(
            'intelligence:regime-change',
            'intelligence',
            'market-regime',
            {
              from: prev,
              to: classification.regime,
              classification,
            },
          );
        }
      } catch (err) {
        this.logger.error(
          'Regime monitoring tick failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }, intervalMs);
  }

  /** Stop continuous monitoring. */
  stopMonitoring(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
      this.logger.info('Regime monitoring stopped');
    }
  }

  /** Fetch raw data from all sources (uses cache if fresh). */
  async getDataSources(): Promise<RegimeDataSources> {
    const now = Date.now();
    if (this.cachedData && now - this.cacheTimestamp < this.config.cacheTtl) {
      return this.cachedData;
    }

    const [solPrice, fearGreed, defiTvl, pumpFun] = await Promise.allSettled([
      this.fetchSolPrice(),
      this.fetchFearGreed(),
      this.fetchDefiTvl(),
      this.fetchPumpFunActivity(),
    ]);

    const solPriceData =
      solPrice.status === 'fulfilled'
        ? solPrice.value
        : { price: 0, change24h: 0, change7d: 0 };
    const fearGreedData =
      fearGreed.status === 'fulfilled'
        ? fearGreed.value
        : { value: 50, classification: 'Neutral' };
    const defiTvlData =
      defiTvl.status === 'fulfilled'
        ? defiTvl.value
        : { current: 0, change7d: 0 };
    const pumpFunData =
      pumpFun.status === 'fulfilled'
        ? pumpFun.value
        : { launchesPerHour: 0, graduationRate: 0, avgMarketCap: 0 };

    // Log failures for observability
    if (solPrice.status === 'rejected') {
      this.logger.warn('SOL price fetch failed', {
        error: String(solPrice.reason),
      });
    }
    if (fearGreed.status === 'rejected') {
      this.logger.warn('Fear & Greed fetch failed', {
        error: String(fearGreed.reason),
      });
    }
    if (defiTvl.status === 'rejected') {
      this.logger.warn('DeFi TVL fetch failed', {
        error: String(defiTvl.reason),
      });
    }
    if (pumpFun.status === 'rejected') {
      this.logger.warn('Pump.fun fetch failed', {
        error: String(pumpFun.reason),
      });
    }

    // Derive meme index from pump.fun data
    const memeIndex = this.deriveMemeIndex(pumpFunData);

    const data: RegimeDataSources = {
      solPrice: solPriceData,
      fearGreed: fearGreedData,
      defiTvl: defiTvlData,
      pumpFunActivity: pumpFunData,
      memeIndex,
      fetchedAt: now,
    };

    this.cachedData = data;
    this.cacheTimestamp = now;
    return data;
  }

  // -----------------------------------------------------------------------
  // Data Fetchers (real APIs)
  // -----------------------------------------------------------------------

  private async fetchSolPrice(): Promise<{
    price: number;
    change24h: number;
    change7d: number;
  }> {
    const url = `https://api.jup.ag/price/v2?ids=${SOL_MINT}`;
    const resp = await this.fetchWithTimeout(url);
    const json = (await resp.json()) as JupiterPriceResponse;
    const priceStr = json.data[SOL_MINT]?.price;
    if (!priceStr) throw new Error('SOL price not found in Jupiter response');
    const price = parseFloat(priceStr);

    // Jupiter v2 only returns spot price. We derive change from cached history.
    const change24h = this.estimatePriceChange(price, 24);
    const change7d = this.estimatePriceChange(price, 168);

    return { price, change24h, change7d };
  }

  private async fetchFearGreed(): Promise<{
    value: number;
    classification: string;
  }> {
    const url = 'https://api.alternative.me/fng/?limit=7';
    const resp = await this.fetchWithTimeout(url);
    const json = (await resp.json()) as FearGreedResponse;
    const latest = json.data[0];
    if (!latest) throw new Error('No Fear & Greed data');
    return {
      value: parseInt(latest.value, 10),
      classification: latest.value_classification,
    };
  }

  private async fetchDefiTvl(): Promise<{
    current: number;
    change7d: number;
  }> {
    const url = 'https://api.llama.fi/v2/historicalChainTvl/Solana';
    const resp = await this.fetchWithTimeout(url);
    const json = (await resp.json()) as DefiLlamaTvlEntry[];
    if (!json.length) throw new Error('No DeFi TVL data');

    const sorted = json.sort((a, b) => b.date - a.date);
    const current = sorted[0].tvl;
    // Find entry closest to 7 days ago
    const sevenDaysAgo = Date.now() / 1000 - 7 * 86400;
    const weekAgoEntry = sorted.find((e) => e.date <= sevenDaysAgo);
    const change7d = weekAgoEntry
      ? ((current - weekAgoEntry.tvl) / weekAgoEntry.tvl) * 100
      : 0;

    return { current, change7d };
  }

  private async fetchPumpFunActivity(): Promise<{
    launchesPerHour: number;
    graduationRate: number;
    avgMarketCap: number;
  }> {
    const url =
      'https://frontend-api-v3.pump.fun/coins?sort=created_timestamp&order=desc&limit=50';
    const resp = await this.fetchWithTimeout(url);
    const coins = (await resp.json()) as PumpFunCoin[];
    if (!coins.length) throw new Error('No Pump.fun data');

    const now = Date.now();
    const oldest = Math.min(...coins.map((c) => c.created_timestamp));
    const timeSpanHours = Math.max((now - oldest) / 3_600_000, 0.01);
    const launchesPerHour = coins.length / timeSpanHours;

    const graduated = coins.filter((c) => c.complete === true);
    const graduationRate = coins.length > 0 ? graduated.length / coins.length : 0;

    const marketCaps = coins
      .map((c) => c.market_cap ?? 0)
      .filter((mc) => mc > 0);
    const avgMarketCap =
      marketCaps.length > 0
        ? marketCaps.reduce((sum, mc) => sum + mc, 0) / marketCaps.length
        : 0;

    return { launchesPerHour, graduationRate, avgMarketCap };
  }

  // -----------------------------------------------------------------------
  // Score Computation
  // -----------------------------------------------------------------------

  private buildFactors(sources: RegimeDataSources): RegimeFactor[] {
    const w = this.config.weights;

    return [
      {
        source: 'solPrice',
        value: sources.solPrice.change24h,
        normalizedScore: this.normalizeSolPrice(sources.solPrice.change24h),
        weight: w.solPrice,
        description: `SOL 24h change: ${sources.solPrice.change24h.toFixed(2)}%`,
      },
      {
        source: 'fearGreed',
        value: sources.fearGreed.value,
        normalizedScore: this.normalizeFearGreed(sources.fearGreed.value),
        weight: w.fearGreed,
        description: `Fear & Greed: ${sources.fearGreed.value} (${sources.fearGreed.classification})`,
      },
      {
        source: 'defiTvl',
        value: sources.defiTvl.change7d,
        normalizedScore: this.normalizeDefiTvl(sources.defiTvl.change7d),
        weight: w.defiTvl,
        description: `Solana TVL 7d change: ${sources.defiTvl.change7d.toFixed(2)}%`,
      },
      {
        source: 'pumpFunActivity',
        value: sources.pumpFunActivity.launchesPerHour,
        normalizedScore: this.normalizePumpFunActivity(
          sources.pumpFunActivity.launchesPerHour,
        ),
        weight: w.pumpFunActivity,
        description: `Pump.fun launches/hr: ${sources.pumpFunActivity.launchesPerHour.toFixed(1)}`,
      },
      {
        source: 'memeIndex',
        value: sources.memeIndex.score,
        normalizedScore: this.normalizeMemeIndex(sources.memeIndex.score),
        weight: w.memeIndex,
        description: `Meme index: ${sources.memeIndex.score.toFixed(2)}, trend: ${sources.memeIndex.trend}`,
      },
    ];
  }

  private computeWeightedScore(factors: RegimeFactor[]): number {
    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    const raw = factors.reduce(
      (s, f) => s + f.normalizedScore * f.weight,
      0,
    );
    // Scale to -100 … +100
    return totalWeight > 0 ? (raw / totalWeight) * 100 : 0;
  }

  private scoreToRegime(score: number): RegimeLabel {
    if (score > 60) return 'euphoria';
    if (score > 30) return 'bull';
    if (score > -10) return 'crab';
    if (score > -40) return 'bear';
    return 'capitulation';
  }

  // -----------------------------------------------------------------------
  // Normalizers  (-1 … +1)
  // -----------------------------------------------------------------------

  /** SOL price 24h change → normalized score */
  private normalizeSolPrice(change24h: number): number {
    if (change24h > 10) return 1;
    if (change24h > 5) return 0.5;
    if (change24h > -5) return change24h / 10; // smooth gradient in the middle
    if (change24h > -10) return -0.5;
    return -1;
  }

  /** Fear & Greed index (0-100) → normalized score */
  private normalizeFearGreed(value: number): number {
    return clamp((value - 50) / 50, -1, 1);
  }

  /** DeFi TVL 7d % change → normalized score */
  private normalizeDefiTvl(change7d: number): number {
    // ±20% maps to ±1
    return clamp(change7d / 20, -1, 1);
  }

  /** Pump.fun launches/hr → normalized score */
  private normalizePumpFunActivity(launchesPerHour: number): number {
    // Baseline ~30 launches/hr → 0; 100+ → +1; <5 → -1
    const baseline = 30;
    if (launchesPerHour >= 100) return 1;
    if (launchesPerHour <= 5) return -1;
    return clamp((launchesPerHour - baseline) / (100 - baseline), -1, 1);
  }

  /** Meme index (0-1) → normalized score */
  private normalizeMemeIndex(score: number): number {
    // 0.5 is neutral
    return clamp((score - 0.5) * 2, -1, 1);
  }

  // -----------------------------------------------------------------------
  // Confidence & Transition
  // -----------------------------------------------------------------------

  private computeConfidence(
    sources: RegimeDataSources,
    factors: RegimeFactor[],
  ): number {
    // Start at 1.0, degrade for issues
    let confidence = 1.0;

    // If any source returned defaults (failures), reduce confidence
    if (sources.solPrice.price === 0) confidence -= 0.2;
    if (sources.fearGreed.value === 50 && sources.fearGreed.classification === 'Neutral') {
      confidence -= 0.15;
    }
    if (sources.defiTvl.current === 0) confidence -= 0.15;
    if (
      sources.pumpFunActivity.launchesPerHour === 0 &&
      sources.pumpFunActivity.graduationRate === 0
    ) {
      confidence -= 0.2;
    }

    // If factors disagree strongly (high variance), lower confidence
    const scores = factors.map((f) => f.normalizedScore);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance =
      scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    if (variance > 0.5) confidence -= 0.15;

    // Data staleness penalty
    const age = Date.now() - sources.fetchedAt;
    if (age > 600_000) confidence -= 0.1; // > 10 min
    if (age > 1_800_000) confidence -= 0.2; // > 30 min

    return clamp(confidence, 0, 1);
  }

  /** Detect if we're transitioning between regimes. */
  private isTransitioning(currentRegime: RegimeLabel): boolean {
    if (!this.lastClassification) return false;
    if (this.lastClassification.regime === currentRegime) return false;
    return true;
  }

  /** Predict the likely next regime based on score trajectory. */
  private predictNextRegime(score: number): string {
    // Simple: use the score to suggest the next regime
    // If we're close to a boundary, we might be transitioning
    if (score > 50 && score <= 60) return 'euphoria';
    if (score > 20 && score <= 30) return 'bull';
    if (score > -20 && score <= -10) return 'bear';
    if (score > -50 && score <= -40) return 'capitulation';
    return this.scoreToRegime(score);
  }

  // -----------------------------------------------------------------------
  // Strategy Adjustments
  // -----------------------------------------------------------------------

  private buildStrategyAdjustments(regime: RegimeLabel): StrategyAdjustment[] {
    const base = STRATEGY_ORGANIC;
    const adjustments: StrategyAdjustment[] = [];

    switch (regime) {
      case 'euphoria':
        adjustments.push(
          {
            parameter: 'buySellRatio',
            currentValue: base.buySellRatio,
            adjustedValue: Math.min(0.95, base.buySellRatio + 0.15),
            reason: 'Euphoria: maximize buy pressure for rapid graduation',
          },
          {
            parameter: 'minIntervalSeconds',
            currentValue: base.minIntervalSeconds,
            adjustedValue: Math.max(5, Math.floor(base.minIntervalSeconds * 0.5)),
            reason: 'Euphoria: faster trading tempo',
          },
          {
            parameter: 'tradeSizeMultiplier',
            currentValue: '1x',
            adjustedValue: '2x',
            reason: 'Euphoria: double position sizes for momentum',
          },
          {
            parameter: 'strategy',
            currentValue: 'ORGANIC',
            adjustedValue: 'GRADUATION',
            reason: 'Euphoria: switch to aggressive graduation strategy',
          },
        );
        break;

      case 'bull':
        adjustments.push(
          {
            parameter: 'buySellRatio',
            currentValue: base.buySellRatio,
            adjustedValue: Math.min(0.85, base.buySellRatio + 0.05),
            reason: 'Bull: slightly increase buy bias',
          },
          {
            parameter: 'minIntervalSeconds',
            currentValue: base.minIntervalSeconds,
            adjustedValue: Math.max(10, Math.floor(base.minIntervalSeconds * 0.75)),
            reason: 'Bull: moderately faster cadence',
          },
          {
            parameter: 'strategy',
            currentValue: 'ORGANIC',
            adjustedValue: 'ORGANIC',
            reason: 'Bull: maintain organic strategy with optimistic bias',
          },
        );
        break;

      case 'crab':
        adjustments.push(
          {
            parameter: 'buySellRatio',
            currentValue: base.buySellRatio,
            adjustedValue: 0.5,
            reason: 'Crab: balanced buy/sell in sideways market',
          },
          {
            parameter: 'minIntervalSeconds',
            currentValue: base.minIntervalSeconds,
            adjustedValue: Math.floor(base.minIntervalSeconds * 1.5),
            reason: 'Crab: slower cadence to reduce costs',
          },
          {
            parameter: 'tradeSizeMultiplier',
            currentValue: '1x',
            adjustedValue: '0.7x',
            reason: 'Crab: reduce position sizes in low-volatility',
          },
        );
        break;

      case 'bear':
        adjustments.push(
          {
            parameter: 'buySellRatio',
            currentValue: base.buySellRatio,
            adjustedValue: Math.max(0.2, base.buySellRatio - 0.25),
            reason: 'Bear: heavy sell bias to reduce exposure',
          },
          {
            parameter: 'minIntervalSeconds',
            currentValue: base.minIntervalSeconds,
            adjustedValue: Math.floor(base.minIntervalSeconds * 2),
            reason: 'Bear: slow cadence, prefer exits',
          },
          {
            parameter: 'strategy',
            currentValue: 'ORGANIC',
            adjustedValue: 'EXIT',
            reason: 'Bear: switch to exit strategy for existing positions',
          },
          {
            parameter: 'tradeSizeMultiplier',
            currentValue: '1x',
            adjustedValue: '0.5x',
            reason: 'Bear: halve position sizes',
          },
        );
        break;

      case 'capitulation':
        adjustments.push(
          {
            parameter: 'buySellRatio',
            currentValue: base.buySellRatio,
            adjustedValue: 0,
            reason: 'Capitulation: halt all buying, sell everything',
          },
          {
            parameter: 'maxTrades',
            currentValue: base.maxTrades ?? 'unlimited',
            adjustedValue: 0,
            reason: 'Capitulation: no new trades allowed',
          },
          {
            parameter: 'strategy',
            currentValue: 'ORGANIC',
            adjustedValue: 'HALT',
            reason: 'Capitulation: halt all activity, preserve capital',
          },
        );
        break;
    }

    return adjustments;
  }

  // -----------------------------------------------------------------------
  // History
  // -----------------------------------------------------------------------

  private recordHistory(classification: RegimeClassification): void {
    const now = Date.now();

    // Close previous entry if regime changed
    if (this.history.length > 0) {
      const latest = this.history[0];
      if (latest.regime !== classification.regime && !latest.endedAt) {
        latest.endedAt = now;
        latest.duration = now - latest.startedAt;
      }
    }

    // Add new entry if regime changed or first entry
    if (
      this.history.length === 0 ||
      this.history[0].regime !== classification.regime
    ) {
      this.history.unshift({
        regime: classification.regime,
        startedAt: now,
        duration: 0,
        sentimentScore: classification.sentimentScore,
        factors: classification.factors,
      });

      // Keep last 100 entries
      if (this.history.length > 100) {
        this.history = this.history.slice(0, 100);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Meme Index Derivation
  // -----------------------------------------------------------------------

  /** Derive a meme market index from pump.fun data. */
  private deriveMemeIndex(pumpFun: {
    launchesPerHour: number;
    graduationRate: number;
    avgMarketCap: number;
  }): { score: number; trend: 'up' | 'down' | 'flat' } {
    // Composite score: graduation rate (40%), activity (30%), avg mcap (30%)
    const activityScore = clamp(pumpFun.launchesPerHour / 100, 0, 1);
    const gradScore = clamp(pumpFun.graduationRate * 5, 0, 1); // 20% grad rate → 1.0
    const mcapScore = clamp(pumpFun.avgMarketCap / 100_000, 0, 1); // $100k avg → 1.0

    const score = gradScore * 0.4 + activityScore * 0.3 + mcapScore * 0.3;

    // Determine trend from history
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (this.cachedData) {
      const prevScore = this.cachedData.memeIndex.score;
      const delta = score - prevScore;
      if (delta > 0.05) trend = 'up';
      else if (delta < -0.05) trend = 'down';
    }

    return { score, trend };
  }

  // -----------------------------------------------------------------------
  // Price Change Estimation
  // -----------------------------------------------------------------------

  /** Estimate price change from cached history or return 0. */
  private estimatePriceChange(_price: number, _hoursAgo: number): number {
    // If we have cached data with a price, compute % change
    if (this.cachedData && this.cachedData.solPrice.price > 0) {
      const prevPrice = this.cachedData.solPrice.price;
      if (prevPrice > 0) {
        return ((_price - prevPrice) / prevPrice) * 100;
      }
    }
    return 0;
  }

  // -----------------------------------------------------------------------
  // HTTP Helper
  // -----------------------------------------------------------------------

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number = FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'crypto-vision-market-regime/1.0',
        },
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} from ${url}`);
      }
      return resp;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}
