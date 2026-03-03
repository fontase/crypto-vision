/**
 * usePerformanceMonitor — Runtime performance telemetry for React Native
 *
 * Captures JS thread frame rate, memory pressure, and route context so we can
 * identify which screens are most problematic — exactly as described in the
 * Pump.fun article where they "capture this telemetry by regular sampling of
 * these metrics and sending them to DataDog".
 *
 * Metrics collected:
 * - JS thread FPS (sampled via requestAnimationFrame)
 * - Render count per component lifecycle
 * - Slow render detection (warns when renders exceed threshold)
 * - Route context for attribution
 *
 * Usage:
 *   const perf = usePerformanceMonitor('MarketsScreen');
 *   // perf.fps — current JS FPS
 *   // perf.renderCount — how many times this component rendered
 *   // perf.isLowFPS — true when FPS drops below threshold
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Configuration ───────────────────────────────────────────

/** FPS below this is considered degraded (Pump.fun saw 20 FPS on high-end devices) */
const LOW_FPS_THRESHOLD = 30;
/** How often to sample FPS (ms) */
const SAMPLE_INTERVAL_MS = 1_000;
/** How many recent samples to keep for averaging */
const SAMPLE_WINDOW = 10;
/** Warn in console when a render takes longer than this (ms) */
const SLOW_RENDER_THRESHOLD_MS = 16; // ~1 frame at 60fps

// ─── Types ───────────────────────────────────────────────────

interface PerformanceMetrics {
  /** Current JS thread FPS (1-second rolling average) */
  fps: number;
  /** Average FPS over the sample window */
  avgFps: number;
  /** True when FPS is below LOW_FPS_THRESHOLD */
  isLowFPS: boolean;
  /** Number of renders since mount */
  renderCount: number;
  /** Screen/component name for attribution */
  screenName: string;
}

interface PerformanceSample {
  fps: number;
  timestamp: number;
  screenName: string;
}

// ─── Global telemetry buffer ─────────────────────────────────
// Accumulates samples to be flushed to an analytics backend.

const telemetryBuffer: PerformanceSample[] = [];
const MAX_BUFFER_SIZE = 100;
let telemetryFlushCallback: ((samples: PerformanceSample[]) => void) | null = null;

/**
 * Register a callback to receive batched performance samples.
 * e.g., for sending to DataDog, Sentry, or your own analytics.
 */
export function setPerformanceTelemetryHandler(
  handler: (samples: PerformanceSample[]) => void
): void {
  telemetryFlushCallback = handler;
}

function pushSample(sample: PerformanceSample): void {
  telemetryBuffer.push(sample);
  if (telemetryBuffer.length >= MAX_BUFFER_SIZE) {
    flushTelemetry();
  }
}

function flushTelemetry(): void {
  if (telemetryBuffer.length === 0) return;
  const batch = telemetryBuffer.splice(0, telemetryBuffer.length);
  if (telemetryFlushCallback) {
    try {
      telemetryFlushCallback(batch);
    } catch {
      // Don't let telemetry errors affect the app
    }
  }
}

// ─── Hook ────────────────────────────────────────────────────

export function usePerformanceMonitor(screenName: string): PerformanceMetrics {
  const [fps, setFps] = useState(60);
  const [avgFps, setAvgFps] = useState(60);
  const renderCount = useRef(0);
  const renderStart = useRef(Date.now());
  const fpsSamples = useRef<number[]>([]);

  // Track render count and warn on slow renders
  renderCount.current += 1;
  const renderDuration = Date.now() - renderStart.current;
  if (renderDuration > SLOW_RENDER_THRESHOLD_MS && renderCount.current > 1) {
    if (__DEV__) {
      console.warn(
        `[Perf] Slow render on ${screenName}: ${renderDuration}ms (render #${renderCount.current})`
      );
    }
  }
  renderStart.current = Date.now();

  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let rafId: number;
    let intervalId: ReturnType<typeof setInterval>;

    const countFrame = () => {
      frameCount++;
      rafId = requestAnimationFrame(countFrame);
    };

    // Start counting frames
    rafId = requestAnimationFrame(countFrame);

    // Sample FPS every second
    intervalId = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - lastTime) / 1000;
      const currentFps = Math.round(frameCount / elapsed);

      frameCount = 0;
      lastTime = now;

      // Update rolling window
      fpsSamples.current.push(currentFps);
      if (fpsSamples.current.length > SAMPLE_WINDOW) {
        fpsSamples.current.shift();
      }

      const avg = Math.round(
        fpsSamples.current.reduce((a, b) => a + b, 0) / fpsSamples.current.length
      );

      setFps(currentFps);
      setAvgFps(avg);

      // Push to telemetry buffer
      pushSample({
        fps: currentFps,
        timestamp: Date.now(),
        screenName,
      });
    }, SAMPLE_INTERVAL_MS);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(intervalId);
      flushTelemetry();
    };
  }, [screenName]);

  return {
    fps,
    avgFps,
    isLowFPS: fps < LOW_FPS_THRESHOLD,
    renderCount: renderCount.current,
    screenName,
  };
}

// ─── Utilities ───────────────────────────────────────────────

/**
 * Throttle a callback to fire at most `hz` times per second.
 * Use this for high-frequency event handlers (price updates, scroll, etc.)
 *
 * Pump.fun throttles price updates to 5 Hz — "the human eye could not
 * perceive 1000 price updates a second".
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  hz: number
): T {
  const intervalMs = 1000 / hz;
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return ((...args: unknown[]) => {
    const now = Date.now();
    const elapsed = now - lastCall;

    if (elapsed >= intervalMs) {
      lastCall = now;
      fn(...args);
    } else if (!timer) {
      // Schedule trailing call
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn(...args);
      }, intervalMs - elapsed);
    }
  }) as T;
}

/**
 * Debounce a callback — waits until `ms` of silence before firing.
 * Useful for search inputs, resize handlers, etc.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as T & { cancel: () => void };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
