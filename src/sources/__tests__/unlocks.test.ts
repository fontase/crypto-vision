/**
 * Tests for src/sources/unlocks.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getEmissionsProtocols,
    getProtocolEmissions,
    getUpcomingUnlocks,
    getTokenUnlocks,
    getUnlockCalendar,
    getLargeUnlocks,
    getCliffUnlocks,
    getUnlockImpact,
    getVestingSchedule,
    getProtocolSupply,
    getTrackedEmissions,
} from "../unlocks.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("unlocks source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getEmissionsProtocols", () => {
        it("returns emissions protocols", async () => {
            mockFetch.mockResolvedValue([{ name: "Arbitrum", tvl: 1000000 }]);
            const result = await getEmissionsProtocols();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getEmissionsProtocols()).rejects.toThrow();
        });
    });

    describe("getProtocolEmissions", () => {
        it("returns protocol emissions", async () => {
            mockFetch.mockResolvedValue({ hallmarks: [], events: [] });
            const result = await getProtocolEmissions("arbitrum");
            expect(result).toBeDefined();
        });
    });

    describe("getUpcomingUnlocks", () => {
        it("returns upcoming unlocks", async () => {
            mockFetch.mockResolvedValue([{ name: "Arbitrum", tvl: 1000000 }]);
            const result = await getUpcomingUnlocks(30);
            expect(result).toBeDefined();
        });
    });

    describe("getTokenUnlocks", () => {
        it("returns token unlock data", async () => {
            mockFetch.mockResolvedValue([{ name: "Arbitrum", tvl: 1000000 }]);
            const result = await getTokenUnlocks("ARB");
            expect(result).toBeDefined();
        });
    });

    describe("getUnlockCalendar", () => {
        it("returns unlock calendar", async () => {
            mockFetch.mockResolvedValue([{ name: "Arbitrum", tvl: 1000000 }]);
            const result = await getUnlockCalendar(90);
            expect(result).toBeDefined();
        });
    });

    describe("getLargeUnlocks", () => {
        it("returns large unlocks", async () => {
            mockFetch.mockResolvedValue([{ name: "Arbitrum", tvl: 1000000 }]);
            const result = await getLargeUnlocks();
            expect(result).toBeDefined();
        });
    });

    describe("getCliffUnlocks", () => {
        it("returns cliff unlocks", async () => {
            mockFetch.mockResolvedValue([{ name: "Arbitrum", tvl: 1000000 }]);
            const result = await getCliffUnlocks();
            expect(result).toBeDefined();
        });
    });

    describe("getUnlockImpact", () => {
        it("returns unlock impact", async () => {
            mockFetch.mockResolvedValue([{ name: "Arbitrum", tvl: 1000000 }]);
            const result = await getUnlockImpact("ARB");
            expect(result).toBeDefined();
        });
    });

    describe("getVestingSchedule", () => {
        it("returns vesting schedule", async () => {
            mockFetch.mockResolvedValue([{ name: "Arbitrum", tvl: 1000000 }]);
            const result = await getVestingSchedule("ARB");
            expect(result).toBeDefined();
        });
    });

    describe("getProtocolSupply", () => {
        it("returns protocol supply", async () => {
            mockFetch.mockResolvedValue({ hallmarks: [], events: [] });
            const result = await getProtocolSupply("arbitrum");
            expect(result).toBeDefined();
        });
    });

    describe("getTrackedEmissions", () => {
        it("returns tracked emissions", async () => {
            mockFetch.mockResolvedValue({ hallmarks: [], events: [] });
            const result = await getTrackedEmissions();
            expect(result).toBeDefined();
        });
    });
});
