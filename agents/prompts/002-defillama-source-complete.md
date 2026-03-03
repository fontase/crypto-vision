# Prompt 002 — DeFiLlama Source Adapter (Complete Implementation)

## Preamble — Read Every Time

You are an expert TypeScript engineer building **cryptocurrency.cv**, the most comprehensive crypto/DeFi API infrastructure in existence. The stack is **Hono + TypeScript + Node.js**, deployed on Google Cloud Run, with Redis caching and Zod validation.

### Absolute Rules

1. **Never mock, stub, or fake anything.** Every function must do real work against real APIs.
2. **TypeScript strict mode** — no `any`, no `@ts-ignore`, no type assertions unless documented why.
3. **Every async call** needs try/catch, every API response needs validation, every edge case needs a code path.
4. **Always kill terminals** after commands complete — never leave them open.
5. **Always commit and push** as `nirholas`:
   ```bash
   git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
   git add -A && git commit -m "descriptive message" && git push
   ```
6. **If you are close to hallucinating** — stop and tell the prompter what you're uncertain about.
7. **Always improve existing code** you touch — fix tech debt, add missing types, improve error messages.
8. **Run `npx tsc --noEmit` and `npx vitest run`** after every change.

### Project Structure

```
src/
  lib/          # cache.ts, fetcher.ts, logger.ts, api-error.ts, etc.
  routes/       # Hono route handlers
  sources/      # Third-party API adapters (THIS IS WHERE YOU WORK)
```

### Conventions

- Imports: `@/` alias → `src/`, always `.js` extension
- Named exports only, Zod schemas for all responses, cache.wrap() for all fetches
- Use `fetchJSON` from `@/lib/fetcher.js` with retry + circuit breaker

---

## Task

Build the **complete DeFiLlama source adapter** at `src/sources/defillama.ts`. DeFiLlama is THE source for DeFi TVL, yields, bridges, stablecoins, and protocol revenue data. No API key needed — fully open.

### DeFiLlama API Base URLs

```
https://api.llama.fi          # TVL, protocols, chains
https://yields.llama.fi       # Yield pools, APY data
https://bridges.llama.fi      # Bridge volumes
https://stablecoins.llama.fi  # Stablecoin flows
https://coins.llama.fi        # Token prices (multi-chain)
https://dimensions.llama.fi   # Volume, fees, revenue
```

### Requirements

#### 1. Base Client

```typescript
function llamaFetch<T>(base: string, path: string, params?: Record<string, string>, ttl?: number): Promise<T>
```

- Use appropriate base URL per data category
- Cache all responses — TVL data for 120s, yield data for 60s, price data for 30s
- No auth required

#### 2. Zod Schemas

Define comprehensive schemas for:

- `Protocol` — name, slug, chain, tvl, change_1h/1d/7d, category, chains[], mcap, etc.
- `ProtocolDetail` — full protocol with historical TVL, token info, chainTvls
- `ChainTVL` — chain name, tokenSymbol, tvl, change
- `YieldPool` — pool, project, chain, symbol, tvlUsd, apy, apyBase, apyReward, stablecoin, ilRisk, exposure
- `BridgeData` — id, name, chains, currentDayVolume, weeklyVolume
- `BridgeTransaction` — detailed bridge transfer
- `StablecoinData` — id, name, symbol, pegType, pegMechanism, circulating, chains
- `TokenPrice` — price, symbol, timestamp, confidence
- `FeeRevenue` — protocol, total24h, total7d, total30d, totalAllTime
- `RaisesData` — name, round, amount, date, category, leadInvestors, otherInvestors

#### 3. Exported Functions (implement ALL)

**TVL & Protocols:**

| Function | Endpoint | Cache TTL |
|----------|----------|-----------|
| `getProtocols()` | `/protocols` | 120s |
| `getProtocolDetail(slug)` | `/protocol/{slug}` | 120s |
| `getChainTVLs()` | `/v2/chains` | 120s |
| `getChainTVL(chain)` | `/v2/historicalChainTvl/{chain}` | 300s |
| `getHistoricalTVL()` | `/v2/historicalChainTvl` | 300s |
| `getProtocolsByChain(chain)` | Filter from `/protocols` | 120s |

**Yields:**

| Function | Endpoint | Cache TTL |
|----------|----------|-----------|
| `getYieldPools(chain?)` | `/pools` | 60s |
| `getYieldPool(poolId)` | `/pool/{poolId}` | 60s |
| `getTopYields(limit, stableOnly?)` | Filter from `/pools` | 60s |
| `getYieldByProject(project)` | Filter from `/pools` | 60s |
| `getYieldMedian()` | `/median` | 300s |

**Bridges:**

| Function | Endpoint | Cache TTL |
|----------|----------|-----------|
| `getBridges()` | `/bridges` | 300s |
| `getBridgeVolume(id, chain?)` | `/bridge/{id}` or `/bridgevolume/{chain}` | 300s |
| `getBridgeTransactions(id)` | `/transactions/{id}` | 120s |

**Stablecoins:**

| Function | Endpoint | Cache TTL |
|----------|----------|-----------|
| `getStablecoins()` | `/stablecoins` | 120s |
| `getStablecoinCharts(id)` | `/stablecoincharts/all` | 300s |
| `getStablecoinPrices()` | `/stablecoinprices` | 60s |

**Prices:**

| Function | Endpoint | Cache TTL |
|----------|----------|-----------|
| `getTokenPrices(coins)` | `/prices/current/{coins}` | 30s |
| `getHistoricalPrice(coins, timestamp)` | `/prices/historical/{ts}/{coins}` | 3600s |
| `getBatchPrices(coins)` | `/batchHistorical` (POST) | 30s |

**Fees & Revenue:**

| Function | Endpoint | Cache TTL |
|----------|----------|-----------|
| `getProtocolFees()` | `/overview/fees` | 120s |
| `getProtocolRevenue()` | `/overview/fees` (filter) | 120s |
| `getProtocolFeeDetail(slug)` | `/summary/fees/{slug}` | 120s |

**Raises & Funding:**

| Function | Endpoint | Cache TTL |
|----------|----------|-----------|
| `getRaises()` | `/raises` | 600s |
| `getHacks()` | `/hacks` | 600s |

#### 4. Aggregation Helpers

```typescript
export function calculateChainDominance(chain: string, chains: ChainTVL[]): number
export function getTopProtocolsByTVL(protocols: Protocol[], limit: number): Protocol[]
export function getTVLChangeLeaders(protocols: Protocol[], period: '1h' | '1d' | '7d'): Protocol[]
export function aggregateYieldsByChain(pools: YieldPool[]): Record<string, { avgApy: number; totalTvl: number; poolCount: number }>
export function findBestYields(pools: YieldPool[], filters: { minTvl?: number; stableOnly?: boolean; maxIlRisk?: string }): YieldPool[]
export function getStablecoinDominance(stables: StablecoinData[]): { name: string; share: number }[]
```

#### 5. Chain Name Normalization

DeFiLlama uses inconsistent chain names. Build a normalizer:

```typescript
export function normalizeChainName(raw: string): string
// "ethereum" → "Ethereum", "bsc" → "BSC", "arbitrum" → "Arbitrum"
```

### Acceptance Criteria

- [ ] File compiles with zero errors
- [ ] All 25+ functions exported and fully implemented
- [ ] Zod schemas validate all DeFiLlama response shapes
- [ ] Cache TTLs are appropriate per data category
- [ ] Chain name normalization handles all major chains
- [ ] Aggregation helpers are pure functions with proper types
- [ ] `src/routes/defi.ts` imports still work
- [ ] All existing tests pass
- [ ] Committed and pushed as `nirholas`
- [ ] All terminals killed

### Hallucination Warning

DeFiLlama's API has many endpoints with varying response shapes. If you're unsure about the exact response structure of an endpoint, check https://defillama.com/docs/api or tell the prompter. The `/protocols` response shape is particularly complex with nested chain TVLs — don't guess at field names.
