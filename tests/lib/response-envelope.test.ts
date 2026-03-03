/**
 * Tests for lib/response-envelope.ts — Response envelope middleware
 *
 * Covers:
 *   - getSource: upstream source mapping from request path
 *   - responseEnvelope: meta injection, data wrapping, skip paths
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { getSource, responseEnvelope } from "@/lib/response-envelope.js";

// ─── Unit: getSource ─────────────────────────────────────────

describe("getSource", () => {
  it("maps /api/defi/protocols to defillama", () => {
    expect(getSource("/api/defi/protocols")).toBe("defillama");
  });

  it("maps /api/coins to coingecko", () => {
    expect(getSource("/api/coins")).toBe("coingecko");
  });

  it("maps /api/news to cryptopanic", () => {
    expect(getSource("/api/news")).toBe("cryptopanic");
  });

  it("maps /api/bitcoin/stats to mempool.space", () => {
    expect(getSource("/api/bitcoin/stats")).toBe("mempool.space");
  });

  it("maps /api/ai/sentiment/btc to vertex-ai", () => {
    expect(getSource("/api/ai/sentiment/btc")).toBe("vertex-ai");
  });

  it("maps /api/cex/tickers to binance", () => {
    expect(getSource("/api/cex/tickers")).toBe("binance");
  });

  it("maps /api/macro/overview to yahoo-finance", () => {
    expect(getSource("/api/macro/overview")).toBe("yahoo-finance");
  });

  it("returns 'api' for unknown routes", () => {
    expect(getSource("/api/unknown-thing")).toBe("api");
  });
});

// ─── Integration: responseEnvelope ───────────────────────────

function createEnvelopeApp() {
  const app = new Hono();
  app.use("/api/*", responseEnvelope);

  app.get("/api/coins", (c) => c.json([{ id: "bitcoin", price: 42000 }]));
  app.get("/api/defi/protocols", (c) =>
    c.json({ data: [{ name: "aave" }], total: 100 }),
  );
  app.get("/api", (c) => c.json({ name: "Crypto Vision API" }));
  app.get("/api/ready", (c) => c.json({ status: "ready" }));
  app.get("/api/fail", (c) => c.json({ error: "not found" }, 404));
  app.post("/api/ai/ask", (c) => c.json({ answer: "response" }));
  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

describe("responseEnvelope", () => {
  const app = createEnvelopeApp();

  it("wraps array responses under { data, meta }", async () => {
    const res = await app.request("/api/coins");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("includes meta.source in the envelope", async () => {
    const res = await app.request("/api/coins");
    const json = (await res.json()) as { meta: { source: string } };
    expect(json.meta.source).toBe("coingecko");
  });

  it("includes meta.latencyMs as a number", async () => {
    const res = await app.request("/api/coins");
    const json = (await res.json()) as { meta: { latencyMs: number } };
    expect(typeof json.meta.latencyMs).toBe("number");
    expect(json.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("includes meta.cached as a boolean", async () => {
    const res = await app.request("/api/coins");
    const json = (await res.json()) as { meta: { cached: boolean } };
    expect(typeof json.meta.cached).toBe("boolean");
  });

  it("merges meta alongside existing data key", async () => {
    const res = await app.request("/api/defi/protocols");
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("total");
    expect(json).toHaveProperty("meta");
  });

  it("skips /api (docs listing path)", async () => {
    const res = await app.request("/api");
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toHaveProperty("name");
    expect(json).not.toHaveProperty("meta");
  });

  it("skips /api/ready", async () => {
    const res = await app.request("/api/ready");
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toHaveProperty("status");
    expect(json).not.toHaveProperty("meta");
  });

  it("skips error responses (4xx)", async () => {
    const res = await app.request("/api/fail");
    expect(res.status).toBe(404);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("meta");
  });

  it("does not apply to non-API routes", async () => {
    const res = await app.request("/health");
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("meta");
  });

  it("sets correct source for DeFi routes", async () => {
    const res = await app.request("/api/defi/protocols");
    const json = (await res.json()) as { meta: { source: string } };
    expect(json.meta.source).toBe("defillama");
  });
});
