/**
 * Tests for src/sources/crypto-news.ts
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
    getSources,
} from "../crypto-news.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("crypto-news source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getNews", () => {
        it("returns news articles", async () => {
            mockFetch.mockResolvedValue([{ title: "BTC up", url: "https://x.com", source: "test" }]);
            const result = await getNews({});
            expect(result).toBeDefined();
        });

        it("handles empty response", async () => {
            mockFetch.mockResolvedValue([]);
            const result = await getNews({});
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe("getBreakingNews", () => {
        it("returns breaking news", async () => {
            mockFetch.mockResolvedValue([{ title: "Breaking" }]);
            const result = await getBreakingNews(5);
            expect(result).toBeDefined();
        });
    });

    describe("getTrending", () => {
        it("returns trending news", async () => {
            mockFetch.mockResolvedValue([{ title: "Trending" }]);
            const result = await getTrending(5);
            expect(result).toBeDefined();
        });
    });

    describe("getSources", () => {
        it("returns available sources", async () => {
            const result = await getSources();
            expect(result).toBeDefined();
        });
    });
});
