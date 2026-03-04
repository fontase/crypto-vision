/**
 * Tests for src/sources/portfolio.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    valuePortfolio,
    correlationMatrix,
    volatilityMetrics,
    diversificationScore,
} from "../portfolio.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("portfolio source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("valuePortfolio", () => {
        it("returns portfolio valuation", async () => {
            mockFetch.mockResolvedValue({
                bitcoin: { usd: 60000 },
                ethereum: { usd: 3000 },
            });
            const result = await valuePortfolio(
                [{ id: "bitcoin", quantity: 1 }, { id: "ethereum", quantity: 10 }],
                "usd",
            );
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(
                valuePortfolio([{ id: "bitcoin", quantity: 1 }], "usd"),
            ).rejects.toThrow();
        });
    });

    describe("correlationMatrix", () => {
        it("returns correlation data", async () => {
            mockFetch.mockResolvedValue({
                prices: [[1, 60000], [2, 60100]],
            });
            const result = await correlationMatrix(["bitcoin", "ethereum"], 30, "usd");
            expect(result).toBeDefined();
        });
    });

    describe("volatilityMetrics", () => {
        it("returns volatility data", async () => {
            mockFetch.mockResolvedValue({
                prices: [[1, 60000], [2, 60100], [3, 59900]],
            });
            const result = await volatilityMetrics("bitcoin", 30, "usd");
            expect(result).toBeDefined();
        });
    });

    describe("diversificationScore", () => {
        it("returns diversification data", async () => {
            mockFetch.mockResolvedValue({
                bitcoin: { usd: 60000 },
                ethereum: { usd: 3000 },
            });
            const result = await diversificationScore([
                { id: "bitcoin", quantity: 1 },
                { id: "ethereum", quantity: 10 },
            ]);
            expect(result).toBeDefined();
        });
    });
});
