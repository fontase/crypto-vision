/**
 * Integration tests for health & meta endpoints: /, /health, /api
 *
 * Uses Hono test client against the main app.
 * All upstream dependencies are mocked.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

// ─── Mock all external sources so the app boots cleanly ──────

vi.mock("../../sources/coingecko.js", () => ({
  getCoins: vi.fn().mockResolvedValue([]),
  getCoinDetail: vi.fn(),
  getPrice: vi.fn(),
  getTrending: vi.fn(),
  getGlobal: vi.fn(),
  searchCoins: vi.fn(),
  getMarketChart: vi.fn(),
  getOHLC: vi.fn(),
  getExchanges: vi.fn(),
  getCategories: vi.fn(),
}));

vi.mock("../../sources/alternative.js", () => ({
  getFearGreedIndex: vi.fn(),
}));

vi.mock("../../sources/defillama.js", () => ({
  getProtocols: vi.fn(),
  getProtocolDetail: vi.fn(),
  getChainsTVL: vi.fn(),
  getChainTVLHistory: vi.fn(),
  getYieldPools: vi.fn(),
  getStablecoins: vi.fn(),
  getDexVolumes: vi.fn(),
  getFeesRevenue: vi.fn(),
  getBridges: vi.fn(),
  getRaises: vi.fn(),
  getTokenPrices: vi.fn(),
}));

vi.mock("../../sources/crypto-news.js", () => ({
  getNews: vi.fn().mockResolvedValue([]),
  searchNews: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/queue.js", () => ({
  aiQueue: { add: vi.fn(), stats: () => ({ pending: 0, active: 0 }) },
  heavyFetchQueue: { add: vi.fn(), stats: () => ({ pending: 0, active: 0 }) },
}));

// Stub Redis
vi.stubEnv("REDIS_URL", "");

import app from "../../index.js";

// ─── GET / ───────────────────────────────────────────────────

describe("GET /", () => {
  it("returns the API identity payload", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      name: "Crypto Vision",
      version: "0.1.0",
    });
    expect(body).toHaveProperty("docs", "/api");
    expect(body).toHaveProperty("health", "/health");
  });
});

// ─── GET /health ─────────────────────────────────────────────

describe("GET /health", () => {
  it("returns status ok with diagnostic info", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("cache");
    expect(body).toHaveProperty("memory");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("string");
  });

  it("includes cache stats", async () => {
    const res = await app.request("/health");
    const body = await res.json();
    expect(body.cache).toHaveProperty("memoryEntries");
    expect(body.cache).toHaveProperty("redisConnected");
  });

  it("includes memory stats", async () => {
    const res = await app.request("/health");
    const body = await res.json();
    expect(body.memory).toHaveProperty("rss");
    expect(body.memory).toHaveProperty("heapUsed");
    expect(typeof body.memory.rss).toBe("number");
    expect(typeof body.memory.heapUsed).toBe("number");
  });
});

// ─── GET /api ────────────────────────────────────────────────

describe("GET /api", () => {
  it("returns API documentation", async () => {
    const res = await app.request("/api");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("name", "Crypto Vision API");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("endpoints");
    expect(body.endpoints).toHaveProperty("market");
    expect(body.endpoints).toHaveProperty("defi");
    expect(body.endpoints).toHaveProperty("news");
    expect(body.endpoints).toHaveProperty("ai");
  });
});

// ─── 404 ─────────────────────────────────────────────────────

describe("404 handler", () => {
  it("returns 404 JSON for unmatched routes", async () => {
    const res = await app.request("/nonexistent-path");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error", "Not Found");
    expect(body).toHaveProperty("docs", "/api");
  });
});
