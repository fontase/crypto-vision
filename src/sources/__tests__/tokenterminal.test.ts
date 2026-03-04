/**
 * Tests for src/sources/tokenterminal.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getProjects,
    getProjectDetail,
    getProjectMetrics,
    getProjectFinancials,
    getMarketSectors,
    getTopByRevenue,
    getTopByFees,
    getTopByUsers,
    getTopByTVL,
    getMostUndervalued,
    getRevenueTimeseries,
    getFeesTimeseries,
    getActiveUsersTimeseries,
    calculatePSRatio,
    calculatePERatio,
    calculateRevenueMultiple,
    calculateTokenIncentiveEfficiency,
    rankByFundamental,
    identifyUndervalued,
    sectorComparison,
    calculateGrowthRate,
    getProtocolRevenue,
    getProtocolFees,
    getActiveUsers,
    getMarketMetric,
} from "../tokenterminal.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("tokenterminal source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getProjects", () => {
        it("returns projects", async () => {
            mockFetch.mockResolvedValue({ data: [{ project_id: "aave", name: "Aave" }] });
            const result = await getProjects();
            expect(result.data).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getProjects()).rejects.toThrow();
        });
    });

    describe("getProjectDetail", () => {
        it("returns project detail", async () => {
            mockFetch.mockResolvedValue({ data: { project_id: "aave" } });
            const result = await getProjectDetail("aave");
            expect(result.data).toBeDefined();
        });
    });

    describe("getProjectMetrics", () => {
        it("returns project metrics", async () => {
            mockFetch.mockResolvedValue({ data: [{ timestamp: "2024-01-01", revenue: 1000 }] });
            const result = await getProjectMetrics("aave");
            expect(result.data).toBeDefined();
        });
    });

    describe("getProjectFinancials", () => {
        it("returns financial statements", async () => {
            mockFetch.mockResolvedValue({ data: { revenue: 1000 } });
            const result = await getProjectFinancials("aave");
            expect(result.data).toBeDefined();
        });
    });

    describe("getMarketSectors", () => {
        it("returns market sectors", async () => {
            mockFetch.mockResolvedValue({ data: [{ sector: "DeFi" }] });
            const result = await getMarketSectors();
            expect(result.data).toBeDefined();
        });
    });

    describe("getTopByRevenue", () => {
        it("returns top by revenue", async () => {
            mockFetch.mockResolvedValue({ data: [{ project_id: "aave" }] });
            const result = await getTopByRevenue();
            expect(result.data).toBeDefined();
        });
    });

    describe("getTopByFees", () => {
        it("returns top by fees", async () => {
            mockFetch.mockResolvedValue({ data: [{ project_id: "uniswap" }] });
            const result = await getTopByFees();
            expect(result.data).toBeDefined();
        });
    });

    describe("getTopByUsers", () => {
        it("returns top by users", async () => {
            mockFetch.mockResolvedValue({ data: [{ project_id: "uniswap" }] });
            const result = await getTopByUsers();
            expect(result.data).toBeDefined();
        });
    });

    describe("getTopByTVL", () => {
        it("returns top by TVL", async () => {
            mockFetch.mockResolvedValue({ data: [{ project_id: "aave" }] });
            const result = await getTopByTVL();
            expect(result.data).toBeDefined();
        });
    });

    describe("getMostUndervalued", () => {
        it("returns undervalued projects", async () => {
            mockFetch.mockResolvedValue({ data: [{ project_id: "gmx" }] });
            const result = await getMostUndervalued();
            expect(result.data).toBeDefined();
        });
    });

    describe("getRevenueTimeseries", () => {
        it("returns revenue timeseries", async () => {
            mockFetch.mockResolvedValue({ data: [{ timestamp: "2024-01-01", value: 1000 }] });
            const result = await getRevenueTimeseries("aave");
            expect(result.data).toBeDefined();
        });
    });

    describe("getFeesTimeseries", () => {
        it("returns fees timeseries", async () => {
            mockFetch.mockResolvedValue({ data: [{ timestamp: "2024-01-01", value: 500 }] });
            const result = await getFeesTimeseries("aave");
            expect(result.data).toBeDefined();
        });
    });

    describe("getActiveUsersTimeseries", () => {
        it("returns active users timeseries", async () => {
            mockFetch.mockResolvedValue({ data: [{ timestamp: "2024-01-01", value: 10000 }] });
            const result = await getActiveUsersTimeseries("aave");
            expect(result.data).toBeDefined();
        });
    });

    describe("calculatePSRatio", () => {
        it("calculates P/S ratio", () => {
            expect(calculatePSRatio(1000000, 100000)).toBe(10);
        });

        it("handles zero revenue", () => {
            expect(calculatePSRatio(1000000, 0)).toBe(Infinity);
        });
    });

    describe("calculatePERatio", () => {
        it("calculates P/E ratio", () => {
            expect(calculatePERatio(1000000, 50000)).toBe(20);
        });
    });

    describe("calculateRevenueMultiple", () => {
        it("calculates revenue multiple", () => {
            expect(calculateRevenueMultiple(1000000, 100000)).toBe(10);
        });
    });

    describe("calculateTokenIncentiveEfficiency", () => {
        it("calculates efficiency", () => {
            expect(calculateTokenIncentiveEfficiency(100000, 50000)).toBe(2);
        });
    });

    describe("rankByFundamental", () => {
        it("ranks projects by metric", () => {
            const projects = [
                { project_id: "a", revenue: 100 },
                { project_id: "b", revenue: 200 },
            ] as any[];
            const result = rankByFundamental(projects, "revenue" as any);
            expect(result).toBeDefined();
        });
    });

    describe("identifyUndervalued", () => {
        it("identifies undervalued projects", () => {
            const projects = [
                { project_id: "a", market_cap: 1000, revenue: 500, ps_ratio: 2 },
            ] as any[];
            const result = identifyUndervalued(projects);
            expect(result).toBeDefined();
        });
    });

    describe("sectorComparison", () => {
        it("compares sectors", () => {
            const projects = [
                { project_id: "a", category: "DeFi", revenue: 100 },
            ] as any[];
            const result = sectorComparison(projects);
            expect(result).toBeDefined();
        });
    });

    describe("calculateGrowthRate", () => {
        it("calculates growth rate", () => {
            const timeseries = [
                { timestamp: "2024-01-01", value: 100 },
                { timestamp: "2024-01-08", value: 110 },
            ] as any[];
            const result = calculateGrowthRate(timeseries, "7d");
            expect(typeof result).toBe("number");
        });
    });

    describe("getProtocolRevenue", () => {
        it("returns protocol revenue", async () => {
            mockFetch.mockResolvedValue({ protocols: [{ name: "Aave" }] });
            const result = await getProtocolRevenue();
            expect(result).toBeDefined();
        });
    });

    describe("getProtocolFees", () => {
        it("returns protocol fees", async () => {
            mockFetch.mockResolvedValue({ protocols: [{ name: "Uniswap" }] });
            const result = await getProtocolFees();
            expect(result).toBeDefined();
        });
    });

    describe("getActiveUsers", () => {
        it("returns active users", async () => {
            mockFetch.mockResolvedValue({ protocols: [{ name: "Uniswap" }] });
            const result = await getActiveUsers();
            expect(result).toBeDefined();
        });
    });

    describe("getMarketMetric", () => {
        it("returns market metric", async () => {
            mockFetch.mockResolvedValue({ data: [{ timestamp: "2024-01-01", value: 100 }] });
            const result = await getMarketMetric("tvl");
            expect(result).toBeDefined();
        });
    });
});
