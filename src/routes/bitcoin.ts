/**
 * Crypto Vision — Bitcoin & On-Chain Extended Routes
 *
 * Deep Bitcoin network data from blockchain.info + mempool.space.
 *
 * GET /api/bitcoin/overview        — Comprehensive Bitcoin stats
 * GET /api/bitcoin/blocks          — Recent blocks
 * GET /api/bitcoin/mempool         — Mempool stats
 * GET /api/bitcoin/difficulty      — Difficulty adjustment info
 * GET /api/bitcoin/hashrate        — Hashrate over time
 * GET /api/bitcoin/miners          — Mining pool rankings
 * GET /api/bitcoin/lightning       — Lightning Network stats
 * GET /api/bitcoin/address/:addr   — Address lookup
 * GET /api/bitcoin/price-history   — 30-day price chart
 * GET /api/bitcoin/exchange-rates  — BTC exchange rates (40+ fiat currencies)
 */

import { Hono } from "hono";
import * as bc from "../sources/blockchain.js";
import * as alt from "../sources/alternative.js";

export const bitcoinRoutes = new Hono();

// ─── GET /api/bitcoin/overview ───────────────────────────────

bitcoinRoutes.get("/overview", async (c) => {
  const [stats, fees, difficulty, unconfirmed, latestBlock, lightning] = await Promise.all([
    bc.getBtcStats().catch(() => null),
    alt.getBitcoinFees().catch(() => null),
    bc.getDifficultyAdjustment().catch(() => null),
    bc.getUnconfirmedCount().catch(() => 0),
    bc.getLatestBlock().catch(() => null),
    bc.getLightningStats().catch(() => null),
  ]);

  return c.json({
    data: {
      price: stats?.market_price_usd,
      hashrate: stats?.hash_rate,
      difficulty: stats?.difficulty,
      blockHeight: latestBlock?.height || stats?.n_blocks_total,
      unconfirmedTxs: unconfirmed,
      minutesBetweenBlocks: stats?.minutes_between_blocks,
      totalBtcMined: stats ? stats.totalbc / 1e8 : null,
      tradingVolume24h: stats?.trade_volume_usd,
      minersRevenue24h: stats?.miners_revenue_usd,
      fees: fees
        ? {
            fastest: fees.fastestFee,
            halfHour: fees.halfHourFee,
            hour: fees.hourFee,
            economy: fees.economyFee,
            unit: "sat/vB",
          }
        : null,
      nextDifficulty: difficulty
        ? {
            estimatedChange: difficulty.difficultyChange,
            remainingBlocks: difficulty.remainingBlocks,
            estimatedDate: new Date(difficulty.estimatedRetargetDate).toISOString(),
            progressPercent: difficulty.progressPercent,
          }
        : null,
      lightning: lightning?.latest
        ? {
            channels: lightning.latest.channel_count,
            nodes: lightning.latest.node_count,
            capacitySats: lightning.latest.total_capacity,
            avgCapacity: lightning.latest.avg_capacity,
          }
        : null,
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/blocks ─────────────────────────────────

bitcoinRoutes.get("/blocks", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 10), 15);
  const blocks = await bc.getRecentBlocks();

  return c.json({
    data: blocks.slice(0, limit).map((b) => ({
      hash: b.id,
      height: b.height,
      timestamp: new Date(b.timestamp * 1000).toISOString(),
      txCount: b.tx_count,
      size: b.size,
      weight: b.weight,
      difficulty: b.difficulty,
    })),
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/mempool ────────────────────────────────

bitcoinRoutes.get("/mempool", async (c) => {
  const [stats, fees] = await Promise.all([
    bc.getMempoolStats(),
    alt.getBitcoinFees(),
  ]);

  return c.json({
    data: {
      txCount: stats.count,
      totalVsize: stats.vsize,
      totalFee: stats.total_fee,
      feeHistogram: stats.fee_histogram?.slice(0, 20),
      recommendedFees: {
        fastest: fees.fastestFee,
        halfHour: fees.halfHourFee,
        hour: fees.hourFee,
        economy: fees.economyFee,
        minimum: fees.minimumFee,
        unit: "sat/vB",
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/difficulty ─────────────────────────────

bitcoinRoutes.get("/difficulty", async (c) => {
  const adj = await bc.getDifficultyAdjustment();

  return c.json({
    data: {
      progressPercent: adj.progressPercent,
      difficultyChange: adj.difficultyChange,
      estimatedRetargetDate: new Date(adj.estimatedRetargetDate).toISOString(),
      remainingBlocks: adj.remainingBlocks,
      remainingTime: adj.remainingTime,
      previousRetarget: adj.previousRetarget,
      nextRetargetHeight: adj.nextRetargetHeight,
      timeAvg: adj.timeAvg,
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/hashrate ───────────────────────────────

bitcoinRoutes.get("/hashrate", async (c) => {
  const period = c.req.query("period") || "1m";
  const data = await bc.getHashrate(period);

  return c.json({
    data: {
      currentHashrate: data.currentHashrate,
      currentDifficulty: data.currentDifficulty,
      history: (data.hashrates || []).slice(-90).map((h) => ({
        timestamp: new Date(h.timestamp * 1000).toISOString(),
        hashrate: h.avgHashrate,
      })),
    },
    period,
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/miners ─────────────────────────────────

bitcoinRoutes.get("/miners", async (c) => {
  const period = c.req.query("period") || "1w";
  const data = await bc.getMiningPools(period);

  return c.json({
    data: {
      totalBlocks: data.blockCount,
      estimatedHashrate: data.lastEstimatedHashrate,
      pools: (data.pools || []).map((p) => ({
        name: p.name,
        rank: p.rank,
        blocks: p.blockCount,
        share: data.blockCount > 0
          ? ((p.blockCount / data.blockCount) * 100).toFixed(2) + "%"
          : "0%",
        emptyBlocks: p.emptyBlocks,
        link: p.link,
      })),
    },
    period,
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/lightning ──────────────────────────────

bitcoinRoutes.get("/lightning", async (c) => {
  const data = await bc.getLightningStats();
  const l = data.latest;

  return c.json({
    data: {
      channels: l.channel_count,
      nodes: l.node_count,
      capacity: {
        sats: l.total_capacity,
        btc: l.total_capacity / 1e8,
      },
      avgCapacity: l.avg_capacity,
      medianCapacity: l.med_capacity,
      avgFeeRate: l.avg_fee_rate,
      medianFeeRate: l.med_fee_rate,
      nodeTypes: {
        clearnet: l.clearnet_nodes,
        tor: l.tor_nodes,
        hybrid: l.clearnet_tor_nodes,
        unannounced: l.unannounced_nodes,
      },
      updated: l.added,
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/address/:addr ──────────────────────────

bitcoinRoutes.get("/address/:addr", async (c) => {
  const address = c.req.param("addr");
  const data = await bc.getAddressInfo(address);

  const chain = data.chain_stats;
  const mempool = data.mempool_stats;
  const balanceSats = chain.funded_txo_sum - chain.spent_txo_sum
    + mempool.funded_txo_sum - mempool.spent_txo_sum;

  return c.json({
    data: {
      address: data.address,
      balance: {
        sats: balanceSats,
        btc: balanceSats / 1e8,
      },
      txCount: chain.tx_count,
      totalReceived: chain.funded_txo_sum,
      totalSent: chain.spent_txo_sum,
      unconfirmedTxCount: mempool.funded_txo_count + mempool.spent_txo_count,
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/price-history ──────────────────────────

bitcoinRoutes.get("/price-history", async (c) => {
  const data = await bc.getBtcMarketPrice();

  return c.json({
    data: {
      name: data.name,
      unit: data.unit,
      period: data.period,
      values: data.values.map((v) => ({
        timestamp: new Date(v.x * 1000).toISOString(),
        price: v.y,
      })),
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/bitcoin/exchange-rates ─────────────────────────

bitcoinRoutes.get("/exchange-rates", async (c) => {
  const data = await alt.getBtcExchangeRates();

  return c.json({
    data: Object.entries(data).map(([currency, rates]) => ({
      currency,
      symbol: rates.symbol,
      last: rates.last,
      buy: rates.buy,
      sell: rates.sell,
    })),
    timestamp: new Date().toISOString(),
  });
});
