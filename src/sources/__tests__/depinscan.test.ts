/**
 * Tests for src/sources/depinscan.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getProjects, getProject, getCategories, getMetrics } from "../depinscan.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("depinscan source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getProjects", () => {
        it("returns DePIN projects", async () => {
            mockFetch.mockResolvedValue([{ name: "Helium", slug: "helium" }]);
            const result = await getProjects(10);
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getProjects(10)).rejects.toThrow();
        });
    });

    describe("getProject", () => {
        it("returns project detail", async () => {
            mockFetch.mockResolvedValue({ name: "Helium", description: "IoT network" });
            const result = await getProject("helium");
            expect(result).toBeDefined();
        });
    });

    describe("getCategories", () => {
        it("returns categories", async () => {
            mockFetch.mockResolvedValue([{ name: "Wireless" }]);
            const result = await getCategories();
            expect(result).toBeDefined();
        });
    });

    describe("getMetrics", () => {
        it("returns DePIN metrics", async () => {
            mockFetch.mockResolvedValue({ totalProjects: 100 });
            const result = await getMetrics();
            expect(result).toBeDefined();
        });
    });
});
