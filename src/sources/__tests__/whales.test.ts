/**
 * Tests for src/sources/whales.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
  cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
  getChainStats,
  getLatestBTCTransactions,
  getAddressInfo,
  getBTCMempool,
  getBTCChart,
  getETHRichList,
  getTokenTopHolders,
  getRecentLargeETHTransfers,
  getWhaleOverview,
  getRecentWhaleTransactions,
  getWhaleTransactionsForToken,
  classifyWhaleActivity,
  getSmartMoneyTrades,
  analyzeSmartMoney,
  getExchangeFlows,
  getTokenExchangeFlows,
  getTopWalletsByChain,
  getWalletProfile,
  trackWallet,
  getTrackedWallets,
  getAccumulationSignal,
  getDormantWallets,
  getWhaleAlerts,
} from "../whales.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("whales source adapter", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  describe("getChainStats", () => {
    it("returns chain stats", async () => {
      mockFetch.mockResolvedValue({ data: { bitcoin: { data: { blocks: 800000 } } } });
      const result = await getChainStats();
      expect(result).toBeDefined();
    });

    it("handles error", async () => {
      mockFetch.mockRejectedValue(new Error("fail"));
      await expect(getChainStats()).rejects.toThrow();
    });
  });

  describe("getLatestBTCTransactions", () => {
    it("returns recent transactions", async () => {
      mockFetch.mockResolvedValue({ data: [{ hash: "0x1" }] });
      const result = await getLatestBTCTransactions();
      expect(result).toBeDefined();
    });
  });

  describe("getAddressInfo", () => {
    it("returns address info", async () => {
      mockFetch.mockResolvedValue({ data: { "0x1": { address: { balance: 100 } } } });
      const result = await getAddressInfo("bitcoin", "0x1");
      expect(result).toBeDefined();
    });
  });

  describe("getBTCMempool", () => {
    it("returns mempool data", async () => {
      mockFetch.mockResolvedValue({ data: { mempool_transactions: 5000 } });
      const result = await getBTCMempool();
      expect(result).toBeDefined();
    });
  });

  describe("getBTCChart", () => {
    it("returns chart data", async () => {
      mockFetch.mockResolvedValue({ values: [{ x: 1, y: 60000 }] });
      const result = await getBTCChart("market-price");
      expect(result).toBeDefined();
    });
  });

  describe("getETHRichList", () => {
    it("returns ETH rich list", async () => {
      mockFetch.mockResolvedValue({ result: [{ account: "0x1", balance: "1000000" }] });
      const result = await getETHRichList();
      expect(result).toBeDefined();
    });
  });

  describe("getTokenTopHolders", () => {
    it("returns token top holders", async () => {
      mockFetch.mockResolvedValue({ result: [{ TokenHolderAddress: "0x1" }] });
      const result = await getTokenTopHolders("0xdac17f958d2ee523a2206206994597c13d831ec7");
      expect(result).toBeDefined();
    });
  });

  describe("getRecentLargeETHTransfers", () => {
    it("returns large ETH transfers", async () => {
      mockFetch.mockResolvedValue({ result: [{ hash: "0x1", value: "1000000000000000000" }] });
      const result = await getRecentLargeETHTransfers("0x1");
      expect(result).toBeDefined();
    });
  });

  describe("getWhaleOverview", () => {
    it("returns whale overview", async () => {
      mockFetch.mockResolvedValue({ data: { bitcoin: { data: {} } } });
      const result = await getWhaleOverview();
      expect(result).toBeDefined();
    });
  });

  describe("getRecentWhaleTransactions", () => {
    it("returns recent whale txs", async () => {
      mockFetch.mockResolvedValue({ result: [{ hash: "0x1" }] });
      const result = await getRecentWhaleTransactions();
      expect(result).toBeDefined();
    });
  });

  describe("getWhaleTransactionsForToken", () => {
    it("returns token whale txs", async () => {
      mockFetch.mockResolvedValue({ result: [{ hash: "0x1" }] });
      const result = await getWhaleTransactionsForToken("ETH");
      expect(result).toBeDefined();
    });
  });

  describe("classifyWhaleActivity", () => {
    it("classifies whale activity (sync)", () => {
      const txs = [
        { hash: "0x1", from: "0xa", to: "0xb", symbol: "ETH", amountUsd: 200000, type: "transfer" as const, timestamp: Date.now(), blockchain: "ethereum" },
      ];
      const result = classifyWhaleActivity(txs);
      expect(result).toBeDefined();
    });
  });

  describe("getSmartMoneyTrades", () => {
    it("returns smart money trades", async () => {
      mockFetch.mockResolvedValue({ result: [{ hash: "0x1" }] });
      const result = await getSmartMoneyTrades();
      expect(result).toBeDefined();
    });
  });

  describe("analyzeSmartMoney", () => {
    it("analyzes smart money trades (sync)", () => {
      const trades = [
        { wallet: "0x1", token: "ETH", action: "buy" as const, amountUsd: 50000, timestamp: Date.now(), exchange: "uniswap" },
      ];
      const result = analyzeSmartMoney(trades);
      expect(result).toBeDefined();
    });
  });

  describe("getExchangeFlows", () => {
    it("returns exchange flows", async () => {
      mockFetch.mockResolvedValue({ result: [{ exchange: "binance" }] });
      const result = await getExchangeFlows();
      expect(result).toBeDefined();
    });
  });

  describe("getTokenExchangeFlows", () => {
    it("returns token exchange flows", async () => {
      mockFetch.mockResolvedValue({ result: [{ exchange: "binance" }] });
      const result = await getTokenExchangeFlows("ETH");
      expect(result).toBeDefined();
    });
  });

  describe("getTopWalletsByChain", () => {
    it("returns top wallets", async () => {
      mockFetch.mockResolvedValue({ result: [{ account: "0x1" }] });
      const result = await getTopWalletsByChain("ethereum");
      expect(result).toBeDefined();
    });
  });

  describe("getWalletProfile", () => {
    it("returns wallet profile", async () => {
      mockFetch.mockResolvedValue({ result: [{ hash: "0x1" }] });
      const result = await getWalletProfile("0x1");
      expect(result).toBeDefined();
    });
  });

  describe("trackWallet", () => {
    it("tracks a wallet (sync)", () => {
      const result = trackWallet("0x1");
      expect(result).toBeDefined();
      expect(result.tracked).toBe(true);
    });
  });

  describe("getTrackedWallets", () => {
    it("returns tracked wallets (sync)", () => {
      const result = getTrackedWallets();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getAccumulationSignal", () => {
    it("returns accumulation signal", async () => {
      mockFetch.mockResolvedValue({ result: [{ hash: "0x1" }] });
      const result = await getAccumulationSignal("ETH");
      expect(result).toBeDefined();
    });
  });

  describe("getDormantWallets", () => {
    it("returns dormant wallets", async () => {
      mockFetch.mockResolvedValue({ result: [{ account: "0x1" }] });
      const result = await getDormantWallets();
      expect(result).toBeDefined();
    });
  });

  describe("getWhaleAlerts", () => {
    it("returns whale alerts", async () => {
      mockFetch.mockResolvedValue({ result: [{ hash: "0x1" }] });
      const result = await getWhaleAlerts();
      expect(result).toBeDefined();
    });
  });
});
