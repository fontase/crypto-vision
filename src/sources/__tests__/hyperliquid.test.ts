/**
 * Tests for src/sources/hyperliquid.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getMetaAndAssetCtxs, getAllMids, getFundingHistory, getRecentTrades, getL1Stats } from "../hyperliquid.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("hyperliquid source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getMetaAndAssetCtxs", () => {
        it("returns meta and asset contexts", async () => {
            mockFetch.mockResolvedValue([{ universe: [{ name: "BTC" }] }, [{ funding: "0.0001" }]]);
            const result = await getMetaAndAssetCtxs();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getMetaAndAssetCtxs()).rejects.toThrow();
        });
    });

    describe("getAllMids", () => {
        it("returns all mid prices", async () => {
            mockFetch.mockResolvedValue({ BTC: "60000", ETH: "3600" });
            const result = await getAllMids();
            expect(result).toBeDefined();
        });
    });

    describe("getFundingHistory", () => {
        it("returns funding history", async () => {
            mockFetch.mockResolvedValue([{ coin: "BTC", fundingRate: "0.0001" }]);
            const result = await getFundingHistory("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getRecentTrades", () => {
        it("returns recent trades", async () => {
            mockFetch.mockResolvedValue([{ coin: "BTC", px: "60000", sz: "0.1" }]);
            const result = await getRecentTrades("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getL1Stats", () => {
        it("returns L1 stats", async () => {
            mockFetch.mockResolvedValue({ totalVolume: "1000000" });
            const result = await getL1Stats();
            expect(result).toBeDefined();
        });
    });
});
