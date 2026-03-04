/**
 * Tests for src/sources/oracles.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getMainnetFeeds,
    getAllNetworkFeeds,
    getDiaQuotation,
    getDiaAssetList,
    getDiaSupply,
    getPythPriceFeeds,
    getPythPriceFeedIds,
} from "../oracles.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("oracles source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getMainnetFeeds", () => {
        it("returns Chainlink feeds", async () => {
            mockFetch.mockResolvedValue([{ pair: "ETH/USD", answer: "3000" }]);
            const result = await getMainnetFeeds();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getMainnetFeeds()).rejects.toThrow();
        });
    });

    describe("getAllNetworkFeeds", () => {
        it("returns all network feeds", async () => {
            mockFetch.mockResolvedValue({ ethereum: [], polygon: [] });
            const result = await getAllNetworkFeeds();
            expect(result).toBeDefined();
        });
    });

    describe("getDiaQuotation", () => {
        it("returns DIA quotation", async () => {
            mockFetch.mockResolvedValue({ Symbol: "BTC", Price: 60000 });
            const result = await getDiaQuotation("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getDiaAssetList", () => {
        it("returns DIA asset list", async () => {
            mockFetch.mockResolvedValue({ Coins: [{ Symbol: "BTC", Name: "Bitcoin" }] });
            const result = await getDiaAssetList();
            expect(result.Coins).toHaveLength(1);
        });
    });

    describe("getDiaSupply", () => {
        it("returns DIA supply", async () => {
            mockFetch.mockResolvedValue({ Symbol: "BTC", CirculatingSupply: 19000000 });
            const result = await getDiaSupply("BTC");
            expect(result.Symbol).toBe("BTC");
        });
    });

    describe("getPythPriceFeeds", () => {
        it("returns Pyth price feeds", async () => {
            mockFetch.mockResolvedValue([{ id: "0x1", price: { price: "60000" } }]);
            const result = await getPythPriceFeeds(["0x1"]);
            expect(result).toBeDefined();
        });
    });

    describe("getPythPriceFeedIds", () => {
        it("returns Pyth feed ids", async () => {
            mockFetch.mockResolvedValue(["0x1", "0x2"]);
            const result = await getPythPriceFeedIds();
            expect(result).toBeDefined();
        });
    });
});
