/**
 * Crypto Vision — Main Entry Point
 *
 * The complete cryptocurrency intelligence API.
 * https://cryptocurrency.cv
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";
import { requestId } from "hono/request-id";
import { serve } from "@hono/node-server";

import { logger as log } from "@/lib/logger";
import { cache } from "@/lib/cache";
import { rateLimit } from "@/lib/rate-limit";
import { ApiError } from "@/lib/api-error";
import { requestLogger, globalErrorHandler } from "@/lib/middleware";
import { apiKeyAuth } from "@/lib/auth";
import { circuitBreakerStats } from "@/lib/fetcher";
import { aiQueue, heavyFetchQueue } from "@/lib/queue";

import { marketRoutes } from "@/routes/market";
import { defiRoutes } from "@/routes/defi";
import { newsRoutes } from "@/routes/news";
import { onchainRoutes } from "@/routes/onchain";
import { aiRoutes } from "@/routes/ai";
import { keysRoutes } from "@/routes/keys";

// ─── App ─────────────────────────────────────────────────────

const app = new Hono();

// ─── Global Middleware ───────────────────────────────────────

app.use("*", requestId());
app.use("*", timing());
app.use("*", secureHeaders());
app.use("*", compress());

app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow all in dev, restrict in prod
      if (process.env.NODE_ENV !== "production") return origin;
      const allowed = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim());
      if (allowed.includes("*") || allowed.includes(origin)) return origin;
      return "";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    maxAge: 86400,
  })
);

// API key auth — resolves tier (public / basic / pro) and attaches to context
app.use("/api/*", apiKeyAuth());

// Rate limit — dynamically uses tier from auth middleware
app.use("/api/*", rateLimit({ limit: 200, windowSeconds: 60 }));

// Structured request logging (method, path, status, duration)
app.use("*", requestLogger);

// ─── Health / Meta ───────────────────────────────────────────

app.get("/", (c) =>
  c.json({
    name: "Crypto Vision",
    description: "The complete cryptocurrency intelligence API",
    version: "0.1.0",
    docs: "/api",
    health: "/health",
    website: "https://cryptocurrency.cv",
  })
);

app.get("/health", async (c) => {
  const cacheStats = cache.stats();
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    cache: cacheStats,
    circuitBreakers: circuitBreakerStats(),
    queues: {
      ai: aiQueue.stats(),
      heavyFetch: heavyFetchQueue.stats(),
    },
    memory: {
      rss: Math.round(process.memoryUsage.rss() / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
    env: process.env.NODE_ENV || "development",
  });
});

// ─── Readiness Probe ─────────────────────────────────────────

app.get("/api/ready", async (c) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // Check in-memory cache layer (always healthy)
  checks.memory = { status: "ok" };

  // Check Redis connectivity (if configured)
  const cacheStats = cache.stats();
  if (cacheStats.redisConnected) {
    try {
      const start = Date.now();
      await cache.set("readiness:ping", "pong", 10);
      const val = await cache.get<string>("readiness:ping");
      const latencyMs = Date.now() - start;
      checks.redis = val === "pong"
        ? { status: "ok", latencyMs }
        : { status: "degraded", latencyMs, error: "read-back mismatch" };
    } catch (err: any) {
      checks.redis = { status: "fail", error: err.message };
    }
  } else if (process.env.REDIS_URL) {
    // Redis is configured but not connected
    checks.redis = { status: "fail", error: "Redis configured but not connected" };
  } else {
    checks.redis = { status: "skipped", error: "REDIS_URL not set — memory-only mode" };
  }

  const allOk = Object.values(checks).every(
    (ch) => ch.status === "ok" || ch.status === "skipped",
  );

  return c.json(
    {
      status: allOk ? "ready" : "not_ready",
      checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
    allOk ? 200 : 503,
  );
});

app.get("/api", (c) =>
  c.json({
    name: "Crypto Vision API",
    version: "0.1.0",
    endpoints: {
      market: {
        "GET /api/coins": "Top coins by market cap",
        "GET /api/coin/:id": "Coin detail",
        "GET /api/price": "Simple price lookup (?ids=bitcoin,ethereum&vs=usd)",
        "GET /api/trending": "Trending coins",
        "GET /api/global": "Global market stats",
        "GET /api/search": "Search coins (?q=...)",
        "GET /api/chart/:id": "Price chart data (?days=7)",
        "GET /api/ohlc/:id": "OHLC candles (?days=7)",
        "GET /api/exchanges": "Exchange rankings",
        "GET /api/categories": "Coin categories",
        "GET /api/fear-greed": "Fear & Greed Index",
        "GET /api/dex/search": "DEX token search (?q=...)",
      },
      defi: {
        "GET /api/defi/protocols": "Top DeFi protocols by TVL",
        "GET /api/defi/protocol/:slug": "Protocol detail + TVL history",
        "GET /api/defi/chains": "Chain TVL rankings",
        "GET /api/defi/chain/:name": "Chain TVL history",
        "GET /api/defi/yields": "Top yield opportunities",
        "GET /api/defi/stablecoins": "Stablecoin market data",
        "GET /api/defi/dex-volumes": "DEX volume rankings",
        "GET /api/defi/fees": "Protocol fee rankings",
        "GET /api/defi/bridges": "Bridge volume data",
        "GET /api/defi/raises": "Recent funding raises",
      },
      news: {
        "GET /api/news": "Latest crypto news",
        "GET /api/news/search": "Search news (?q=...)",
        "GET /api/news/bitcoin": "Bitcoin news",
        "GET /api/news/defi": "DeFi news",
        "GET /api/news/breaking": "Breaking news",
        "GET /api/news/trending": "Trending stories",
        "GET /api/news/sources": "News sources",
      },
      onchain: {
        "GET /api/onchain/gas": "Multi-chain gas prices",
        "GET /api/onchain/bitcoin/fees": "Bitcoin fee estimates",
        "GET /api/onchain/bitcoin/stats": "Bitcoin network stats",
        "GET /api/onchain/token/:address": "Token info by address",
        "GET /api/onchain/prices": "Multi-chain token prices",
      },
      ai: {
        "GET /api/ai/sentiment/:coin": "AI sentiment analysis",
        "GET /api/ai/digest": "AI daily market digest",
        "GET /api/ai/signals": "AI trading signals",
        "POST /api/ai/ask": "Ask AI about crypto",
      },
      keys: {
        "POST /api/keys": "Generate new API key (admin)",
        "GET /api/keys/usage": "Usage stats for current key",
      },
    },
  })
);

// ─── Mount Routes ────────────────────────────────────────────

app.route("/api", marketRoutes);
app.route("/api/defi", defiRoutes);
app.route("/api/news", newsRoutes);
app.route("/api/onchain", onchainRoutes);
app.route("/api/ai", aiRoutes);
app.route("/", keysRoutes);

// ─── 404 Fallback ────────────────────────────────────────────

app.notFound((c) =>
  ApiError.notFound(c, `No route matches ${c.req.method} ${c.req.path}`)
);

// ─── Global Error Handler ────────────────────────────────────

app.onError(globalErrorHandler);

// ─── Start Server ────────────────────────────────────────────

const port = Number(process.env.PORT) || 8080;

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    log.info(
      `🚀 Crypto Vision API running on http://localhost:${info.port}`
    );
    log.info(
      `📖 API docs at http://localhost:${info.port}/api`
    );
  }
);

// ─── Graceful Shutdown ───────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15_000;

async function gracefulShutdown(signal: string) {
  log.info(`${signal} received — starting graceful shutdown`);

  // Stop accepting new connections
  server.close(() => {
    log.info("HTTP server closed");
  });

  // Allow in-flight requests to drain
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      log.warn("Shutdown timeout reached, forcing exit");
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  // Disconnect shared resources
  try {
    await cache.disconnect();
  } catch {
    /* best-effort */
  }

  log.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default app;
