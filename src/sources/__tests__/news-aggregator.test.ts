/**
 * Tests for src/sources/news-aggregator.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getNews,
    getBreakingNews,
    getTrending,
    getNewsByCategory,
    getHomepageNews,
    getSources,
    getCategories,
} from "../news-aggregator.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("news-aggregator source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getNews", () => {
        it("returns articles", async () => {
            mockFetch.mockResolvedValue({ data: [{ title: "BTC up", url: "https://x.com/1" }] });
            const result = await getNews();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getNews()).rejects.toThrow();
        });
    });

    describe("getBreakingNews", () => {
        it("returns breaking news", async () => {
            mockFetch.mockResolvedValue({ data: [{ title: "Breaking" }] });
            const result = await getBreakingNews(5);
            expect(result).toBeDefined();
        });
    });

    describe("getTrending", () => {
        it("returns trending topics", async () => {
            mockFetch.mockResolvedValue({ data: [{ topic: "ETH", score: 95 }] });
            const result = await getTrending(5);
            expect(result).toBeDefined();
        });
    });

    describe("getNewsByCategory", () => {
        it("returns categorized news", async () => {
            mockFetch.mockResolvedValue({ data: [{ title: "DeFi update" }] });
            const result = await getNewsByCategory("defi", 10);
            expect(result).toBeDefined();
        });
    });

    describe("getHomepageNews", () => {
        it("returns homepage bundle", async () => {
            mockFetch.mockResolvedValue({ data: [{ title: "News" }] });
            const result = await getHomepageNews();
            expect(result).toBeDefined();
        });
    });

    describe("getSources", () => {
        it("returns source list", () => {
            const result = getSources();
            expect(result.sources).toBeDefined();
            expect(result.count).toBeGreaterThanOrEqual(0);
        });
    });

    describe("getCategories", () => {
        it("returns category list", () => {
            const result = getCategories();
            expect(result.categories).toBeDefined();
        });
    });
});
