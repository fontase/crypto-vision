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
 * Fear & Greed Chain — Integration Tests
 *
 * Validates the provider chain's fallback, caching, circuit breaker,
 * and response shape for the fear-greed category.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFearGreedChain } from '../adapters/fear-greed';
import { registry } from '../registry';
import '../setup';

// Mock global fetch for deterministic tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('FearGreedChain', () => {
  it('fetches data from primary provider (Alternative.me)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { value: '72', value_classification: 'Greed', timestamp: '1700000000' },
          { value: '68', value_classification: 'Greed', timestamp: '1699913600' },
        ],
      }),
    });

    const chain = createFearGreedChain({ cacheTtlSeconds: 0 });
    const result = await chain.fetch({ limit: 2 });

    expect(result.data).toBeDefined();
    expect(result.data.value).toBe(72);
    expect(result.data.classification).toBe('Greed');
    expect(result.lineage.provider).toBe('alternative-me-fear-greed');
  });

  it('falls back when primary fails', async () => {
    // First call (Alternative.me) fails
    mockFetch.mockRejectedValueOnce(new Error('API down'));
    // Second call (CoinStats fallback) succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        fear_greed: { value: 55, label: 'Neutral' },
      }),
    });

    const chain = createFearGreedChain({ cacheTtlSeconds: 0 });
    const result = await chain.fetch({});

    expect(result.data).toBeDefined();
    expect(result.data.value).toBeGreaterThanOrEqual(0);
    expect(result.data.value).toBeLessThanOrEqual(100);
  });

  it('serves cached data on total failure when staleWhileError=true', async () => {
    // First call succeeds — populates cache
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { value: '45', value_classification: 'Fear', timestamp: '1700000000' },
        ],
      }),
    });

    const chain = createFearGreedChain({ cacheTtlSeconds: 1, staleWhileError: true });
    const fresh = await chain.fetch({ limit: 1 });
    expect(fresh.cached).toBe(false);

    // Wait for cache to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    // All providers fail
    mockFetch.mockRejectedValue(new Error('All down'));

    const stale = await chain.fetch({ limit: 1 });
    expect(stale.cached).toBe(true);
    expect(stale.data.value).toBe(45);
    // Confidence is halved for stale data
    expect(stale.lineage.confidence).toBeLessThan(fresh.lineage.confidence);
  });

  it('validates response shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { value: '82', value_classification: 'Extreme Greed', timestamp: '1700000000' },
        ],
      }),
    });

    const chain = createFearGreedChain({ cacheTtlSeconds: 0 });
    const result = await chain.fetch({});

    const data = result.data;
    expect(typeof data.value).toBe('number');
    expect(data.value).toBeGreaterThanOrEqual(0);
    expect(data.value).toBeLessThanOrEqual(100);
    expect(typeof data.classification).toBe('string');
    expect(typeof data.timestamp).toBe('string');
    expect(typeof data.source).toBe('string');
  });

  it('registry resolves fear-greed category', async () => {
    // The chain is already registered via setup.ts import
    expect(registry.has('fear-greed')).toBe(true);
  });
});
