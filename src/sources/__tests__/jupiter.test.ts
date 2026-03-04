/**
 * Tests for src/sources/jupiter.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getPrice,
    getTokenList,
    getStrictTokenList,
    getPopularPrices,
    getTopTokensByMarketCap,
    searchTokens,
} from "../jupiter.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("jupiter source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getPrice", () => {
        it("returns token prices", async () => {
            mockFetch.mockResolvedValue({ data: { SOL: { id: "SOL", price: "150" } } });
            const result = await getPrice("SOL");
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getPrice("SOL")).rejects.toThrow();
        });
    });

    describe("getTokenList", () => {
        it("returns full token list", async () => {
            mockFetch.mockResolvedValue([{ address: "So11...", symbol: "SOL" }]);
            const result = await getTokenList();
            expect(result).toBeDefined();
        });
    });

    describe("getStrictTokenList", () => {
        it("returns strict token list", async () => {
            mockFetch.mockResolvedValue([{ address: "So11...", symbol: "SOL" }]);
            const result = await getStrictTokenList();
            expect(result).toBeDefined();
        });
    });

    describe("getPopularPrices", () => {
        it("returns popular token prices", async () => {
            mockFetch.mockResolvedValue({ data: { SOL: { price: "150" } } });
            const result = await getPopularPrices();
            expect(result).toBeDefined();
        });
    });

    describe("getTopTokensByMarketCap", () => {
        it("returns top tokens", async () => {
            mockFetch.mockResolvedValue([{ symbol: "SOL", market_cap: 50e9 }]);
            const result = await getTopTokensByMarketCap(10);
            expect(result).toBeDefined();
        });
    });

    describe("searchTokens", () => {
        it("returns search results", async () => {
            mockFetch.mockResolvedValue([{ symbol: "SOL" }]);
            const result = await searchTokens("SOL");
            expect(result).toBeDefined();
        });
    });
});
