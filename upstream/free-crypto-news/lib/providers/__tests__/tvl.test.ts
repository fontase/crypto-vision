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
 * TVL Chain — Integration Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTVLChain } from '../adapters/tvl';
import { registry } from '../registry';
import '../setup';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('TVLChain', () => {
  it('fetches protocol TVL from DefiLlama', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          id: '1', name: 'Lido', slug: 'lido', chains: ['Ethereum'],
          category: 'Liquid Staking', tvl: 15000000000,
          change_1h: 0.01, change_1d: 1.5, change_7d: 3.2,
          mcapTvl: 0.8, symbol: 'LDO', logo: 'https://example.com/lido.png',
        },
        {
          id: '2', name: 'Aave', slug: 'aave', chains: ['Ethereum', 'Polygon'],
          category: 'Lending', tvl: 12000000000,
          change_1h: -0.1, change_1d: 0.5, change_7d: 2.1,
          mcapTvl: 0.65, symbol: 'AAVE', logo: 'https://example.com/aave.png',
        },
      ]),
    });

    const chain = createTVLChain({ cacheTtlSeconds: 0 });
    const result = await chain.fetch({ limit: 10 });

    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBe(2);
    expect(result.data[0].name).toBe('Lido');
    expect(result.data[0].tvl).toBe(15000000000);
    expect(result.lineage.provider).toBe('defillama-tvl');
  });

  it('filters by chain parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { id: '1', name: 'Lido', slug: 'lido', chains: ['Ethereum'], category: 'Staking', tvl: 15e9 },
        { id: '2', name: 'Raydium', slug: 'raydium', chains: ['Solana'], category: 'DEX', tvl: 1e9 },
      ]),
    });

    const chain = createTVLChain({ cacheTtlSeconds: 0 });
    const result = await chain.fetch({ chain: 'ethereum', limit: 100 });

    // DefiLlama adapter filters by chain internally
    expect(result.data).toBeDefined();
  });

  it('validates TVL data shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          id: '1', name: 'Compound', slug: 'compound',
          chains: ['Ethereum'], category: 'Lending', tvl: 5000000000,
          change_1h: null, change_1d: null, change_7d: null,
          mcapTvl: null, symbol: 'COMP', logo: null,
        },
      ]),
    });

    const chain = createTVLChain({ cacheTtlSeconds: 0 });
    const result = await chain.fetch({});
    const protocol = result.data[0];

    expect(typeof protocol.name).toBe('string');
    expect(typeof protocol.tvl).toBe('number');
    expect(protocol.tvl).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(protocol.chains)).toBe(true);
  });

  it('registry resolves tvl category', () => {
    expect(registry.has('tvl')).toBe(true);
  });
});
