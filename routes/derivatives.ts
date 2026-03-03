/**
 * Crypto Vision — Derivatives Routes
 *
 * Perpetuals, options, and liquidation data from DeFiLlama (free, no key).
 *
 * GET /api/derivatives/perps         — Perpetual/derivatives volume rankings
 * GET /api/derivatives/options       — Options volume rankings
 * GET /api/derivatives/liquidations  — Current liquidation data
 * GET /api/derivatives/overview      — Combined derivatives overview
 */

import { Hono } from "hono";
import * as llama from "../sources/defillama.js";

export const derivativesRoutes = new Hono();

// ─── GET /api/derivatives/perps ──────────────────────────────

derivativesRoutes.get("/perps", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const data = await llama.getDerivativesVolume();

  return c.json({
    data: {
      totalChart: data.totalDataChart?.slice(-30),
      protocols: (data.protocols || [])
        .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
        .slice(0, limit)
        .map((p) => ({
          name: p.name,
          volume24h: p.total24h,
          volume7d: p.total7d,
          volume30d: p.total30d,
          change1d: p.change_1d,
        })),
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/derivatives/options ────────────────────────────

derivativesRoutes.get("/options", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const data = await llama.getOptionsVolume();

  return c.json({
    data: {
      totalChart: data.totalDataChart?.slice(-30),
      protocols: (data.protocols || [])
        .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
        .slice(0, limit)
        .map((p) => ({
          name: p.name,
          volume24h: p.total24h,
          volume7d: p.total7d,
          volume30d: p.total30d,
          change1d: p.change_1d,
        })),
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/derivatives/liquidations ───────────────────────

derivativesRoutes.get("/liquidations", async (c) => {
  const data = await llama.getLiquidations();

  return c.json({
    data: (Array.isArray(data) ? data : []).map((item) => ({
      symbol: item.symbol,
      openInterest: item.openInterest,
      liquidations24h: item.liquidations24h,
    })),
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/derivatives/overview ───────────────────────────

derivativesRoutes.get("/overview", async (c) => {
  const [perps, options] = await Promise.all([
    llama.getDerivativesVolume().catch(() => ({ protocols: [], totalDataChart: [] })),
    llama.getOptionsVolume().catch(() => ({ protocols: [], totalDataChart: [] })),
  ]);

  const totalPerpsVol = (perps.protocols || []).reduce((s, p) => s + (p.total24h || 0), 0);
  const totalOptionsVol = (options.protocols || []).reduce((s, p) => s + (p.total24h || 0), 0);

  return c.json({
    data: {
      perpetuals: {
        totalVolume24h: totalPerpsVol,
        protocolCount: perps.protocols?.length || 0,
        top5: (perps.protocols || [])
          .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
          .slice(0, 5)
          .map((p) => ({ name: p.name, volume24h: p.total24h })),
      },
      options: {
        totalVolume24h: totalOptionsVol,
        protocolCount: options.protocols?.length || 0,
        top5: (options.protocols || [])
          .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
          .slice(0, 5)
          .map((p) => ({ name: p.name, volume24h: p.total24h })),
      },
      combinedVolume24h: totalPerpsVol + totalOptionsVol,
    },
    timestamp: new Date().toISOString(),
  });
});
