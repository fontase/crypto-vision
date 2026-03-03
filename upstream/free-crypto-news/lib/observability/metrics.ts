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
 * Observability — Prometheus-compatible metrics
 *
 * Lightweight in-process metrics collection with a /api/metrics endpoint
 * that emits Prometheus text format. No external dependencies required.
 *
 * Metrics tracked:
 *   http_requests_total            — Counter, by method/path/status
 *   http_request_duration_ms       — Histogram, by method/path
 *   cache_operations_total         — Counter, by operation (hit/miss/set/evict)
 *   provider_requests_total        — Counter, by provider/category/status
 *   provider_latency_ms            — Histogram, by provider
 *   ws_connections_active          — Gauge
 *   db_query_duration_ms           — Histogram, by query
 *   job_executions_total           — Counter, by function/status
 *   circuit_breaker_state_changes  — Counter, by provider/from/to
 *
 * @module observability/metrics
 */

// =============================================================================
// COUNTER
// =============================================================================

export class Counter {
  readonly name: string;
  readonly help: string;
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = labelsToKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  get(labels: Record<string, string> = {}): number {
    return this.values.get(labelsToKey(labels)) ?? 0;
  }

  toPrometheus(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key} ${value}`);
    }
    return lines.join('\n');
  }

  reset(): void {
    this.values.clear();
  }
}

// =============================================================================
// GAUGE
// =============================================================================

export class Gauge {
  readonly name: string;
  readonly help: string;
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(labels: Record<string, string>, value: number): void {
    this.values.set(labelsToKey(labels), value);
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = labelsToKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  dec(labels: Record<string, string> = {}, value = 1): void {
    const key = labelsToKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) - value);
  }

  get(labels: Record<string, string> = {}): number {
    return this.values.get(labelsToKey(labels)) ?? 0;
  }

  toPrometheus(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key} ${value}`);
    }
    return lines.join('\n');
  }

  reset(): void {
    this.values.clear();
  }
}

// =============================================================================
// HISTOGRAM
// =============================================================================

export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly buckets: number[];
  private readonly observations = new Map<string, { counts: number[]; sum: number; count: number }>();

  constructor(name: string, help: string, buckets?: number[]) {
    this.name = name;
    this.help = help;
    this.buckets = buckets ?? [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  }

  observe(labels: Record<string, string>, value: number): void {
    const key = labelsToKey(labels);
    let obs = this.observations.get(key);
    if (!obs) {
      obs = { counts: new Array(this.buckets.length + 1).fill(0), sum: 0, count: 0 };
      this.observations.set(key, obs);
    }
    obs.sum += value;
    obs.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) obs.counts[i]++;
    }
    obs.counts[this.buckets.length]++; // +Inf
  }

  toPrometheus(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, obs] of this.observations) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += obs.counts[i];
        lines.push(`${this.name}_bucket${mergeLabelKey(key, `le="${this.buckets[i]}"`)}} ${cumulative}`);
      }
      lines.push(`${this.name}_bucket${mergeLabelKey(key, 'le="+Inf"')}} ${obs.count}`);
      lines.push(`${this.name}_sum${key} ${obs.sum}`);
      lines.push(`${this.name}_count${key} ${obs.count}`);
    }
    return lines.join('\n');
  }

  reset(): void {
    this.observations.clear();
  }
}

// =============================================================================
// GLOBAL METRICS INSTANCES
// =============================================================================

export const httpRequestsTotal = new Counter(
  'http_requests_total',
  'Total HTTP requests',
);

export const httpRequestDuration = new Histogram(
  'http_request_duration_ms',
  'HTTP request duration in milliseconds',
  [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
);

export const cacheOperations = new Counter(
  'cache_operations_total',
  'Cache operations (hit, miss, set, evict)',
);

export const providerRequests = new Counter(
  'provider_requests_total',
  'Provider fetch requests by provider, category, and status',
);

export const providerLatency = new Histogram(
  'provider_latency_ms',
  'Provider fetch latency in milliseconds',
  [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
);

export const wsConnectionsActive = new Gauge(
  'ws_connections_active',
  'Active WebSocket connections',
);

export const dbQueryDuration = new Histogram(
  'db_query_duration_ms',
  'Database query duration in milliseconds',
  [1, 5, 10, 25, 50, 100, 250, 500, 1000],
);

export const jobExecutions = new Counter(
  'job_executions_total',
  'Background job executions by function and status',
);

export const circuitBreakerChanges = new Counter(
  'circuit_breaker_state_changes_total',
  'Circuit breaker state transitions',
);

// =============================================================================
// REGISTRY — Collect all metrics
// =============================================================================

const ALL_METRICS = [
  httpRequestsTotal,
  httpRequestDuration,
  cacheOperations,
  providerRequests,
  providerLatency,
  wsConnectionsActive,
  dbQueryDuration,
  jobExecutions,
  circuitBreakerChanges,
];

/**
 * Export all metrics in Prometheus text exposition format.
 */
export function toPrometheusText(): string {
  return ALL_METRICS.map((m) => m.toPrometheus()).join('\n\n') + '\n';
}

/**
 * Reset all metrics (useful for testing).
 */
export function resetAllMetrics(): void {
  for (const m of ALL_METRICS) m.reset();
}

// =============================================================================
// HELPERS
// =============================================================================

function labelsToKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return '{' + entries.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
}

function mergeLabelKey(existingKey: string, extraLabel: string): string {
  if (!existingKey) return `{${extraLabel}`;
  // existingKey looks like {method="GET",path="/api/news"}
  // Remove trailing } and append new label
  return existingKey.slice(0, -1) + ',' + extraLabel;
}
