/**
 * Tests for src/sources/okx.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getSwapTickers,
    getSpotTickers,
    getTicker,
    getOrderbook,
    getCandles,
    getFundingRate,
    getFundingHistory,
    getOpenInterest,
    getInstruments,
    getMarkPrice,
} from "../okx.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("okx source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getSwapTickers", () => {
        it("returns swap tickers", async () => {
            mockFetch.mockResolvedValue({ data: [{ instId: "BTC-USDT-SWAP", last: "60000" }] });
            const result = await getSwapTickers();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getSwapTickers()).rejects.toThrow();
        });
    });

    describe("getSpotTickers", () => {
        it("returns spot tickers", async () => {
            mockFetch.mockResolvedValue({ data: [{ instId: "BTC-USDT", last: "60000" }] });
            const result = await getSpotTickers();
            expect(result).toBeDefined();
        });
    });

    describe("getTicker", () => {
        it("returns single ticker", async () => {
            mockFetch.mockResolvedValue({ data: [{ instId: "BTC-USDT", last: "60000" }] });
            const result = await getTicker("BTC-USDT");
            expect(result).toBeDefined();
        });
    });

    describe("getOrderbook", () => {
        it("returns orderbook", async () => {
            mockFetch.mockResolvedValue({ data: [{ asks: [], bids: [] }] });
            const result = await getOrderbook("BTC-USDT");
            expect(result).toBeDefined();
        });
    });

    describe("getCandles", () => {
        it("returns candle data", async () => {
            mockFetch.mockResolvedValue({ data: [["1700000000", "60000", "61000", "59000", "60500", "100"]] });
            const result = await getCandles("BTC-USDT");
            expect(result).toBeDefined();
        });
    });

    describe("getFundingRate", () => {
        it("returns funding rate", async () => {
            mockFetch.mockResolvedValue({ data: [{ fundingRate: "0.0001" }] });
            const result = await getFundingRate("BTC-USDT-SWAP");
            expect(result).toBeDefined();
        });
    });

    describe("getFundingHistory", () => {
        it("returns funding history", async () => {
            mockFetch.mockResolvedValue({ data: [{ fundingRate: "0.0001", fundingTime: "1700000000" }] });
            const result = await getFundingHistory("BTC-USDT-SWAP");
            expect(result).toBeDefined();
        });
    });

    describe("getOpenInterest", () => {
        it("returns open interest", async () => {
            mockFetch.mockResolvedValue({ data: [{ instId: "BTC-USDT-SWAP", oi: "100" }] });
            const result = await getOpenInterest();
            expect(result).toBeDefined();
        });
    });

    describe("getInstruments", () => {
        it("returns instruments", async () => {
            mockFetch.mockResolvedValue({ data: [{ instId: "BTC-USDT-SWAP", instType: "SWAP" }] });
            const result = await getInstruments();
            expect(result).toBeDefined();
        });
    });

    describe("getMarkPrice", () => {
        it("returns mark prices", async () => {
            mockFetch.mockResolvedValue({ data: [{ instId: "BTC-USDT-SWAP", markPx: "60000" }] });
            const result = await getMarkPrice();
            expect(result).toBeDefined();
        });
    });
});
