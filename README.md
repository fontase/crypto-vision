# Crypto Vision

> **The complete cryptocurrency intelligence API** — [cryptocurrency.cv](https://cryptocurrency.cv)

Crypto Vision is a high-performance TypeScript API that aggregates data from CoinGecko, DeFiLlama, DexScreener, RSS news feeds, and multiple LLM providers (Groq, Gemini, OpenAI, Anthropic, OpenRouter) into a single unified endpoint. Built on the [Hono](https://hono.dev) framework and deployable to any Node.js host or Google Cloud Run.

Key capabilities:

- **Market Data** — real-time coin prices, charts, OHLC candles, exchange rankings, categories, Fear & Greed Index, and DEX pair search.
- **DeFi Analytics** — protocol TVL rankings, yield opportunities, stablecoin stats, DEX volumes, protocol fees/revenue, bridge volumes, and funding rounds.
- **News Aggregation** — native RSS feed aggregation with search, category filtering, and trending topic detection.
- **On-Chain Data** — multi-chain gas prices, Bitcoin fee estimates & network stats, token lookups by contract address, and DeFiLlama token pricing.
- **AI Intelligence** — LLM-powered sentiment analysis, daily market digests, trading signal generation, and free-form Q&A enriched with live market context.

---

## Quick Start

### Prerequisites

- **Node.js ≥ 22**
- **Redis** (optional — an in-memory LRU cache is used when Redis is absent)

### Install & Run

```bash
# 1. Clone the repository
git clone https://github.com/nirholas/crypto-vision.git
cd crypto-vision

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env
# Edit .env and add your API keys (see Environment Variables below)

# 4. Start the dev server (hot-reload via tsx)
npm run dev
```

The server starts on **http://localhost:8080** by default.

### Docker

```bash
npm run docker:build    # docker build -t crypto-vision .
npm run docker:run      # docker run -p 8080:8080 --env-file .env crypto-vision
```

### Other Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript + resolve path aliases |
| `npm start` | Run the compiled production build |
| `npm run lint` | Lint source files with ESLint |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |

---

## Environment Variables

Copy `.env.example` to `.env` and configure as needed. All variables are **optional** unless noted.

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP server port |
| `NODE_ENV` | `development` | `development` or `production` |
| `LOG_LEVEL` | `info` | Pino log level (`trace` / `debug` / `info` / `warn` / `error` / `fatal`) |
| `CORS_ORIGINS` | *(all in dev)* | Comma-separated allowed origins (production only) |

### Cache

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | — | Redis connection URL. In-memory LRU used when absent |

### Queue / Concurrency

| Variable | Default | Description |
|---|---|---|
| `AI_CONCURRENCY` | `10` | Max concurrent AI requests |
| `AI_MAX_QUEUE` | `500` | Max queued AI requests before 503 |
| `HEAVY_FETCH_CONCURRENCY` | `20` | Max concurrent upstream fetches |

### Market Data APIs

| Variable | Default | Description |
|---|---|---|
| `COINGECKO_API_KEY` | — | CoinGecko API key for higher rate limits |
| `COINGECKO_PRO` | `false` | Use CoinGecko Pro base URL |
| `CRYPTOCOMPARE_API_KEY` | — | CryptoCompare key (not yet wired) |

### News

| Variable | Default | Description |
|---|---|---|
| `NEWS_API_URL` | — | Upstream news service base URL |
| `NEWSAPI_API_KEY` | — | NewsAPI.org key (not yet wired) |
| `CRYPTOPANIC_API_KEY` | — | CryptoPanic key (not yet wired) |

### AI Providers

At least one key is required for `/api/ai/*` endpoints. Providers are tried in order: **Groq → Gemini → OpenAI → Anthropic → OpenRouter**.

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq — fastest inference, tried first |
| `GEMINI_API_KEY` | Google Gemini |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENROUTER_API_KEY` | OpenRouter multi-model gateway (tried last) |

### Infrastructure (Production / GCP)

| Variable | Default | Description |
|---|---|---|
| `GCP_PROJECT_ID` | — | Google Cloud project ID |
| `GCP_REGION` | `us-central1` | Google Cloud region |

---

## API Endpoints

The full [OpenAPI 3.1 specification](openapi.yaml) is available at the project root.

A live endpoint directory is also served at `GET /api`.

### Meta

| Method | Path | Description |
|---|---|---|
| GET | `/` | API info and links |
| GET | `/health` | Health check, uptime, cache stats |
| GET | `/api` | Endpoint directory |

### Market Data (`/api/`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/coins` | Top coins by market cap (paginated) |
| GET | `/api/coin/:id` | Coin detail including description, links, and market data |
| GET | `/api/price` | Simple price lookup (`?ids=bitcoin,ethereum&vs_currencies=usd`) |
| GET | `/api/trending` | Trending coins |
| GET | `/api/global` | Global market statistics |
| GET | `/api/search` | Search coins by name or symbol (`?q=...`) |
| GET | `/api/chart/:id` | Price/market-cap/volume chart data (`?days=7&interval=daily`) |
| GET | `/api/ohlc/:id` | OHLC candlestick data (`?days=7`) |
| GET | `/api/exchanges` | Exchange rankings by trust score (paginated) |
| GET | `/api/categories` | Coin categories with market cap and volume |
| GET | `/api/fear-greed` | Crypto Fear & Greed Index (`?limit=1`) |
| GET | `/api/dex/search` | DEX pair search via DexScreener (`?q=...`) |

### DeFi (`/api/defi/`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/defi/protocols` | Top DeFi protocols by TVL (`?limit=100&chain=...&category=...`) |
| GET | `/api/defi/protocol/:slug` | Protocol detail with per-chain TVL and 90-day history |
| GET | `/api/defi/chains` | All chains ranked by TVL |
| GET | `/api/defi/chain/:name` | Chain TVL history (last 365 days) |
| GET | `/api/defi/yields` | Yield pools sorted by APY (`?min_tvl=...&min_apy=...&stablecoin=true`) |
| GET | `/api/defi/stablecoins` | Stablecoins sorted by circulating supply |
| GET | `/api/defi/dex-volumes` | DEX volume rankings (top 50) |
| GET | `/api/defi/fees` | Protocol fee/revenue rankings (top 50) |
| GET | `/api/defi/bridges` | Cross-chain bridge volumes |
| GET | `/api/defi/raises` | Recent crypto funding rounds (`?limit=50`) |

### News (`/api/news/`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/news` | Latest news (`?limit=20&source=...&category=...&page=1`) |
| GET | `/api/news/search` | Search news (`?q=...&limit=20`) |
| GET | `/api/news/bitcoin` | Bitcoin-specific news |
| GET | `/api/news/defi` | DeFi-specific news |
| GET | `/api/news/breaking` | Breaking news (last 2 hours) |
| GET | `/api/news/trending` | Trending topics |
| GET | `/api/news/sources` | Available RSS feed sources |

### On-Chain (`/api/onchain/`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/onchain/gas` | Multi-chain gas prices (Bitcoin; EVM planned) |
| GET | `/api/onchain/bitcoin/fees` | Bitcoin fee estimates (sat/vB) |
| GET | `/api/onchain/bitcoin/stats` | Bitcoin network stats (hashrate) |
| GET | `/api/onchain/token/:address` | Token info + DEX pairs by contract address |
| GET | `/api/onchain/prices` | Token prices by chain:address (`?coins=ethereum:0x...`) |

### AI Intelligence (`/api/ai/`)

Requires at least one LLM API key configured.

| Method | Path | Description |
|---|---|---|
| GET | `/api/ai/sentiment/:coin` | AI sentiment analysis for a coin (cached 5 min) |
| GET | `/api/ai/digest` | AI daily market digest (cached 15 min) |
| GET | `/api/ai/signals` | AI trading signals (cached 10 min) |
| POST | `/api/ai/ask` | Free-form crypto Q&A (body: `{ "question": "...", "context?": "..." }`) |

---

## Tech Stack

- [Hono](https://hono.dev) — ultra-fast HTTP framework
- TypeScript (strict mode)
- [ioredis](https://github.com/redis/ioredis) — Redis caching (optional)
- [pino](https://getpino.io) — structured JSON logging
- [zod](https://zod.dev) — runtime validation
- [undici](https://undici.nodejs.org) — HTTP client
- [Vitest](https://vitest.dev) — testing framework

## Data Sources

| Source | Used For |
|---|---|
| [CoinGecko](https://www.coingecko.com/en/api) | Market data, coin details, charts, trending |
| [DeFiLlama](https://defillama.com/docs/api) | DeFi protocols, yields, stablecoins, DEX volumes, fees, bridges, raises, token prices |
| [DexScreener](https://docs.dexscreener.com) | DEX pair search, token lookups |
| [Alternative.me](https://alternative.me/crypto/fear-and-greed-index/) | Fear & Greed Index |
| [mempool.space](https://mempool.space/docs/api) | Bitcoin fees and network stats |
| RSS Feeds | Crypto news aggregation |
| Groq / Gemini / OpenAI / Anthropic / OpenRouter | AI-powered analysis |

## Rate Limiting

The API enforces a default rate limit of **200 requests per minute per IP** on all `/api/*` routes.

## Upstream References

This project was ported from and informed by the following repositories. They are **reference material used during development, no longer vendored**:

- <https://github.com/agentix-labs/agenti>
- <https://github.com/nicholasgriffintn/free-crypto-news>

## License

MIT
