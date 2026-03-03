/**
 * Crypto Vision — Whale Tracking Routes
 *
 * Large transaction monitoring via Blockchair, Blockchain.info, and Etherscan.
 *
 * GET /api/whales/btc/latest              — Recent large BTC transactions
 * GET /api/whales/btc/mempool             — BTC mempool data
 * GET /api/whales/stats/:chain            — Blockchair chain stats
 * GET /api/whales/address/:chain/:address — Address balance lookup
 * GET /api/whales/eth/richlist            — Top ETH holders
 * GET /api/whales/eth/holders/:address    — Token top holders
 * GET /api/whales/eth/transfers/:address  — Recent large ETH transfers
 * GET /api/whales/charts/:name            — Blockchain.info chart data
 * GET /api/whales/overview                — Aggregate whale overview
 *
 * @copyright 2024-2026 nirholas. All rights reserved.
 */

import { Hono } from "hono";
import * as whales from "../sources/whales.js";

export const whaleRoutes = new Hono();

// ─── Bitcoin Whale Tracking ──────────────────────────────────

whaleRoutes.get("/btc/latest", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 25, 100);
  const data = await whales.getLatestBTCTransactions(limit);
  return c.json(data);
});

whaleRoutes.get("/btc/mempool", async (c) => {
  const data = await whales.getBTCMempool();
  return c.json(data);
});

// ─── Multi-Chain Stats ───────────────────────────────────────

whaleRoutes.get("/stats/bitcoin", async (c) => {
  const data = await whales.getChainStats("bitcoin");
  return c.json(data);
});

whaleRoutes.get("/stats/ethereum", async (c) => {
  const data = await whales.getChainStats("ethereum");
  return c.json(data);
});

whaleRoutes.get("/stats/:chain", async (c) => {
  const chain = c.req.param("chain");
  const data = await whales.getChainStats(chain);
  return c.json(data);
});

// ─── Address Lookup ──────────────────────────────────────────

whaleRoutes.get("/address/:chain/:address", async (c) => {
  const chain = c.req.param("chain");
  const address = c.req.param("address");
  const data = await whales.getAddressInfo(chain, address);
  return c.json(data);
});

// ─── Ethereum Whale Data ─────────────────────────────────────

whaleRoutes.get("/eth/richlist", async (c) => {
  const data = await whales.getETHRichList();
  return c.json(data);
});

whaleRoutes.get("/eth/holders/:address", async (c) => {
  const address = c.req.param("address");
  const page = Number(c.req.query("page")) || 1;
  const offset = Math.min(Number(c.req.query("offset")) || 25, 100);
  const data = await whales.getTokenTopHolders(address, page, offset);
  return c.json(data);
});

whaleRoutes.get("/eth/transfers/:address", async (c) => {
  const address = c.req.param("address");
  const startblock = Number(c.req.query("startblock")) || 0;
  const data = await whales.getRecentLargeETHTransfers(address, startblock);
  return c.json(data);
});

// ─── Charts (Blockchain.info) ────────────────────────────────

whaleRoutes.get("/charts/price", async (c) => {
  const timespan = c.req.query("timespan") || "1year";
  const data = await whales.getBTCChart("market-price", timespan);
  return c.json(data);
});

whaleRoutes.get("/charts/hashrate", async (c) => {
  const timespan = c.req.query("timespan") || "1year";
  const data = await whales.getBTCChart("hash-rate", timespan);
  return c.json(data);
});

whaleRoutes.get("/charts/difficulty", async (c) => {
  const timespan = c.req.query("timespan") || "1year";
  const data = await whales.getBTCChart("difficulty", timespan);
  return c.json(data);
});

whaleRoutes.get("/charts/transactions", async (c) => {
  const timespan = c.req.query("timespan") || "1year";
  const data = await whales.getBTCChart("n-transactions", timespan);
  return c.json(data);
});

whaleRoutes.get("/charts/:name", async (c) => {
  const name = c.req.param("name");
  const timespan = c.req.query("timespan") || "1year";
  const rollingAverage = c.req.query("rollingAverage") || undefined;
  const data = await whales.getBTCChart(name, timespan, rollingAverage);
  return c.json(data);
});

// ─── Aggregate ───────────────────────────────────────────────

whaleRoutes.get("/overview", async (c) => {
  const data = await whales.getWhaleOverview();
  return c.json(data);
});
