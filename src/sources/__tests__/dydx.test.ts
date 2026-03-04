/**
 * Tests for src/sources/dydx.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getMarkets, getMarket, getCandles, getOrderbook, getTrades, getFundingRates, getSparklines } from "../dydx.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("dydx source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getMarkets", () => {
        it("returns all markets", async () => {
            mockFetch.mockResolvedValue({ markets: { "BTC-USD": { ticker: "BTC-USD" } } });
            const result = await getMarkets();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getMarkets()).rejects.toThrow();
        });
    });

    describe("getMarket", () => {
        it("returns single market", async () => {
            mockFetch.mockResolvedValue({ markets: { "BTC-USD": { ticker: "BTC-USD", oraclePrice: "60000" } } });
            const result = await getMarket("BTC-USD");
            expect(result).toBeDefined();
        });
    });

    describe("getCandles", () => {
        it("returns candle data", async () => {
            mockFetch.mockResolvedValue({ candles: [{ startedAt: "2026-01-01", close: "60000" }] });
            const result = await getCandles("BTC-USD", "1HOUR");
            expect(result).toBeDefined();
        });
    });

    describe("getOrderbook", () => {
        it("returns orderbook", async () => {
            mockFetch.mockResolvedValue({ bids: [{ price: "59999", size: "1" }], asks: [{ price: "60001", size: "1" }] });
            const result = await getOrderbook("BTC-USD");
            expect(result).toBeDefined();
        });
    });

    describe("getTrades", () => {
        it("returns trades", async () => {
            mockFetch.mockResolvedValue({ trades: [{ price: "60000", size: "0.1" }] });
            const result = await getTrades("BTC-USD");
            expect(result).toBeDefined();
        });
    });

    describe("getFundingRates", () => {
        it("returns funding rates", async () => {
            mockFetch.mockResolvedValue({ historicalFunding: [{ rate: "0.0001" }] });
            const result = await getFundingRates("BTC-USD");
            expect(result).toBeDefined();
        });
    });

    describe("getSparklines", () => {
        it("returns sparklines", async () => {
            mockFetch.mockResolvedValue({ "BTC-USD": [60000, 60100, 60050] });
            const result = await getSparklines("ONE_DAY");
            expect(result).toBeDefined();
        });
    });
});
