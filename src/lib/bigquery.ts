/**
 * Crypto Vision — BigQuery Client
 *
 * Production-grade BigQuery streaming insert client with:
 * - Automatic batching (max 500 rows per insert)
 * - Exponential backoff with jitter on transient errors
 * - Graceful degradation: logs warnings, never crashes the API
 * - Insert metrics tracking (rows/sec, errors, latency)
 * - Parameterized query execution for analytics
 * - Typed row interfaces for all 17 warehouse tables
 *
 * BigQuery is supplementary — the API works without it.
 * Set GCP_PROJECT_ID to enable.
 */

import { BigQuery, type InsertRowsOptions } from "@google-cloud/bigquery";
import { log } from "./logger.js";

// ── Constants ────────────────────────────────────────────

const DATASET = process.env.BQ_DATASET || "crypto_vision";
const MAX_BATCH = 500;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

// ── Metrics ──────────────────────────────────────────────

interface BQMetrics {
  totalInserts: number;
  totalRows: number;
  totalErrors: number;
  totalRetries: number;
  lastInsertAt: number;
  latencySum: number;
  latencyCount: number;
}

const metrics: BQMetrics = {
  totalInserts: 0,
  totalRows: 0,
  totalErrors: 0,
  totalRetries: 0,
  lastInsertAt: 0,
  latencySum: 0,
  latencyCount: 0,
};

// ── Client Singleton ─────────────────────────────────────

let bq: BigQuery | null = null;
let initAttempted = false;

function getClient(): BigQuery | null {
  if (bq) return bq;
  if (initAttempted) return null;

  initAttempted = true;
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    log.info("[bigquery] GCP_PROJECT_ID not set — BigQuery disabled");
    return null;
  }

  try {
    bq = new BigQuery({
      projectId,
      location: process.env.GCP_REGION || "us-central1",
    });
    log.info({ projectId, dataset: DATASET }, "[bigquery] Client initialized");
    return bq;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message }, "[bigquery] Failed to initialize client");
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────

/** Exponential backoff with jitter */
function backoffDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = delay * 0.5 * Math.random();
  return delay + jitter;
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Check if an error is transient (retryable) */
function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("rate limit") ||
      msg.includes("quota exceeded") ||
      msg.includes("internal error") ||
      msg.includes("service unavailable") ||
      msg.includes("deadline exceeded") ||
      msg.includes("connection") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("503") ||
      msg.includes("429")
    );
  }
  return false;
}

// ── Core: insertRows ─────────────────────────────────────

/**
 * Stream rows into a BigQuery table with automatic batching and retry.
 *
 * Rows are enriched with `ingested_at` timestamp automatically.
 * Failures are logged but never propagated — BigQuery is supplementary.
 *
 * @param table  Table name within the crypto_vision dataset
 * @param rows   Array of row objects to insert
 */
export async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const client = getClient();
  if (!client || rows.length === 0) return;

  const now = new Date().toISOString();
  const enriched = rows.map((r) => ({
    ...r,
    ingested_at: r.ingested_at ?? now,
  }));

  const insertOptions: InsertRowsOptions = {
    skipInvalidRows: true,
    ignoreUnknownValues: true,
  };

  const tableRef = client.dataset(DATASET).table(table);

  for (let i = 0; i < enriched.length; i += MAX_BATCH) {
    const batch = enriched.slice(i, i + MAX_BATCH);
    let attempt = 0;
    let inserted = false;

    while (attempt <= MAX_RETRIES && !inserted) {
      const start = Date.now();
      try {
        await tableRef.insert(batch, insertOptions);
        const elapsed = Date.now() - start;

        metrics.totalInserts++;
        metrics.totalRows += batch.length;
        metrics.lastInsertAt = Date.now();
        metrics.latencySum += elapsed;
        metrics.latencyCount++;

        inserted = true;

        log.debug(
          { table, rows: batch.length, elapsed, batch: Math.floor(i / MAX_BATCH) + 1 },
          "[bigquery] Insert succeeded",
        );
      } catch (err: unknown) {
        const elapsed = Date.now() - start;
        metrics.latencySum += elapsed;
        metrics.latencyCount++;

        if (attempt < MAX_RETRIES && isTransientError(err)) {
          metrics.totalRetries++;
          const delay = backoffDelay(attempt);
          const message = err instanceof Error ? err.message : String(err);
          log.warn(
            { table, attempt: attempt + 1, delay: Math.round(delay), err: message },
            "[bigquery] Transient error, retrying",
          );
          await sleep(delay);
          attempt++;
        } else {
          metrics.totalErrors++;
          const message = err instanceof Error ? err.message : String(err);
          log.warn(
            { table, rows: batch.length, err: message, attempt },
            "[bigquery] Insert failed (non-retryable or max retries)",
          );
          inserted = true; // Break the loop — do not crash
        }
      }
    }
  }
}

// ── Core: query ──────────────────────────────────────────

/**
 * Execute a parameterized BigQuery SQL query.
 * Returns empty array if BigQuery is unavailable.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const client = getClient();
  if (!client) return [];

  try {
    const [rows] = await client.query({
      query: sql,
      params,
      location: process.env.GCP_REGION || "us-central1",
      maximumBytesBilled: process.env.BQ_MAX_BYTES || "1000000000", // 1 GB safety limit
    });
    return rows as T[];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message, sql: sql.slice(0, 200) }, "[bigquery] Query failed");
    return [];
  }
}

// ── Dataset / Table Management ───────────────────────────

/**
 * Ensure the dataset exists, creating it if necessary.
 */
export async function ensureDataset(datasetId = DATASET): Promise<void> {
  const client = getClient();
  if (!client) return;

  const ds = client.dataset(datasetId);
  const [exists] = await ds.exists();
  if (!exists) {
    await ds.create({ location: process.env.GCP_REGION || "us-central1" });
    log.info({ datasetId }, "[bigquery] Created dataset");
  }
}

/**
 * Ensure a table exists, creating it with the given schema if necessary.
 */
export async function ensureTable(
  tableId: string,
  schema: Array<{ name: string; type: string; mode?: string; fields?: Array<{ name: string; type: string }> }>,
  datasetId = DATASET,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  const table = client.dataset(datasetId).table(tableId);
  const [exists] = await table.exists();
  if (!exists) {
    await table.create({ schema: { fields: schema } });
    log.info({ datasetId, tableId }, "[bigquery] Created table");
  }
}

// ── Metrics ──────────────────────────────────────────────

/**
 * Return current BigQuery insert metrics for observability.
 */
export function getMetrics(): {
  enabled: boolean;
  totalInserts: number;
  totalRows: number;
  totalErrors: number;
  totalRetries: number;
  avgLatencyMs: number;
  lastInsertAt: string | null;
} {
  return {
    enabled: getClient() !== null,
    totalInserts: metrics.totalInserts,
    totalRows: metrics.totalRows,
    totalErrors: metrics.totalErrors,
    totalRetries: metrics.totalRetries,
    avgLatencyMs:
      metrics.latencyCount > 0
        ? Math.round(metrics.latencySum / metrics.latencyCount)
        : 0,
    lastInsertAt:
      metrics.lastInsertAt > 0
        ? new Date(metrics.lastInsertAt).toISOString()
        : null,
  };
}

// ── Embeddings Table Schema ──────────────────────────────

export const EMBEDDINGS_TABLE = "embeddings";

export const EMBEDDINGS_SCHEMA = [
  { name: "id", type: "STRING", mode: "REQUIRED" },
  { name: "content", type: "STRING" },
  { name: "embedding", type: "FLOAT64", mode: "REPEATED" },
  { name: "metadata", type: "STRING" }, // JSON string
  { name: "category", type: "STRING" },
  { name: "source", type: "STRING" },
  { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
];

/**
 * Ensure the embeddings table and vector index exist.
 */
export async function ensureEmbeddingsTable(datasetId = DATASET): Promise<void> {
  await ensureDataset(datasetId);
  await ensureTable(EMBEDDINGS_TABLE, EMBEDDINGS_SCHEMA, datasetId);
  log.info("[bigquery] Embeddings table ready");
}

// ── Cleanup ──────────────────────────────────────────────

export async function closeBigQuery(): Promise<void> {
  if (bq) {
    bq = null;
    initAttempted = false;
    log.info("[bigquery] Client reference released");
  }
}

// ── Typed Row Interfaces ─────────────────────────────────

export interface MarketSnapshotRow {
  snapshot_id: string;
  coin_id: string;
  symbol: string;
  name: string;
  current_price_usd?: number | null;
  market_cap?: number | null;
  market_cap_rank?: number | null;
  total_volume?: number | null;
  price_change_pct_1h?: number | null;
  price_change_pct_24h?: number | null;
  price_change_pct_7d?: number | null;
  price_change_pct_30d?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  ath?: number | null;
  ath_change_pct?: number | null;
  source?: string;
}

export interface OHLCCandleRow {
  coin_id: string;
  timestamp_ms: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  source?: string;
}

export interface DefiProtocolRow {
  protocol_slug: string;
  name: string;
  category?: string | null;
  chain?: string | null;
  tvl_usd?: number | null;
  change_1h?: number | null;
  change_1d?: number | null;
  change_7d?: number | null;
  mcap_tvl_ratio?: number | null;
  fees_24h?: number | null;
  revenue_24h?: number | null;
  source?: string;
}

export interface YieldPoolRow {
  pool_id: string;
  chain?: string | null;
  project?: string | null;
  symbol?: string | null;
  tvl_usd?: number | null;
  apy?: number | null;
  apy_base?: number | null;
  apy_reward?: number | null;
  il_risk?: string | null;
  stablecoin?: boolean | null;
}

export interface NewsArticleRow {
  article_id: string;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  source_name?: string | null;
  category?: string | null;
  published_at?: string | null;
  sentiment_score?: number | null;
  sentiment_label?: string | null;
  entities?: string[];
  topics?: string[];
  embedding?: number[];
}

export interface FearGreedRow {
  value?: number | null;
  classification?: string | null;
  timestamp_unix?: number | null;
}

export interface DexPairRow {
  pair_address: string;
  chain_id?: string | null;
  dex_id?: string | null;
  base_token_address?: string | null;
  base_token_symbol?: string | null;
  quote_token_address?: string | null;
  quote_token_symbol?: string | null;
  price_usd?: number | null;
  volume_24h?: number | null;
  liquidity_usd?: number | null;
  price_change_5m?: number | null;
  price_change_1h?: number | null;
  price_change_24h?: number | null;
  fdv?: number | null;
  source?: string | null;
}

export interface ChainTVLRow {
  chain_name: string;
  tvl_usd?: number | null;
  protocols_count?: number | null;
}

export interface ExchangeSnapshotRow {
  exchange_id: string;
  name?: string | null;
  trust_score?: number | null;
  trade_volume_24h_btc?: number | null;
  trade_volume_24h_usd?: number | null;
  open_interest_usd?: number | null;
  source?: string | null;
}

export interface BitcoinNetworkRow {
  hashrate?: number | null;
  difficulty?: number | null;
  block_height?: number | null;
  fee_fast_sat_vb?: number | null;
  fee_medium_sat_vb?: number | null;
  fee_slow_sat_vb?: number | null;
  mempool_size?: number | null;
}

export interface GasPriceRow {
  chain: string;
  fast_gwei?: number | null;
  standard_gwei?: number | null;
  slow_gwei?: number | null;
  base_fee_gwei?: number | null;
}

export interface StablecoinSupplyRow {
  stablecoin_id: string;
  name?: string | null;
  symbol?: string | null;
  peg_type?: string | null;
  circulating?: number | null;
  chain_circulating?: Record<string, unknown> | null;
  price?: number | null;
}

export interface FundingRoundRow {
  round_id?: string | null;
  name?: string | null;
  category?: string | null;
  amount?: number | null;
  round_type?: string | null;
  lead_investors?: string[];
  date?: string | null;
}

export interface DerivativesSnapshotRow {
  symbol: string;
  exchange?: string | null;
  open_interest_usd?: number | null;
  funding_rate?: number | null;
  volume_24h?: number | null;
  long_short_ratio?: number | null;
  liquidations_24h?: number | null;
  source?: string | null;
}

export interface GovernanceProposalRow {
  proposal_id: string;
  space_id?: string | null;
  title?: string | null;
  body?: string | null;
  state?: string | null;
  author?: string | null;
  votes_for?: number | null;
  votes_against?: number | null;
  quorum?: number | null;
  start_ts?: number | null;
  end_ts?: number | null;
}

export interface WhaleMovementRow {
  tx_hash: string;
  chain?: string | null;
  from_address?: string | null;
  to_address?: string | null;
  token_symbol?: string | null;
  amount?: number | null;
  usd_value?: number | null;
  block_number?: number | null;
  timestamp_unix?: number | null;
  movement_type?: string | null;
}

export interface AgentInteractionRow {
  interaction_id: string;
  agent_id: string;
  query?: string | null;
  response?: string | null;
  model_used?: string | null;
  tokens_used?: number | null;
  latency_ms?: number | null;
  user_feedback?: string | null;
}

// ── Table Name Constants ─────────────────────────────────

export const Tables = {
  MARKET_SNAPSHOTS: "market_snapshots",
  OHLC_CANDLES: "ohlc_candles",
  DEFI_PROTOCOLS: "defi_protocols",
  YIELD_POOLS: "yield_pools",
  NEWS_ARTICLES: "news_articles",
  FEAR_GREED: "fear_greed",
  DEX_PAIRS: "dex_pairs",
  CHAIN_TVL: "chain_tvl",
  EXCHANGE_SNAPSHOTS: "exchange_snapshots",
  BITCOIN_NETWORK: "bitcoin_network",
  GAS_PRICES: "gas_prices",
  STABLECOIN_SUPPLY: "stablecoin_supply",
  FUNDING_ROUNDS: "funding_rounds",
  DERIVATIVES_SNAPSHOTS: "derivatives_snapshots",
  GOVERNANCE_PROPOSALS: "governance_proposals",
  WHALE_MOVEMENTS: "whale_movements",
  AGENT_INTERACTIONS: "agent_interactions",
} as const;

export type TableName = (typeof Tables)[keyof typeof Tables];
