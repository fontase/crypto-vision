# Data Sources

> Complete reference for all external data sources integrated into Crypto Vision.

## Table of Contents

1. [Overview](#overview)
2. [Market Data](#market-data)
3. [DeFi](#defi)
4. [News & Social](#news--social)
5. [On-Chain](#on-chain)
6. [Derivatives & Perps](#derivatives--perps)
7. [Security & Auditing](#security--auditing)
8. [Governance & Research](#governance--research)
9. [Macro & TradFi](#macro--tradfi)
10. [Source Adapter Architecture](#source-adapter-architecture)
11. [Rate Limits & Caching](#rate-limits--caching)

---

## Overview

Crypto Vision integrates **37+ external data sources** through source adapters located in `src/sources/`. Each adapter handles authentication, rate limiting, error handling, and response normalization.

| Category | Sources | Adapter Count |
|----------|---------|---------------|
| Market Data | CoinGecko, CoinCap, CoinLore, CoinPaprika, CryptoCompare | 5 |
| DeFi | DeFiLlama, TokenTerminal | 2 |
| DEX | GeckoTerminal, Jupiter | 2 |
| CEX | Binance, Bybit, OKX | 3 |
| Derivatives | Deribit, dYdX, Hyperliquid | 3 |
| News | RSS Aggregator (130+ feeds), Crypto News API | 2 |
| Social | LunarCrush, CryptoCompare Social | 2 |
| On-Chain | mempool.space, Blockchain.info, Etherscan, Blockchair | 4 |
| Security | GoPlus | 1 |
| Governance | Snapshot | 1 |
| NFT | Reservoir | 1 |
| Oracles | Chainlink, DIA, Pyth | 3 |
| Staking | Rated.network | 1 |
| L2 | L2Beat | 1 |
| DePIN | DePINScan | 1 |
| Calendar | CoinMarketCal | 1 |
| Research | Messari | 1 |
| Macro | Yahoo Finance | 1 |
| Sentiment | Alternative.me | 1 |
| Unlocks | Token unlock trackers | 1 |

---

## Market Data

### CoinGecko

| Field | Value |
|-------|-------|
| Adapter | `src/sources/coingecko.ts` |
| Base URL | `https://api.coingecko.com/api/v3` (free) or `https://pro-api.coingecko.com/api/v3` (pro) |
| Auth | Optional `x-cg-demo-key` or `x-cg-pro-api-key` header |
| Rate Limit | 30 req/min (free), 500 req/min (pro) |
| Cache TTL | 60s (prices), 300s (coin detail), 600s (categories) |

**Endpoints used:**
- `/coins/markets` — top coins by market cap
- `/coins/{id}` — coin detail with description, links, market data
- `/simple/price` — bulk price lookup
- `/search/trending` — trending coins
- `/coins/{id}/market_chart` — price/volume/mcap chart data
- `/coins/{id}/ohlc` — OHLC candlestick data
- `/exchanges` — exchange rankings
- `/coins/categories` — coin categories
- `/search` — search coins by name or symbol
- `/global` — global market statistics

### CoinCap

| Field | Value |
|-------|-------|
| Adapter | `src/sources/coincap.ts` |
| Base URL | `https://api.coincap.io/v2` |
| Auth | Optional Bearer token |
| WebSocket | `wss://ws.coincap.io/prices?assets=...` |

**Used for:** Real-time price WebSocket feed at `/ws/prices` (throttled to 5 Hz)

### CoinLore / CoinPaprika

| Field | Value |
|-------|-------|
| Adapter | `src/sources/coinlore.ts` |
| Base URL | `https://api.coinlore.net/api` / `https://api.coinpaprika.com/v1` |
| Auth | None |

**Used for:** Supplementary market data, coin metadata, exchange data

### CryptoCompare

| Field | Value |
|-------|-------|
| Adapter | `src/sources/cryptocompare.ts` |
| Base URL | `https://min-api.cryptocompare.com` |
| Auth | `Apikey` header |

**Used for:** Historical OHLCV data, social stats, coin metadata

---

## DeFi

### DeFiLlama

| Field | Value |
|-------|-------|
| Adapter | `src/sources/defillama.ts` |
| Base URL | `https://api.llama.fi` / `https://yields.llama.fi` / `https://stablecoins.llama.fi` / `https://bridges.llama.fi` |
| Auth | None (free, no API key required) |
| Rate Limit | Generous (no documented limit) |
| Cache TTL | 300s |

**Endpoints used:**
- `/protocols` — all DeFi protocols with TVL
- `/protocol/{slug}` — protocol detail with per-chain TVL history
- `/v2/chains` — all chains ranked by TVL
- `/v2/historicalChainTvl/{chain}` — chain TVL history
- `/pools` — yield pools with APY
- `/stablecoins` — stablecoin supply data
- `/overview/dexs` — DEX volume rankings
- `/overview/fees` — protocol fee/revenue data
- `/bridges` — cross-chain bridge volumes
- `/raises` — crypto funding rounds
- `/prices/current/{chain}:{address}` — token prices by contract

### TokenTerminal

| Field | Value |
|-------|-------|
| Adapter | `src/sources/tokenterminal.ts` |
| Base URL | `https://api.tokenterminal.com/v2` |
| Auth | Bearer token |

**Used for:** Protocol revenue, P/E ratios, financial metrics

---

## News & Social

### RSS News Aggregator

| Field | Value |
|-------|-------|
| Adapter | `src/sources/news-aggregator.ts` |
| Feed Count | 130+ RSS feeds |
| Auth | None |
| Cache TTL | 120s |

**Feed categories:**
- **General**: CoinDesk, CoinTelegraph, The Block, Decrypt, Bitcoin Magazine
- **DeFi**: DeFi Pulse, Bankless, The Defiant
- **Technical**: Ethereum Foundation, Bitcoin Core, Protocol blogs
- **Research**: Messari, Delphi Digital, Galaxy Research
- **Market**: Bloomberg Crypto, Reuters Crypto
- **Regional**: Various regional crypto news outlets

**Features:**
- Full-text search across articles
- Category filtering
- Trending topic detection
- Breaking news (articles < 2 hours old)
- Source metadata and reliability scoring

### LunarCrush

| Field | Value |
|-------|-------|
| Adapter | `src/sources/social.ts` |
| Base URL | `https://lunarcrush.com/api4/public` |
| Auth | Bearer token |

**Used for:** Social volume, sentiment scores, social dominance, galaxy scores

### Alternative.me

| Field | Value |
|-------|-------|
| Adapter | `src/sources/alternative.ts` |
| Base URL | `https://api.alternative.me/fng` |
| Auth | None |

**Used for:** Crypto Fear & Greed Index (0-100 scale)

---

## On-Chain

### mempool.space (Bitcoin)

| Field | Value |
|-------|-------|
| Adapter | `src/sources/bitcoin.ts` |
| Base URL | `https://mempool.space/api` |
| Auth | None |
| WebSocket | `wss://mempool.space/api/v1/ws` |

**Endpoints used:**
- `/v1/fees/recommended` — fee estimates (sat/vB)
- `/v1/mining/hashrate/3m` — hashrate history
- `/v1/difficulty-adjustment` — difficulty data
- `/v1/lightning/statistics/latest` — Lightning Network stats
- `/v1/mining/pools` — mining pool distribution

### Blockchain.info

| Field | Value |
|-------|-------|
| Adapter | `src/sources/blockchain-info.ts` |
| Base URL | `https://blockchain.info` |
| Auth | None |

**Used for:** Bitcoin rich list, transaction volume, total BTC stats

### Etherscan (EVM)

| Field | Value |
|-------|-------|
| Adapter | `src/sources/evm.ts` |
| Base URL | `https://api.etherscan.io/api` |
| Auth | API key parameter |

**Used for:** ETH gas prices, ETH supply, token information, transaction data

### Blockchair

| Field | Value |
|-------|-------|
| Adapter | `src/sources/whales.ts` |
| Base URL | `https://api.blockchair.com` |
| Auth | Optional API key |

**Used for:** Whale address tracking, large transfer detection, rich lists

---

## Derivatives & Perps

### Exchange APIs (Bybit, OKX, Binance)

| Exchange | Adapter | Base URL |
|----------|---------|----------|
| Binance | `src/sources/binance.ts` | `https://api.binance.com/api/v3` |
| Bybit | `src/sources/bybit.ts` | `https://api.bybit.com/v5` |
| OKX | `src/sources/okx.ts` | `https://www.okx.com/api/v5` |

**Used for:** Spot tickers, orderbooks, klines, funding rates, open interest

### Specialized Derivatives

| Exchange | Adapter | Base URL |
|----------|---------|----------|
| Hyperliquid | `src/sources/hyperliquid.ts` | `https://api.hyperliquid.xyz` |
| dYdX | `src/sources/dydx.ts` | `https://indexer.dydx.trade/v4` |
| Deribit | `src/sources/deribit.ts` | `https://www.deribit.com/api/v2` |

**Used for:** Perps markets, options data, liquidations, funding rate comparison

---

## Security & Auditing

### GoPlus Security

| Field | Value |
|-------|-------|
| Adapter | `src/sources/goplus.ts` |
| Base URL | `https://api.gopluslabs.io/api/v1` |
| Auth | None (free) |
| Cache TTL | 3600s |

**Endpoints used:**
- `/token_security/{chain_id}` — token security audit (honeypot, hidden tax, owner privileges)
- `/address_security/{address}` — address risk assessment
- `/phishing_site` — phishing URL detection
- `/nft_security/{chain_id}` — NFT contract security

---

## Governance & Research

### Snapshot (Governance)

| Field | Value |
|-------|-------|
| Adapter | `src/sources/snapshot.ts` |
| Base URL | `https://hub.snapshot.org/graphql` |
| Auth | None |

**Used for:** DAO proposals, voting results, governance spaces, voter participation

### Messari

| Field | Value |
|-------|-------|
| Adapter | `src/sources/messari.ts` |
| Base URL | `https://data.messari.io/api/v2` |
| Auth | `x-messari-api-key` header |

**Used for:** Deep asset metrics, OHLCV data, profile data, quantitative indicators

---

## Macro & TradFi

### Yahoo Finance

| Field | Value |
|-------|-------|
| Adapter | `src/sources/macro.ts`, `src/sources/etf.ts` |
| Base URL | `https://query2.finance.yahoo.com/v8` |
| Auth | None |
| Cache TTL | 300s |

**Used for:**
- **Macro**: S&P 500, NASDAQ, DXY (dollar index), VIX, gold, oil, treasury yields
- **ETF**: BTC/ETH spot ETF prices, NAV, volume, premium/discount

---

## Source Adapter Architecture

### Pattern

Every source adapter follows this structure:

```typescript
// src/sources/{name}.ts

import { safeFetch } from '@/lib/fetcher';
import { cache } from '@/lib/cache';

const BASE_URL = 'https://api.example.com';

export async function getDataFromSource(params: Params): Promise<Data> {
  const cacheKey = `source:${params.id}`;
  
  // Check cache first
  const cached = await cache.get<Data>(cacheKey);
  if (cached) return cached;

  // Fetch from upstream with circuit breaker
  const response = await safeFetch(`${BASE_URL}/endpoint`, {
    headers: { Authorization: `Bearer ${process.env.API_KEY}` },
  });

  // Validate and normalize
  const data = normalizeResponse(response);

  // Cache for future requests
  await cache.set(cacheKey, data, TTL);

  return data;
}
```

### Key Properties

| Property | Implementation |
|----------|---------------|
| Circuit Breaker | Opens after 5 failures, half-opens after 30s |
| Retry | 3 attempts with exponential backoff (1s, 2s, 4s) |
| Caching | Redis (if available) or in-memory LRU |
| Timeout | 10s per upstream request |
| Normalization | Each adapter maps vendor-specific fields to internal types |
| Error Handling | Graceful degradation — stale cache served when upstream fails |

---

## Rate Limits & Caching

### Cache TTL by Source

| Source | TTL | Rationale |
|--------|-----|-----------|
| CoinGecko (prices) | 60s | Balance freshness vs rate limits |
| CoinGecko (detail) | 300s | Metadata changes slowly |
| DeFiLlama | 300s | TVL updates every ~5 min |
| News feeds | 120s | News should be reasonably fresh |
| GoPlus (security) | 3600s | Security audits rarely change |
| Fear & Greed | 300s | Updates once daily |
| Bitcoin network | 120s | Blocks every ~10 min |
| Gas prices | 30s | Changes frequently |
| Exchange tickers | 30s | Near real-time |
| WebSocket prices | 0s | Real-time (throttled to 5 Hz) |

### Rate Limit Strategy

1. **Application-level** — 200 req/min per IP on the API
2. **Per-source** — respect upstream rate limits via cached responses
3. **Circuit breaker** — stops calling failing upstreams
4. **Backoff** — exponential backoff prevents thundering herd
5. **Stale-while-revalidate** — serve stale cache while refreshing in background
