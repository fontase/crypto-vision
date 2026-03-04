/**
 * Tests for src/sources/deribit.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getIndexPrice,
    getInstruments,
    getBookSummary,
    getVolatilityIndex,
    getFundingRate,
    getOrderbook,
    getHistoricalVolatility,
    getCurrencies,
} from "../deribit.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("deribit source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getIndexPrice", () => {
        it("returns index price", async () => {
            mockFetch.mockResolvedValue({ result: { index_price: 60000 } });
            const result = await getIndexPrice("btc_usd");
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getIndexPrice("btc_usd")).rejects.toThrow();
        });
    });

    describe("getInstruments", () => {
        it("returns instruments", async () => {
            mockFetch.mockResolvedValue({ result: [{ instrument_name: "BTC-PERPETUAL" }] });
            const result = await getInstruments("BTC", "future");
            expect(result).toBeDefined();
        });
    });

    describe("getBookSummary", () => {
        it("returns book summary", async () => {
            mockFetch.mockResolvedValue({ result: [{ instrument_name: "BTC-PERPETUAL", mark_price: 60000 }] });
            const result = await getBookSummary("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getVolatilityIndex", () => {
        it("returns volatility index", async () => {
            mockFetch.mockResolvedValue({ result: { data: [{ timestamp: 1, close: 50 }] } });
            const result = await getVolatilityIndex("BTC", "1D");
            expect(result).toBeDefined();
        });
    });

    describe("getFundingRate", () => {
        it("returns funding rate", async () => {
            mockFetch.mockResolvedValue({ result: { current_interest: 0.0001 } });
            const result = await getFundingRate("BTC-PERPETUAL");
            expect(result).toBeDefined();
        });
    });

    describe("getCurrencies", () => {
        it("returns supported currencies", async () => {
            mockFetch.mockResolvedValue({ result: [{ currency: "BTC" }] });
            const result = await getCurrencies();
            expect(result).toBeDefined();
        });
    });
});
