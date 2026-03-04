# Crypto Vision

> **The complete cryptocurrency intelligence platform** — [cryptocurrency.cv](https://cryptocurrency.cv)

Crypto Vision is a production-grade TypeScript monorepo that aggregates data from 30+ sources, powers 300+ API endpoints, runs a Telegram bot, orchestrates AI agent swarms, and provides real-time WebSocket feeds — all deployable via Docker, Kubernetes, or Google Cloud Run.

## What's Inside

| Layer | Description |
|---|---|
| **Root API** (`src/`) | Hono v4 service — market data, DeFi, news, on-chain, AI, search, analytics, WebSocket |
| **Dashboard** (`apps/dashboard/`) | Next.js 16 + React 19 — real-time market data, DeFi analytics, portfolio tracking |
| **News** (`apps/news/`) | Next.js 16 — crypto news aggregator with AI analysis and 12+ RSS sources |
| **Video** (`apps/video/`) | Remotion v4 — programmatic video generation |
| **Pump Agent Swarm** (`packages/pump-agent-swarm/`) | Pump.fun agent swarm: creator/trader agents, intelligence, coordination |
| **MCP Servers** (`packages/mcp-server/`, `binance-mcp/`, `bnbchain-mcp/`) | Model Context Protocol servers for AI tool calling |
| **Market Data** (`packages/market-data/`) | Edge-compatible market data client (CoinGecko, DeFiLlama) |
| **Agent Runtime** (`packages/agent-runtime/`) | ERC-8004 agent runtime with A2A messaging + x402 micropayments |
| **Sweep** (`packages/sweep/`) | Multi-chain dust sweeper with DeFi routing |
| **Telegram Bot** (`src/bot/`) | Grammy-based bot — calls, leaderboards, premium, insider alerts |
| **Infrastructure** (`infra/`) | Terraform, Kubernetes manifests, Pub/Sub topics, scheduler jobs |

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System architecture, middleware stack, data flow |
| [API Reference](docs/API_REFERENCE.md) | All 300+ endpoints with parameters and examples |
| [Configuration](docs/CONFIGURATION.md) | Environment variables, API keys, secrets |
| [Database](docs/DATABASE.md) | PostgreSQL schema, BigQuery tables, materialized views |
| [Packages](docs/PACKAGES.md) | Deep-dive into each package and app |
| [Infrastructure](docs/INFRASTRUCTURE.md) | Docker, Kubernetes, Terraform, CI/CD |
| [Testing](docs/TESTING.md) | Test strategy, running tests, coverage |
| [Agents](docs/AGENTS.md) | 58 AI agents, localization, prompt system |
| [Performance](docs/PERFORMANCE.md) | WebSocket throttling, caching, optimization |
| [Self-Hosting](docs/SELF_HOSTING.md) | Run the full stack without GCP |
| [Repository Guide](docs/REPOSITORY_GUIDE.md) | Full repo structure and project relationships |
| [Developer Workflow](docs/DEVELOPER_WORKFLOW.md) | Day-to-day dev commands and workflows |

---

## Quick Start

### Prerequisites

- **Node.js ≥ 22**
- **Redis 7** (optional — an in-memory LRU cache is used when Redis is absent)
- **PostgreSQL 16** (required for the Telegram bot; optional otherwise)

### Install & Run

```bash
git clone https://github.com/nirholas/crypto-vision.git
cd crypto-vision
npm install
cp .env.example .env   # edit with your API keys
npm run dev             # http://localhost:8080
```

### Docker Compose (full stack)

```bash
docker compose up -d    # API + Redis + PostgreSQL + scheduler
```

### Docker (API only)

```bash
npm run docker:build
npm run docker:run
```

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled production build |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run test:e2e` | End-to-end tests |
| `npm run training:generate` | Generate LLM training data from BigQuery |
| `npm run training:finetune` | Fine-tune Gemini on Vertex AI |
| `npm run training:eval` | Evaluate model performance |
| `npm run training:prepare` | Prepare data for open-source model training |
| `npm run export` | Export all data (BigQuery → GCS) |
| `npm run export:import-pg` | Import Parquet exports to PostgreSQL |

---

## API Surface (Summary)

The full OpenAPI 3.1 spec is at [`openapi.yaml`](openapi.yaml). Live directory at `GET /api`.

| Category | Prefix | Endpoints | Examples |
|---|---|---|---|
| Meta | `/` | 5 | `/health`, `/metrics`, `/api/ready` |
| Market | `/api/` | 12 | `/api/coins`, `/api/price`, `/api/chart/:id`, `/api/ohlc/:id` |
| DeFi | `/api/defi/` | 10 | `/api/defi/protocols`, `/api/defi/yields`, `/api/defi/bridges` |
| News | `/api/news/` | 7 | `/api/news`, `/api/news/search`, `/api/news/breaking` |
| On-Chain | `/api/onchain/` | 5 | `/api/onchain/gas`, `/api/onchain/token/:address` |
| AI | `/api/ai/` | 4 | `/api/ai/sentiment/:coin`, `/api/ai/digest`, `/api/ai/ask` |
| Search | `/api/search/` | 4 | `/api/search/smart`, `/api/search/nlq`, `/api/search/suggest` |
| Bitcoin | `/api/bitcoin/` | 5+ | Network stats, lightning, UTXO, mempool |
| Analytics | `/api/analytics/` | 5+ | Correlations, market cycles, portfolio analysis |
| Derivatives | `/api/derivatives/` | 5+ | Funding rates, open interest, liquidations |
| CEX | `/api/cex/` | 5+ | Exchange data, order books, volumes |
| DEX | `/api/dex/` | 5+ | DEX pairs, volume, liquidity |
| Solana | `/api/solana/` | 5+ | Solana-specific data, programs, validators |
| Whales | `/api/whales/` | 3+ | Whale transactions, accumulation |
| Staking | `/api/staking/` | 3+ | Staking yields, validators |
| NFT | `/api/nft/` | 3+ | NFT collections, sales, floor prices |
| Governance | `/api/governance/` | 3+ | DAO proposals, voting |
| Macro | `/api/macro/` | 3+ | Traditional finance correlation |
| Agents | `/api/agents/` | 3+ | Agent orchestration, discovery |
| WebSocket | `/ws/` | 4 | `/ws/prices`, `/ws/bitcoin`, `/ws/trades`, `/ws/status` |

See [API Reference](docs/API_REFERENCE.md) for the complete list with parameters.

---

## Data Sources (30+)

| Source | Category |
|---|---|
| CoinGecko | Market data, coin details, charts, trending, exchanges |
| DeFiLlama | DeFi protocols, TVL, yields, stablecoins, DEX volumes, fees, bridges, raises |
| DexScreener / GeckoTerminal | DEX pair search and token lookups |
| Alternative.me | Fear & Greed Index |
| mempool.space | Bitcoin fees and network stats |
| Binance / Bybit / OKX / dYdX / Hyperliquid | CEX data, derivatives, perps |
| CoinGlass | Derivatives, open interest, liquidations |
| CryptoCompare | Social metrics, historical data |
| Messari | Research, protocol metrics |
| Token Terminal | Protocol revenue and earnings |
| CoinMarketCal | Crypto calendar events |
| Etherscan / Blockchair | On-chain data, whale tracking |
| L2Beat | Layer 2 metrics |
| DePIN Scan | DePIN protocol data |
| Snapshot | Governance proposals |
| Reservoir | NFT data |
| Jupiter | Solana DEX aggregator, SOL price |
| Pump.fun | Memecoin launch activity |
| RSS Feeds (12+) | Crypto news aggregation |
| Groq / Gemini / OpenAI / Anthropic / OpenRouter | AI analysis (cascading fallback) |

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 22, TypeScript 5.7+ (strict mode) |
| HTTP | Hono v4 + @hono/node-server + WebSocket |
| Database | PostgreSQL 16 (Drizzle ORM), BigQuery |
| Cache | Redis 7 (ioredis) with LRU fallback |
| AI | Multi-provider LLM (Groq→Gemini→OpenAI→Anthropic→OpenRouter) |
| ML Training | CUDA 12.4, PyTorch 2.4, Unsloth, LoRA, vLLM |
| Telegram | Grammy v1 |
| Validation | Zod |
| Logging | Pino (structured JSON) |
| Metrics | Prometheus (prom-client) |
| Testing | Vitest (unit + e2e), k6 (load) |
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Video | Remotion v4 |
| Blockchain | @solana/web3.js, @coral-xyz/anchor, ethers v6, viem v2 |
| Cloud | GCP (Cloud Run, BigQuery, Pub/Sub, Vertex AI, Memorystore) |
| IaC | Terraform, Kubernetes (Kustomize), Docker Compose |
| CI/CD | Google Cloud Build (canary deploys) |

---

## Deployment Options

| Method | Complexity | Cost |
|---|---|---|
| `docker compose up` | Minimal | ~$43/mo (Hetzner) |
| Kubernetes (k3s/GKE) | Medium | ~$50–150/mo |
| GCP Cloud Run | Production | ~$305/mo |
| Bare metal | Advanced | See [Self-Hosting](docs/SELF_HOSTING.md) |

---

## Rate Limiting

Default: **200 requests per minute per IP** on all `/api/*` routes. Redis-backed when available, in-memory otherwise.

---

## License

MIT
