/**
 * Tests for src/sources/cryptocompare.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getPrice,
    getPriceFull,
    getHistoDay,
    getHistoHour,
    getTopByMarketCap,
    getTopByVolume,
    getTradingSignals,
    getSocialStats,
    getTopExchanges,
    getNews,
    getNewsCategories,
    getBlockchainAvailable,
    getCoinList,
    resolveCoinId,
} from "../cryptocompare.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("cryptocompare source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getPrice", () => {
        it("returns price data", async () => {
            mockFetch.mockResolvedValue({ BTC: { USD: 60000 } });
            const result = await getPrice("BTC", "USD");
            expect(result.BTC.USD).toBe(60000);
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("API error"));
            await expect(getPrice("BTC", "USD")).rejects.toThrow();
        });
    });

    describe("getPriceFull", () => {
        it("returns full price data", async () => {
            mockFetch.mockResolvedValue({ RAW: { BTC: { USD: { PRICE: 60000 } } } });
            const result = await getPriceFull("BTC", "USD");
            expect(result.RAW.BTC.USD.PRICE).toBe(60000);
        });
    });

    describe("getHistoDay", () => {
        it("returns daily history", async () => {
            mockFetch.mockResolvedValue({ Data: { Data: [{ time: 1, close: 60000 }] } });
            const result = await getHistoDay("BTC", "USD", 30);
            expect(result.Data.Data).toHaveLength(1);
        });
    });

    describe("getHistoHour", () => {
        it("returns hourly history", async () => {
            mockFetch.mockResolvedValue({ Data: { Data: [{ time: 1, close: 60000 }] } });
            const result = await getHistoHour("BTC", "USD", 24);
            expect(result.Data.Data).toHaveLength(1);
        });
    });

    describe("getTopByMarketCap", () => {
        it("returns top coins by mcap", async () => {
            mockFetch.mockResolvedValue({ Data: [{ CoinInfo: { Name: "BTC" } }] });
            const result = await getTopByMarketCap("USD", 10);
            expect(result.Data).toHaveLength(1);
        });
    });

    describe("getTopByVolume", () => {
        it("returns top coins by volume", async () => {
            mockFetch.mockResolvedValue({ Data: [{ CoinInfo: { Name: "BTC" } }] });
            const result = await getTopByVolume("USD", 10);
            expect(result.Data).toHaveLength(1);
        });
    });

    describe("getTradingSignals", () => {
        it("returns trading signals", async () => {
            mockFetch.mockResolvedValue({ Data: { inOutVar: {} } });
            const result = await getTradingSignals("BTC");
            expect(result.Data).toBeDefined();
        });
    });

    describe("getSocialStats", () => {
        it("returns social stats", async () => {
            mockFetch.mockResolvedValue({ Data: { General: { Name: "Bitcoin" } } });
            const result = await getSocialStats(1182);
            expect(result.Data.General.Name).toBe("Bitcoin");
        });
    });

    describe("getNews", () => {
        it("returns news articles", async () => {
            mockFetch.mockResolvedValue({ Data: [{ title: "Test" }] });
            const result = await getNews();
            expect(result.Data).toHaveLength(1);
        });
    });

    describe("getNewsCategories", () => {
        it("returns news categories", async () => {
            mockFetch.mockResolvedValue({ Data: [{ categoryName: "BTC" }] });
            const result = await getNewsCategories();
            expect(result.Data).toHaveLength(1);
        });
    });

    describe("getBlockchainAvailable", () => {
        it("returns available blockchains", async () => {
            mockFetch.mockResolvedValue({ Data: { BTC: { id: 1 } } });
            const result = await getBlockchainAvailable();
            expect(result.Data.BTC).toBeDefined();
        });
    });

    describe("getCoinList", () => {
        it("returns coin list", async () => {
            mockFetch.mockResolvedValue({ Data: { BTC: { Id: "1", Symbol: "BTC" } } });
            const result = await getCoinList();
            expect(result.Data.BTC).toBeDefined();
        });
    });

    describe("resolveCoinId", () => {
        it("resolves coin symbol to id", async () => {
            mockFetch.mockResolvedValue({ Data: { BTC: { Id: "1182" } } });
            const result = await resolveCoinId("BTC");
            expect(result).toBe(1182);
        });

        it("returns null for unknown symbol", async () => {
            mockFetch.mockResolvedValue({ Data: {} });
            const result = await resolveCoinId("FAKE");
            expect(result).toBeNull();
        });
    });
});
