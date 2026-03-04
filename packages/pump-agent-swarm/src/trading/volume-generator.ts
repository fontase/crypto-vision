/**
 * Volume Generator — Time-Based Volume Planning & Tracking
 *
 * Generates volume plans that specify exactly how much SOL volume
 * should be generated in each time bucket, following configurable
 * curves (constant, ramp-up, ramp-down, bell-curve, burst, natural, custom).
 *
 * Features:
 * - Multiple curve types with realistic shaping
 * - Jitter for human-like variance
 * - Adaptive adjustment — re-balances remaining buckets based on actual progress
 * - Hot-adjust total target mid-plan
 */

import { randomUUID } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────

export type VolumeCurve =
  | 'constant'
  | 'ramp-up'
  | 'ramp-down'
  | 'bell-curve'
  | 'burst'
  | 'natural'
  | 'custom';

export interface VolumeGeneratorConfig {
  /** Which curve shape to use for volume distribution */
  curve: VolumeCurve;
  /** For 'burst': interval between bursts in ms (default: 300_000 = 5 min) */
  burstIntervalMs?: number;
  /** For 'burst': duration of each burst in ms (default: 60_000 = 1 min) */
  burstDurationMs?: number;
  /** For 'natural': UTC hours with peak activity (default: [14,15,16,1,2,3]) */
  peakHours?: number[];
  /** For 'custom': array of [timestampOffsetMs, volumeWeight] data points */
  customCurve?: Array<[number, number]>;
  /** Randomness factor (0–1). 0 = exact, 1 = highly variable (default: 0.1) */
  jitter: number;
}

export interface VolumeBucket {
  /** Bucket start offset (ms from plan start) */
  startMs: number;
  /** Bucket end offset (ms from plan start) */
  endMs: number;
  /** Target SOL volume for this bucket */
  targetSol: number;
  /** Actual SOL volume recorded in this bucket */
  actualSol: number;
  /** Number of trades executed in this bucket */
  trades: number;
}

export interface VolumePlan {
  /** Unique plan identifier */
  id: string;
  /** Total target SOL volume for the plan */
  totalTargetSol: number;
  /** Total plan duration in ms */
  durationMs: number;
  /** Time-bucketed volume targets */
  buckets: VolumeBucket[];
  /** Curve used to generate this plan */
  curve: VolumeCurve;
  /** Plan creation timestamp (epoch ms) */
  createdAt: number;
}

// ─── Constants ────────────────────────────────────────────────

/** Default bucket size: 1 minute */
const DEFAULT_BUCKET_MS = 60_000;

/** Default burst interval: 5 minutes */
const DEFAULT_BURST_INTERVAL_MS = 300_000;

/** Default burst duration: 1 minute */
const DEFAULT_BURST_DURATION_MS = 60_000;

/**
 * Default peak hours for 'natural' curve — overlapping US afternoon
 * (14–16 UTC ≈ 9–11 AM ET) and Asia morning (1–3 UTC ≈ 9–11 AM JST).
 */
const DEFAULT_PEAK_HOURS: number[] = [14, 15, 16, 1, 2, 3];

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Deterministic (seedless) jitter: scales a value by ±jitter factor.
 * Uses Math.random internally — not cryptographic, but adequate for
 * trading variance simulation.
 */
function applyJitter(value: number, jitter: number): number {
  if (jitter <= 0) return value;
  const clampedJitter = Math.min(jitter, 1);
  // Range: [1 - jitter, 1 + jitter]
  const multiplier = 1 + (Math.random() * 2 - 1) * clampedJitter;
  return Math.max(0, value * multiplier);
}

/**
 * Linearly interpolate between two points.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Gaussian-like bell curve using the formula: e^(-((x - μ)² / (2σ²)))
 * Returns a value in (0, 1].
 */
function gaussian(x: number, mu: number, sigma: number): number {
  const exponent = -((x - mu) ** 2) / (2 * sigma ** 2);
  return Math.exp(exponent);
}

/**
 * Piecewise-linear interpolation over custom data points.
 * Points must be sorted by x-coordinate.
 */
function interpolateCustomCurve(
  points: Array<[number, number]>,
  x: number,
): number {
  if (points.length === 0) return 1;
  if (points.length === 1) return points[0][1];

  // Clamp to range
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[points.length - 1][0]) return points[points.length - 1][1];

  // Find surrounding points
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return lerp(y0, y1, t);
    }
  }

  return points[points.length - 1][1];
}

// ─── Curve Weight Functions ───────────────────────────────────

/**
 * Each curve function receives the bucket index, total bucket count,
 * and config, and returns a raw weight (unnormalized).
 */
type CurveWeightFn = (
  bucketIndex: number,
  totalBuckets: number,
  bucketMidpointMs: number,
  config: VolumeGeneratorConfig,
) => number;

const curveWeights: Record<VolumeCurve, CurveWeightFn> = {
  /**
   * constant — equal weight for every bucket.
   */
  constant: () => 1,

  /**
   * ramp-up — linearly increases from 20% to 180% of the average.
   */
  'ramp-up': (idx, total) => {
    if (total <= 1) return 1;
    const t = idx / (total - 1);
    return lerp(0.2, 1.8, t);
  },

  /**
   * ramp-down — linearly decreases from 180% to 20% of the average.
   */
  'ramp-down': (idx, total) => {
    if (total <= 1) return 1;
    const t = idx / (total - 1);
    return lerp(1.8, 0.2, t);
  },

  /**
   * bell-curve — normal distribution peaked at the midpoint.
   * σ is set to 1/6 of total buckets so tails are ~5% of peak.
   */
  'bell-curve': (idx, total) => {
    if (total <= 1) return 1;
    const mu = (total - 1) / 2;
    const sigma = Math.max(total / 6, 1);
    return gaussian(idx, mu, sigma);
  },

  /**
   * burst — alternates between high-activity bursts (4× average)
   * and quiet periods (0.25× average).
   */
  burst: (_idx, _total, bucketMidpointMs, config) => {
    const interval = config.burstIntervalMs ?? DEFAULT_BURST_INTERVAL_MS;
    const duration = config.burstDurationMs ?? DEFAULT_BURST_DURATION_MS;
    const positionInCycle = bucketMidpointMs % interval;
    return positionInCycle < duration ? 4 : 0.25;
  },

  /**
   * natural — simulates real market patterns.
   * Peak hours get 3× weight, adjacent hours 2×, others 1×.
   */
  natural: (_idx, _total, bucketMidpointMs, config) => {
    const peakHours = config.peakHours ?? DEFAULT_PEAK_HOURS;
    const absoluteMs = Date.now() + bucketMidpointMs;
    const utcHour = new Date(absoluteMs).getUTCHours();

    if (peakHours.includes(utcHour)) return 3;

    // Adjacent hours
    const isAdjacent = peakHours.some(
      (h) => Math.abs(h - utcHour) === 1 || Math.abs(h - utcHour) === 23,
    );
    if (isAdjacent) return 2;

    return 1;
  },

  /**
   * custom — user-defined curve via [offsetMs, weight] data points
   * with piecewise-linear interpolation.
   */
  custom: (_idx, _total, bucketMidpointMs, config) => {
    const points = config.customCurve;
    if (!points || points.length === 0) return 1;
    return Math.max(0, interpolateCustomCurve(points, bucketMidpointMs));
  },
};

// ─── VolumeGenerator ─────────────────────────────────────────

export class VolumeGenerator {
  private readonly config: VolumeGeneratorConfig;
  private plan: VolumePlan | null = null;
  private planStartTimestamp = 0;

  constructor(config: VolumeGeneratorConfig) {
    if (config.jitter < 0 || config.jitter > 1) {
      throw new Error(
        `jitter must be between 0 and 1, received ${String(config.jitter)}`,
      );
    }
    this.config = { ...config };
  }

  // ── Plan Generation ───────────────────────────────────────

  /**
   * Generate a volume plan — an array of time-bucketed targets
   * that sum to `totalVolumeSol`, shaped by the configured curve.
   */
  generatePlan(durationMs: number, totalVolumeSol: number): VolumePlan {
    if (durationMs <= 0) {
      throw new Error('durationMs must be positive');
    }
    if (totalVolumeSol <= 0) {
      throw new Error('totalVolumeSol must be positive');
    }

    const bucketCount = Math.max(1, Math.ceil(durationMs / DEFAULT_BUCKET_MS));
    const curveFn = curveWeights[this.config.curve];

    // Step 1: compute raw weights for each bucket
    const rawWeights: number[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const startMs = i * DEFAULT_BUCKET_MS;
      const endMs = Math.min((i + 1) * DEFAULT_BUCKET_MS, durationMs);
      const midpointMs = (startMs + endMs) / 2;
      rawWeights.push(curveFn(i, bucketCount, midpointMs, this.config));
    }

    // Step 2: normalize weights so they sum to 1
    const weightSum = rawWeights.reduce((s, w) => s + w, 0);
    const normalizedWeights =
      weightSum > 0 ? rawWeights.map((w) => w / weightSum) : rawWeights.map(() => 1 / bucketCount);

    // Step 3: apply jitter and re-normalize to preserve total
    const jitteredWeights = normalizedWeights.map((w) =>
      applyJitter(w, this.config.jitter),
    );
    const jitteredSum = jitteredWeights.reduce((s, w) => s + w, 0);
    const finalWeights =
      jitteredSum > 0
        ? jitteredWeights.map((w) => w / jitteredSum)
        : jitteredWeights.map(() => 1 / bucketCount);

    // Step 4: build buckets
    const buckets: VolumeBucket[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const startMs = i * DEFAULT_BUCKET_MS;
      const endMs = Math.min((i + 1) * DEFAULT_BUCKET_MS, durationMs);
      buckets.push({
        startMs,
        endMs,
        targetSol: finalWeights[i] * totalVolumeSol,
        actualSol: 0,
        trades: 0,
      });
    }

    const plan: VolumePlan = {
      id: randomUUID(),
      totalTargetSol: totalVolumeSol,
      durationMs,
      buckets,
      curve: this.config.curve,
      createdAt: Date.now(),
    };

    this.plan = plan;
    this.planStartTimestamp = Date.now();
    return plan;
  }

  // ── Real-Time Tracking ────────────────────────────────────

  /**
   * Get the SOL volume target for the current minute bucket.
   * Returns 0 if no plan is active or the plan has elapsed.
   */
  getCurrentTarget(): number {
    const bucket = this.getCurrentBucket();
    return bucket ? bucket.targetSol : 0;
  }

  /**
   * Get progress across the entire plan.
   */
  getProgress(): { actual: number; target: number; percent: number } {
    if (!this.plan) {
      return { actual: 0, target: 0, percent: 0 };
    }

    const elapsed = Date.now() - this.planStartTimestamp;
    let targetSoFar = 0;
    let actualSoFar = 0;

    for (const bucket of this.plan.buckets) {
      if (elapsed >= bucket.endMs) {
        // Fully elapsed bucket
        targetSoFar += bucket.targetSol;
        actualSoFar += bucket.actualSol;
      } else if (elapsed >= bucket.startMs) {
        // Partially elapsed — pro-rate the target
        const bucketDuration = bucket.endMs - bucket.startMs;
        const elapsedInBucket = elapsed - bucket.startMs;
        const fraction = bucketDuration > 0 ? elapsedInBucket / bucketDuration : 1;
        targetSoFar += bucket.targetSol * fraction;
        actualSoFar += bucket.actualSol;
      }
    }

    const percent = targetSoFar > 0 ? (actualSoFar / targetSoFar) * 100 : 0;
    return { actual: actualSoFar, target: targetSoFar, percent };
  }

  /**
   * Record actual volume against the current bucket.
   * Increments both `actualSol` and `trades` count.
   */
  recordVolume(sol: number): void {
    if (sol <= 0) return;

    const bucket = this.getCurrentBucket();
    if (!bucket) return;

    bucket.actualSol += sol;
    bucket.trades += 1;

    // Trigger adaptive adjustment after every recording
    this.adaptRemaining();
  }

  /**
   * Hot-adjust the total target SOL mid-plan.
   * Re-distributes the delta across remaining (future) buckets
   * proportionally to their current targets.
   */
  adjustPlan(newTotalSol: number): void {
    if (!this.plan) {
      throw new Error('No active plan to adjust');
    }
    if (newTotalSol <= 0) {
      throw new Error('newTotalSol must be positive');
    }

    const elapsed = Date.now() - this.planStartTimestamp;

    // Sum already-completed and in-progress actual volume
    let lockedVolume = 0;
    const futureBuckets: VolumeBucket[] = [];

    for (const bucket of this.plan.buckets) {
      if (elapsed >= bucket.endMs) {
        // Fully elapsed — lock its actual volume
        lockedVolume += bucket.actualSol;
      } else if (elapsed >= bucket.startMs) {
        // Current bucket — lock its actual so far, but adjust remaining target
        lockedVolume += bucket.actualSol;
        futureBuckets.push(bucket);
      } else {
        futureBuckets.push(bucket);
      }
    }

    const remainingTarget = Math.max(0, newTotalSol - lockedVolume);

    // Distribute remaining target proportionally across future buckets
    const futureWeightSum = futureBuckets.reduce((s, b) => s + b.targetSol, 0);

    if (futureWeightSum > 0) {
      for (const bucket of futureBuckets) {
        bucket.targetSol = (bucket.targetSol / futureWeightSum) * remainingTarget;
      }
    } else if (futureBuckets.length > 0) {
      // Equal distribution if all future targets were zero
      const perBucket = remainingTarget / futureBuckets.length;
      for (const bucket of futureBuckets) {
        bucket.targetSol = perBucket;
      }
    }

    this.plan.totalTargetSol = newTotalSol;
  }

  // ── Accessors ─────────────────────────────────────────────

  /**
   * Returns the current active plan, or null if none exists.
   */
  getPlan(): VolumePlan | null {
    return this.plan;
  }

  // ── Private ───────────────────────────────────────────────

  /**
   * Find the bucket that corresponds to the current time.
   */
  private getCurrentBucket(): VolumeBucket | null {
    if (!this.plan) return null;

    const elapsed = Date.now() - this.planStartTimestamp;
    for (const bucket of this.plan.buckets) {
      if (elapsed >= bucket.startMs && elapsed < bucket.endMs) {
        return bucket;
      }
    }
    return null;
  }

  /**
   * Adaptive adjustment: if actual volume is behind/ahead of target,
   * redistribute the deficit/surplus across remaining future buckets.
   *
   * This keeps the overall plan on track to hit the total target.
   */
  private adaptRemaining(): void {
    if (!this.plan) return;

    const elapsed = Date.now() - this.planStartTimestamp;

    let completedActual = 0;
    let completedTarget = 0;
    const futureBuckets: VolumeBucket[] = [];

    for (const bucket of this.plan.buckets) {
      if (elapsed >= bucket.endMs) {
        completedActual += bucket.actualSol;
        completedTarget += bucket.targetSol;
      } else if (elapsed >= bucket.startMs) {
        // Current bucket — count actual so far but don't adjust its target
        completedActual += bucket.actualSol;
        completedTarget += bucket.targetSol;
      } else {
        futureBuckets.push(bucket);
      }
    }

    if (futureBuckets.length === 0) return;

    // How much volume is left to generate?
    const remainingNeeded = Math.max(
      0,
      this.plan.totalTargetSol - completedActual,
    );

    // Current total future target
    const currentFutureTarget = futureBuckets.reduce(
      (s, b) => s + b.targetSol,
      0,
    );

    if (currentFutureTarget <= 0) {
      // Equal redistribution
      const perBucket = remainingNeeded / futureBuckets.length;
      for (const bucket of futureBuckets) {
        bucket.targetSol = perBucket;
      }
      return;
    }

    // Scale proportionally
    const scaleFactor = remainingNeeded / currentFutureTarget;
    for (const bucket of futureBuckets) {
      bucket.targetSol *= scaleFactor;
    }
  }
}
