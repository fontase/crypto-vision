/**
 * Tests for src/sources/staking.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getValidatorQueue,
    getLatestEpoch,
    getETHNetworkStats,
    getValidator,
    getValidatorAttestations,
    getRatedOverview,
    getTopOperators,
    getNetworkMetrics,
    getLiquidStakingProtocols,
    getLiquidStaking,
    getLiquidStakingByChain,
    getRestakingProtocols,
    getStakingYields,
    getStakingYield,
    getStakingHistory,
    getChainValidators,
    getStakingOverview,
} from "../staking.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("staking source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getValidatorQueue", () => {
        it("returns validator queue", async () => {
            mockFetch.mockResolvedValue({ data: { beaconchain_entering: 100 } });
            const result = await getValidatorQueue();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getValidatorQueue()).rejects.toThrow();
        });
    });

    describe("getLatestEpoch", () => {
        it("returns latest epoch", async () => {
            mockFetch.mockResolvedValue({ data: { epoch: 200000 } });
            const result = await getLatestEpoch();
            expect(result).toBeDefined();
        });
    });

    describe("getETHNetworkStats", () => {
        it("returns network stats", async () => {
            mockFetch.mockResolvedValue({ data: { epoch: 200000 } });
            const result = await getETHNetworkStats();
            expect(result).toBeDefined();
        });
    });

    describe("getValidator", () => {
        it("returns validator data", async () => {
            mockFetch.mockResolvedValue({ data: { validatorindex: 1 } });
            const result = await getValidator("1");
            expect(result).toBeDefined();
        });
    });

    describe("getValidatorAttestations", () => {
        it("returns attestations", async () => {
            mockFetch.mockResolvedValue({ data: [{ epoch: 200000 }] });
            const result = await getValidatorAttestations("1");
            expect(result).toBeDefined();
        });
    });

    describe("getRatedOverview", () => {
        it("returns rated overview", async () => {
            mockFetch.mockResolvedValue({ data: [{ operatorName: "Lido" }] });
            const result = await getRatedOverview();
            expect(result).toBeDefined();
        });
    });

    describe("getTopOperators", () => {
        it("returns top operators", async () => {
            mockFetch.mockResolvedValue({ data: [{ operatorName: "Lido" }] });
            const result = await getTopOperators();
            expect(result).toBeDefined();
        });
    });

    describe("getNetworkMetrics", () => {
        it("returns network metrics", async () => {
            mockFetch.mockResolvedValue({ data: { validatorCount: 800000 } });
            const result = await getNetworkMetrics();
            expect(result).toBeDefined();
        });
    });

    describe("getLiquidStakingProtocols", () => {
        it("returns LST protocols", async () => {
            mockFetch.mockResolvedValue([{ name: "Lido", category: "Liquid Staking" }]);
            const result = await getLiquidStakingProtocols();
            expect(result).toBeDefined();
        });
    });

    describe("getLiquidStaking", () => {
        it("returns liquid staking data", async () => {
            mockFetch.mockResolvedValue([{ name: "Lido", tvl: 15000000000 }]);
            const result = await getLiquidStaking();
            expect(result).toBeDefined();
        });
    });

    describe("getLiquidStakingByChain", () => {
        it("returns liquid staking by chain", async () => {
            mockFetch.mockResolvedValue([{ name: "Lido", tvl: 15000000000 }]);
            const result = await getLiquidStakingByChain("ethereum");
            expect(result).toBeDefined();
        });
    });

    describe("getRestakingProtocols", () => {
        it("returns restaking protocols", async () => {
            mockFetch.mockResolvedValue([{ name: "EigenLayer", tvl: 3000000000 }]);
            const result = await getRestakingProtocols();
            expect(result).toBeDefined();
        });
    });

    describe("getStakingYields", () => {
        it("returns staking yields", async () => {
            mockFetch.mockResolvedValue({ data: [{ pool: "ETH staking", apy: 3.5 }] });
            const result = await getStakingYields();
            expect(result).toBeDefined();
        });
    });

    describe("getStakingYield", () => {
        it("returns yield for specific token", async () => {
            mockFetch.mockResolvedValue({ data: [{ pool: "ETH staking", apy: 3.5 }] });
            const result = await getStakingYield("ETH");
            expect(result).toBeDefined();
        });
    });

    describe("getStakingHistory", () => {
        it("returns historical staking data", async () => {
            mockFetch.mockResolvedValue({ data: [{ timestamp: "2024-01-01", apy: 3.5 }] });
            const result = await getStakingHistory("ETH");
            expect(result).toBeDefined();
        });
    });

    describe("getChainValidators", () => {
        it("returns chain validators", async () => {
            mockFetch.mockResolvedValue({ data: [{ name: "node1" }] });
            const result = await getChainValidators("cosmos");
            expect(result).toBeDefined();
        });
    });

    describe("getStakingOverview", () => {
        it("returns staking overview", async () => {
            mockFetch.mockResolvedValue({ data: { epoch: 200000 } });
            const result = await getStakingOverview();
            expect(result).toBeDefined();
        });
    });
});
