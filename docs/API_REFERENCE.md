# API Reference

> Complete endpoint reference for the Crypto Vision API. OpenAPI 3.1 spec at [`openapi.yaml`](../openapi.yaml). Live directory at `GET /api`.

## Base URL

```
Production:  https://cryptocurrency.cv
Development: http://localhost:8080
```

## Authentication

Optional API key authentication via header or query parameter:

```
X-API-Key: your-key-here
# or
GET /api/coins?api_key=your-key-here
```

Admin endpoints require an admin key (set via `ADMIN_API_KEYS` env var).

## Response Format

All responses follow a standard envelope:

```json
{
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-03-04T00:00:00.000Z",
    "cached": true,
    "source": "coingecko"
  },
  "error": null
}
```

Error responses:

```json
{
  "data": null,
  "meta": { "requestId": "uuid", "timestamp": "..." },
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "status": 429
  }
}
```

## Rate Limiting

**200 requests per minute per IP** on all `/api/*` routes. Redis-backed when available, in-memory otherwise.

Response headers:
```
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 187
X-RateLimit-Reset: 1709510460
```

---

## Meta Endpoints

### `GET /`

API root with version info and links.

### `GET /health`

Health check with system diagnostics.

**Response:**
```json
{
  "status": "ok",
  "uptime": 123456,
  "cache": { "hits": 5000, "misses": 200, "size": 1500 },
  "circuitBreaker": { "state": "closed", "failures": 0 },
  "websocket": { "clients": 42, "messagesPerSecond": 15 },
  "memory": { "heapUsed": 128000000, "rss": 256000000 }
}
```

### `GET /api`

JSON directory of all available endpoints (300+).

### `GET /api/ready`

Kubernetes readiness probe. Returns 200 when ready, 503 when not.

### `GET /metrics`

Prometheus-format metrics (request counts, latencies, error rates, cache stats).

---

## Market Data

### `GET /api/coins`

Top coins ranked by market cap.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `vs_currency` | string | `usd` | Target currency |
| `per_page` | number | `100` | Results per page (max 250) |
| `page` | number | `1` | Page number |
| `sparkline` | boolean | `false` | Include 7-day sparkline |
| `price_change_percentage` | string | — | Comma-separated: `1h,24h,7d,14d,30d,200d,1y` |

### `GET /api/coin/:id`

Detailed coin information.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | CoinGecko coin ID (e.g., `bitcoin`, `ethereum`) |

**Response includes:** description, links, market data, developer stats, community data, tickers.

### `GET /api/price`

Quick price lookup for multiple coins.

| Parameter | Type | Description |
|---|---|---|
| `ids` | string | Comma-separated coin IDs: `bitcoin,ethereum,solana` |
| `vs_currencies` | string | Comma-separated currencies: `usd,eur,btc` |

### `GET /api/trending`

Currently trending coins on CoinGecko. No parameters.

### `GET /api/global`

Global cryptocurrency market statistics. No parameters.

**Response includes:** total market cap, 24h volume, BTC/ETH dominance, active coins count.

### `GET /api/chart/:id`

Price chart data for a coin.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | Coin ID |
| `days` | number | `7` | Chart duration (1, 7, 14, 30, 90, 180, 365, max) |
| `interval` | string | — | `daily` or auto-selected |
| `vs_currency` | string | `usd` | Target currency |

### `GET /api/ohlc/:id`

OHLC candlestick data.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | Coin ID |
| `days` | number | `7` | Options: 1, 7, 14, 30, 90, 180, 365 |
| `vs_currency` | string | `usd` | Target currency |

### `GET /api/exchanges`

Exchange rankings by trust score.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `per_page` | number | `100` | Results per page (max 250) |
| `page` | number | `1` | Page number |

### `GET /api/categories`

Coin categories with aggregated market data. No parameters.

### `GET /api/fear-greed`

Crypto Fear & Greed Index.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `1` | Number of data points (max 30) |

**Response:**
```json
{
  "value": 75,
  "value_classification": "Greed",
  "timestamp": "1709510400"
}
```

### `GET /api/dex/search`

DEX pair search via DexScreener.

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Search query (token name, symbol, or address) |

---

## DeFi

### `GET /api/defi/protocols`

Top DeFi protocols ranked by TVL.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `100` | Max results |
| `chain` | string | — | Filter by chain (e.g., `Ethereum`, `Solana`) |
| `category` | string | — | Filter by category (e.g., `Dexes`, `Lending`) |

### `GET /api/defi/protocol/:slug`

Protocol detail with per-chain TVL breakdown and 90-day TVL history.

| Parameter | Type | Description |
|---|---|---|
| `slug` | path | Protocol slug (e.g., `aave`, `uniswap`) |

### `GET /api/defi/chains`

All chains ranked by TVL. No parameters.

### `GET /api/defi/chain/:name`

Chain TVL history (last 365 days).

| Parameter | Type | Description |
|---|---|---|
| `name` | path | Chain name (e.g., `Ethereum`, `Solana`) |

### `GET /api/defi/yields`

Yield pools sorted by APY.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `100` | Max results |
| `chain` | string | — | Filter by chain |
| `project` | string | — | Filter by project slug |
| `stablecoin` | boolean | — | Stablecoin pools only |
| `min_tvl` | number | — | Minimum TVL in USD |
| `min_apy` | number | — | Minimum APY percentage |

### `GET /api/defi/stablecoins`

Stablecoins sorted by circulating supply. No parameters.

### `GET /api/defi/dex-volumes`

Top 50 DEXs by volume. No parameters.

### `GET /api/defi/fees`

Top 50 protocols by fees/revenue. No parameters.

### `GET /api/defi/bridges`

Cross-chain bridge volumes. No parameters.

### `GET /api/defi/raises`

Recent crypto funding rounds.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max results (max 200) |

---

## News

### `GET /api/news`

Latest crypto news from 12+ RSS sources.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Results per page |
| `source` | string | — | Filter by source |
| `category` | string | — | Filter by category |
| `page` | number | `1` | Page number |

### `GET /api/news/search`

Full-text news search.

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Search query |
| `limit` | number | Max results (default 20) |

### `GET /api/news/bitcoin`

Bitcoin-specific news. No parameters.

### `GET /api/news/defi`

DeFi-specific news. No parameters.

### `GET /api/news/breaking`

Breaking news from the last 2 hours. No parameters.

### `GET /api/news/trending`

Trending stories based on cross-source frequency. No parameters.

### `GET /api/news/sources`

Available RSS feed sources and their status. No parameters.

---

## On-Chain

### `GET /api/onchain/gas`

Multi-chain gas prices (Bitcoin, EVM chains).

### `GET /api/onchain/bitcoin/fees`

Bitcoin fee estimates in sat/vB for different confirmation targets.

### `GET /api/onchain/bitcoin/stats`

Bitcoin network statistics (hashrate, difficulty, block height, mempool).

### `GET /api/onchain/token/:address`

Token information by contract address with DEX pair data.

| Parameter | Type | Description |
|---|---|---|
| `address` | path | Token contract address |

### `GET /api/onchain/prices`

Multi-chain token prices via DeFiLlama.

| Parameter | Type | Description |
|---|---|---|
| `coins` | string | Comma-separated `chain:address` pairs (e.g., `ethereum:0x...`) |

---

## AI Intelligence

Requires at least one LLM API key configured. Providers tried in order: Groq → Gemini → OpenAI → Anthropic → OpenRouter.

### `GET /api/ai/sentiment/:coin`

AI-powered sentiment analysis for a specific coin. Cached 5 minutes.

| Parameter | Type | Description |
|---|---|---|
| `coin` | path | Coin name or symbol (e.g., `bitcoin`, `ETH`) |

**Response:**
```json
{
  "coin": "bitcoin",
  "sentiment": "bullish",
  "confidence": 0.82,
  "summary": "...",
  "factors": ["...", "..."],
  "recommendation": "hold",
  "analyzedAt": "2026-03-04T00:00:00.000Z"
}
```

### `GET /api/ai/digest`

Daily market digest. Cached 15 minutes.

### `GET /api/ai/signals`

AI trading signals. Cached 10 minutes.

### `POST /api/ai/ask`

Free-form crypto Q&A with live market context enrichment.

**Request body:**
```json
{
  "question": "Should I buy Solana right now?",
  "context": "optional additional context"
}
```

---

## Search

### `GET /api/search`

Basic search across coins, protocols, and news.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Search query |
| `limit` | number | `10` | Max results |
| `type` | string[] | — | Filter by type: `coin`, `protocol`, `news` |

### `GET /api/search/smart`

AI-powered semantic search with intent classification.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Natural language query |
| `limit` | number | `10` | Max results |
| `threshold` | number | `0.7` | Similarity threshold (0-1) |

### `GET /api/search/nlq`

Natural language query with RAG retrieval. Uses embeddings + LLM to answer complex questions.

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Natural language question |

### `GET /api/search/suggest`

Autocomplete suggestions.

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Partial query (min 2 chars) |

---

## Bitcoin

23 endpoints for Bitcoin network data, on-chain analytics, and market models.

### `GET /api/bitcoin/overview`

Aggregated Bitcoin overview combining price, on-chain metrics, mining data, mempool stats, and market dominance in a single call.

### `GET /api/bitcoin/price`

BTC price from multiple sources (blockchain.info + CoinGecko) for cross-validation.

### `GET /api/bitcoin/metrics`

On-chain metrics: active addresses, hash rate, transaction count, block height.

### `GET /api/bitcoin/mining`

Mining statistics: hashrate, difficulty, pool distribution, block reward, miner revenue.

### `GET /api/bitcoin/mempool`

Mempool analysis: pending transaction count, size in bytes, fee estimates by priority, fee histogram.

### `GET /api/bitcoin/fees`

Fee estimates in sat/vB for different confirmation targets.

**Response:**
```json
{
  "fastest": 45,
  "halfHour": 38,
  "hour": 25,
  "economy": 12,
  "minimum": 5
}
```

### `GET /api/bitcoin/address/:address`

Address balance and transaction history.

| Parameter | Type | Description |
|---|---|---|
| `address` | path | Bitcoin address (26–90 characters) |

### `GET /api/bitcoin/tx/:txid`

Transaction detail: inputs, outputs, fee, size, confirmations.

| Parameter | Type | Description |
|---|---|---|
| `txid` | path | Transaction ID (64-character hex string) |

### `GET /api/bitcoin/block/:height`

Block detail by height or hash.

| Parameter | Type | Description |
|---|---|---|
| `height` | path | Block height (non-negative integer) or block hash (64-char hex) |

**Response includes:** version, timestamp, transaction count, size, weight, difficulty, nonce.

### `GET /api/bitcoin/blocks/latest`

List of most recent blocks.

### `GET /api/bitcoin/halving`

Next halving countdown: blocks remaining, estimated date, reward schedule, previous halvings.

### `GET /api/bitcoin/supply`

Supply breakdown: total mined, circulating, max supply (21M), estimated lost, current inflation rate.

### `GET /api/bitcoin/utxo-stats`

UTXO set statistics (estimated from blockchain.info).

### `GET /api/bitcoin/lightning`

Lightning Network statistics: node count, channel count, total capacity, average fee rates, Tor node percentage.

### `GET /api/bitcoin/dominance`

BTC and ETH dominance percentages, with total market cap and volume.

### `GET /api/bitcoin/stock-to-flow`

Stock-to-Flow model: current S2F ratio, model price, deviation, comparison to gold and silver.

### `GET /api/bitcoin/rainbow`

Rainbow chart price bands with current band classification (e.g., "Accumulate", "HODL", "Bubble").

### `GET /api/bitcoin/hodl-waves`

HODL waves — UTXO age distribution showing holder behavior across time bands.

### `GET /api/bitcoin/exchange-balance`

Estimated BTC held on exchanges vs off-exchange (cold storage).

### `GET /api/bitcoin/whale-holdings`

Top BTC holder distribution tiers: shrimp (<1 BTC), crab, fish, dolphin, whale, mega whale (>10K BTC).

### `GET /api/bitcoin/stats`

Legacy endpoint. Network stats from blockchain.info.

### `GET /api/bitcoin/difficulty`

Legacy endpoint. Difficulty adjustment progress and estimated next retarget.

### `GET /api/bitcoin/block-height`

Legacy endpoint. Latest block height.

---

## CEX (Centralized Exchanges)

11 endpoints for centralized exchange data from Binance.

### `GET /api/cex/tickers`

All 24h tickers sorted by quote volume.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `quote` | string | — | Filter by quote asset (`USDT`, `BTC`, `ETH`) |
| `limit` | number | `100` | Max results (max 500) |

### `GET /api/cex/ticker/:symbol`

Single 24h ticker with price, change, OHLC, volume, bid/ask spread.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Trading pair (e.g., `BTCUSDT`) |

### `GET /api/cex/price/:symbol`

Current price for a single trading pair.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Trading pair (e.g., `ETHUSDT`) |

### `GET /api/cex/prices`

All current prices.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `quote` | string | — | Filter by quote asset |
| `limit` | number | `200` | Max results (max 2000) |

### `GET /api/cex/orderbook/:symbol`

Order book depth (bids + asks).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Trading pair |
| `limit` | number | `20` | Depth levels (max 1000) |

### `GET /api/cex/trades/:symbol`

Recent trades with price, quantity, time, and side.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Trading pair |
| `limit` | number | `50` | Number of trades (max 1000) |

### `GET /api/cex/klines/:symbol`

Candlestick / OHLCV data.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Trading pair |
| `interval` | string | `1h` | Candle interval (e.g., `1m`, `5m`, `15m`, `1h`, `4h`, `1d`) |
| `limit` | number | `100` | Number of candles (max 1000) |

### `GET /api/cex/pairs`

Available trading pairs from exchange info.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `quote` | string | — | Filter by quote asset |
| `status` | string | `TRADING` | Filter by status |

### `GET /api/cex/book-ticker`

Best bid/ask prices with spread calculation.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | query | Specific symbol (optional) |
| `quote` | query | Filter by quote asset (optional) |

### `GET /api/cex/mini-ticker`

Lightweight 24h ticker (faster response than full ticker).

| Parameter | Type | Description |
|---|---|---|
| `quote` | query | Filter by quote asset (optional) |

### `GET /api/cex/avg-price/:symbol`

5-minute weighted average price.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Trading pair |

---

## Derivatives

6 endpoints for derivatives data from CoinGlass. Feeds the anomaly detection engine.

### `GET /api/derivatives/funding`

Funding rates across all exchanges. Also triggers anomaly detection analysis.

### `GET /api/derivatives/funding/:symbol`

Funding rate for a specific symbol broken down by exchange.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Uppercase symbol (e.g., `BTC`, `ETH`) |

### `GET /api/derivatives/oi`

Open interest overview sorted by OI descending. Triggers anomaly detection.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max results (max 200) |

### `GET /api/derivatives/oi/:symbol`

Open interest breakdown by exchange for a specific symbol.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Uppercase symbol |

### `GET /api/derivatives/liquidations`

Liquidation data (long/short, 1h/4h/12h/24h windows) sorted by total 24h liquidations.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max results (max 200) |

### `GET /api/derivatives/long-short/:symbol`

Long/short ratio history for a symbol.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Uppercase symbol |
| `interval` | string | `h1` | Time interval |

---

## Perpetuals

19 endpoints for cross-exchange perpetual futures data (Bybit, OKX, Hyperliquid, dYdX, Deribit).

### `GET /api/perps/overview`

Multi-exchange perpetual market overview aggregating data from Bybit, OKX, Hyperliquid, and dYdX.

### `GET /api/perps/funding`

Top 50 cross-exchange funding rates sorted by absolute rate.

### `GET /api/perps/funding/:symbol`

Funding rate history for one asset across all supported exchanges.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Uppercase symbol (e.g., `BTC`) |

### `GET /api/perps/oi`

Open interest overview from Bybit + OKX.

### `GET /api/perps/oi/:symbol`

Open interest for one asset across Bybit, OKX, and dYdX.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Uppercase symbol |

### `GET /api/perps/markets`

Hyperliquid perpetual markets listing.

### `GET /api/perps/markets/dydx`

dYdX perpetual markets listing.

### `GET /api/perps/markets/bybit`

Bybit linear perpetual markets listing.

### `GET /api/perps/markets/okx`

OKX swap markets listing.

### `GET /api/perps/orderbook/:exchange/:symbol`

Order book from a specific exchange.

| Parameter | Type | Description |
|---|---|---|
| `exchange` | path | `bybit`, `okx`, `dydx`, or `deribit` |
| `symbol` | path | Uppercase symbol |

### `GET /api/perps/trades/:exchange/:symbol`

Recent trades from a specific exchange.

| Parameter | Type | Description |
|---|---|---|
| `exchange` | path | `bybit`, `dydx`, or `hyperliquid` |
| `symbol` | path | Uppercase symbol |

### `GET /api/perps/klines/:exchange/:symbol`

Candlestick data from a specific exchange.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `exchange` | path | — | `bybit`, `okx`, or `dydx` |
| `symbol` | path | — | Uppercase symbol |
| `interval` | string | `60` | Candle interval |
| `limit` | number | `100` | Number of candles |

### `GET /api/perps/options/:currency`

Deribit options instruments, book summary, and volatility index.

| Parameter | Type | Description |
|---|---|---|
| `currency` | path | Uppercase currency (`BTC`, `ETH`) |

### `GET /api/perps/volatility/:currency`

Deribit implied + historical volatility.

| Parameter | Type | Description |
|---|---|---|
| `currency` | path | Uppercase currency |

### `GET /api/perps/dydx/sparklines`

dYdX market sparklines.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `period` | string | `ONE_DAY` | Sparkline period |

### `GET /api/perps/hl/user/:address`

Hyperliquid user positions and open orders.

| Parameter | Type | Description |
|---|---|---|
| `address` | path | User wallet address |

### `GET /api/perps/hl/mids`

Hyperliquid all mid prices.

### `GET /api/perps/hl/stats`

Hyperliquid L1 stats.

### `GET /api/perps/deribit/currencies`

Deribit available currencies.

---

## DEX

9 endpoints for decentralized exchange pool data from GeckoTerminal.

### `GET /api/dex/networks`

List of supported DEX networks.

### `GET /api/dex/trending-pools`

Trending DEX pools across all chains.

### `GET /api/dex/trending-pools/:network`

Trending pools on a specific network.

| Parameter | Type | Description |
|---|---|---|
| `network` | path | Chain slug (e.g., `eth`, `solana`, `base`) |

### `GET /api/dex/new-pools`

Newly created pools across all chains.

### `GET /api/dex/new-pools/:network`

New pools on a specific network.

| Parameter | Type | Description |
|---|---|---|
| `network` | path | Chain slug |

### `GET /api/dex/top-pools/:network`

Top pools by volume on a network.

| Parameter | Type | Description |
|---|---|---|
| `network` | path | Chain slug |

### `GET /api/dex/pool/:network/:address`

Pool OHLCV candle data.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `network` | path | — | Chain slug |
| `address` | path | — | Pool contract address (hex) |
| `timeframe` | string | `hour` | Candle timeframe |
| `limit` | number | `100` | Max candles (max 1000) |

### `GET /api/dex/token/:network/:address`

Token info with top 20 pools.

| Parameter | Type | Description |
|---|---|---|
| `network` | path | Chain slug |
| `address` | path | Token contract address (hex) |

### `GET /api/dex/pool-search`

Search pools by query.

| Parameter | Type | Description |
|---|---|---|
| `q` | query | Search query (token name, symbol, or address) |

---

## Solana

18 endpoints for Solana ecosystem data including DeFi, staking, NFTs, and on-chain analytics.

### `GET /api/solana/overview`

Solana ecosystem overview: SOL price, TPS, slot height, staking stats, DeFi TVL.

### `GET /api/solana/price`

SOL price from CoinGecko in USD, BTC, and ETH.

### `GET /api/solana/tps`

Solana TPS and network performance metrics.

### `GET /api/solana/validators`

Active validators sorted by stake.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `30` | Max results (max 200) |

### `GET /api/solana/balance/:address`

SOL balance for a wallet address.

| Parameter | Type | Description |
|---|---|---|
| `address` | path | Solana wallet address |

### `GET /api/solana/tokens/:address`

SPL token holdings for a wallet.

| Parameter | Type | Description |
|---|---|---|
| `address` | path | Solana wallet address |

### `GET /api/solana/transactions/:address`

Recent transactions for a wallet.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `address` | path | — | Solana wallet address |
| `limit` | number | `10` | Max results (max 50) |

### `GET /api/solana/token/:mint`

Token metadata by mint address (via Helius).

| Parameter | Type | Description |
|---|---|---|
| `mint` | path | SPL token mint address |

### `GET /api/solana/tx/:sig`

Transaction detail by signature.

| Parameter | Type | Description |
|---|---|---|
| `sig` | path | Transaction signature |

### `GET /api/solana/defi/tvl`

Solana DeFi total value locked chart from DeFiLlama.

### `GET /api/solana/defi/protocols`

Top DeFi protocols on Solana.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |

### `GET /api/solana/defi/yields`

Top yield pools on Solana (>$100K TVL).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |

### `GET /api/solana/nft/collections`

Top Solana NFT collections from CoinGecko.

### `GET /api/solana/supply`

SOL supply distribution: circulating, staked, locked, burned.

### `GET /api/solana/epoch`

Current epoch info: progress percentage, remaining time, slot data.

### `GET /api/solana/health`

Cluster health and recent block production stats.

### `GET /api/solana/fees`

Recent fee statistics.

### `GET /api/solana/staking`

Staking overview: total staked SOL, active validators, APY, stake distribution.

---

## Analytics

28 endpoints for market analytics, DeFi analytics, and AI-powered analysis.

### `GET /api/analytics/market`

Full market overview: global stats, trending, fear/greed index, DeFi TVL.

### `GET /api/analytics/market/movers`

Top gainers and losers (24h).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `10` | Max results (max 50) |

### `GET /api/analytics/market/categories`

Market categories with market cap and change data.

### `GET /api/analytics/coin/:id`

Deep coin analysis: price, supply, market data, description.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | CoinGecko coin ID (e.g., `bitcoin`) |

### `GET /api/analytics/coin/:id/chart`

Price and volume chart data.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | CoinGecko coin ID |
| `days` | number | `30` | Chart duration (1–365) |
| `interval` | string | `daily` | Data interval |

### `GET /api/analytics/coin/:id/ohlc`

OHLC candlestick data.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | CoinGecko coin ID |
| `days` | number | `30` | Chart duration |

### `GET /api/analytics/coins`

Paginated coin listings.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number |
| `perPage` | number | `100` | Results per page (1–250) |
| `order` | string | `market_cap_desc` | Sort order |
| `sparkline` | boolean | `false` | Include 7-day sparkline |

### `GET /api/analytics/exchanges`

Exchange listings with trust scores.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number |
| `perPage` | number | `50` | Results per page (max 100) |

### `GET /api/analytics/exchanges/:id`

Single exchange detail.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Exchange ID |

### `GET /api/analytics/exchanges/:id/tickers`

Exchange tickers.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | Exchange ID |
| `page` | number | `1` | Page number |

### `GET /api/analytics/defi`

DeFi overview: TVL, chain breakdown, top protocols, top yields.

### `GET /api/analytics/defi/yields`

DeFi yield pools sorted by APY (>$1M TVL).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max results (max 200) |

### `GET /api/analytics/defi/protocols`

Top DeFi protocols by TVL.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max results (max 200) |

### `GET /api/analytics/defi/chains`

Chain TVLs from DeFiLlama.

### `GET /api/analytics/defi/stablecoins`

Top stablecoins by market cap.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |

### `GET /api/analytics/defi/protocol/:name`

Single protocol detail with TVL chart.

| Parameter | Type | Description |
|---|---|---|
| `name` | path | Protocol slug |

### `GET /api/analytics/defi/bridges`

Cross-chain bridge data.

### `GET /api/analytics/defi/volumes/dex`

DEX volume aggregation.

### `GET /api/analytics/global`

Global market stats from CoinGecko.

### `GET /api/analytics/trending`

Trending coins.

### `GET /api/analytics/search`

Search coins by query.

| Parameter | Type | Description |
|---|---|---|
| `q` | query | Search term (required) |

### `GET /api/analytics/categories`

All CoinGecko categories.

### `GET /api/analytics/category/:id`

Coins in a specific category.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Category ID |

### `GET /api/analytics/coin/:id/tickers`

Coin tickers (exchange listings).

| Parameter | Type | Description |
|---|---|---|
| `id` | path | CoinGecko coin ID |

### `POST /api/analytics/ai/analyze`

AI-powered coin analysis combining market data with LLM analysis.

**Request body:**
```json
{
  "coinId": "bitcoin",
  "question": "Is this a good entry point?"
}
```

### `POST /api/analytics/ai/report`

AI market report for multiple coins.

**Request body:**
```json
{
  "coinIds": ["bitcoin", "ethereum", "solana"],
  "format": "comparison"
}
```

| Field | Type | Description |
|---|---|---|
| `coinIds` | string[] | 1–10 CoinGecko coin IDs |
| `format` | string | `summary`, `detailed`, or `comparison` |

### `POST /api/analytics/ai/sentiment`

AI sentiment analysis for a coin.

**Request body:**
```json
{
  "coinId": "ethereum",
  "context": "ETH ETF approval"
}
```

### `GET /api/analytics/ai/providers`

List configured AI providers and their status.

---

## Whales

6 endpoints for whale transaction tracking via Whale Alert.

### `GET /api/whales/transactions`

Large cryptocurrency transactions.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |
| `min_value` | number | `500000` | Minimum USD value |
| `cursor` | string | — | Pagination cursor |

### `GET /api/whales/status`

Whale Alert API status and connectivity.

### `GET /api/whales/alerts/recent`

Recent whale alerts from the in-memory buffer.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `10` | Max results (max 50) |

### `GET /api/whales/alerts/stats`

Alert statistics: count by severity and type.

### `GET /api/whales/top-holders/:id`

Top holder distribution tiers (estimated).

| Parameter | Type | Description |
|---|---|---|
| `id` | path | CoinGecko coin ID |

### `GET /api/whales/exchange-flows`

Exchange inflow/outflow analysis estimated from Whale Alert data.

---

## Staking

6 endpoints for staking yields and validator data.

### `GET /api/staking/rates`

Top staking assets by market cap with reward rates.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |

### `GET /api/staking/rate/:id`

Staking details for a specific asset.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | CoinGecko coin ID |

### `GET /api/staking/validators/:chain`

Validator list for a chain (currently supports `solana`).

| Parameter | Type | Description |
|---|---|---|
| `chain` | path | Chain name (e.g., `solana`) |

### `GET /api/staking/overview`

Staking overview: top assets, total staked value.

### `GET /api/staking/eth`

Ethereum staking overview: validator count, total staked ETH, APR, entry queue.

### `GET /api/staking/sol`

Solana staking overview: validators, total staked SOL, APY.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `30` | Max validators (max 200) |

---

## Governance

7 endpoints for on-chain governance data from Snapshot.

### `GET /api/governance/spaces`

Top Snapshot governance spaces by followers.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |

### `GET /api/governance/space/:id`

Space detail: name, members, proposal count, strategies, admins.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Snapshot space ID |

### `GET /api/governance/proposals/:space`

Proposals for a governance space.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `space` | path | — | Space ID |
| `limit` | number | `10` | Max results (max 50) |
| `state` | string | — | Filter: `active`, `closed`, or `pending` |

### `GET /api/governance/proposal/:id`

Full proposal detail: title, body, choices, scores, quorum.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Proposal ID |

### `GET /api/governance/votes/:proposal`

Votes on a specific proposal.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `proposal` | path | — | Proposal ID |
| `limit` | number | `20` | Max results (max 100) |

### `GET /api/governance/active`

All currently active proposals across popular governance spaces.

### `GET /api/governance/leaderboard`

Top governance spaces by followers.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `10` | Max results (max 50) |

---

## NFT

5 endpoints for NFT collection data from CoinGecko.

### `GET /api/nft/trending`

Trending NFTs across marketplaces.

### `GET /api/nft/collections`

Top NFT collections by market cap.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |

### `GET /api/nft/collection/:id`

Collection detail: floor price, volume, owners, supply.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | CoinGecko NFT collection ID |

### `GET /api/nft/categories`

NFT categories and chains.

### `GET /api/nft/market-overview`

NFT market overview: total market cap, volume, floor prices for top collections.

---

## Macro

8 endpoints for macroeconomic data from Yahoo Finance and other sources.

### `GET /api/macro/dxy`

US Dollar Index (DXY) price and change.

### `GET /api/macro/rates`

US Treasury rates: 2Y, 10Y, 30Y yields and fed funds rate.

### `GET /api/macro/gold`

Gold price (XAU/USD).

### `GET /api/macro/vix`

CBOE Volatility Index (VIX).

### `GET /api/macro/overview`

Full macro overview combining DXY, rates, gold, VIX, with correlation commentary.

### `GET /api/macro/m2`

M2 money supply data.

### `GET /api/macro/inflation`

CPI and inflation data.

### `GET /api/macro/correlation`

Crypto vs macroeconomic correlation analysis.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `asset` | string | `bitcoin` | Crypto asset to correlate |
| `days` | number | `90` | Lookback period (max 365) |

---

## ETF

6 endpoints for crypto ETF data, flows, and market impact.

### `GET /api/etf/bitcoin`

Bitcoin spot ETF overview: all ETFs with AUM, daily flows, price, premium/discount.

### `GET /api/etf/ethereum`

Ethereum spot ETF overview.

### `GET /api/etf/flows`

ETF flow history (daily inflows/outflows).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | number | `30` | Lookback period (max 365) |

### `GET /api/etf/overview`

Combined BTC + ETH ETF dashboard.

### `GET /api/etf/comparison`

ETF comparison: AUM, expense ratio, volume, issuer.

### `GET /api/etf/impact`

ETF market impact analysis: % of supply held by ETFs, buying pressure metrics.

---

## Gas

8 endpoints for multi-chain gas prices.

### `GET /api/gas/ethereum`

Ethereum gas prices (fast, standard, safe) from Etherscan.

### `GET /api/gas/ethereum/history`

Gas price history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | number | `7` | Lookback period (max 90) |

### `GET /api/gas/bsc`

BSC gas oracle.

### `GET /api/gas/polygon`

Polygon gas oracle.

### `GET /api/gas/arbitrum`

Arbitrum gas oracle.

### `GET /api/gas/optimism`

Optimism gas oracle.

### `GET /api/gas/base`

Base gas oracle.

### `GET /api/gas/overview`

Multi-chain gas overview — all networks in a single response.

---

## Security

7 endpoints for token, wallet, and dApp security analysis via GoPlus.

### `GET /api/security/token/:chain/:address`

Token security audit: honeypot check, ownership analysis, buy/sell tax, holder distribution.

| Parameter | Type | Description |
|---|---|---|
| `chain` | path | Chain name (e.g., `ethereum`, `bsc`, `arbitrum`) |
| `address` | path | Token contract address |

### `GET /api/security/approval/:chain/:address`

Token approval security check for risky approvals.

| Parameter | Type | Description |
|---|---|---|
| `chain` | path | Chain name |
| `address` | path | Wallet address |

### `GET /api/security/malicious/:address`

Malicious address detection.

| Parameter | Type | Description |
|---|---|---|
| `address` | path | Wallet address to check |

### `GET /api/security/nft/:chain/:address`

NFT security check.

| Parameter | Type | Description |
|---|---|---|
| `chain` | path | Chain name |
| `address` | path | NFT contract address |

### `GET /api/security/dapp/:url`

dApp security check.

| Parameter | Type | Description |
|---|---|---|
| `url` | query | dApp URL (required) |

### `GET /api/security/phishing/:url`

Phishing site detection.

| Parameter | Type | Description |
|---|---|---|
| `url` | query | URL to check |

### `GET /api/security/overview`

Security overview: supported chains and audit capabilities.

---

## Layer 2

3 endpoints for Layer 2 scaling data from L2Beat.

### `GET /api/l2/summary`

All L2 projects with TVL, sorted by TVL descending.

### `GET /api/l2/tvl`

TVL breakdown (canonical, external, native) with 30-day history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |

### `GET /api/l2/activity`

Transaction activity and TPS across L2s with 7-day history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 100) |

---

## Portfolio

10 endpoints for portfolio analysis, optimization, backtesting, and risk assessment.

### `POST /api/portfolio/value`

Portfolio valuation for given holdings.

**Request body:**
```json
{
  "holdings": [
    { "coinId": "bitcoin", "amount": 0.5 },
    { "coinId": "ethereum", "amount": 10 }
  ],
  "vs_currency": "usd"
}
```

### `POST /api/portfolio/calculate`

Full PnL calculation: value, cost basis, profit/loss, allocations, diversification score.

**Request body:**
```json
{
  "holdings": [
    { "coinId": "bitcoin", "amount": 0.5, "costBasis": 25000 },
    { "coinId": "ethereum", "amount": 10, "costBasis": 1800 }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `holdings[].coinId` | string | CoinGecko coin ID |
| `holdings[].amount` | number | Quantity held (>0) |
| `holdings[].costBasis` | number | Optional average cost per unit |

### `POST /api/portfolio/analyze`

Deep portfolio analysis: volatility, max drawdown, correlation pairs, concentration risk, recommendations.

### `POST /api/portfolio/optimize`

Portfolio optimization suggestions using risk-parity blending.

**Request body:**
```json
{
  "holdings": [
    { "coinId": "bitcoin", "allocation": 60 },
    { "coinId": "ethereum", "allocation": 30 },
    { "coinId": "solana", "allocation": 10 }
  ],
  "riskTolerance": "moderate",
  "targetReturn": 15
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `riskTolerance` | string | `moderate` | `conservative`, `moderate`, or `aggressive` |
| `targetReturn` | number | — | Optional target annual return % |

### `POST /api/portfolio/risk`

Risk assessment: VaR (95%), Sharpe ratio, Sortino ratio, max drawdown, concentration risk, per-asset risk contribution.

### `POST /api/portfolio/correlation`

Asset correlation matrix (N×N Pearson correlation with strongest pairs highlighted).

**Request body:**
```json
{
  "coinIds": ["bitcoin", "ethereum", "solana", "avalanche-2"],
  "days": 90
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `coinIds` | string[] | — | 2–20 CoinGecko coin IDs |
| `days` | number | `90` | Lookback period (7–365) |

### `POST /api/portfolio/backtest`

Historical portfolio backtest with optional rebalancing.

**Request body:**
```json
{
  "holdings": [
    { "coinId": "bitcoin", "allocation": 50 },
    { "coinId": "ethereum", "allocation": 50 }
  ],
  "days": 180,
  "rebalanceFrequency": "monthly",
  "initialInvestment": 10000
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `days` | number | `90` | Backtest period (7–365) |
| `rebalanceFrequency` | string | `none` | `daily`, `weekly`, `monthly`, or `none` |
| `initialInvestment` | number | `10000` | Starting investment in USD |

**Response includes:** total return, Sharpe ratio, max drawdown, BTC benchmark comparison, timeline data.

### `POST /api/portfolio/diversification`

Diversification score for a portfolio.

### `GET /api/portfolio/volatility/:id`

Volatility and risk metrics for a single coin.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | CoinGecko coin ID |
| `days` | number | `90` | Lookback period (max 365) |
| `vs` | string | `usd` | Quote currency |

### `GET /api/portfolio/wallet/:address`

Auto-detect portfolio from an Ethereum wallet address.

| Parameter | Type | Description |
|---|---|---|
| `address` | path | Ethereum address (0x + 40 hex chars) |

---

## Agents

9 endpoints for AI agent management, execution, and orchestration.

### `GET /api/agents`

List all available agents with metadata, tags, categories, and AI config status.

### `GET /api/agents/categories`

Agent categories with counts.

### `GET /api/agents/search`

Search agents by ID, title, description, or tags.

| Parameter | Type | Description |
|---|---|---|
| `q` | query | Search term (required) |

### `GET /api/agents/discover`

AI-powered agent discovery using semantic/keyword matching.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | query | — | Natural language query (required) |
| `limit` | number | `5` | Max results (max 10) |

### `GET /api/agents/:id`

Agent detail: title, description, system role preview, opening questions.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Agent identifier |

### `POST /api/agents/:id/run`

Execute an agent task with AI completion and optional live data enrichment.

**Request body:**
```json
{
  "message": "What are the best yield farms on Solana right now?",
  "context": "I have $10k to deploy",
  "enrich": true,
  "maxTokens": 2048
}
```

| Field | Type | Description |
|---|---|---|
| `message` | string | User message (required) |
| `context` | string | Optional additional context |
| `enrich` | boolean | Enable live market data enrichment |
| `maxTokens` | number | Max response tokens |

### `POST /api/agents/multi`

Ask multiple agents simultaneously (max 5).

**Request body:**
```json
{
  "agents": ["defi-yield-farmer", "defi-risk-scoring-engine"],
  "message": "Analyze Aave v3 on Ethereum",
  "maxTokens": 2048
}
```

### `GET /api/agents/orchestrate/templates`

List available workflow templates for multi-agent orchestration.

### `POST /api/agents/orchestrate`

Multi-agent orchestration: plan → execute → synthesize.

**Request body:**
```json
{
  "question": "Analyze ETH risk and suggest a DeFi strategy",
  "template": "defi-analysis",
  "context": "Risk-averse investor"
}
```

---

## Calendar

7 endpoints for crypto events from CoinMarketCal and CoinPaprika.

### `GET /api/calendar/events`

Upcoming hot crypto events.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number |
| `max` | number | `50` | Results per page (max 100) |
| `sortBy` | string | `hot_events` | Sort order |

### `GET /api/calendar/coin/:symbol`

Events for a specific coin.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Coin symbol |
| `page` | number | `1` | Page number |
| `max` | number | `25` | Results per page (max 100) |

### `GET /api/calendar/categories`

Event categories.

### `GET /api/calendar/category/:id`

Events by category.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | Category ID (number) |
| `page` | number | `1` | Page number |
| `max` | number | `25` | Results per page (max 100) |

### `GET /api/calendar/coins`

Coins with upcoming events.

### `GET /api/calendar/paprika/:coinId`

CoinPaprika events for a coin.

| Parameter | Type | Description |
|---|---|---|
| `coinId` | path | CoinPaprika coin ID |

### `GET /api/calendar/aggregate`

Aggregated events from all sources.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | number | `30` | Lookback period |

---

## Oracles

7 endpoints for oracle price feed data from Chainlink, Pyth, and DIA.

### `GET /api/oracles/chainlink/feeds`

Chainlink Ethereum mainnet price feeds.

### `GET /api/oracles/chainlink/all`

All Chainlink feed directories across all networks.

### `GET /api/oracles/dia/quote/:symbol`

DIA oracle price quote.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/oracles/dia/assets`

DIA asset list.

### `GET /api/oracles/dia/supply/:symbol`

DIA circulating supply data.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/oracles/pyth/feeds`

Pyth Network feed IDs.

### `POST /api/oracles/pyth/prices`

Pyth latest prices for given feed IDs.

**Request body:**
```json
{
  "ids": ["0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"]
}
```

---

## Unlocks

11 endpoints for token unlock schedules and emission tracking.

### `GET /api/unlocks/upcoming`

Upcoming token unlocks.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | number | `30` | Lookahead period (1–365) |

### `GET /api/unlocks/token/:symbol`

Unlock schedule for a specific token.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/unlocks/calendar`

Calendar view of token unlocks.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | number | `90` | Lookahead period (1–365) |

### `GET /api/unlocks/large`

Large unlocks above a USD threshold.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `threshold` | number | `10000000` | Minimum USD value (min $100K) |
| `days` | number | `90` | Lookahead period (1–365) |

### `GET /api/unlocks/impact/:symbol`

Unlock price impact analysis for a token.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/unlocks/cliff`

Upcoming cliff unlocks.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | number | `90` | Lookahead period (1–365) |

### `GET /api/unlocks/vesting/:symbol`

Full vesting schedule for a token.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/unlocks/protocols`

All protocols with emission data.

### `GET /api/unlocks/protocol/:name`

Emission schedule for a specific protocol.

| Parameter | Type | Description |
|---|---|---|
| `name` | path | Protocol name |

### `GET /api/unlocks/supply/:name`

Protocol supply breakdown.

| Parameter | Type | Description |
|---|---|---|
| `name` | path | Protocol name |

### `GET /api/unlocks/tracked`

List of all tracked major protocol emissions.

---

## Social

18 endpoints for social media metrics, sentiment, and developer activity.

### `GET /api/social/stats/:symbol`

Aggregated social stats for a coin.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol (auto-uppercased) |

### `GET /api/social/trending`

Trending coins on social media.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `20` | Max results (max 50) |

### `GET /api/social/volume/:symbol`

Social volume (mention count) over time.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Token symbol |
| `days` | number | `30` | Lookback period (max 90) |

### `GET /api/social/sentiment/:symbol`

Social sentiment analysis.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/social/influencers/:symbol`

Top social influencers for a coin.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Token symbol |
| `limit` | number | `20` | Max results (max 50) |

### `GET /api/social/reddit/:symbol`

Reddit activity metrics.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/social/github/:symbol`

GitHub development activity.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/social/correlation`

Social vs price correlation analysis.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | query | — | Token symbol (required) |
| `days` | number | `30` | Lookback period (max 90) |

### `GET /api/social/profile/:id`

Social profile for a coin.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | CoinGecko coin ID |

### `GET /api/social/profiles`

Batch social profiles.

| Parameter | Type | Description |
|---|---|---|
| `ids` | query | Comma-separated CoinGecko coin IDs (max 20, required) |

### `GET /api/social/fear-greed`

Fear & Greed Index.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | number | `1` | Number of data points (max 365) |

### `GET /api/social/fear-greed/history`

Fear & Greed history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `30` | Number of data points (max 365) |

### `GET /api/social/lunar/top`

Top coins by social volume (LunarCrush).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sort` | string | `galaxy_score` | Sort metric |
| `limit` | number | `50` | Max results (max 100) |

### `GET /api/social/lunar/feed/:symbol`

LunarCrush social feed for a coin.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Token symbol |
| `limit` | number | `20` | Max results (max 50) |

### `GET /api/social/lunar/:symbol`

LunarCrush metrics for a coin.

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol |

### `GET /api/social/cc/history/:coinId`

CryptoCompare social history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `coinId` | path | — | CryptoCompare coin ID (number) |
| `limit` | number | `30` | Data points (max 365) |

### `GET /api/social/cc/:coinId`

CryptoCompare social stats.

| Parameter | Type | Description |
|---|---|---|
| `coinId` | path | CryptoCompare coin ID (number) |

### `GET /api/social/dashboard`

Aggregate social dashboard combining all social data sources.

---

## DePIN

5 endpoints for Decentralized Physical Infrastructure Network data.

### `GET /api/depin/projects`

All DePIN projects.

### `GET /api/depin/project/:slug`

Single project detail.

| Parameter | Type | Description |
|---|---|---|
| `slug` | path | Project slug |

### `GET /api/depin/categories`

Project categories.

### `GET /api/depin/metrics`

Aggregate DePIN metrics.

### `GET /api/depin/category/:category`

Projects by category.

| Parameter | Type | Description |
|---|---|---|
| `category` | path | Category name |

---

## Exchanges

16 endpoints for exchange data from CoinCap, Bybit, OKX, and Deribit.

### `GET /api/exchanges/list`

Ranked list of exchanges from CoinCap.

### `GET /api/exchanges/rates`

All conversion rates from CoinCap.

### `GET /api/exchanges/rates/:id`

Single conversion rate.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Rate ID |

### `GET /api/exchanges/bybit/insurance`

Bybit insurance fund history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `coin` | string | `BTC` | Coin filter |

### `GET /api/exchanges/bybit/risk-limit`

Bybit risk limits for a symbol.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | string | `BTCUSDT` | Trading pair |
| `category` | string | `linear` | Market category |

### `GET /api/exchanges/deribit/index`

Deribit index prices.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `currency` | string | `BTC` | Currency |

### `GET /api/exchanges/coincap/candles`

CoinCap exchange candles.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `exchange` | string | `binance` | Exchange ID |
| `base` | string | `bitcoin` | Base asset |
| `quote` | string | `tether` | Quote asset |
| `interval` | string | `h1` | Candle interval |

### `GET /api/exchanges/okx/spot`

OKX spot tickers (top 200).

### `GET /api/exchanges/okx/ticker/:instId`

OKX single ticker.

| Parameter | Type | Description |
|---|---|---|
| `instId` | path | Instrument ID (e.g., `BTC-USDT`) |

### `GET /api/exchanges/okx/instruments`

OKX instruments listing.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | string | `SPOT` | Instrument type |

### `GET /api/exchanges/okx/funding/:instId`

OKX funding rate.

| Parameter | Type | Description |
|---|---|---|
| `instId` | path | Instrument ID |

### `GET /api/exchanges/okx/mark-price`

OKX mark prices.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | string | `SWAP` | Instrument type |
| `instId` | string | — | Optional instrument filter |

### `GET /api/exchanges/bybit/spot`

Bybit spot tickers (top 200).

### `GET /api/exchanges/deribit/funding/:instrument`

Deribit funding rate.

| Parameter | Type | Description |
|---|---|---|
| `instrument` | path | Deribit instrument name |

### `GET /api/exchanges/:id/markets`

Markets on an exchange from CoinCap.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Exchange ID |

### `GET /api/exchanges/:id`

Single exchange detail from CoinCap.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Exchange ID |

---

## Aggregate

7 endpoints for multi-source data aggregation (CoinGecko, CoinPaprika, CoinCap).

### `GET /api/aggregate/prices/:ids`

Price from 3 sources with average calculation.

| Parameter | Type | Description |
|---|---|---|
| `ids` | path | Comma-separated uppercase symbols (e.g., `BTC,ETH,SOL`) |

### `GET /api/aggregate/global`

Global stats cross-checked from CoinGecko + CoinPaprika + Fear & Greed.

### `GET /api/aggregate/tickers`

CoinPaprika tickers: price, volume, market cap, change.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `100` | Max results (max 250) |

### `GET /api/aggregate/assets`

CoinCap assets: rank, price, market cap, supply.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `100` | Max results (max 250) |

### `GET /api/aggregate/history/:id`

CoinCap price history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | CoinCap asset ID |
| `interval` | string | `h1` | Data interval |

### `GET /api/aggregate/top-movers`

Biggest 24h gainers and losers from the top 250 by market cap.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `10` | Max results (max 25) |

### `GET /api/aggregate/market-overview`

Full market dashboard: global stats, fear/greed, trending, top coins, top chains TVL, DeFi TVL.

---

## Research

18 endpoints for deep asset research using Messari and CryptoCompare.

### `GET /api/research/assets`

Asset rankings with ROI metrics from Messari.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max results (max 200) |
| `page` | number | `1` | Page number |

### `GET /api/research/asset/:slug`

Deep asset profile: market data, supply, ATH, ROI, risk, on-chain metrics, developer activity.

| Parameter | Type | Description |
|---|---|---|
| `slug` | path | Messari asset slug |

### `GET /api/research/asset/:slug/markets`

Exchange/pair data for an asset (top 50 markets).

| Parameter | Type | Description |
|---|---|---|
| `slug` | path | Messari asset slug |

### `GET /api/research/asset/:slug/market`

Real-time market data from Messari.

| Parameter | Type | Description |
|---|---|---|
| `slug` | path | Messari asset slug |

### `GET /api/research/signals/:symbol`

Trading signals from IntoTheBlock (via CryptoCompare).

| Parameter | Type | Description |
|---|---|---|
| `symbol` | path | Token symbol (auto-uppercased) |

### `GET /api/research/social/:coinId`

Social metrics: Twitter, Reddit, GitHub activity from CryptoCompare.

| Parameter | Type | Description |
|---|---|---|
| `coinId` | path | CryptoCompare coin ID (number) |

### `GET /api/research/compare`

Compare multiple assets side by side.

| Parameter | Type | Description |
|---|---|---|
| `slugs` | query | Comma-separated Messari slugs (max 10, required) |

### `GET /api/research/top-volume`

Top coins by 24h volume from CryptoCompare.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max results (max 100) |

### `GET /api/research/news`

CryptoCompare news feed (top 50 articles).

| Parameter | Type | Description |
|---|---|---|
| `categories` | query | Category filter (optional) |

### `GET /api/research/news/categories`

CryptoCompare news categories.

### `GET /api/research/exchanges/:symbol`

Top exchanges for a symbol.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Token symbol (auto-uppercased) |
| `limit` | number | `20` | Max results (max 50) |

### `GET /api/research/price`

Multi-symbol price lookup from CryptoCompare.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `fsyms` | string | `BTC,ETH` | From symbols (comma-separated) |
| `tsyms` | string | `USD` | To symbols (comma-separated) |

### `GET /api/research/price-full`

Detailed multi-symbol price data: volume, market cap, 24h change, high/low.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `fsyms` | string | `BTC,ETH` | From symbols |
| `tsyms` | string | `USD` | To symbols |

### `GET /api/research/histoday/:symbol`

Daily OHLCV candles from CryptoCompare.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Token symbol (auto-uppercased) |
| `vs` | string | `USD` | Quote currency |
| `limit` | number | `30` | Number of candles (max 365) |

### `GET /api/research/histohour/:symbol`

Hourly OHLCV candles from CryptoCompare.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `symbol` | path | — | Token symbol (auto-uppercased) |
| `vs` | string | `USD` | Quote currency |
| `limit` | number | `24` | Number of candles (max 168) |

### `GET /api/research/top-mcap`

Top coins by market cap from CryptoCompare.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `vs` | string | `USD` | Quote currency |
| `limit` | number | `50` | Max results (max 100) |

### `GET /api/research/blockchains`

Available blockchain data from CryptoCompare.

### `GET /api/research/search`

Search assets via Messari.

| Parameter | Type | Description |
|---|---|---|
| `q` | query | Search term (required) |

---

## Ecosystem

18 endpoints for the agent ecosystem — autonomous trading organisms with skills, lineage, and interactions.

### `GET /api/ecosystem`

Ecosystem overview and aggregate statistics.

### `GET /api/ecosystem/organisms`

List all organisms (paginated, filterable).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sort` | string | `activity` | Sort: `activity`, `pnl`, `winrate`, `elo`, `newest`, `volume` |
| `status` | string | `active` | Filter: `active`, `dormant`, `extinct`, `all` |
| `generation` | number | — | Filter by generation |
| `category` | string | — | Filter by category |
| `page` | number | `1` | Page number |
| `limit` | number | `50` | Results per page (max 100) |

### `GET /api/ecosystem/organisms/:id`

Organism detail.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Organism ID |

### `GET /api/ecosystem/organisms/:id/trades`

Organism trade history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `id` | path | — | Organism ID |
| `page` | number | `1` | Page number |
| `limit` | number | `50` | Results per page (max 100) |
| `direction` | string | — | Filter: `buy`, `sell`, or `all` |

### `GET /api/ecosystem/organisms/:id/skills`

Organism skill breakdown.

### `GET /api/ecosystem/organisms/:id/lineage`

Ancestor/descendant tree.

### `GET /api/ecosystem/organisms/:id/interactions`

Interaction history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | string | — | Filter: `cooperate`, `compete`, `observe`, `compose`, `trade` |
| `page` | number | `1` | Page number |
| `limit` | number | `50` | Results per page (max 100) |

### `GET /api/ecosystem/organisms/:id/positions`

Current open positions.

### `GET /api/ecosystem/organisms/:id/holdings`

Investments in/from other agents.

### `GET /api/ecosystem/leaderboard`

Global rankings.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `category` | string | `overall` | `overall`, `pnl`, `winrate`, `trades`, `elo`, `streak` |
| `limit` | number | `50` | Max results (max 100) |

### `GET /api/ecosystem/feed`

Real-time activity feed.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max results (max 100) |
| `before` | string | — | Pagination cursor |
| `types` | string | — | Comma-separated event types |

### `GET /api/ecosystem/compositions`

Composition history.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number |
| `limit` | number | `50` | Results per page (max 100) |

### `GET /api/ecosystem/skills`

All skills in the ecosystem.

| Parameter | Type | Description |
|---|---|---|
| `category` | query | Filter by category (optional) |

### `GET /api/ecosystem/snapshots`

Historical ecosystem snapshots.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `100` | Max results (max 500) |
| `interval` | string | `1h` | `5m`, `15m`, `1h`, or `1d` |

### `GET /api/ecosystem/search`

Search organisms.

| Parameter | Type | Description |
|---|---|---|
| `q` | query | Search term (min 2 chars, required) |

### `GET /api/ecosystem/map`

Force-directed graph visualization data.

### `POST /api/ecosystem/organisms/:id/fund`

Fund an organism (SOL deposit).

**Request body:**
```json
{
  "walletAddress": "...",
  "amountLamports": "1000000000",
  "txSignature": "..."
}
```

### `POST /api/ecosystem/organisms/:id/intervene`

Owner intervention (adjust risk, pause, resume, rebalance, withdraw).

**Request body:**
```json
{
  "action": "adjust_risk",
  "ownerWallet": "..."
}
```

| Field | Type | Description |
|---|---|---|
| `action` | string | `adjust_risk`, `pause`, `resume`, `rebalance`, `add_skill_focus`, `withdraw` |

---

## Anomaly Detection

5 endpoints for the real-time anomaly detection engine (Modified Z-Score / MAD-based).

### `GET /api/anomalies`

Recent anomaly events with filtering.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `severity` | string | — | Filter: `info`, `warning`, `critical` |
| `type` | string | — | Anomaly type filter |
| `asset` | string | — | Asset name filter (case-insensitive contains) |
| `limit` | number | `50` | Max results (max 200) |

### `GET /api/anomalies/stats`

Detection engine statistics: severity counts, top assets, top anomaly types.

### `GET /api/anomalies/types`

Available anomaly types with configuration (z-score threshold, min data points, cooldown).

### `GET /api/anomalies/config`

Current detector configuration (MAD-based z-score method).

### `GET /api/anomalies/stream`

**Server-Sent Events** — real-time anomaly stream. Events sent by severity with a 30-second keep-alive ping.

```
GET /api/anomalies/stream
Accept: text/event-stream

event: anomaly
data: {"type":"price_spike","asset":"BTC","severity":"warning","zScore":3.2,...}

event: ping
data: {"timestamp":"..."}
```

---

## Export (Admin)

4 endpoints for BigQuery data export. All require admin API key via `X-API-Key` header.

### `POST /api/admin/export`

Trigger a full BigQuery export (non-blocking, returns immediately with export ID).

### `GET /api/admin/export/status`

Get status of current and recent exports with manifests from GCS.

### `GET /api/admin/export/tables`

List all exportable BigQuery tables.

### `GET /api/admin/export/manifest/:id`

Fetch a specific export manifest.

| Parameter | Type | Description |
|---|---|---|
| `id` | path | Export ID (must start with `export-`) |

---

## WebSocket Endpoints

### `ws://host/ws/prices`

Real-time price updates at 5 Hz (throttled from CoinCap WebSocket upstream).

**Subscribe:**
```json
{ "type": "subscribe", "coins": ["bitcoin", "ethereum", "solana"] }
```

**Message:**
```json
{
  "type": "prices",
  "data": {
    "bitcoin": { "price": 95000, "change24h": 2.5 },
    "ethereum": { "price": 3200, "change24h": -0.8 }
  },
  "timestamp": 1709510400000
}
```

### `ws://host/ws/bitcoin`

Bitcoin-specific real-time events: new blocks, fee changes, mempool updates from Mempool.space.

### `ws://host/ws/trades`

Live DEX trade stream from DexScreener.

### `ws://host/ws/status`

System health updates with 10-second heartbeat interval.

---

## Error Codes

| Code | HTTP | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Too many requests |
| `UPSTREAM_ERROR` | 502 | Upstream API failure (stale cache may be served) |
| `QUEUE_FULL` | 503 | AI request queue at capacity |
| `TIMEOUT` | 504 | Request processing exceeded timeout |
