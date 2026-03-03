# Prompt 001 — CoinGecko Source Adapter (Complete Implementation)

## Preamble — Read Every Time

You are an expert TypeScript engineer building **cryptocurrency.cv**, the most comprehensive crypto/DeFi API infrastructure in existence. The stack is **Hono + TypeScript + Node.js**, deployed on Google Cloud Run, with Redis caching and Zod validation.

### Absolute Rules

1. **Never mock, stub, or fake anything.** Every function must do real work against real APIs.
2. **TypeScript strict mode** — no `any`, no `@ts-ignore`, no type assertions unless documented why.
3. **Every async call** needs try/catch, every API response needs validation, every edge case needs a code path.
4. **Always kill terminals** after commands complete — never leave them open (`isBackground: true`, then `kill_terminal`).
5. **Always commit and push** as `nirholas`:
   ```bash
   git config user.name "nirholas"
   git config user.email "nirholas@users.noreply.github.com"
   git add -A && git commit -m "descriptive message" && git push
   ```
6. **If you are close to hallucinating** (unsure of an API schema, uncertain about a library's behavior, guessing at types), **stop and tell the prompter** what you're uncertain about rather than generating incorrect code.
7. **Always improve existing code** you touch — fix tech debt, add missing types, improve error messages.
8. **Run `npx tsc --noEmit`** after every change to verify compilation.
9. **Run `npx vitest run`** after every change to verify tests pass.

### Project Structure

```
src/
  index.ts              # Hono app entry, serves on port 8080
  lib/
    ai.ts               # AI completion wrapper (OpenRouter/Anthropic)
    api-error.ts         # Structured error responses with codes
    auth.ts              # API key auth + tier system (public/basic/pro/enterprise)
    cache.ts             # In-memory LRU + Redis hybrid cache
    cdn-cache.ts         # CDN cache headers
    fetcher.ts           # HTTP client with retry, circuit breaker, timeout
    logger.ts            # Pino structured logging
    middleware.ts        # CORS, request ID, timing middleware
    queue.ts             # Concurrency-limited AI queue
    rate-limit.ts        # Sliding window rate limiter per tier
    redis.ts             # Redis connection manager
    validation.ts        # Zod schema validation helpers
    ws.ts                # WebSocket manager
  routes/                # Hono route handlers (market, defi, ai, etc.)
  sources/               # Third-party API adapters (coingecko, defillama, etc.)
tests/                   # Vitest test files
```

### Conventions

- **Imports**: Use `@/` path alias (maps to `src/`), always include `.js` extension.
- **Exports**: Named exports only, no default exports.
- **Errors**: Use `FetchError` from `@/lib/fetcher.js` for HTTP failures.
- **Caching**: All source adapters should call `cache.wrap(key, fn, ttlSeconds)`.
- **Logging**: Use `log` from `@/lib/logger.js` — structured JSON with context.
- **Types**: Define Zod schemas for all API responses, derive TypeScript types with `z.infer<>`.

---

## Task

Build the **complete CoinGecko source adapter** at `src/sources/coingecko.ts`. This is the primary market data provider for cryptocurrency.cv.

### Context

CoinGecko provides: coin listings, prices, market data, trending coins, OHLCV charts, exchanges, global stats, NFT data, and category breakdowns. The free API (demo key) rate limits at 30 req/min. Pro keys get 500 req/min.

### Requirements

#### 1. Configuration & Base Client

```typescript
// Environment: COINGECKO_API_KEY, COINGECKO_PRO (boolean)
// Base URLs: https://api.coingecko.com/api/v3 (free), https://pro-api.coingecko.com/api/v3 (pro)
// Auth: x-cg-demo-key header (free) or x-cg-pro-api-key header (pro)
```

- Create a `cgFetch<T>(path, params?)` helper that:
  - Builds the full URL with query params
  - Adds correct auth header based on env
  - Uses `fetchJSON` from `@/lib/fetcher.js` with `retries: 2`, `timeout: 15_000`
  - Logs request hostname + path at debug level
  - Wraps result in `cache.wrap()` with appropriate TTL per endpoint type

#### 2. Zod Schemas (define all of these)

- `CoinListItem` — id, symbol, name, platforms
- `CoinMarket` — full market data (price, mcap, volume, supply, ATH, etc.)
- `CoinDetail` — comprehensive single-coin data (description, links, market_data, tickers)
- `CoinPrice` — simple price map `{ bitcoin: { usd: 60000, usd_24h_change: 2.5 } }`
- `TrendingResponse` — trending coins and NFTs
- `GlobalData` — total market cap, volume, dominance, active coins
- `OHLCData` — array of `[timestamp, open, high, low, close]`
- `ExchangeData` — exchange info with volume, trust score
- `CategoryData` — market categories with aggregate stats
- `SearchResult` — coins, exchanges, NFTs matching query

#### 3. Exported Functions (implement ALL)

| Function | Endpoint | Cache TTL | Description |
|----------|----------|-----------|-------------|
| `getCoins(params)` | `/coins/markets` | 60s | Paginated coin list with market data |
| `getCoinDetail(id)` | `/coins/{id}` | 120s | Full coin detail |
| `getCoinPrice(ids, currencies)` | `/simple/price` | 30s | Batch price lookup |
| `getTrending()` | `/search/trending` | 120s | Trending coins/NFTs |
| `getGlobal()` | `/global` | 60s | Global market stats |
| `getOHLC(id, days)` | `/coins/{id}/ohlc` | 300s | OHLCV candle data |
| `getExchanges(page)` | `/exchanges` | 300s | Exchange listings |
| `getExchangeDetail(id)` | `/exchanges/{id}` | 300s | Single exchange |
| `getCategories()` | `/coins/categories` | 300s | Category breakdown |
| `searchCoins(query)` | `/search` | 60s | Search coins/exchanges |
| `getCoinHistory(id, date)` | `/coins/{id}/history` | 3600s | Historical snapshot |
| `getCoinMarketChart(id, days)` | `/coins/{id}/market_chart` | 120s | Price/mcap/vol timeline |
| `getTopGainersLosers()` | `/coins/markets` (sorted) | 60s | Top movers |
| `getCoinTickers(id)` | `/coins/{id}/tickers` | 120s | Exchange tickers for a coin |
| `getNFTList()` | `/nfts/list` | 600s | NFT collection listings |

#### 4. Error Handling

- Catch 429 (rate limit) — log warning, let circuit breaker handle retry
- Catch 404 — return `null` for single-resource lookups
- Catch network errors — log with CoinGecko-specific context
- **Never throw unhandled** — every function returns `T | null` for single lookups or `T` with empty arrays for list endpoints

#### 5. Rate Limit Awareness

- Track remaining calls via `x-cg-remaining` response header when available
- Log warning when remaining < 5
- Expose `getRateLimitStatus()` function returning `{ remaining: number, limit: number }`

#### 6. Helper Utilities

- `formatMarketCap(num)` — human readable ($1.2T, $500M, etc.)
- `calculateDominance(coinMcap, globalMcap)` — percentage
- `groupByCategory(coins)` — group CoinMarket[] by category

### Acceptance Criteria

- [ ] File compiles with zero errors (`npx tsc --noEmit`)
- [ ] All 15+ functions exported and fully implemented
- [ ] Zod schemas validate all CoinGecko response shapes
- [ ] Every function has JSDoc with `@param`, `@returns`, `@example`
- [ ] Cache TTLs match the table above
- [ ] Circuit breaker via `fetchJSON` handles CoinGecko outages gracefully
- [ ] Existing route handlers in `src/routes/market.ts` continue to work
- [ ] All existing tests pass (`npx vitest run`)
- [ ] Committed and pushed as `nirholas`
- [ ] All terminals killed after use

### What to Improve While You're Here

- If `src/routes/market.ts` imports from this source, verify the imports still work
- If there are unused imports in adjacent files, clean them up
- If `src/lib/fetcher.ts` is missing type exports this file needs, add them
- Check if `src/lib/cache.ts` has the `wrap` signature this file expects

### Hallucination Warning

If you're unsure about a CoinGecko API response field or schema, check their docs at https://docs.coingecko.com/reference/ or tell the prompter: "I'm unsure about the exact shape of [endpoint]. Please verify." Do NOT guess at nested field names.
