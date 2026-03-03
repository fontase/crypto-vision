/**
 * Crypto Vision — Macro / TradFi Route
 *
 * Traditional finance indicators that correlate with crypto markets.
 * Data from Yahoo Finance (free, no key).
 *
 * GET /api/macro/overview      — All macro data at once
 * GET /api/macro/indices       — Stock market indices
 * GET /api/macro/commodities   — Gold, silver, oil, natgas
 * GET /api/macro/bonds         — Treasury yields
 * GET /api/macro/vix           — Volatility index
 * GET /api/macro/dxy           — US Dollar index
 * GET /api/macro/crypto        — BTC, ETH, SOL, BNB benchmarks
 * GET /api/macro/quote/:symbol — Raw Yahoo Finance quote
 */

import { Hono } from "hono";
import * as macro from "../sources/macro.js";

export const macroRoutes = new Hono();

macroRoutes.get("/overview", async (c) => {
  const data = await macro.getMacroOverview();
  return c.json(data);
});

macroRoutes.get("/indices", async (c) => {
  const data = await macro.getStockIndices();
  return c.json({ data, timestamp: new Date().toISOString() });
});

macroRoutes.get("/commodities", async (c) => {
  const data = await macro.getCommodities();
  return c.json({ data, timestamp: new Date().toISOString() });
});

macroRoutes.get("/bonds", async (c) => {
  const data = await macro.getBondYields();
  return c.json({ data, timestamp: new Date().toISOString() });
});

macroRoutes.get("/vix", async (c) => {
  const data = await macro.getVolatility();
  return c.json(data);
});

macroRoutes.get("/dxy", async (c) => {
  const data = await macro.getDXY();
  return c.json(data);
});

macroRoutes.get("/crypto", async (c) => {
  const data = await macro.getCryptoBenchmarks();
  return c.json({ data, timestamp: new Date().toISOString() });
});

macroRoutes.get("/quote/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const data = await macro.getQuote(symbol);
  return c.json(data);
});
