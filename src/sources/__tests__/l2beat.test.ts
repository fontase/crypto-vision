/**
 * Tests for src/sources/l2beat.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getScalingSummary, getScalingTvl, getScalingActivity } from "../l2beat.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("l2beat source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getScalingSummary", () => {
        it("returns scaling summary", async () => {
            mockFetch.mockResolvedValue({ projects: [{ name: "Arbitrum", tvl: 10e9 }] });
            const result = await getScalingSummary();
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getScalingSummary()).rejects.toThrow();
        });
    });

    describe("getScalingTvl", () => {
        it("returns scaling TVL", async () => {
            mockFetch.mockResolvedValue({ projects: [{ name: "Arbitrum", tvl: 10e9 }] });
            const result = await getScalingTvl();
            expect(result).toBeDefined();
        });
    });

    describe("getScalingActivity", () => {
        it("returns scaling activity", async () => {
            mockFetch.mockResolvedValue({ projects: [{ name: "Arbitrum", txCount: 1000 }] });
            const result = await getScalingActivity();
            expect(result).toBeDefined();
        });
    });
});
