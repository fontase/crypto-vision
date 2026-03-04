/**
 * Tests for src/sources/messari.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getAssets, getAssetProfile, getAssetMetrics, getAssetMarketData, searchAssets, getAssetMarkets } from "../messari.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("messari source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getAssets", () => {
        it("returns asset list", async () => {
            mockFetch.mockResolvedValue({ data: [{ id: "1", symbol: "BTC", name: "Bitcoin" }] });
            const result = await getAssets(10, 1);
            expect(result.data).toHaveLength(1);
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getAssets(10, 1)).rejects.toThrow();
        });
    });

    describe("getAssetProfile", () => {
        it("returns asset profile", async () => {
            mockFetch.mockResolvedValue({ data: { profile: { general: {} } } });
            const result = await getAssetProfile("bitcoin");
            expect(result.data).toBeDefined();
        });
    });

    describe("getAssetMetrics", () => {
        it("returns asset metrics", async () => {
            mockFetch.mockResolvedValue({ data: { market_data: { price_usd: 60000 } } });
            const result = await getAssetMetrics("bitcoin");
            expect(result.data.market_data.price_usd).toBe(60000);
        });
    });

    describe("getAssetMarketData", () => {
        it("returns real-time market data", async () => {
            mockFetch.mockResolvedValue({ data: { market_data: { price_usd: 60000 } } });
            const result = await getAssetMarketData("bitcoin");
            expect(result.data).toBeDefined();
        });
    });

    describe("searchAssets", () => {
        it("returns search results", async () => {
            mockFetch.mockResolvedValue({ data: [{ id: "1", symbol: "BTC" }] });
            const result = await searchAssets("bitcoin");
            expect(result.data).toHaveLength(1);
        });
    });

    describe("getAssetMarkets", () => {
        it("returns asset market data", async () => {
            mockFetch.mockResolvedValue({ data: [{ exchange_name: "Binance" }] });
            const result = await getAssetMarkets("bitcoin");
            expect(result.data).toHaveLength(1);
        });
    });
});
