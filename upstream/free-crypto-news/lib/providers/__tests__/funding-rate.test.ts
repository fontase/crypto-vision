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
 * Funding Rate Chain — Integration Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFundingRateChain } from '../adapters/funding-rate';
import { registry } from '../registry';
import '../setup';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('FundingRateChain', () => {
  it('fetches from Binance (highest priority)', async () => {
    // Binance adapter fetches fundingRate + premiumIndex in parallel
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          symbol: 'BTCUSDT', markPrice: '65000.00', indexPrice: '64990.00',
          lastFundingRate: '0.0001', nextFundingTime: 1700000000000,
          interestRate: '0.0001', time: 1699990000000,
        },
      ]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          symbol: 'BTCUSDT', markPrice: '65000.00', indexPrice: '64990.00',
          lastFundingRate: '0.0001', nextFundingTime: 1700000000000,
          interestRate: '0.0001', time: 1699990000000,
        },
      ]),
    });

    const chain = createFundingRateChain({
      strategy: 'fallback',
      cacheTtlSeconds: 0,
      includeBinance: true,
      includeBybit: false,
      includeOkx: false,
      includeDydx: false,
      includeHyperliquid: false,
      includeCoinglass: false,
    });
    const result = await chain.fetch({});

    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].symbol).toBe('BTCUSDT');
    expect(typeof result.data[0].fundingRate).toBe('number');
  });

  it('fetches from Bybit when Binance fails', async () => {
    // Binance makes 2 parallel fetches — both fail
    mockFetch.mockRejectedValueOnce(new Error('Binance down'));
    mockFetch.mockRejectedValueOnce(new Error('Binance down'));
    // Bybit succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        retCode: 0,
        retMsg: 'OK',
        result: {
          list: [
            {
              symbol: 'BTCUSDT', lastPrice: '65000', indexPrice: '64990',
              markPrice: '65000', fundingRate: '0.0001',
              nextFundingTime: '1700000000000', openInterestValue: '500000000',
              volume24h: '100000', turnover24h: '6500000000',
            },
          ],
        },
      }),
    });

    const chain = createFundingRateChain({
      strategy: 'fallback',
      cacheTtlSeconds: 0,
      includeBinance: true,
      includeBybit: true,
      includeOkx: false,
      includeDydx: false,
      includeHyperliquid: false,
      includeCoinglass: false,
    });
    const result = await chain.fetch({});

    expect(result.data).toBeDefined();
    expect(result.lineage.provider).toBe('bybit');
  });

  it('validates funding rate data shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        retCode: 0,
        retMsg: 'OK',
        result: {
          list: [
            {
              symbol: 'ETHUSDT', lastPrice: '3500', indexPrice: '3498',
              markPrice: '3500', fundingRate: '0.0003',
              nextFundingTime: '1700000000000', openInterestValue: '200000000',
              volume24h: '50000', turnover24h: '175000000',
            },
          ],
        },
      }),
    });

    const chain = createFundingRateChain({
      strategy: 'fallback',
      cacheTtlSeconds: 0,
      includeBinance: false,
      includeBybit: true,
      includeOkx: false,
      includeDydx: false,
      includeHyperliquid: false,
      includeCoinglass: false,
    });
    const result = await chain.fetch({});
    const rate = result.data[0];

    expect(typeof rate.symbol).toBe('string');
    expect(typeof rate.fundingRate).toBe('number');
    expect(typeof rate.annualizedRate).toBe('number');
    expect(typeof rate.exchange).toBe('string');
    expect(typeof rate.markPrice).toBe('number');
  });

  it('registry resolves funding-rate category', () => {
    expect(registry.has('funding-rate')).toBe(true);
  });
});
