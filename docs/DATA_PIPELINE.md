# Data Pipeline

> Ingestion workers, data flow, and storage architecture for Crypto Vision.

## Overview

Crypto Vision ingests cryptocurrency data from 37+ upstream sources through a pipeline of scheduled workers. Data flows through two paths simultaneously:

1. **BigQuery** — immutable OLAP storage for historical analytics
2. **Pub/Sub** — real-time streaming for downstream consumers

```
┌────────────────────┐
│  Upstream APIs      │
│  (37+ sources)     │
└────────┬───────────┘
         │
┌────────▼───────────┐
│  Ingestion Workers  │
│  (8 workers)       │
└────┬──────────┬────┘
     │          │
┌────▼────┐ ┌──▼──────┐
│ BigQuery│ │ Pub/Sub  │
│ (OLAP)  │ │ (stream) │
└─────────┘ └──┬──────┘
               │
         ┌─────▼──────┐
         │ Consumers   │
         │ (API cache, │
         │  ML, alerts)│
         └─────────────┘
```

## Workers

All workers extend `WorkerBase` (`src/workers/worker-base.ts`), which provides:

- **Periodic fetching** — configurable interval per worker
- **Dual-write** — BigQuery streaming insert + Pub/Sub publish
- **Exponential backoff** — automatic retry with jitter on failures
- **Prometheus metrics** — ingestion count, latency, error rate
- **Graceful shutdown** — SIGTERM/SIGINT handling with drain

### Worker Registry

| Worker | File | Schedule | Source | Data |
|--------|------|----------|--------|------|
| Market | `ingest-market.ts` | Every 2 min | CoinGecko | Top coins, prices, market caps, volumes |
| DeFi | `ingest-defi.ts` | Every 5 min | DeFiLlama | Protocol TVL, yields, stablecoins, fees |
| News | `ingest-news.ts` | Every 5 min | RSS (130+ feeds) | Aggregated crypto news articles |
| DEX | `ingest-dex.ts` | Every 2 min | GeckoTerminal | DEX pair data, liquidity, volume |
| Derivatives | `ingest-derivatives.ts` | Every 5 min | CoinGlass | Funding rates, OI, liquidations |
| On-Chain | `ingest-onchain.ts` | Every 5 min | mempool.space, Etherscan | Gas, fees, network stats |
| Governance | `ingest-governance.ts` | Every 15 min | Snapshot | DAO proposals, voting |
| Macro | `ingest-macro.ts` | Every 15 min | Yahoo Finance | Indices, commodities, bonds, VIX |

### Worker Lifecycle

```
Worker Start
    │
    ├── Register Prometheus metrics
    ├── Connect to BigQuery + Pub/Sub
    │
    └── Enter Loop ─────────────────────────┐
         │                                   │
         ├── Fetch from upstream source      │
         │      │                            │
         │      ├── Success                  │
         │      │    ├── Stream to BigQuery   │
         │      │    ├── Publish to Pub/Sub   │
         │      │    └── Reset backoff        │
         │      │                            │
         │      └── Failure                  │
         │           ├── Log error            │
         │           ├── Increment backoff    │
         │           └── Wait (exp backoff)   │
         │                                   │
         └── Sleep(interval) ────────────────┘

SIGTERM → Drain current batch → Disconnect → Exit
```

## BigQuery Schema

Data is stored in BigQuery dataset `crypto_vision` with these core tables:

| Table | Description | Partitioned By |
|-------|-------------|----------------|
| `market_snapshots` | Coin prices, market caps, volumes | `ingested_at` (DAY) |
| `defi_protocols` | Protocol TVL, chains, categories | `ingested_at` (DAY) |
| `defi_yields` | Yield pool data (APY, TVL, chain) | `ingested_at` (DAY) |
| `news_articles` | Aggregated news with metadata | `published_at` (DAY) |
| `dex_pairs` | DEX trading pair snapshots | `ingested_at` (DAY) |
| `derivatives_data` | Funding rates, OI, liquidations | `ingested_at` (DAY) |
| `onchain_metrics` | Gas prices, network stats | `ingested_at` (DAY) |
| `governance_proposals` | DAO proposals and votes | `created_at` (DAY) |
| `macro_indicators` | Stock indices, bonds, commodities | `ingested_at` (DAY) |
| `anomaly_events` | Detected price/volume anomalies | `detected_at` (DAY) |
| `embeddings` | Vector embeddings for search/RAG | `created_at` (DAY) |

BigQuery schemas are defined in `infra/bigquery/` SQL files.

## Pub/Sub Topics

Topics are organized by freshness requirements:

| Tier | Latency | Topics |
|------|---------|--------|
| **Realtime** | < 1s | `price-ticks`, `trade-events` |
| **Frequent** | 1–2 min | `market-snapshots`, `dex-updates` |
| **Standard** | 5–10 min | `defi-snapshots`, `news-articles`, `derivatives` |
| **Hourly** | 30–60 min | `governance-updates`, `macro-data` |
| **Daily** | 24h | `daily-summaries`, `model-training-data` |

Topic definitions are in `infra/pubsub/topics.yaml`.

## Deployment

### Docker Compose (Local)

```bash
# Start the ingestion pipeline locally with Pub/Sub emulator
docker compose -f docker-compose.ingest.yml up
```

This starts all 8 workers plus a GCP Pub/Sub emulator for local development.

### Cloud Run Jobs (Production)

Workers are deployed as Cloud Run Jobs via `cloudbuild-workers.yaml`:

```bash
# Builds worker Docker image and deploys 8 Cloud Run Jobs
gcloud builds submit --config=cloudbuild-workers.yaml
```

Each worker runs as an independent job on its configured schedule.

### Cloud Scheduler

Seven scheduler jobs trigger API endpoints and workers on periodic schedules. Defined in `infra/scheduler/scheduler-jobs.ts` and provisioned via `infra/terraform/scheduler.tf`.

## Backfill

Historical data backfill is handled by `src/workers/backfill-historical.ts`:

```bash
# Run a historical backfill (example: last 90 days of market data)
npx tsx src/workers/backfill-historical.ts --source market --days 90
```

## Export Pipeline

The export system (`src/lib/export-manager.ts`) manages bulk data exports to GCS:

```bash
# Full export to GCS
npm run export

# Dry run (no writes)
npm run export:dry-run

# Download exports locally
npm run export:download

# Import into PostgreSQL
npm run export:import-pg
```

See [Self-Hosting Guide](SELF_HOSTING.md) for migration details.

## Monitoring

Workers expose Prometheus metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `worker_ingestion_total` | Counter | Total records ingested per worker |
| `worker_ingestion_errors_total` | Counter | Ingestion errors per worker |
| `worker_ingestion_duration_seconds` | Histogram | Ingestion batch duration |
| `worker_bigquery_insert_total` | Counter | BigQuery streaming inserts |
| `worker_pubsub_publish_total` | Counter | Pub/Sub messages published |
| `worker_upstream_latency_seconds` | Histogram | Upstream API response time |
