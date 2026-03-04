/**
 * Tests for src/sources/nft.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getTopCollections,
    getCollection,
    getCollectionActivity,
    getCollectionStats,
    getTrendingCollections,
    searchCollections,
    getCollectionBids,
    getCollectionListings,
    getUserNFTs,
    getNFTMarketplaces,
    getNFTCollectionChart,
    getNFTChains,
    getNFTList,
    getNFTDetail,
    getNFTMarketChart,
    getTrendingNFTs,
} from "../nft.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("nft source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getTopCollections", () => {
        it("returns collections", async () => {
            mockFetch.mockResolvedValue({ collections: [{ name: "BAYC", volume: 1000 }] });
            const result = await getTopCollections();
            expect(result.collections).toHaveLength(1);
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getTopCollections()).rejects.toThrow();
        });
    });

    describe("getCollection", () => {
        it("returns collection detail", async () => {
            mockFetch.mockResolvedValue({ collections: [{ name: "BAYC" }] });
            const result = await getCollection("bayc");
            expect(result.collections).toBeDefined();
        });
    });

    describe("getCollectionActivity", () => {
        it("returns activity", async () => {
            mockFetch.mockResolvedValue({ activities: [{ type: "sale" }] });
            const result = await getCollectionActivity("bayc");
            expect(result.activities).toBeDefined();
        });
    });

    describe("getCollectionStats", () => {
        it("returns stats", async () => {
            mockFetch.mockResolvedValue({ total: { volume: 5000 } });
            const result = await getCollectionStats("bayc");
            expect(result).toBeDefined();
        });
    });

    describe("getTrendingCollections", () => {
        it("returns trending", async () => {
            mockFetch.mockResolvedValue({ collections: [{ name: "Pudgy" }] });
            const result = await getTrendingCollections();
            expect(result.collections).toBeDefined();
        });
    });

    describe("searchCollections", () => {
        it("returns search results", async () => {
            mockFetch.mockResolvedValue({ collections: [{ name: "BAYC" }] });
            const result = await searchCollections("bored");
            expect(result.collections).toBeDefined();
        });
    });

    describe("getCollectionBids", () => {
        it("returns bids", async () => {
            mockFetch.mockResolvedValue({ orders: [{ price: 10 }] });
            const result = await getCollectionBids("bayc");
            expect(result.orders).toBeDefined();
        });
    });

    describe("getCollectionListings", () => {
        it("returns listings", async () => {
            mockFetch.mockResolvedValue({ orders: [{ price: 50 }] });
            const result = await getCollectionListings("bayc");
            expect(result.orders).toBeDefined();
        });
    });

    describe("getUserNFTs", () => {
        it("returns user tokens", async () => {
            mockFetch.mockResolvedValue({ tokens: [{ tokenId: "1" }] });
            const result = await getUserNFTs("0xabc");
            expect(result.tokens).toBeDefined();
        });
    });

    describe("getNFTMarketplaces", () => {
        it("returns marketplaces", async () => {
            mockFetch.mockResolvedValue({ marketplaces: ["opensea"] });
            const result = await getNFTMarketplaces();
            expect(result).toBeDefined();
        });
    });

    describe("getNFTCollectionChart", () => {
        it("returns chart data", async () => {
            mockFetch.mockResolvedValue({ prices: [[1, 2]] });
            const result = await getNFTCollectionChart("bayc");
            expect(result).toBeDefined();
        });
    });

    describe("getNFTChains", () => {
        it("returns chains", async () => {
            mockFetch.mockResolvedValue(["ethereum", "polygon"]);
            const result = await getNFTChains();
            expect(result).toBeDefined();
        });
    });

    describe("getNFTList", () => {
        it("returns nft list", async () => {
            mockFetch.mockResolvedValue([{ id: "bayc", name: "BAYC" }]);
            const result = await getNFTList();
            expect(result).toBeDefined();
        });
    });

    describe("getNFTDetail", () => {
        it("returns nft detail", async () => {
            mockFetch.mockResolvedValue({ id: "bayc", name: "BAYC" });
            const result = await getNFTDetail("bayc");
            expect(result).toBeDefined();
        });
    });

    describe("getNFTMarketChart", () => {
        it("returns market chart", async () => {
            mockFetch.mockResolvedValue({ prices: [[1, 2]] });
            const result = await getNFTMarketChart("bayc");
            expect(result).toBeDefined();
        });
    });

    describe("getTrendingNFTs", () => {
        it("returns trending nfts", async () => {
            mockFetch.mockResolvedValue([{ id: "pudgy" }]);
            const result = await getTrendingNFTs();
            expect(result).toBeDefined();
        });
    });
});
