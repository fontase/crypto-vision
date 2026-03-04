/**
 * Tests for src/sources/macro.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getStockIndices, getCommodities, getBondYields, getVolatility, getDXY, getMacroOverview, getQuote } from "../macro.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("macro source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getStockIndices", () => {
        it("returns stock indices", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "^SPX" }, indicators: { quote: [{ close: [5000] }] } }] } });
            const result = await getStockIndices();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getStockIndices()).rejects.toThrow();
        });
    });

    describe("getCommodities", () => {
        it("returns commodity data", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "GC=F" }, indicators: { quote: [{ close: [2000] }] } }] } });
            const result = await getCommodities();
            expect(result).toBeDefined();
        });
    });

    describe("getBondYields", () => {
        it("returns bond yields", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "^TNX" }, indicators: { quote: [{ close: [4.5] }] } }] } });
            const result = await getBondYields();
            expect(result).toBeDefined();
        });
    });

    describe("getVolatility", () => {
        it("returns VIX data", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "^VIX" }, indicators: { quote: [{ close: [18] }] } }] } });
            const result = await getVolatility();
            expect(result).toBeDefined();
        });
    });

    describe("getDXY", () => {
        it("returns dollar index", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "DX-Y.NYB" }, indicators: { quote: [{ close: [104] }] } }] } });
            const result = await getDXY();
            expect(result).toBeDefined();
        });
    });

    describe("getMacroOverview", () => {
        it("returns macro overview", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "^SPX" }, indicators: { quote: [{ close: [5000] }] } }] } });
            const result = await getMacroOverview();
            expect(result).toBeDefined();
        });
    });

    describe("getQuote", () => {
        it("returns quote for symbol", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "AAPL" }, indicators: { quote: [{ close: [180] }] } }] } });
            const result = await getQuote("AAPL");
            expect(result).toBeDefined();
        });
    });
});
