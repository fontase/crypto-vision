/**
 * Metrics Collection & Reporting
 *
 * In-process metrics system for the pump-agent swarm. Tracks counters,
 * gauges, histograms, and rates with label support. Exports to
 * Prometheus text format and JSON for the dashboard.
 *
 * @example
 * ```typescript
 * import { MetricsCollector } from './infra/metrics.js';
 *
 * const metrics = MetricsCollector.getInstance();
 * const trades = metrics.counter('swarm.trades.total', { direction: 'buy', status: 'success' });
 * trades.inc();
 *
 * const latency = metrics.histogram('swarm.trades.latency_ms');
 * latency.observe(42);
 *
 * console.log(metrics.toPrometheus());
 * console.log(JSON.stringify(metrics.toJSON(), null, 2));
 * ```
 */

// ─── Types ────────────────────────────────────────────────────

export interface MetricSnapshot {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'rate';
  labels: Record<string, string>;
  value:
    | number
    | {
        count: number;
        sum: number;
        avg: number;
        min: number;
        max: number;
        p50: number;
        p95: number;
        p99: number;
      };
  updatedAt: number;
}

// ─── Counter ──────────────────────────────────────────────────

/**
 * Monotonically increasing counter.
 * Use for totals: trades executed, errors observed, bytes transferred, etc.
 */
export class Counter {
  readonly name: string;
  readonly labels: Record<string, string>;
  private _value = 0;
  private _updatedAt = Date.now();

  constructor(name: string, labels: Record<string, string> = {}) {
    this.name = name;
    this.labels = Object.freeze({ ...labels });
  }

  /** Increment by `value` (default: 1). Value must be positive. */
  inc(value = 1): void {
    if (value < 0) throw new Error(`Counter.inc() value must be non-negative, got ${value}`);
    this._value += value;
    this._updatedAt = Date.now();
  }

  /** Current counter value */
  get(): number {
    return this._value;
  }

  /** Reset to zero (mainly for testing) */
  reset(): void {
    this._value = 0;
    this._updatedAt = Date.now();
  }

  snapshot(): MetricSnapshot {
    return {
      name: this.name,
      type: 'counter',
      labels: this.labels,
      value: this._value,
      updatedAt: this._updatedAt,
    };
  }
}

// ─── Gauge ────────────────────────────────────────────────────

/**
 * Value that can go up or down.
 * Use for current state: active wallets, SOL balance, phase encoding, etc.
 */
export class Gauge {
  readonly name: string;
  readonly labels: Record<string, string>;
  private _value = 0;
  private _updatedAt = Date.now();

  constructor(name: string, labels: Record<string, string> = {}) {
    this.name = name;
    this.labels = Object.freeze({ ...labels });
  }

  /** Set the gauge to an arbitrary value */
  set(value: number): void {
    this._value = value;
    this._updatedAt = Date.now();
  }

  /** Increment by `value` (default: 1) */
  inc(value = 1): void {
    this._value += value;
    this._updatedAt = Date.now();
  }

  /** Decrement by `value` (default: 1) */
  dec(value = 1): void {
    this._value -= value;
    this._updatedAt = Date.now();
  }

  /** Current gauge value */
  get(): number {
    return this._value;
  }

  /** Reset to zero */
  reset(): void {
    this._value = 0;
    this._updatedAt = Date.now();
  }

  snapshot(): MetricSnapshot {
    return {
      name: this.name,
      type: 'gauge',
      labels: this.labels,
      value: this._value,
      updatedAt: this._updatedAt,
    };
  }
}

// ─── Histogram ────────────────────────────────────────────────

/**
 * Distribution of observed values with percentile calculation.
 *
 * Keeps all observations in memory (bounded by the observations array).
 * For long-running processes, consider periodic resets or a fixed-size
 * circular buffer extension.
 */
export class Histogram {
  readonly name: string;
  readonly labels: Record<string, string>;
  readonly buckets: readonly number[];

  private _observations: number[] = [];
  private _count = 0;
  private _sum = 0;
  private _min = Infinity;
  private _max = -Infinity;
  private _bucketCounts: number[];
  private _updatedAt = Date.now();
  private _sorted = true;

  /** Maximum observations to retain before compacting (256k) */
  private static readonly MAX_OBSERVATIONS = 262_144;

  constructor(
    name: string,
    buckets: number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    labels: Record<string, string> = {},
  ) {
    this.name = name;
    this.labels = Object.freeze({ ...labels });
    // Sort and deduplicate buckets
    this.buckets = Object.freeze([...new Set(buckets)].sort((a, b) => a - b));
    this._bucketCounts = new Array(this.buckets.length).fill(0) as number[];
  }

  /** Record an observation */
  observe(value: number): void {
    this._observations.push(value);
    this._count++;
    this._sum += value;
    if (value < this._min) this._min = value;
    if (value > this._max) this._max = value;
    this._sorted = false;

    // Increment bucket counts
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        this._bucketCounts[i]++;
      }
    }

    this._updatedAt = Date.now();

    // Compact if we've exceeded the max observation count
    if (this._observations.length > Histogram.MAX_OBSERVATIONS) {
      this.compact();
    }
  }

  /** Get the full histogram stats including percentiles */
  get(): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    if (this._count === 0) {
      return { count: 0, sum: 0, avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    }

    this.ensureSorted();

    return {
      count: this._count,
      sum: this._sum,
      avg: this._sum / this._count,
      min: this._min,
      max: this._max,
      p50: this.percentile(0.5),
      p95: this.percentile(0.95),
      p99: this.percentile(0.99),
    };
  }

  /** Reset all observations */
  reset(): void {
    this._observations = [];
    this._count = 0;
    this._sum = 0;
    this._min = Infinity;
    this._max = -Infinity;
    this._bucketCounts = new Array(this.buckets.length).fill(0) as number[];
    this._sorted = true;
    this._updatedAt = Date.now();
  }

  snapshot(): MetricSnapshot {
    return {
      name: this.name,
      type: 'histogram',
      labels: this.labels,
      value: this.get(),
      updatedAt: this._updatedAt,
    };
  }

  /** Calculate a percentile (0-1) from sorted observations */
  private percentile(p: number): number {
    this.ensureSorted();
    const n = this._observations.length;
    if (n === 0) return 0;
    if (n === 1) return this._observations[0];

    const rank = p * (n - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const frac = rank - lower;

    if (lower === upper) return this._observations[lower];
    return this._observations[lower] * (1 - frac) + this._observations[upper] * frac;
  }

  /** Sort observations if needed */
  private ensureSorted(): void {
    if (!this._sorted) {
      this._observations.sort((a, b) => a - b);
      this._sorted = true;
    }
  }

  /**
   * Compact observations to prevent unbounded memory growth.
   * Retains the last half of the sorted observations.
   */
  private compact(): void {
    this.ensureSorted();
    const keepCount = Math.floor(this._observations.length / 2);
    this._observations = this._observations.slice(-keepCount);
    this._sorted = true;
  }
}

// ─── Rate ─────────────────────────────────────────────────────

/**
 * Events-per-second rate using a sliding window.
 *
 * Internally stores timestamps of events in the window. `get()`
 * returns the number of events in the window divided by the window
 * duration in seconds.
 */
export class Rate {
  readonly name: string;
  readonly labels: Record<string, string>;
  readonly windowMs: number;

  private _timestamps: number[] = [];
  private _updatedAt = Date.now();

  constructor(
    name: string,
    windowMs = 60_000,
    labels: Record<string, string> = {},
  ) {
    this.name = name;
    this.windowMs = windowMs;
    this.labels = Object.freeze({ ...labels });
  }

  /** Mark one event occurrence */
  mark(): void {
    const now = Date.now();
    this._timestamps.push(now);
    this._updatedAt = now;
    this.prune(now);
  }

  /** Current rate: events per second in the window */
  get(): number {
    const now = Date.now();
    this.prune(now);
    if (this._timestamps.length === 0) return 0;
    return this._timestamps.length / (this.windowMs / 1_000);
  }

  /** Reset */
  reset(): void {
    this._timestamps = [];
    this._updatedAt = Date.now();
  }

  snapshot(): MetricSnapshot {
    return {
      name: this.name,
      type: 'rate',
      labels: this.labels,
      value: this.get(),
      updatedAt: this._updatedAt,
    };
  }

  /** Remove timestamps outside the sliding window */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    // Binary search for cutoff point for efficiency
    let lo = 0;
    let hi = this._timestamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._timestamps[mid] < cutoff) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      this._timestamps = this._timestamps.slice(lo);
    }
  }
}

// ─── Label Key Helper ─────────────────────────────────────────

/**
 * Generate a unique registry key from metric name + labels.
 * Ensures metrics with different labels are stored separately.
 */
function metricKey(name: string, labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return name;
  const labelStr = entries.map(([k, v]) => `${k}="${v}"`).join(',');
  return `${name}{${labelStr}}`;
}

// ─── Prometheus Format Helpers ────────────────────────────────

function escapePrometheusLabel(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function sanitizePrometheusName(name: string): string {
  // Prometheus metric names: [a-zA-Z_:][a-zA-Z0-9_:]*
  return name.replace(/[^a-zA-Z0-9_:]/g, '_').replace(/^([^a-zA-Z_:])/, '_$1');
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const parts = entries.map(
    ([k, v]) => `${sanitizePrometheusName(k)}="${escapePrometheusLabel(v)}"`,
  );
  return `{${parts.join(',')}}`;
}

// ─── Metric Union Type ───────────────────────────────────────

type AnyMetric = Counter | Gauge | Histogram | Rate;

// ─── MetricsCollector (Singleton) ─────────────────────────────

/**
 * Central metrics registry. Singleton per process.
 *
 * Provides factory methods for creating metrics and export methods
 * for Prometheus text format and JSON.
 */
export class MetricsCollector {
  private static _instance: MetricsCollector | undefined;

  private readonly _registry = new Map<string, AnyMetric>();
  private readonly _startTime = Date.now();

  private constructor() {
    this.registerPredefinedMetrics();
  }

  /** Get or create the singleton instance */
  static getInstance(): MetricsCollector {
    if (!MetricsCollector._instance) {
      MetricsCollector._instance = new MetricsCollector();
    }
    return MetricsCollector._instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    MetricsCollector._instance = undefined;
  }

  // ── Factory Methods ─────────────────────────────────────────

  /** Get or create a counter */
  counter(name: string, labels: Record<string, string> = {}): Counter {
    const key = metricKey(name, labels);
    const existing = this._registry.get(key);
    if (existing) {
      if (!(existing instanceof Counter)) {
        throw new Error(`Metric "${name}" already registered as ${existing.constructor.name}, not Counter`);
      }
      return existing;
    }
    const c = new Counter(name, labels);
    this._registry.set(key, c);
    return c;
  }

  /** Get or create a gauge */
  gauge(name: string, labels: Record<string, string> = {}): Gauge {
    const key = metricKey(name, labels);
    const existing = this._registry.get(key);
    if (existing) {
      if (!(existing instanceof Gauge)) {
        throw new Error(`Metric "${name}" already registered as ${existing.constructor.name}, not Gauge`);
      }
      return existing;
    }
    const g = new Gauge(name, labels);
    this._registry.set(key, g);
    return g;
  }

  /** Get or create a histogram */
  histogram(
    name: string,
    buckets?: number[],
    labels: Record<string, string> = {},
  ): Histogram {
    const key = metricKey(name, labels);
    const existing = this._registry.get(key);
    if (existing) {
      if (!(existing instanceof Histogram)) {
        throw new Error(`Metric "${name}" already registered as ${existing.constructor.name}, not Histogram`);
      }
      return existing;
    }
    const h = new Histogram(name, buckets, labels);
    this._registry.set(key, h);
    return h;
  }

  /** Get or create a rate tracker */
  rate(name: string, windowMs?: number, labels: Record<string, string> = {}): Rate {
    const key = metricKey(name, labels);
    const existing = this._registry.get(key);
    if (existing) {
      if (!(existing instanceof Rate)) {
        throw new Error(`Metric "${name}" already registered as ${existing.constructor.name}, not Rate`);
      }
      return existing;
    }
    const r = new Rate(name, windowMs, labels);
    this._registry.set(key, r);
    return r;
  }

  // ── Query Methods ───────────────────────────────────────────

  /** Get all metric snapshots */
  getAll(): MetricSnapshot[] {
    // Update uptime before snapshot
    this.gauge('swarm.uptime_seconds').set(
      Math.floor((Date.now() - this._startTime) / 1_000),
    );

    const snapshots: MetricSnapshot[] = [];
    for (const metric of this._registry.values()) {
      snapshots.push(metric.snapshot());
    }
    return snapshots;
  }

  /** Get a single metric snapshot by name (returns first match, ignoring labels) */
  getMetric(name: string): MetricSnapshot | undefined {
    for (const metric of this._registry.values()) {
      if (metric.name === name) {
        return metric.snapshot();
      }
    }
    return undefined;
  }

  /** Reset all metrics */
  reset(): void {
    for (const metric of this._registry.values()) {
      metric.reset();
    }
  }

  // ── Export Methods ──────────────────────────────────────────

  /**
   * Export all metrics in Prometheus text exposition format.
   *
   * @see https://prometheus.io/docs/instrumenting/exposition_formats/
   */
  toPrometheus(): string {
    // Update uptime before export
    this.gauge('swarm.uptime_seconds').set(
      Math.floor((Date.now() - this._startTime) / 1_000),
    );

    const lines: string[] = [];
    const seenTypes = new Set<string>();

    for (const metric of this._registry.values()) {
      const promName = sanitizePrometheusName(metric.name);
      const labelStr = formatLabels(metric.labels);

      // TYPE declaration (once per metric name)
      if (!seenTypes.has(metric.name)) {
        seenTypes.add(metric.name);
        const promType =
          metric instanceof Counter
            ? 'counter'
            : metric instanceof Gauge
              ? 'gauge'
              : metric instanceof Histogram
                ? 'histogram'
                : 'gauge'; // Rate exported as gauge
        lines.push(`# TYPE ${promName} ${promType}`);
      }

      if (metric instanceof Counter || metric instanceof Gauge) {
        lines.push(`${promName}${labelStr} ${metric.get()}`);
      } else if (metric instanceof Rate) {
        lines.push(`${promName}${labelStr} ${metric.get()}`);
      } else if (metric instanceof Histogram) {
        const stats = metric.get();
        lines.push(`${promName}_count${labelStr} ${stats.count}`);
        lines.push(`${promName}_sum${labelStr} ${stats.sum}`);

        // Bucket lines
        for (let i = 0; i < metric.buckets.length; i++) {
          const bucketLabels = { ...metric.labels, le: String(metric.buckets[i]) };
          lines.push(
            `${promName}_bucket${formatLabels(bucketLabels)} ${(metric as unknown as { _bucketCounts: number[] })._bucketCounts[i]}`,
          );
        }
        // +Inf bucket
        const infLabels = { ...metric.labels, le: '+Inf' };
        lines.push(`${promName}_bucket${formatLabels(infLabels)} ${stats.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Export all metrics as a JSON-serializable object.
   * Grouped by metric name, with labels as nested keys.
   */
  toJSON(): Record<string, unknown> {
    // Update uptime before export
    this.gauge('swarm.uptime_seconds').set(
      Math.floor((Date.now() - this._startTime) / 1_000),
    );

    const result: Record<string, unknown> = {
      _meta: {
        exportedAt: Date.now(),
        uptimeMs: Date.now() - this._startTime,
        metricCount: this._registry.size,
      },
    };

    for (const metric of this._registry.values()) {
      const snap = metric.snapshot();
      const labelKeys = Object.keys(snap.labels);

      if (labelKeys.length === 0) {
        result[snap.name] = {
          type: snap.type,
          value: snap.value,
          updatedAt: snap.updatedAt,
        };
      } else {
        // Group labeled metrics under the metric name
        const group = (result[snap.name] as Record<string, unknown>) ?? {
          type: snap.type,
          series: [],
        };
        if (!result[snap.name]) {
          result[snap.name] = group;
        }
        (group['series'] as Array<{ labels: Record<string, string>; value: MetricSnapshot['value']; updatedAt: number }>).push({
          labels: snap.labels,
          value: snap.value,
          updatedAt: snap.updatedAt,
        });
      }
    }

    return result;
  }

  // ── Pre-defined Metrics ─────────────────────────────────────

  /**
   * Register all pre-defined swarm metrics.
   * These are automatically available to all components.
   */
  private registerPredefinedMetrics(): void {
    // ── Trading ───────────────────────────────────────────────
    this.counter('swarm.trades.total', { direction: 'buy', status: 'success' });
    this.counter('swarm.trades.total', { direction: 'buy', status: 'failure' });
    this.counter('swarm.trades.total', { direction: 'sell', status: 'success' });
    this.counter('swarm.trades.total', { direction: 'sell', status: 'failure' });
    this.histogram('swarm.trades.latency_ms');
    this.counter('swarm.trades.volume_sol', { direction: 'buy' });
    this.counter('swarm.trades.volume_sol', { direction: 'sell' });
    this.rate('swarm.trades.rate', 60_000);

    // ── Wallets ───────────────────────────────────────────────
    this.gauge('swarm.wallets.active');
    this.gauge('swarm.wallets.total_sol');
    // Per-wallet balance gauges are created dynamically with wallet_id labels

    // ── Bundle ────────────────────────────────────────────────
    this.counter('swarm.bundle.total', { status: 'success' });
    this.counter('swarm.bundle.total', { status: 'failure' });
    this.counter('swarm.bundle.total', { status: 'partial' });
    this.histogram('swarm.bundle.latency_ms');

    // ── RPC ───────────────────────────────────────────────────
    // Per-endpoint counters are created dynamically with endpoint labels
    this.histogram('swarm.rpc.latency_ms');

    // ── Intelligence ──────────────────────────────────────────
    this.counter('swarm.intelligence.signals', { signal_type: 'buy' });
    this.counter('swarm.intelligence.signals', { signal_type: 'sell' });
    this.counter('swarm.intelligence.signals', { signal_type: 'hold' });
    this.counter('swarm.intelligence.llm_calls');
    this.histogram('swarm.intelligence.llm_latency_ms');

    // ── x402 ──────────────────────────────────────────────────
    this.counter('swarm.x402.payments');
    this.counter('swarm.x402.spent_usdc');

    // ── System ────────────────────────────────────────────────
    this.gauge('swarm.uptime_seconds');
    this.gauge('swarm.phase');
    // Per-role agent gauges are created dynamically with role labels
  }
}
