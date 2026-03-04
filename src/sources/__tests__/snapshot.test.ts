/**
 * Tests for src/sources/snapshot.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getProposals,
    getActiveProposals,
    getTopSpaces,
    getSpace,
    getVotes,
    searchSpaces,
} from "../snapshot.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("snapshot source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getProposals", () => {
        it("returns proposals for a space", async () => {
            mockFetch.mockResolvedValue({ data: { proposals: [{ id: "1", title: "Test" }] } });
            const result = await getProposals("aave.eth");
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getProposals("aave.eth")).rejects.toThrow();
        });
    });

    describe("getActiveProposals", () => {
        it("returns active proposals across spaces", async () => {
            mockFetch.mockResolvedValue({ data: { proposals: [{ id: "1", state: "active" }] } });
            const result = await getActiveProposals();
            expect(result).toBeDefined();
        });
    });

    describe("getTopSpaces", () => {
        it("returns top spaces", async () => {
            mockFetch.mockResolvedValue({ data: { spaces: [{ id: "aave.eth", name: "Aave" }] } });
            const result = await getTopSpaces();
            expect(result).toBeDefined();
        });
    });

    describe("getSpace", () => {
        it("returns space detail", async () => {
            mockFetch.mockResolvedValue({ data: { space: { id: "aave.eth", name: "Aave" } } });
            const result = await getSpace("aave.eth");
            expect(result).toBeDefined();
        });
    });

    describe("getVotes", () => {
        it("returns votes for a proposal", async () => {
            mockFetch.mockResolvedValue({ data: { votes: [{ voter: "0x1", choice: 1 }] } });
            const result = await getVotes("proposal-id");
            expect(result).toBeDefined();
        });
    });

    describe("searchSpaces", () => {
        it("returns search results", async () => {
            mockFetch.mockResolvedValue({ data: { spaces: [{ id: "aave.eth" }] } });
            const result = await searchSpaces("aave");
            expect(result).toBeDefined();
        });
    });
});
