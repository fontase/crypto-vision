# Developer Workflow

Practical workflows for developing across the `crypto-vision` monorepo. This covers local setup, daily development, testing, deployment, and troubleshooting.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Development Scripts](#development-scripts)
- [Docker Development](#docker-development)
- [App Workflows](#app-workflows)
- [Package Workflows](#package-workflows)
- [Worker & Ingestion Pipelines](#worker--ingestion-pipelines)
- [Database Workflows](#database-workflows)
- [Testing](#testing)
- [Code Quality](#code-quality)
- [Data & Model Pipelines](#data--model-pipelines)
- [Infrastructure](#infrastructure)
- [CI/CD Pipeline](#cicd-pipeline)
- [Pre-Push Checklist](#pre-push-checklist)
- [Secret Hygiene](#secret-hygiene)
- [Debugging Tips](#debugging-tips)
- [Related Documentation](#related-documentation)

---

## Prerequisites

| Requirement  | Version | Notes                                         |
| ------------ | ------- | --------------------------------------------- |
| Node.js      | ≥ 22    | Required — uses ES2022 features               |
| npm          | latest  | Bundled with Node.js                          |
| Docker       | latest  | Optional — for containerized local dev        |
| PostgreSQL   | 16      | Optional — Docker provides it, or use local   |
| Redis        | 7       | Optional — in-memory LRU used when absent     |

### API Keys

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env
```

The server starts without any API keys but will warn about degraded functionality. At minimum, set one AI provider key for AI-powered endpoints.

---

## Quick Start

### Bare-Metal (fastest iteration)

```bash
npm install
npm run dev          # tsx watch on src/index.ts — auto-reloads on file changes
# → http://localhost:8080/health
```

### Using dev.sh (multi-service orchestrator)

```bash
./dev.sh api          # Start API on port 8080
./dev.sh dashboard    # Start dashboard on port 3000
./dev.sh news         # Start news app on port 3001
./dev.sh video        # Start video app on port 3002
./dev.sh redis        # Start Redis on port 6379
./dev.sh all          # Start everything
./dev.sh status       # Show running services
./dev.sh stop all     # Stop everything
```

PID files are stored in `.dev-pids/` for process management.

### Using Docker Compose (production-like)

```bash
docker compose up     # Starts: api (8080), redis (6379), postgres (5432), scheduler
```

---

## Environment Variables

All environment variables are validated at startup via Zod in `src/lib/env.ts`. The server logs warnings for missing optional keys with degradation context.

### Core Variables

| Variable              | Default       | Description                                |
| --------------------- | ------------- | ------------------------------------------ |
| `PORT`                | `8080`        | HTTP server port                           |
| `NODE_ENV`            | `development` | `development` / `production` / `test`      |
| `LOG_LEVEL`           | `info`        | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `CORS_ORIGINS`        | —             | Comma-separated allowed origins            |
| `SHUTDOWN_TIMEOUT_MS` | `15000`       | Graceful shutdown timeout (ms)             |

### Cache & Rate Limiting

| Variable              | Default | Description                                        |
| --------------------- | ------- | -------------------------------------------------- |
| `REDIS_URL`           | —       | Redis connection URL; in-memory LRU when absent    |
| `CACHE_MAX_ENTRIES`   | `200000`| Max entries in memory cache                        |
| `RATE_LIMIT_RPM`      | `200`   | Default requests/min/IP                            |

### API Authentication

| Variable         | Format                          | Description                        |
| ---------------- | ------------------------------- | ---------------------------------- |
| `API_KEYS`       | `key1:basic,key2:pro`           | API keys with tier (public/basic/pro) |
| `ADMIN_API_KEYS` | `adminkey1,adminkey2`           | Admin-tier API keys                |

Tiers: `public` (30 rpm), `basic` (200 rpm), `pro` (2000 rpm).

### Circuit Breaker

| Variable                     | Default | Description                              |
| ---------------------------- | ------- | ---------------------------------------- |
| `CB_FAILURE_THRESHOLD`       | `5`     | Consecutive failures before circuit opens |
| `CB_RESET_MS`                | `30000` | Delay before half-open probe             |
| `FETCH_CONCURRENCY_PER_HOST` | `10`    | Max concurrent HTTP requests per host    |

### AI Providers (tried in order)

Groq → Gemini → OpenAI → Anthropic → OpenRouter:

```env
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
AI_CONCURRENCY=10
AI_MAX_QUEUE=500
```

### Market Data APIs (all optional)

```env
COINGECKO_API_KEY=CG-...
COINGECKO_PRO=true
CRYPTOCOMPARE_API_KEY=...
COINCAP_API_KEY=...
COINGLASS_API_KEY=...
MESSARI_API_KEY=...
TOKEN_TERMINAL_API_KEY=...
COINMARKETCAL_API_KEY=...
ETHERSCAN_API_KEY=...
OWLRACLE_API_KEY=...
RESERVOIR_API_KEY=...
BLOCKCHAIR_API_KEY=...
BEACONCHAIN_API_KEY=...
RATED_API_KEY=...
```

### Infrastructure

```env
GCP_PROJECT_ID=my-project
GCP_REGION=us-central1
DATABASE_URL=postgresql://cryptovision:cryptovision@localhost:5432/cryptovision
BQ_DATASET=crypto_vision
BQ_MAX_BYTES=1000000000
TELEGRAM_BOT_TOKEN=...
```

See `.env.example` for the full annotated list (105 variables).

---

## Development Scripts

### Root API

| Command                   | Action                                       |
| ------------------------- | -------------------------------------------- |
| `npm run dev`             | Start dev server with hot reload (tsx watch)  |
| `npm run build`           | TypeScript compile + tsc-alias path resolution |
| `npm start`               | Run compiled production build                |
| `npm run lint`            | ESLint on `src/`                             |
| `npm run typecheck`       | `tsc --noEmit`                               |
| `npm test`                | Run all unit/integration tests (vitest)      |
| `npm run test:watch`      | Tests in watch mode                          |
| `npm run test:e2e`        | End-to-end tests (spawns real server)        |

### Docker

| Command              | Action                                  |
| -------------------- | --------------------------------------- |
| `npm run docker:build` | Build production Docker image          |
| `npm run docker:run`   | Run container with `.env` on port 8080 |

### Training & Export

| Command                      | Action                              |
| ---------------------------- | ----------------------------------- |
| `npm run training:generate`  | Generate training data from exports |
| `npm run training:validate`  | Validate training data quality      |
| `npm run training:finetune`  | Fine-tune Gemini model              |
| `npm run training:eval`      | Evaluate model performance          |
| `npm run training:eval:quick`| Quick evaluation pass               |
| `npm run training:retrain`   | Full retrain pipeline               |
| `npm run training:prepare`   | Prepare open-source model data      |
| `npm run export`             | Export all data to BigQuery          |
| `npm run export:dry-run`     | Dry-run export (no writes)          |
| `npm run export:download`    | Download exports locally            |
| `npm run export:import-pg`   | Import exports into PostgreSQL      |

---

## Docker Development

### Full Stack

```bash
docker compose up -d            # Detached mode
docker compose logs -f api      # Follow API logs
docker compose down             # Stop everything
docker compose down -v          # Stop + remove volumes
```

**Services:**

| Service     | Port   | Description                                           |
| ----------- | ------ | ----------------------------------------------------- |
| `api`       | `8080` | Main API (2GB mem, 4 CPU limit)                       |
| `redis`     | `6379` | Redis 7 (256MB maxmemory, allkeys-lru, AOF enabled)   |
| `postgres`  | `5432` | PostgreSQL 16 (db: `cryptovision`, user: `cryptovision`) |
| `scheduler` | —      | Cron-based cache warmer (hits API endpoints on schedule) |

The scheduler pre-warms caches:

| Endpoint              | Interval |
| --------------------- | -------- |
| `/api/coins`          | 2 min    |
| `/api/trending`       | 5 min    |
| `/api/global`         | 5 min    |
| `/api/fear-greed`     | 15 min   |
| `/api/defi/protocols` | 10 min   |
| `/api/defi/chains`    | 10 min   |
| `/api/news`           | 5 min    |

### Ingestion Pipeline

```bash
docker compose -f docker-compose.ingest.yml up -d
```

Starts 8 ingestion workers + a Pub/Sub emulator on port `8085`. See [Worker & Ingestion Pipelines](#worker--ingestion-pipelines) for details.

---

## App Workflows

### Dashboard (`apps/dashboard`)

Next.js application — crypto data visualization.

```bash
cd apps/dashboard
npm install
npm run dev              # Dev server on port 3000
npm run build            # Production build
npm run test:run         # Run tests
npm run typecheck        # Type check
npm run lint && npm run format:check  # Quality gates
npm run check-all        # All checks at once
npm run analyze          # Bundle analyzer
```

Additional capabilities:

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `npm run changelog`  | Generate changelog                     |
| `npm run sync:all`   | Sync data from upstream                |
| `npm run i18n:*`     | Internationalization workflows         |
| `npm run archive`    | Archive data snapshots                 |

Has **husky + lint-staged** for pre-commit hooks (ESLint + Prettier on staged files).

### News (`apps/news`)

Next.js application — crypto news aggregation.

```bash
cd apps/news
npm install
npm run dev              # Dev server on port 3001
npm run build            # Production build
npm run test:run         # Run tests
```

Extended capabilities:

| Command                  | Description                          |
| ------------------------ | ------------------------------------ |
| `npm run test:e2e`       | Playwright end-to-end tests          |
| `npm run lint:a11y`      | Accessibility lint                   |
| `npm run audit:a11y`     | Full accessibility audit             |
| `npm run storybook`      | Component explorer on port 6006      |
| `npm run rag:ingest`     | Ingest news into vector store        |
| `npm run mcp:start`      | Start MCP server                     |
| `npm run docs:dev`       | MkDocs server on port 8000           |
| `npm run i18n:translate` | Translate content                    |
| `npm run audit:unused`   | Dead code detection (knip)           |

### Video (`apps/video`)

Remotion-based video generation.

```bash
cd apps/video
npm install
npm run studio           # Remotion studio (visual editor)
npm run render           # Render MP4
npm run render:gif       # Render GIF
```

---

## Package Workflows

All packages live under `packages/`. General pattern:

```bash
cd packages/<package-name>
npm install
npm run build
npm test
```

Available packages: `agent-runtime`, `binance-mcp`, `bnbchain-mcp`, `market-data`, `mcp-server`, `pump-agent-swarm`, `sweep`, `ucai`. Each has its own README with specific setup instructions.

---

## Worker & Ingestion Pipelines

### Architecture

Workers extend the `IngestionWorker` base class (`src/workers/worker-base.ts`) which provides:

- Periodic fetching with configurable intervals
- Dual-write to BigQuery + Pub/Sub
- Structured metrics (runs, rows, errors, latency)
- Graceful shutdown on SIGTERM/SIGINT
- Exponential backoff on consecutive failures

### Ingestion Workers

| Worker                 | File                             | Interval |
| ---------------------- | -------------------------------- | -------- |
| Market data            | `src/workers/ingest-market.ts`   | 2 min    |
| DeFi protocols         | `src/workers/ingest-defi.ts`     | 5 min    |
| News articles          | `src/workers/ingest-news.ts`     | 5 min    |
| DEX data               | `src/workers/ingest-dex.ts`      | 2 min    |
| Derivatives            | `src/workers/ingest-derivatives.ts` | 10 min |
| On-chain metrics       | `src/workers/ingest-onchain.ts`  | 5 min    |
| Governance proposals   | `src/workers/ingest-governance.ts` | 30 min  |
| Macro indicators       | `src/workers/ingest-macro.ts`    | 60 min   |

### Indexing Workers

Indexers run from the main process (started by `startIndexers()` in `src/workers/index.ts`):

| Indexer               | File                               | Schedule        |
| --------------------- | ---------------------------------- | --------------- |
| News                  | `src/workers/index-news.ts`        | Every 5 min     |
| Protocols             | `src/workers/index-protocols.ts`   | Every 1 hour    |
| Governance            | `src/workers/index-governance.ts`  | Every 15 min    |
| Agents                | `src/workers/index-agents.ts`      | Once at startup |
| Historical backfill   | `src/workers/backfill-historical.ts` | On demand     |

### Running Workers Locally

```bash
# Build first
npm run build

# Run a specific worker
node dist/src/workers/ingest-market.js

# Or use Docker Compose for all workers
docker compose -f docker-compose.ingest.yml up
```

---

## Database Workflows

### Setup

The project uses **Drizzle ORM** with PostgreSQL. Schema is at `src/bot/db/schema.ts`.

```bash
# Start PostgreSQL (via Docker)
docker compose up postgres -d

# Or set DATABASE_URL for a local instance
export DATABASE_URL=postgresql://cryptovision:cryptovision@localhost:5432/cryptovision
```

### Migrations

```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit migrate

# Open Drizzle Studio (database browser)
npx drizzle-kit studio
```

Migrations output: `src/bot/db/migrations/`

### Schema Overview

The database includes tables for: users, groups, group memberships, token calls (with market data), leaderboard snapshots, PNL records, user ranks, call channels, referrals, premium subscriptions, advertisements, insider alerts, and more. See `src/bot/db/schema.ts` for the full 471-line schema.

---

## Testing

### Test Structure

| Directory              | Type           | Config                  | Timeout |
| ---------------------- | -------------- | ----------------------- | ------- |
| `tests/lib/`           | Unit (33 files)| `vitest.config.ts`      | 10s     |
| `tests/routes/`        | Route (10 files)| `vitest.config.ts`     | 10s     |
| `tests/integration/`   | Integration    | `vitest.config.ts`      | 10s     |
| `tests/e2e/`           | End-to-end     | `vitest.e2e.config.ts`  | 30s     |
| `tests/benchmarks/`    | Performance    | —                       | —       |
| `tests/fuzz/`          | Fuzz           | —                       | —       |
| `tests/load/`          | Load (k6)      | —                       | —       |

In-source tests are also supported: `src/lib/__tests__/`, `src/routes/__tests__/`, `src/sources/__tests__/`.

### Running Tests

```bash
# All unit + integration tests
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# End-to-end (spawns real server on random port, runs smoke tests)
npm run test:e2e

# Run a specific test file
npx vitest run tests/lib/cache.test.ts

# Run tests matching a pattern
npx vitest run -t "rate limit"
```

### Coverage

Coverage uses V8 provider with thresholds:

| Metric      | Threshold |
| ----------- | --------- |
| Statements  | 50%       |
| Branches    | 40%       |
| Functions   | 45%       |
| Lines       | 50%       |

### E2E Test Setup

E2E tests use a global setup (`tests/e2e/global-setup.ts`) that:
1. Spawns a real API server on a random available port
2. Waits for `/health` endpoint to respond
3. Runs smoke tests against the live server
4. Uses `forks` pool (single fork to share the server connection)

### Load Testing

```bash
# Requires k6 installed
k6 run tests/load/smoke.js     # Quick smoke test
k6 run tests/load/soak.js      # Extended soak test
k6 run tests/load/stress.js    # Stress test
```

---

## Code Quality

### TypeScript

- **Strict mode** enabled — no `any`, no `@ts-ignore`
- **Target:** ES2022, **Module:** ESNext, **Resolution:** bundler
- **Path aliases:** `@/` → `src/`, `@/packages/` → `packages/`, `@/agents/` → `agents/`

```bash
npm run typecheck     # Full type check (tsc --noEmit)
```

### ESLint

ESLint 9 flat config. Primary rules:

| Rule                                   | Level | Notes                       |
| -------------------------------------- | ----- | --------------------------- |
| `@typescript-eslint/no-unused-vars`    | warn  | Ignores `_` prefixed args   |
| `@typescript-eslint/no-explicit-any`   | warn  | Enforced across codebase    |
| All `tseslint.configs.recommended`     | —     | Standard TypeScript rules   |

```bash
npm run lint          # Check for issues
```

### Formatting

No root-level Prettier. The dashboard app has its own Prettier + lint-staged setup for auto-formatting on commit.

---

## Data & Model Pipelines

### Export Pipeline

```bash
npm run export             # Full export to BigQuery
npm run export:dry-run     # Preview export (no writes)
npm run export:download    # Download BigQuery exports as local files
npm run export:import-pg   # Import downloaded exports into PostgreSQL
```

### Training Pipeline

```bash
npm run training:generate  # Generate training data from exports
npm run training:validate  # Validate data quality and format
npm run training:prepare   # Prepare data for open-source models
npm run training:finetune  # Fine-tune Gemini model
npm run training:eval      # Full model evaluation
npm run training:eval:quick # Quick evaluation pass
npm run training:retrain   # Complete retrain pipeline
```

---

## Infrastructure

```bash
cd infra
./setup.sh       # Provision GCP resources (BigQuery, Pub/Sub, Cloud Run, etc.)
./teardown.sh    # Tear down all resources
```

Sub-directories: `bigquery/`, `k8s/`, `pubsub/`, `scheduler/`, `terraform/`. See `docs/INFRASTRUCTURE.md` for detailed setup.

---

## CI/CD Pipeline

### GitHub Actions

| Workflow                  | Trigger                   | Description                                |
| ------------------------- | ------------------------- | ------------------------------------------ |
| `ci.yml`                  | Push/PR to `master`       | typecheck → lint → test → build            |
| `deploy.yml`              | Push to `master` / manual | Quality gates + Cloud Run deploy            |
| `rollback.yml`            | Manual dispatch           | Rollback to specific revision (100/50/25/10%) |
| `deploy-k8s.yml`         | Manual dispatch           | Cloud-agnostic K8s deploy (GKE/EKS/AKS)    |

### Cloud Build

`cloudbuild.yaml` — 9-step pipeline:

1. `npm ci`
2. `tsc --noEmit` (typecheck)
3. `eslint` (lint)
4. `vitest` (test) — steps 2-4 run in parallel
5. Docker build
6. Push to Artifact Registry
7. **Canary deploy** (0% traffic, tagged `canary`)
8. Verify canary health
9. **Promote to 100%** traffic

`cloudbuild-workers.yaml` — Builds and deploys ingestion workers as Cloud Run Jobs.

### Deploy Configuration

Cloud Run production settings:
- **Memory:** 2Gi, **CPU:** 4
- **Scaling:** min 2, max 500 instances
- **Concurrency:** 250 requests per instance
- **Generation:** gen2 with VPC connector
- **Secrets:** Injected from GCP Secret Manager

---

## Pre-Push Checklist

Run before every push:

```bash
npm run typecheck        # 1. Types compile
npm run lint             # 2. No lint errors
npm test                 # 3. All tests pass
npm run build            # 4. Production build succeeds
```

For changes touching specific areas, also run:

```bash
# If you changed apps/dashboard
cd apps/dashboard && npm run check-all

# If you changed apps/news
cd apps/news && npm run test:run && npm run lint:a11y

# If you changed packages/*
cd packages/<name> && npm test
```

---

## Secret Hygiene

### Push Protection

If GitHub push protection blocks a push:

1. Identify the offending commit and file path from the error output
2. Remove or rewrite secret-bearing commits from history:
   ```bash
   git filter-branch --force --index-filter \
     'git rm --cached --ignore-unmatch <path>' \
     --prune-empty -- --all
   ```
3. Ensure generated caches (`.next/`, `dist/`) are in `.gitignore`
4. Force-push the cleaned history

> **Important:** Revoking the key alone is not sufficient — Git history must be clean for push protection rules.

### Best Practices

- Never commit `.env` files (only `.env.example`)
- Use `ADMIN_API_KEYS` for privileged operations, not hardcoded checks
- Pino logger auto-redacts fields matching `authorization`, `cookie`, `password`, `secret`, `token`, `key`
- See `docs/SECURITY_GUIDE.md` for full security guidance

---

## Debugging Tips

### Log Levels

```bash
LOG_LEVEL=debug npm run dev    # Verbose logging
LOG_LEVEL=trace npm run dev    # Maximum verbosity (includes request/response bodies)
```

### Health Check

```bash
curl http://localhost:8080/health | jq
```

Returns server uptime, memory usage, cache stats, and circuit breaker states.

### Circuit Breaker Recovery

If upstream APIs go down, the circuit breaker opens after 5 consecutive failures. It auto-recovers:

1. **Closed** → 5 failures → **Open** (all requests fail-fast)
2. After 30s → **Half-Open** (single probe request)
3. 2 successes → **Closed** (fully recovered)

Check circuit states via the health endpoint or `LOG_LEVEL=debug`.

### Common Issues

| Issue                           | Solution                                           |
| ------------------------------- | -------------------------------------------------- |
| Port 8080 already in use        | `./dev.sh stop all` or `lsof -i :8080`             |
| Redis connection refused        | Start Redis: `./dev.sh redis` or `docker compose up redis -d` |
| CoinGecko 429 rate limit        | Set `COINGECKO_API_KEY` or wait for adaptive backoff |
| TypeScript path alias errors    | Run `npm run build` to resolve `@/` paths          |
| E2E tests timing out            | Increase `SHUTDOWN_TIMEOUT_MS` or check server health |
| WebSocket connections dropping  | Check Redis is running (required for leader election) |
| Missing data in responses       | Check API key config — server logs missing key warnings on startup |

See `docs/TROUBLESHOOTING.md` for comprehensive troubleshooting guidance.

---

## Related Documentation

| Document                     | Description                        |
| ---------------------------- | ---------------------------------- |
| `docs/REPOSITORY_GUIDE.md`  | Repository map and file overview   |
| `docs/ARCHITECTURE.md`      | System architecture and design     |
| `docs/API_REFERENCE.md`     | Complete API endpoint reference    |
| `docs/CONFIGURATION.md`     | Full configuration reference       |
| `docs/TESTING.md`           | Testing strategy and patterns      |
| `docs/DEPLOYMENT.md`        | Deployment procedures              |
| `docs/INFRASTRUCTURE.md`    | GCP infrastructure setup           |
| `docs/SECURITY_GUIDE.md`    | Security hardening guide           |
| `docs/TROUBLESHOOTING.md`   | Common issues and solutions        |
| `README.md`                 | Project overview and quick start   |
