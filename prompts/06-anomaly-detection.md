# Prompt 06: Real-Time Anomaly Detection Engine

## Agent Identity & Rules

```
You are building the real-time anomaly detection engine for Crypto Vision.
- Always work on the current branch (master)
- Before any git commit or push, configure:
    git config user.name "nirholas"
    git config user.email "nirholas@users.noreply.github.com"
- Always use background terminals (isBackground: true)
- Always kill terminals after commands complete
- We have unlimited Claude credits — build the best possible version
- Every function must do real work — no mocks, stubs, or TODOs
- No `any` types, no `@ts-ignore`, strict TypeScript throughout
```

## Objective

Build a statistical anomaly detection engine that monitors all incoming crypto data streams (prices, volumes, TVL, gas, funding rates, whale movements, etc.) and fires alerts in real time. Anomalies are detected using multiple statistical methods (Modified Z-Score, EWMA, sliding windows) without requiring ML model training — pure math, instant deployment.

## Budget: $5k

- BigQuery for anomaly storage: ~$2k
- Cloud Run compute for processing: ~$2k
- Pub/Sub for alert distribution: ~$1k

## Current State

- 26+ data source modules in `src/sources/`
- WebSocket infrastructure in `src/lib/ws.ts` (price throttling, topic-based broadcast)
- Cache layer in `src/lib/cache.ts` (Redis or in-memory)
- Queue system in `src/lib/queue.ts` (concurrent AI request management)
- Pub/Sub publisher from Prompt 02 (`src/lib/pubsub.ts`)
- BigQuery client from Prompt 01 (`src/lib/bigquery.ts`)

## Deliverables

### 1. Anomaly Detection Engine (`src/lib/anomaly.ts`)

```typescript
// src/lib/anomaly.ts — Statistical anomaly detection engine

import { cache } from "./cache.js";
import { log } from "./logger.js";

// --- Types ---

export interface AnomalyEvent {
  id: string;
  type: AnomalyType;
  severity: "info" | "warning" | "critical";
  asset: string;
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviation: number;
  percentChange: number;
  message: string;
  detectedAt: string;
  metadata: Record<string, unknown>;
}

export type AnomalyType =
  | "price_spike"
  | "price_crash"
  | "volume_surge"
  | "volume_drop"
  | "tvl_drain"
  | "tvl_surge"
  | "gas_spike"
  | "whale_movement"
  | "stablecoin_depeg"
  | "liquidity_removal"
  | "funding_rate_extreme"
  | "open_interest_surge"
  | "exchange_inflow"
  | "exchange_outflow"
  | "correlation_break"
  | "volatility_spike";

// --- Sliding Window ---

class SlidingWindow {
  private values: number[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.maxSize) {
      this.values.shift();
    }
  }

  get length(): number { return this.values.length; }
  get data(): readonly number[] { return this.values; }
  get isFull(): boolean { return this.values.length >= this.maxSize; }

  mean(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }

  median(): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  mad(): number {
    const med = this.median();
    const absDevs = this.values.map(v => Math.abs(v - med));
    const sortedDevs = absDevs.sort((a, b) => a - b);
    const midDev = Math.floor(sortedDevs.length / 2);
    return sortedDevs.length % 2
      ? sortedDevs[midDev]
      : (sortedDevs[midDev - 1] + sortedDevs[midDev]) / 2;
  }

  stdDev(): number {
    if (this.values.length < 2) return 0;
    const m = this.mean();
    const variance = this.values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (this.values.length - 1);
    return Math.sqrt(variance);
  }

  modifiedZScore(value: number): number {
    const med = this.median();
    const madVal = this.mad();
    if (madVal === 0) return 0;
    return 0.6745 * (value - med) / madVal;
  }
}

// --- EWMA Tracker ---

class EWMATracker {
  private ewma: number | null = null;
  private ewmaVariance: number = 0;
  private readonly alpha: number;

  constructor(alpha = 0.1) {
    this.alpha = alpha;
  }

  update(value: number): { mean: number; stdDev: number } {
    if (this.ewma === null) {
      this.ewma = value;
      this.ewmaVariance = 0;
      return { mean: value, stdDev: 0 };
    }

    const diff = value - this.ewma;
    this.ewma = this.alpha * value + (1 - this.alpha) * this.ewma;
    this.ewmaVariance = (1 - this.alpha) * (this.ewmaVariance + this.alpha * diff * diff);

    return {
      mean: this.ewma,
      stdDev: Math.sqrt(this.ewmaVariance),
    };
  }

  get current(): number | null { return this.ewma; }
}

// --- Detector Config ---

interface DetectorConfig {
  windowSize: number;
  zScoreThreshold: number;
  cooldownMs: number;
  ewmaAlpha: number;
  minDataPoints: number;
  severityFn: (deviation: number) => AnomalyEvent["severity"];
}

const DEFAULT_CONFIG: DetectorConfig = {
  windowSize: 100,
  zScoreThreshold: 3.5,
  cooldownMs: 300_000,
  ewmaAlpha: 0.1,
  minDataPoints: 20,
  severityFn: (dev) => {
    if (Math.abs(dev) > 6) return "critical";
    if (Math.abs(dev) > 4.5) return "warning";
    return "info";
  },
};

const TYPE_CONFIGS: Partial<Record<AnomalyType, Partial<DetectorConfig>>> = {
  price_spike:          { zScoreThreshold: 3.5, cooldownMs: 300_000 },
  price_crash:          { zScoreThreshold: 3.5, cooldownMs: 300_000 },
  volume_surge:         { zScoreThreshold: 4.0, cooldownMs: 600_000, windowSize: 50 },
  volume_drop:          { zScoreThreshold: 4.0, cooldownMs: 600_000, windowSize: 50 },
  tvl_drain:            { zScoreThreshold: 3.0, cooldownMs: 900_000, windowSize: 48 },
  tvl_surge:            { zScoreThreshold: 3.0, cooldownMs: 900_000, windowSize: 48 },
  gas_spike:            { zScoreThreshold: 4.0, cooldownMs: 120_000, windowSize: 100 },
  whale_movement:       { zScoreThreshold: 3.0, cooldownMs: 60_000, windowSize: 200 },
  stablecoin_depeg:     { zScoreThreshold: 2.5, cooldownMs: 60_000, windowSize: 200 },
  liquidity_removal:    { zScoreThreshold: 3.0, cooldownMs: 600_000 },
  funding_rate_extreme: { zScoreThreshold: 3.5, cooldownMs: 300_000 },
  open_interest_surge:  { zScoreThreshold: 4.0, cooldownMs: 300_000 },
  exchange_inflow:      { zScoreThreshold: 3.5, cooldownMs: 600_000 },
  exchange_outflow:     { zScoreThreshold: 3.5, cooldownMs: 600_000 },
  correlation_break:    { zScoreThreshold: 3.0, cooldownMs: 1_800_000, windowSize: 200 },
  volatility_spike:     { zScoreThreshold: 4.0, cooldownMs: 300_000 },
};

// --- Main Engine ---

type AnomalyListener = (event: AnomalyEvent) => void;

export class AnomalyEngine {
  private windows: Map<string, SlidingWindow> = new Map();
  private ewmas: Map<string, EWMATracker> = new Map();
  private lastAlert: Map<string, number> = new Map();
  private listeners: AnomalyListener[] = [];
  private recentAnomalies: AnomalyEvent[] = [];
  private readonly maxRecentAnomalies = 1000;

  onAnomaly(listener: AnomalyListener): void {
    this.listeners.push(listener);
  }

  private getConfig(type: AnomalyType): DetectorConfig {
    return { ...DEFAULT_CONFIG, ...TYPE_CONFIGS[type] };
  }

  private getKey(asset: string, metric: string): string {
    return `${asset}:${metric}`;
  }

  ingest(
    asset: string,
    metric: string,
    value: number,
    type: AnomalyType,
    metadata: Record<string, unknown> = {}
  ): AnomalyEvent | null {
    const key = this.getKey(asset, metric);
    const config = this.getConfig(type);

    if (!this.windows.has(key)) {
      this.windows.set(key, new SlidingWindow(config.windowSize));
    }
    const window = this.windows.get(key)!;

    if (!this.ewmas.has(key)) {
      this.ewmas.set(key, new EWMATracker(config.ewmaAlpha));
    }
    const ewma = this.ewmas.get(key)!;

    const ewmaResult = ewma.update(value);

    if (window.length < config.minDataPoints) {
      window.push(value);
      return null;
    }

    const zScore = window.modifiedZScore(value);
    window.push(value);

    if (Math.abs(zScore) < config.zScoreThreshold) {
      return null;
    }

    const cooldownKey = `${key}:${type}`;
    const lastAlertTime = this.lastAlert.get(cooldownKey) || 0;
    if (Date.now() - lastAlertTime < config.cooldownMs) {
      return null;
    }

    const expectedValue = ewmaResult.mean;
    const percentChange = expectedValue !== 0
      ? ((value - expectedValue) / expectedValue) * 100
      : 0;

    const event: AnomalyEvent = {
      id: `anomaly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      severity: config.severityFn(zScore),
      asset,
      metric,
      currentValue: value,
      expectedValue,
      deviation: zScore,
      percentChange,
      message: this.formatMessage(type, asset, metric, value, expectedValue, percentChange, zScore),
      detectedAt: new Date().toISOString(),
      metadata: { ...metadata, zScore, windowSize: window.length },
    };

    this.lastAlert.set(cooldownKey, Date.now());
    this.recentAnomalies.unshift(event);
    if (this.recentAnomalies.length > this.maxRecentAnomalies) {
      this.recentAnomalies.pop();
    }

    for (const listener of this.listeners) {
      try { listener(event); } catch (err) {
        log.error("Anomaly listener error", err);
      }
    }

    return event;
  }

  getRecent(limit = 50, type?: AnomalyType, severity?: AnomalyEvent["severity"]): AnomalyEvent[] {
    let results = this.recentAnomalies;
    if (type) results = results.filter(a => a.type === type);
    if (severity) results = results.filter(a => a.severity === severity);
    return results.slice(0, limit);
  }

  getStats(): {
    totalDetected: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    trackedMetrics: number;
  } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const a of this.recentAnomalies) {
      byType[a.type] = (byType[a.type] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
    }
    return {
      totalDetected: this.recentAnomalies.length,
      byType,
      bySeverity,
      trackedMetrics: this.windows.size,
    };
  }

  async saveState(): Promise<void> {
    const state: Record<string, number[]> = {};
    for (const [key, window] of this.windows) {
      state[key] = [...window.data];
    }
    await cache.set("anomaly:state", JSON.stringify(state), 86400);
  }

  async loadState(): Promise<void> {
    const raw = await cache.get("anomaly:state");
    if (!raw) return;
    try {
      const state = JSON.parse(raw as string) as Record<string, number[]>;
      for (const [key, values] of Object.entries(state)) {
        const window = new SlidingWindow(DEFAULT_CONFIG.windowSize);
        for (const v of values) window.push(v);
        this.windows.set(key, window);
      }
      log.info(`Restored anomaly state: ${Object.keys(state).length} metrics`);
    } catch (err) {
      log.error("Failed to restore anomaly state", err);
    }
  }

  private formatMessage(
    type: AnomalyType,
    asset: string,
    _metric: string,
    current: number,
    _expected: number,
    percentChange: number,
    zScore: number,
  ): string {
    const direction = percentChange > 0 ? "up" : "down";
    const pct = Math.abs(percentChange).toFixed(1);
    const z = Math.abs(zScore).toFixed(1);

    const messages: Record<AnomalyType, string> = {
      price_spike: `${asset} price spiked ${pct}% (${z}s deviation)`,
      price_crash: `${asset} price crashed ${pct}% (${z}s deviation)`,
      volume_surge: `${asset} volume surged ${pct}% above normal (${z}s)`,
      volume_drop: `${asset} volume dropped ${pct}% below normal (${z}s)`,
      tvl_drain: `${asset} TVL drained ${pct}% (${z}s deviation)`,
      tvl_surge: `${asset} TVL surged ${pct}% (${z}s deviation)`,
      gas_spike: `Gas prices spiked ${pct}% on ${asset} (${z}s)`,
      whale_movement: `Large ${asset} whale movement detected: ${direction} ${pct}% (${z}s)`,
      stablecoin_depeg: `${asset} depeg alert: ${pct}% deviation from peg (${z}s)`,
      liquidity_removal: `${asset} liquidity removed: ${pct}% drop (${z}s)`,
      funding_rate_extreme: `${asset} funding rate extreme: ${current.toFixed(4)} (${z}s)`,
      open_interest_surge: `${asset} open interest surged ${pct}% (${z}s)`,
      exchange_inflow: `Large ${asset} exchange inflow: ${pct}% above normal (${z}s)`,
      exchange_outflow: `Large ${asset} exchange outflow: ${pct}% above normal (${z}s)`,
      correlation_break: `${asset} correlation break detected: ${pct}% divergence (${z}s)`,
      volatility_spike: `${asset} volatility spiked ${pct}% (${z}s)`,
    };

    return messages[type] || `${asset} anomaly: ${direction} ${pct}% (${z}s)`;
  }
}

// Singleton
export const anomalyEngine = new AnomalyEngine();
```

### 2. Anomaly Processors (`src/lib/anomaly-processors.ts`)

Hook the anomaly engine into existing data source fetch functions:

```typescript
// src/lib/anomaly-processors.ts
// Processors that ingest data from existing sources into the anomaly engine

import { anomalyEngine, AnomalyType } from "./anomaly.js";

// --- Price Anomaly Processor ---

export function processMarketData(coins: Array<{
  id: string;
  current_price?: number;
  total_volume?: number;
  price_change_percentage_24h?: number;
  market_cap?: number;
}>): void {
  for (const coin of coins) {
    if (coin.current_price != null) {
      const priceType: AnomalyType = (coin.price_change_percentage_24h ?? 0) > 0
        ? "price_spike" : "price_crash";
      anomalyEngine.ingest(coin.id, "price", coin.current_price, priceType, {
        marketCap: coin.market_cap,
        change24h: coin.price_change_percentage_24h,
      });
    }

    if (coin.total_volume != null) {
      const volType: AnomalyType = (coin.total_volume ?? 0) > 0
        ? "volume_surge" : "volume_drop";
      anomalyEngine.ingest(coin.id, "volume_24h", coin.total_volume, volType, {
        marketCap: coin.market_cap,
      });
    }
  }
}

// --- DeFi TVL Processor ---

export function processProtocolTVL(protocols: Array<{
  name: string;
  slug?: string;
  tvl?: number;
  change_1d?: number;
}>): void {
  for (const protocol of protocols) {
    if (protocol.tvl != null) {
      const tvlType: AnomalyType = (protocol.change_1d ?? 0) < -10
        ? "tvl_drain" : "tvl_surge";
      anomalyEngine.ingest(
        protocol.slug || protocol.name,
        "tvl",
        protocol.tvl,
        tvlType,
        { change1d: protocol.change_1d }
      );
    }
  }
}

// --- Gas Price Processor ---

export function processGasPrices(chain: string, gasPriceGwei: number): void {
  anomalyEngine.ingest(chain, "gas_price_gwei", gasPriceGwei, "gas_spike");
}

// --- Funding Rate Processor ---

export function processFundingRates(rates: Array<{
  symbol: string;
  fundingRate: number;
  openInterest?: number;
}>): void {
  for (const rate of rates) {
    anomalyEngine.ingest(
      rate.symbol,
      "funding_rate",
      rate.fundingRate,
      "funding_rate_extreme"
    );

    if (rate.openInterest != null) {
      anomalyEngine.ingest(
        rate.symbol,
        "open_interest",
        rate.openInterest,
        "open_interest_surge"
      );
    }
  }
}

// --- Stablecoin Depeg Processor ---

export function processStablecoinPrices(stablecoins: Array<{
  id: string;
  price: number;
  pegTarget?: number;
}>): void {
  for (const coin of stablecoins) {
    const deviation = Math.abs(coin.price - (coin.pegTarget || 1.0));
    if (deviation > 0.001) {
      anomalyEngine.ingest(
        coin.id,
        "peg_deviation",
        deviation,
        "stablecoin_depeg",
        { actualPrice: coin.price, pegTarget: coin.pegTarget || 1.0 }
      );
    }
  }
}

// --- Whale Movement Processor ---

export function processWhaleMovement(asset: string, amountUsd: number, direction: "in" | "out"): void {
  const type: AnomalyType = direction === "in" ? "exchange_inflow" : "exchange_outflow";
  anomalyEngine.ingest(asset, `whale_${direction}flow_usd`, amountUsd, type, { direction });
  anomalyEngine.ingest(asset, "whale_movement_usd", amountUsd, "whale_movement", { direction });
}
```

### 3. Anomaly API Routes (`src/routes/anomalies.ts`)

```typescript
// src/routes/anomalies.ts
// GET  /api/anomalies          - List recent anomalies
// GET  /api/anomalies/stats    - Anomaly detection statistics
// GET  /api/anomalies/stream   - SSE stream of real-time anomalies

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { anomalyEngine } from "../lib/anomaly.js";

export const anomalyRoutes = new Hono();

anomalyRoutes.get("/", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
  const type = c.req.query("type") as any;
  const severity = c.req.query("severity") as any;

  const anomalies = anomalyEngine.getRecent(limit, type, severity);

  return c.json({
    data: anomalies,
    total: anomalies.length,
    timestamp: new Date().toISOString(),
  });
});

anomalyRoutes.get("/stats", (c) => {
  return c.json({
    data: anomalyEngine.getStats(),
    timestamp: new Date().toISOString(),
  });
});

anomalyRoutes.get("/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const controller = new AbortController();

    const listener = (event: any) => {
      stream.writeSSE({
        event: event.severity,
        data: JSON.stringify(event),
        id: event.id,
      }).catch(() => controller.abort());
    };

    anomalyEngine.onAnomaly(listener);

    const keepAlive = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "" }).catch(() => controller.abort());
    }, 30_000);

    await new Promise<void>((resolve) => {
      controller.signal.addEventListener("abort", resolve);
      stream.onAbort(resolve);
    });

    clearInterval(keepAlive);
  });
});
```

### 4. Wire Into Main App

```typescript
// In src/index.ts
import { anomalyRoutes } from "@/routes/anomalies";

app.route("/api/anomalies", anomalyRoutes);
```

### 5. BigQuery Anomaly Table

```sql
CREATE TABLE crypto_vision.anomaly_events (
  id STRING NOT NULL,
  type STRING NOT NULL,
  severity STRING NOT NULL,
  asset STRING NOT NULL,
  metric STRING NOT NULL,
  current_value FLOAT64,
  expected_value FLOAT64,
  deviation FLOAT64,
  percent_change FLOAT64,
  message STRING,
  detected_at TIMESTAMP NOT NULL,
  metadata JSON
)
PARTITION BY DATE(detected_at)
CLUSTER BY type, severity, asset;
```

### 6. BigQuery Persistence Listener

```typescript
// Add to anomaly engine initialization (e.g., in src/index.ts or a startup file)

import { insertRows } from "./lib/bigquery.js";
import { anomalyEngine } from "./lib/anomaly.js";
import { broadcast } from "./lib/ws.js";

// Persist anomalies to BigQuery
anomalyEngine.onAnomaly((event) => {
  insertRows("anomaly_events", [{
    id: event.id,
    type: event.type,
    severity: event.severity,
    asset: event.asset,
    metric: event.metric,
    current_value: event.currentValue,
    expected_value: event.expectedValue,
    deviation: event.deviation,
    percent_change: event.percentChange,
    message: event.message,
    detected_at: event.detectedAt,
    metadata: JSON.stringify(event.metadata),
  }]).catch(() => {});
});

// Broadcast anomalies via WebSocket
anomalyEngine.onAnomaly((event) => {
  broadcast("alerts", {
    type: "anomaly",
    data: event,
  });
});

// Restore state on startup
anomalyEngine.loadState().catch(() => {});

// Save state periodically (every 5 minutes)
setInterval(() => {
  anomalyEngine.saveState().catch(() => {});
}, 300_000);
```

### 7. Integration Points

Wire processors into existing source fetch calls:

```typescript
// Example: in the market data route handler or scheduled job
import { processMarketData } from "../lib/anomaly-processors.js";

// After fetching CoinGecko market data:
const coins = await coingecko.getMarkets({ vs_currency: "usd", per_page: 100 });
processMarketData(coins);

// After fetching DeFiLlama protocols:
const protocols = await defillama.getProtocols({});
processProtocolTVL(protocols);

// After fetching gas prices:
const gas = await getGasPrices("ethereum");
processGasPrices("ethereum", gas.fast);

// After fetching funding rates:
const rates = await getFundingRates();
processFundingRates(rates);
```

## Validation

1. `anomalyEngine.ingest("bitcoin", "price", 50000, "price_spike")` accumulates, no alert (insufficient data)
2. After 20+ ingestions with stable data, a spike value triggers an anomaly event
3. `anomalyEngine.getRecent()` returns list of recent anomalies
4. `anomalyEngine.getStats()` returns breakdown by type and severity
5. Cooldown prevents duplicate alerts within configured period
6. `/api/anomalies` returns JSON with anomaly list
7. `/api/anomalies/stream` returns SSE stream (test with `curl -N`)
8. BigQuery persistence fires on anomaly detection
9. WebSocket broadcast sends anomaly to connected clients on "alerts" topic
10. `npx tsc --noEmit` passes
11. Modified Z-Score correctly identifies outliers vs. normal variation
12. EWMA provides reasonable expected values after 20+ data points

## GCP Services

- BigQuery: anomaly_events table (~$2k for writes over 6 months)
- Pub/Sub: alert distribution to downstream consumers
- Cloud Run: included in existing compute
