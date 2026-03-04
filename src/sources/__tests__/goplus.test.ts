/**
 * Tests for src/sources/goplus.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getTokenSecurity, getAddressSecurity, getSupportedChains, getDappSecurity } from "../goplus.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("goplus source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getTokenSecurity", () => {
        it("returns token security data", async () => {
            mockFetch.mockResolvedValue({ result: { "0x123": { is_honeypot: "0" } } });
            const result = await getTokenSecurity("1", "0x123");
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getTokenSecurity("1", "0x123")).rejects.toThrow();
        });
    });

    describe("getAddressSecurity", () => {
        it("returns address security data", async () => {
            mockFetch.mockResolvedValue({ result: { is_blacklisted: false } });
            const result = await getAddressSecurity("1", "0x123");
            expect(result).toBeDefined();
        });
    });

    describe("getSupportedChains", () => {
        it("returns supported chains", async () => {
            mockFetch.mockResolvedValue({ result: [{ id: "1", name: "Ethereum" }] });
            const result = await getSupportedChains();
            expect(result).toBeDefined();
        });
    });

    describe("getDappSecurity", () => {
        it("returns dapp security data", async () => {
            mockFetch.mockResolvedValue({ result: { is_phishing: false } });
            const result = await getDappSecurity("https://app.uniswap.org");
            expect(result).toBeDefined();
        });
    });
});
