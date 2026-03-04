/**
 * Tests for src/sources/etf.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getBTCETFs, getETHETFs, getETFOverview, getETFPremiums, getTickers } from "../etf.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("etf source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getBTCETFs", () => {
        it("returns BTC ETF data", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "IBIT" }, indicators: { quote: [{ close: [50] }] } }] } });
            const result = await getBTCETFs();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getBTCETFs()).rejects.toThrow();
        });
    });

    describe("getETHETFs", () => {
        it("returns ETH ETF data", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "ETHA" }, indicators: { quote: [{ close: [30] }] } }] } });
            const result = await getETHETFs();
            expect(result).toBeDefined();
        });
    });

    describe("getETFOverview", () => {
        it("returns ETF overview", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "IBIT" }, indicators: { quote: [{ close: [50] }] } }] } });
            const result = await getETFOverview();
            expect(result).toBeDefined();
        });
    });

    describe("getETFPremiums", () => {
        it("returns ETF premiums", async () => {
            mockFetch.mockResolvedValue({ chart: { result: [{ meta: { symbol: "GBTC" }, indicators: { quote: [{ close: [48] }] } }] } });
            const result = await getETFPremiums();
            expect(result).toBeDefined();
        });
    });

    describe("getTickers", () => {
        it("returns ticker list", async () => {
            const result = await getTickers();
            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
        });
    });
});
