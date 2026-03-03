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
 * Tests for providers/circuit-breaker.ts
 *
 * Covers the Netflix Hystrix-style circuit breaker:
 * - State transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
 * - Sliding window failure rate calculation
 * - Adaptive backoff with exponential increase
 * - Half-open probe limiting
 * - Manual trip/reset
 * - Metrics reporting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '@/lib/providers/circuit-breaker';
import type { CircuitBreakerConfig } from '@/lib/providers/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAST_CONFIG: Partial<CircuitBreakerConfig> = {
  failureThreshold: 2,          // 2 failures in window trips it
  slidingWindowSize: 4,         // 4 calls in sliding window
  halfOpenSuccessThreshold: 1,  // 1 success to close
  resetTimeoutMs: 100,          // Fast timeout for tests
};

const fail = () => Promise.reject(new Error('boom'));
const succeed = () => Promise.resolve('ok');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker('test', FAST_CONFIG);
    expect(cb.state).toBe('CLOSED');
  });

  it('stays CLOSED when calls succeed', async () => {
    const cb = new CircuitBreaker('test', FAST_CONFIG);

    await cb.execute(succeed);
    await cb.execute(succeed);
    await cb.execute(succeed);

    expect(cb.state).toBe('CLOSED');
    expect(cb.metrics().totalSuccesses).toBe(3);
  });

  it('transitions to OPEN when failures reach threshold in window', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 2,
      slidingWindowSize: 4,
      halfOpenSuccessThreshold: 1,
      resetTimeoutMs: 100,
    });

    // Fill the sliding window with enough data
    await cb.execute(succeed);
    await cb.execute(succeed);
    await expect(cb.execute(fail)).rejects.toThrow('boom');
    await expect(cb.execute(fail)).rejects.toThrow('boom');

    // 2 failures in a window of 4 with threshold=2 should trip
    expect(cb.state).toBe('OPEN');
  });

  it('rejects calls immediately when OPEN', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      slidingWindowSize: 2,
      halfOpenSuccessThreshold: 1,
      resetTimeoutMs: 100,
    });

    // Trip the circuit — 1 failure in window of 2
    await expect(cb.execute(fail)).rejects.toThrow('boom');
    await expect(cb.execute(fail)).rejects.toThrow('boom');

    // Should be OPEN now — next calls rejected with CircuitOpenError
    expect(cb.state).toBe('OPEN');
    await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError);
  });

  it('CircuitOpenError has correct properties', async () => {
    const cb = new CircuitBreaker('my-provider', {
      failureThreshold: 1,
      slidingWindowSize: 1,
      halfOpenSuccessThreshold: 1,
      resetTimeoutMs: 100,
    });

    await cb.execute(fail).catch(() => {});

    try {
      await cb.execute(succeed);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).provider).toBe('my-provider');
    }
  });

  it('transitions to HALF_OPEN after reset timeout', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      slidingWindowSize: 1,
      halfOpenSuccessThreshold: 1,
      resetTimeoutMs: 100,
    });

    // Trip the circuit
    await cb.execute(fail).catch(() => {});
    expect(cb.state).toBe('OPEN');

    // Advance Date.now() past reset timeout
    vi.setSystemTime(Date.now() + 101);

    expect(cb.state).toBe('HALF_OPEN');
  });

  it('returns to CLOSED after successful probe in HALF_OPEN', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      slidingWindowSize: 1,
      halfOpenSuccessThreshold: 1,
      resetTimeoutMs: 100,
    });

    // Trip → OPEN
    await cb.execute(fail).catch(() => {});

    // Wait → HALF_OPEN
    vi.setSystemTime(Date.now() + 101);
    expect(cb.state).toBe('HALF_OPEN');

    // Successful probe → CLOSED
    await cb.execute(succeed);
    expect(cb.state).toBe('CLOSED');
  });

  it('returns to OPEN after failed probe in HALF_OPEN', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      slidingWindowSize: 1,
      halfOpenSuccessThreshold: 1,
      resetTimeoutMs: 100,
    });

    // Trip → OPEN
    await cb.execute(fail).catch(() => {});

    // Wait → HALF_OPEN
    vi.setSystemTime(Date.now() + 101);

    // Failed probe → OPEN again
    await expect(cb.execute(fail)).rejects.toThrow('boom');
    expect(cb.state).toBe('OPEN');
  });

  it('limits concurrent probes in HALF_OPEN', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      slidingWindowSize: 1,
      halfOpenSuccessThreshold: 1,
      resetTimeoutMs: 100,
    });

    // Trip → OPEN → wait → HALF_OPEN
    await cb.execute(fail).catch(() => {});
    vi.setSystemTime(Date.now() + 101);
    expect(cb.state).toBe('HALF_OPEN');

    // Start a slow probe that doesn't resolve yet
    let resolveProbe: () => void;
    const slowProbe = new Promise<string>(resolve => { resolveProbe = () => resolve('ok'); });
    const probePromise = cb.execute(() => slowProbe);

    // Second call during half-open should be rejected
    await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError);

    // Resolve the first probe
    resolveProbe!();
    await probePromise;
  });

  it('manual trip() opens the circuit', () => {
    const cb = new CircuitBreaker('test', FAST_CONFIG);
    expect(cb.state).toBe('CLOSED');

    cb.trip();
    expect(cb.state).toBe('OPEN');
  });

  it('manual reset() closes the circuit', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      slidingWindowSize: 1,
      halfOpenSuccessThreshold: 1,
      resetTimeoutMs: 100,
    });

    // Trip it
    await cb.execute(fail).catch(() => {});
    expect(cb.state).toBe('OPEN');

    cb.reset();
    expect(cb.state).toBe('CLOSED');

    // Should work again
    const result = await cb.execute(succeed);
    expect(result).toBe('ok');
  });

  it('metrics() returns accurate counts', async () => {
    const cb = new CircuitBreaker('test', FAST_CONFIG);

    await cb.execute(succeed);
    await cb.execute(succeed);
    await cb.execute(fail).catch(() => {});

    const m = cb.metrics();
    expect(m.totalSuccesses).toBe(2);
    expect(m.totalFailures).toBe(1);
    expect(m.state).toBe('CLOSED');
    expect(m.failureRate).toBeCloseTo(1 / 3, 2);
  });

  describe('adaptive backoff', () => {
    it('increases backoff on repeated failures', async () => {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 1,
        slidingWindowSize: 1,
        halfOpenSuccessThreshold: 1,
        resetTimeoutMs: 100,
      });

      // First trip (CLOSED → OPEN): backoff stays at 1x
      await cb.execute(fail).catch(() => {});
      expect(cb.state).toBe('OPEN');
      expect(cb.metrics().backoffMultiplier).toBe(1);

      // Wait for first reset timeout (100ms * 1 = 100ms)
      vi.setSystemTime(Date.now() + 101);
      expect(cb.state).toBe('HALF_OPEN');

      // Fail the probe → HALF_OPEN → OPEN: backoff doubles to 2x
      await cb.execute(fail).catch(() => {});
      expect(cb.state).toBe('OPEN');
      expect(cb.metrics().backoffMultiplier).toBe(2);

      // 100ms is NOT enough (effective timeout = 100 * 2 = 200ms)
      vi.setSystemTime(Date.now() + 101);
      expect(cb.state).toBe('OPEN');

      // 200ms from OPEN should work
      vi.setSystemTime(Date.now() + 100);
      expect(cb.state).toBe('HALF_OPEN');
    });
  });
});
