/**
 * Tests for src/sources/evm.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import { getGasOracle, getMultiChainGas, getEthGasOracle, getEthSupply, getEthPrice } from "../evm.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("evm source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getGasOracle", () => {
        it("returns gas oracle data", async () => {
            mockFetch.mockResolvedValue({ result: { SafeGasPrice: "10", ProposeGasPrice: "15", FastGasPrice: "20" } });
            const result = await getGasOracle("ethereum");
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getGasOracle("ethereum")).rejects.toThrow();
        });
    });

    describe("getMultiChainGas", () => {
        it("returns multi-chain gas data", async () => {
            mockFetch.mockResolvedValue({ result: { SafeGasPrice: "10" } });
            const result = await getMultiChainGas();
            expect(result).toBeDefined();
        });
    });

    describe("getEthGasOracle", () => {
        it("returns ETH gas oracle", async () => {
            mockFetch.mockResolvedValue({ result: { SafeGasPrice: "10", ProposeGasPrice: "15", FastGasPrice: "20" } });
            const result = await getEthGasOracle();
            expect(result).toBeDefined();
        });
    });

    describe("getEthSupply", () => {
        it("returns ETH supply", async () => {
            mockFetch.mockResolvedValue({ result: "120000000000000000000000000" });
            const result = await getEthSupply();
            expect(result).toBeDefined();
        });
    });

    describe("getEthPrice", () => {
        it("returns ETH price", async () => {
            mockFetch.mockResolvedValue({ result: { ethusd: "3600", ethbtc: "0.06" } });
            const result = await getEthPrice();
            expect(result).toBeDefined();
        });
    });
});
