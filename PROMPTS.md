# Crypto Vision — Agent Build-Out Prompts

> **Philosophy**: Unlimited Claude credits. No shortcuts. Build the best possible version of everything.
>
> **Current baseline**: 155 tests passing, 11 test files, 24 route modules, 33 source adapters, 15 lib modules.
> **Branch**: `master` — always work on the current branch.
> **Git identity**: Always `git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"` before commits.
> **Terminal rule**: Always use `isBackground: true` for every command so a terminal ID is returned. Always kill the terminal after.

---

## Prompt 1 — Fix Broken Tests & Achieve Green Baseline

**Priority**: 🔴 Critical — must run first

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Ensure ALL tests pass. Run `npx vitest run 2>&1` and fix every failure.

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Read the failing test AND the source file it tests before making any change
- Fix tests to match actual source behavior — do NOT change source code to match outdated tests
- If a mock is wrong (wrong function signature, missing export), fix the mock
- If an assertion checks the wrong error code or message, fix the assertion to match what ApiError actually returns
- After fixing, run the full suite again to confirm zero failures
- Commit: "fix(tests): green baseline — all tests passing"
- Push to origin/master

CONTEXT:
- Test runner: vitest v3.2.4, config in vitest.config.ts
- Test patterns: src/routes/__tests__/*.test.ts, tests/**/*.test.ts
- Error system: src/lib/api-error.ts — errors return {error, code, timestamp} JSON
- Route tests use vi.mock() for source adapters, Hono app.request() for HTTP
- restoreMocks: true in vitest config — mocks restored between tests
- Sources are in src/sources/*.ts, routes in src/routes/*.ts, lib in src/lib/*.ts
```

---

## Prompt 2 — Lib Module Test Coverage

**Priority**: 🟠 High — core infrastructure needs tests

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Write comprehensive unit tests for all untested lib modules. Target: at least 2 tests per exported function (happy path + error case).

UNTESTED LIB MODULES (need tests):
1. src/lib/api-error.ts (241 lines) — Error factory, toResponse(), all static methods
2. src/lib/queue.ts — aiQueue, heavyFetchQueue, execute(), QueueFullError
3. src/lib/validation.ts — Zod-based request validation
4. src/lib/auth.ts — API key auth middleware, tier resolution
5. src/lib/middleware.ts — requestLogger, globalErrorHandler
6. src/lib/ai.ts — aiComplete function, prompt building
7. src/lib/cdn-cache.ts — CDN cache headers
8. src/lib/agents.ts — Agent loading/execution
9. src/lib/redis.ts — Redis client singleton
10. src/lib/ws.ts — WebSocket management

ALREADY TESTED (reference for patterns):
- tests/lib/cache.test.ts — cache module tests
- tests/lib/fetcher.test.ts — HTTP fetcher with retries/circuit breaker
- tests/lib/rate-limit.test.ts — rate limiting middleware

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Put tests in src/lib/__tests__/ following the pattern: api-error.test.ts, queue.test.ts, etc.
- Read each source file BEFORE writing its test — understand the actual exports and behavior
- Use vi.mock() for external dependencies (Redis, AI providers, etc.)
- Do NOT mock the module under test — test real behavior
- Each test file should have describe() blocks per exported function
- Test edge cases: empty inputs, invalid types, concurrent access, timeout scenarios
- Run `npx vitest run` after each test file to verify
- After all tests pass, run full suite to check for regressions
- Commit each test file individually with message: "test(lib): add {module} tests"
- Push to origin/master after all commits

VITEST CONFIG:
- include: ["tests/**/*.test.ts", "src/lib/__tests__/**/*.test.ts", "src/routes/__tests__/**/*.test.ts"]
- restoreMocks: true — mocks auto-restored between tests
- testTimeout: 10_000
- Path alias: @/ → src/
```

---

## Prompt 3 — Route Test Coverage (Batch 1: High-traffic routes)

**Priority**: 🟠 High — biggest routes need coverage

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Write integration tests for the 6 largest untested route modules. For each route, write at least 2 tests per endpoint (happy path + error case). Mock source adapters so no real API calls.

ROUTES TO TEST (ordered by size/importance):
1. src/routes/perps.ts (352 lines, ~60 route matches) — Perpetuals/cross-exchange
2. src/routes/research.ts (468 lines, ~36 routes) — Research & metrics
3. src/routes/analytics.ts (433 lines, ~24 routes) — Advanced analytics
4. src/routes/cex.ts (300 lines, ~23 routes) — Centralized exchanges
5. src/routes/aggregate.ts (278 lines, ~23 routes) — Multi-source aggregation
6. src/routes/bitcoin.ts (226 lines, ~20 routes) — Bitcoin-specific

ALREADY TESTED (reference for patterns — READ THESE FIRST):
- src/routes/__tests__/market.test.ts — best example, 24 tests
- src/routes/__tests__/ai.test.ts — 14 tests with cache/queue mocking
- src/routes/__tests__/defi.test.ts — 21 tests
- src/routes/__tests__/news.test.ts — 14 tests
- src/routes/__tests__/onchain.test.ts — 11 tests

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Put tests in src/routes/__tests__/{name}.test.ts
- Read the ROUTE FILE first to understand every endpoint, its imports, and error handling
- Read the SOURCE FILES it imports to know what functions to mock
- Mock pattern: vi.mock("../../sources/{name}.js", () => ({ functionName: vi.fn() }))
- Mount routes: const app = new Hono().route("/api/{prefix}", routes)
- Test both success (200) and error paths (400, 404, 500)
- Verify response shape — check that returned JSON has expected keys
- For routes with query params, test missing required params → 400
- Run tests after each file: npx vitest run src/routes/__tests__/{name}.test.ts
- After all 6 files, run full suite: npx vitest run
- Commit each file: "test(routes): add {name} route tests"
- Push to origin/master after all commits
```

---

## Prompt 4 — Route Test Coverage (Batch 2: Remaining routes)

**Priority**: 🟡 Medium

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Write integration tests for ALL remaining untested route modules. Same pattern as existing tests.

ROUTES TO TEST:
1. src/routes/dex.ts (220 lines) — DEX/pool routes
2. src/routes/security.ts (220 lines) — Security audit routes
3. src/routes/derivatives.ts (151 lines) — Derivatives data
4. src/routes/gas.ts (126 lines) — Gas tracker
5. src/routes/l2.ts (107 lines) — Layer 2 data
6. src/routes/keys.ts (99 lines) — API key management
7. src/routes/solana.ts (97 lines) — Solana-specific
8. src/routes/exchanges.ts (78 lines) — Exchange rankings
9. src/routes/governance.ts (66 lines) — Governance/voting
10. src/routes/macro.ts (61 lines) — Macro/TradFi data
11. src/routes/depin.ts (44 lines) — DePIN data
12. src/routes/agents.ts (399 lines) — AI agents

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Same patterns as Prompt 3 — read existing tests for reference
- Put tests in src/routes/__tests__/{name}.test.ts
- Read each route file BEFORE writing tests
- At least 2 tests per endpoint (happy + error)
- Run tests after each file, full suite after all
- Commit each: "test(routes): add {name} route tests"
- Push to origin/master
```

---

## Prompt 5 — Source Adapter Test Coverage

**Priority**: 🟡 Medium — validate all 33 data source integrations

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Write unit tests for all source adapters in src/sources/. These adapters call external APIs via fetchJSON from src/lib/fetcher.ts. Mock fetchJSON, test that each adapter:
1. Calls the correct URL with correct params
2. Transforms the response correctly
3. Handles errors gracefully (returns empty array, throws, etc.)

SOURCE ADAPTERS (33 files):
alternative.ts, binance.ts, bitcoin.ts, blockchain.ts, bybit.ts, calendar.ts,
coincap.ts, coingecko.ts, coinglass.ts, coinlore.ts, coinmarketcal.ts,
crypto-news.ts, cryptocompare.ts, defillama.ts, depinscan.ts, deribit.ts,
dydx.ts, evm.ts, geckoterminal.ts, goplus.ts, hyperliquid.ts, jupiter.ts,
l2beat.ts, macro.ts, messari.ts, news-aggregator.ts, nft.ts, okx.ts,
oracles.ts, snapshot.ts, staking.ts, tokenterminal.ts, unlocks.ts, whales.ts

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Put tests in src/sources/__tests__/{name}.test.ts
- Mock only fetchJSON: vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }))
- Read each source file to understand its exports, URLs, and response transformations
- Test at least 2 functions per adapter (or all if small)
- For each function: test happy path (mock returns expected data) + error path (mock throws)
- Update vitest.config.ts include pattern to add "src/sources/__tests__/**/*.test.ts"
- Run tests incrementally, full suite at end
- Batch commits by groups of 5-6 adapters: "test(sources): add {group} adapter tests"
- Push to origin/master
```

---

## Prompt 6 — OpenAPI / Swagger Spec Generation

**Priority**: 🟡 Medium — API documentation

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Generate a comprehensive OpenAPI 3.1 specification for the entire Crypto Vision API. Create it programmatically from the route definitions.

REQUIREMENTS:
1. Create src/lib/openapi.ts that exports the full OpenAPI spec object
2. Add a GET /api/docs/openapi.json route that serves the spec
3. Add a GET /api/docs route that serves Swagger UI (use @hono/swagger-ui or inline HTML with CDN)
4. Document EVERY endpoint across all 24 route files with:
   - Summary and description
   - Path parameters with types
   - Query parameters with types, defaults, and required flags
   - Request body schemas (for POST endpoints)
   - Response schemas with example values
   - Error responses (400, 401, 404, 429, 500, 503)
5. Add security scheme for X-API-Key header
6. Add server URLs for production (https://cryptocurrency.cv) and local (http://localhost:8080)
7. Group endpoints by tags matching route modules (Market, DeFi, News, AI, etc.)

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Read EVERY route file to catalog all endpoints, params, and response shapes
- Use Zod schemas from src/lib/validation.ts where they exist
- No placeholder descriptions — every endpoint gets a real, useful description
- Install @hono/swagger-ui if needed: npm install @hono/swagger-ui
- Verify the docs endpoint works by starting the server and checking /api/docs
- Run typecheck: npx tsc --noEmit
- Run tests: npx vitest run
- Commit: "feat(docs): add OpenAPI 3.1 spec with Swagger UI"
- Push to origin/master
```

---

## Prompt 7 — Request Validation with Zod

**Priority**: 🟡 Medium — type-safe input validation

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Add Zod-based request validation to ALL route endpoints. The project already has zod as a dependency and src/lib/validation.ts exists.

REQUIREMENTS:
1. Read src/lib/validation.ts to understand existing validation helpers
2. For each route file, add Zod schemas for:
   - Query parameters (with defaults, coercion for numbers, enums for allowed values)
   - Path parameters (with type validation)
   - Request bodies (for POST/PUT endpoints)
3. Use a consistent validation middleware pattern:
   - Parse with schema.safeParse()
   - On failure, return ApiError.validationFailed() with field-level details
   - On success, use typed parsed data instead of raw c.req.query()
4. Add schemas for common patterns:
   - Pagination: { page: z.coerce.number().min(1).default(1), limit: z.coerce.number().min(1).max(250).default(100) }
   - Coin ID: z.string().min(1).regex(/^[a-z0-9-]+$/)
   - Address: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
   - Days: z.coerce.number().min(1).max(365).default(7)
5. Export all schemas from a central file for reuse in OpenAPI generation

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Read each route file BEFORE adding validation — understand what params it uses
- Don't break existing tests — if a test expects a certain error format, keep it
- Add validation tests for new schemas
- Typecheck after: npx tsc --noEmit
- Full test suite after: npx vitest run
- Commit per route batch: "feat(validation): add Zod schemas for {group} routes"
- Push to origin/master
```

---

## Prompt 8 — Prometheus Metrics & Observability

**Priority**: 🟢 Nice to have — production observability

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Add Prometheus-compatible metrics and structured observability to the API.

REQUIREMENTS:
1. Create src/lib/metrics.ts with a lightweight metrics collector (no heavy deps — use prom-client or build a simple one):
   - http_requests_total (counter) — labels: method, path, status
   - http_request_duration_seconds (histogram) — labels: method, path
   - upstream_requests_total (counter) — labels: source, status
   - upstream_request_duration_seconds (histogram) — labels: source
   - cache_hits_total / cache_misses_total (counters) — labels: layer (memory/redis)
   - active_websocket_connections (gauge)
   - queue_depth (gauge) — labels: queue_name
   - circuit_breaker_state (gauge) — labels: host, state (closed/open/half-open)

2. Add GET /metrics endpoint (Prometheus text format, outside /api prefix)
3. Add metrics middleware that instruments every request automatically
4. Instrument the fetcher (src/lib/fetcher.ts) to track upstream calls
5. Instrument the cache (src/lib/cache.ts) to track hit/miss rates
6. Instrument the queue (src/lib/queue.ts) to track depth and execution time
7. Add a GET /api/metrics/summary endpoint returning JSON dashboard data

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Install prom-client: npm install prom-client
- Keep it lightweight — don't add overhead to hot paths
- Write tests for the metrics module
- Typecheck after: npx tsc --noEmit
- Full test suite: npx vitest run
- Commit: "feat(metrics): add Prometheus metrics and observability"
- Push to origin/master
```

---

## Prompt 9 — E2E Smoke Tests

**Priority**: 🟢 Nice to have — confidence for deployment

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Create end-to-end smoke tests that start the actual server and hit real endpoints.

REQUIREMENTS:
1. Create tests/e2e/smoke.test.ts
2. Use vitest with a global setup that:
   - Starts the server on a random available port (import from src/index.ts)
   - Waits for /health to return 200
   - Runs all tests
   - Shuts down the server
3. Test every major route group with at least one request:
   - GET /health → 200, has status: "ok"
   - GET /api → 200, has endpoints object
   - GET /api/coins → 200, returns array (may be empty if no API keys)
   - GET /api/defi/protocols → 200
   - GET /api/onchain/gas → 200
   - GET /api/news → 200
   - GET /api/ai/sentiment/bitcoin → 200 or 503 (no AI key)
   - Verify error responses: GET /api/price (missing ids) → 400
   - Verify 404: GET /api/nonexistent → 404
4. Add "test:e2e" script to package.json
5. Update vitest.config.ts — e2e tests should NOT run with unit tests (separate config or --project flag)

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- These tests may hit real APIs — use generous timeouts (30s)
- Don't fail on network errors from upstream — some sources may be down
- Focus on testing OUR server's behavior: correct status codes, JSON shape, headers
- Run: npx vitest run tests/e2e/
- Commit: "test(e2e): add smoke tests for all route groups"
- Push to origin/master
```

---

## Prompt 10 — TypeScript Strict Audit & Dead Code Removal

**Priority**: 🟢 Nice to have — code quality

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Audit the entire codebase for TypeScript issues, fix all type errors, remove dead code, and ensure strict compliance.

REQUIREMENTS:
1. Run `npx tsc --noEmit 2>&1` and fix EVERY error
2. Search for and eliminate:
   - Any `any` types — replace with proper types
   - Any `@ts-ignore` or `@ts-expect-error` — fix the underlying issue
   - Any `as` type assertions — replace with type guards or proper typing
   - Unused imports (eslint will catch some, but check manually)
   - Unused exports (functions/types exported but never imported)
   - Dead code paths (unreachable code, unused variables)
   - Empty catch blocks — add proper error handling or logging
3. Add return types to all exported functions that are missing them
4. Ensure all async functions have proper error handling
5. Run lint: npx eslint src/ --fix
6. Run tests: npx vitest run
7. Verify build: npm run build

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Do NOT change behavior — only fix types, remove dead code, add missing types
- If removing an export would break something, keep it
- Use grep to search for `any`, `@ts-ignore`, `as ` across all .ts files
- Commit in batches: "refactor(types): strict type audit for src/lib/*" etc.
- Push to origin/master
```

---

## Prompt 11 — Performance: ETags, Conditional Requests & Response Optimization

**Priority**: 🟢 Nice to have — production performance

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Add ETag support, conditional request handling, and response optimization across the API.

REQUIREMENTS:
1. Create src/lib/etag.ts middleware:
   - Generate weak ETags from response body hash (use crypto.createHash('sha256'))
   - Handle If-None-Match header → return 304 Not Modified when match
   - Set Cache-Control headers based on route freshness needs:
     * Market data: max-age=30, stale-while-revalidate=60
     * DeFi protocols: max-age=300, stale-while-revalidate=600
     * News: max-age=60, stale-while-revalidate=120
     * Static data (categories, exchanges): max-age=3600
     * AI responses: no-cache (every request is unique)
2. Apply ETag middleware globally (after route handlers, before response)
3. Add response envelope with metadata:
   - { data: ..., meta: { cached: bool, latencyMs: number, source: string } }
   - Only for /api/* routes, not /health or /metrics
4. Add response compression awareness in CDN cache headers

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Don't break existing tests — update assertions if response shape changes
- Write tests for the ETag middleware
- Benchmark before/after with curl timing
- Typecheck: npx tsc --noEmit
- Full test suite: npx vitest run
- Commit: "feat(perf): add ETag support and cache-control headers"
- Push to origin/master
```

---

## Prompt 12 — Comprehensive Error Recovery & Graceful Degradation

**Priority**: 🟢 Nice to have — resilience

```
You are working on the crypto-vision project at /workspaces/crypto-vision on the master branch.

TASK: Implement graceful degradation so the API returns partial data instead of errors when some upstream sources fail.

REQUIREMENTS:
1. Create src/lib/fallback.ts with a multi-source fetcher:
   - tryMultipleSources([primaryFn, fallbackFn1, fallbackFn2]) → returns first success
   - Adds "source" field to response indicating which source was used
   - Logs which sources failed and which succeeded
2. Apply to key aggregate routes:
   - /api/coins → try CoinGecko, fallback to CoinCap, fallback to CoinLore
   - /api/global → try CoinGecko, fallback to CoinPaprika, fallback to CoinLore
   - /api/fear-greed → try Alternative.me, fallback to calculated sentiment
   - /api/news → try crypto-news, fallback to news-aggregator RSS
3. Add circuit breaker integration — if a source's circuit breaker is open, skip it
4. Add stale-cache fallback — if all sources fail, return stale cached data with "stale: true" flag
5. Add degraded mode indicator to /health endpoint

RULES:
- Work on branch: master (current branch)
- Before any git commit: git config user.name "nirholas" && git config user.email "nirholas@users.noreply.github.com"
- Always use isBackground: true for terminal commands, always kill terminals after
- Read src/lib/fetcher.ts to understand existing circuit breaker
- Read src/lib/cache.ts to understand cache.get/cache.set with TTL
- Write tests for the fallback module
- Typecheck: npx tsc --noEmit
- Full test suite: npx vitest run
- Commit: "feat(resilience): add multi-source fallback and graceful degradation"
- Push to origin/master
```

---

## Execution Order

Run these prompts in order. Each builds on the previous.

| Phase | Prompt | What it does | Est. files changed |
|-------|--------|-------------|-------------------|
| 🔴 P0 | **1** | Fix broken tests → green baseline | 2-5 |
| 🟠 P1 | **2** | Lib module tests (10 files) | 10 new test files |
| 🟠 P1 | **3** | Route tests batch 1 (6 big routes) | 6 new test files |
| 🟠 P1 | **4** | Route tests batch 2 (12 remaining) | 12 new test files |
| 🟡 P2 | **5** | Source adapter tests (33 files) | 33 new test files |
| 🟡 P2 | **6** | OpenAPI/Swagger docs | 2-3 new files |
| 🟡 P2 | **7** | Zod validation on all routes | 24+ files modified |
| 🟢 P3 | **8** | Prometheus metrics | 3-5 new files |
| 🟢 P3 | **9** | E2E smoke tests | 1-2 new files |
| 🟢 P3 | **10** | TypeScript strict audit | 20-40 files modified |
| 🟢 P3 | **11** | ETags & performance | 3-5 files |
| 🟢 P3 | **12** | Graceful degradation | 5-10 files |

**After all prompts**: ~350+ tests, full OpenAPI docs, metrics, E2E coverage, strict types, production-grade resilience.
