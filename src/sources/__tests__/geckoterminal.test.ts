/**
 * Tests for src/sources/geckoterminal.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getNetworks, getTrendingPools, getNewPools, getTokenInfo, searchPools, getTopPools } from "../geckoterminal.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("geckoterminal source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getNetworks", () => {
        it("returns supported networks", async () => {
            mockFetch.mockResolvedValue({ data: [{ id: "eth", attributes: { name: "Ethereum" } }] });
            const result = await getNetworks();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getNetworks()).rejects.toThrow();
        });
    });

    describe("getTrendingPools", () => {
        it("returns trending pools", async () => {
            mockFetch.mockResolvedValue({ data: [{ id: "pool1", attributes: { name: "WETH/USDC" } }] });
            const result = await getTrendingPools("eth");
            expect(result).toBeDefined();
        });
    });

    describe("getNewPools", () => {
        it("returns new pools", async () => {
            mockFetch.mockResolvedValue({ data: [{ id: "pool2" }] });
            const result = await getNewPools("eth");
            expect(result).toBeDefined();
        });
    });

    describe("getTokenInfo", () => {
        it("returns token info", async () => {
            mockFetch.mockResolvedValue({ data: { id: "token1", attributes: { name: "WETH" } } });
            const result = await getTokenInfo("eth", "0x123");
            expect(result).toBeDefined();
        });
    });

    describe("searchPools", () => {
        it("returns search results", async () => {
            mockFetch.mockResolvedValue({ data: [{ id: "pool3" }] });
            const result = await searchPools("WETH");
            expect(result).toBeDefined();
        });
    });

    describe("getTopPools", () => {
        it("returns top pools", async () => {
            mockFetch.mockResolvedValue({ data: [{ id: "pool4" }] });
            const result = await getTopPools("eth");
            expect(result).toBeDefined();
        });
    });
});
