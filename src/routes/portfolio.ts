/**
 * Crypto Vision — Portfolio Analysis Routes
 *
 * Advanced portfolio analytics — valuation, risk, correlation, diversification.
 *
 * POST /api/portfolio/value             — Portfolio valuation (post holdings)
 * POST /api/portfolio/correlation       — Correlation matrix for assets
 * GET  /api/portfolio/volatility/:id    — Volatility & risk metrics for a coin
 * POST /api/portfolio/diversification   — Diversification score for a portfolio
 * POST /api/portfolio/risk              — Multi-asset risk analysis
 *
 * @copyright 2024-2026 nirholas. All rights reserved.
 */

import { Hono } from "hono";
import * as portfolio from "../sources/portfolio.js";
import {
  PortfolioHoldingsSchema,
  AssetIdsSchema,
  RiskAnalysisSchema,
  validateBody,
} from "../lib/validation.js";

export const portfolioRoutes = new Hono();

// ─── Portfolio Valuation ─────────────────────────────────────

portfolioRoutes.post("/value", async (c) => {
  const parsed = await validateBody(c, PortfolioHoldingsSchema);
  if (!parsed.success) return parsed.error;
  const { holdings, vs_currency } = parsed.data;

  const data = await portfolio.valuePortfolio(holdings, vs_currency);
  return c.json(data);
});

// ─── Correlation Matrix ──────────────────────────────────────

portfolioRoutes.post("/correlation", async (c) => {
  const parsed = await validateBody(c, AssetIdsSchema);
  if (!parsed.success) return parsed.error;
  const { ids, days, vs_currency } = parsed.data;

  const data = await portfolio.correlationMatrix(ids, days, vs_currency);
  return c.json(data);
});

// ─── Volatility & Risk ──────────────────────────────────────

portfolioRoutes.get("/volatility/:id", async (c) => {
  const id = c.req.param("id");
  const days = Math.min(Number(c.req.query("days")) || 90, 365);
  const vsCurrency = c.req.query("vs") || "usd";
  const data = await portfolio.volatilityMetrics(id, days, vsCurrency);
  return c.json(data);
});

// Multi-asset volatility
portfolioRoutes.post("/risk", async (c) => {
  const parsed = await validateBody(c, RiskAnalysisSchema);
  if (!parsed.success) return parsed.error;
  const { ids, days, vs_currency } = parsed.data;

  const results = await Promise.all(
    ids.map((id) => portfolio.volatilityMetrics(id, days, vs_currency)),
  );

  // Sort by annualized volatility (highest risk first)
  results.sort((a, b) => b.annualizedVolatility - a.annualizedVolatility);

  return c.json({
    count: results.length,
    period: `${days}d`,
    data: results,
  });
});

// ─── Diversification Score ───────────────────────────────────

portfolioRoutes.post("/diversification", async (c) => {
  const parsed = await validateBody(c, PortfolioHoldingsSchema);
  if (!parsed.success) return parsed.error;
  const { holdings } = parsed.data;

  const data = await portfolio.diversificationScore(holdings);
  return c.json(data);
});
