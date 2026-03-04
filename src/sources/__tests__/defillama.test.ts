/**
 * Tests for src/sources/defillama.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getProtocols,
    getProtocolDetail,
    getChainsTVL,
    getChainTVLHistory,
    getYieldPools,
    getStablecoins,
    getDexVolumes,
    getFeesRevenue,
    getBridges,
    getRaises,
    getHacks,
    getOptionsVolume,
    getDerivativesVolume,
    getHistoricalTVL,
    getTreasuries,
    getNFTCollections,
    getRevenue,
    getLiquidations,
} from "../defillama.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("defillama source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getProtocols", () => {
        it("returns protocols list", async () => {
            mockFetch.mockResolvedValue([{ name: "Aave", tvl: 10e9 }]);
            const result = await getProtocols();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Aave");
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getProtocols()).rejects.toThrow();
        });
    });

    describe("getProtocolDetail", () => {
        it("returns protocol detail", async () => {
            mockFetch.mockResolvedValue({ name: "Aave", tvl: 10e9, chains: ["Ethereum"] });
            const result = await getProtocolDetail("aave");
            expect(result.name).toBe("Aave");
        });
    });

    describe("getChainsTVL", () => {
        it("returns chains TVL", async () => {
            mockFetch.mockResolvedValue([{ name: "Ethereum", tvl: 50e9 }]);
            const result = await getChainsTVL();
            expect(result).toHaveLength(1);
        });
    });

    describe("getYieldPools", () => {
        it("returns yield pools", async () => {
            mockFetch.mockResolvedValue({ data: [{ pool: "1", apy: 5.5 }] });
            const result = await getYieldPools();
            expect(result.data).toHaveLength(1);
        });
    });

    describe("getStablecoins", () => {
        it("returns stablecoin data", async () => {
            mockFetch.mockResolvedValue({ peggedAssets: [{ name: "USDT" }] });
            const result = await getStablecoins();
            expect(result).toBeDefined();
        });
    });

    describe("getDexVolumes", () => {
        it("returns DEX volumes", async () => {
            mockFetch.mockResolvedValue({ protocols: [{ name: "Uniswap" }] });
            const result = await getDexVolumes();
            expect(result).toBeDefined();
        });
    });

    describe("getRaises", () => {
        it("returns fundraising data", async () => {
            mockFetch.mockResolvedValue({ raises: [{ name: "Test", amount: 10e6 }] });
            const result = await getRaises();
            expect(result).toBeDefined();
        });
    });

    describe("getHacks", () => {
        it("returns hack data", async () => {
            mockFetch.mockResolvedValue([{ name: "Hack1", amount: 100e6 }]);
            const result = await getHacks();
            expect(result).toBeDefined();
        });
    });

    describe("getHistoricalTVL", () => {
        it("returns historical TVL", async () => {
            mockFetch.mockResolvedValue([{ date: 1700000000, tvl: 50e9 }]);
            const result = await getHistoricalTVL();
            expect(result).toBeDefined();
        });
    });

    describe("getLiquidations", () => {
        it("returns liquidation data", async () => {
            mockFetch.mockResolvedValue([{ protocol: "Aave", amount: 1e6 }]);
            const result = await getLiquidations();
            expect(result).toBeDefined();
        });
    });
});
