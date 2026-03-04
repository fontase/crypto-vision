# Testing Strategy

> Comprehensive testing guide for the `crypto-vision` monorepo.

## Table of Contents

1. [Overview](#overview)
2. [Test Categories](#test-categories)
3. [Running Tests](#running-tests)
4. [Test Structure](#test-structure)
5. [Writing Tests](#writing-tests)
6. [Coverage](#coverage)
7. [CI Integration](#ci-integration)
8. [Package Testing](#package-testing)

---

## Overview

Crypto Vision uses [Vitest](https://vitest.dev) as the test runner with a multi-layer testing strategy:

| Layer | Purpose | Speed | Count |
|-------|---------|-------|-------|
| Unit | Individual functions and modules | Fast (<1s) | ~33 files |
| Route | HTTP route handler behavior | Fast (<2s) | ~10 files |
| Integration | Multi-route API flows | Medium (~5s) | 1 file |
| E2E | Full server smoke tests | Slow (~30s) | 1 file |
| Fuzz | Random input robustness | Medium | 1 file |
| Benchmark | Performance regression | Variable | 1 file |
| Load | Stress/soak/smoke profiles | Long | 3 files |

---

## Test Categories

### Unit Tests (`tests/lib/`)

Test individual library modules in isolation:

```
tests/lib/
├── cache.test.ts              # Cache operations (get, set, TTL, eviction)
├── auth.test.ts               # API key validation
├── fetcher.test.ts            # HTTP fetch with circuit breaker
├── anomaly.test.ts            # Anomaly detection algorithms
├── anomaly-processors.test.ts # Anomaly signal processors
├── embeddings.test.ts         # Embedding generation and storage
├── queue.test.ts              # Request queue management
├── rate-limit.test.ts         # Rate limiter behavior
├── search.test.ts             # Semantic search logic
├── security.test.ts           # Security header validation
├── validation.test.ts         # Zod schema validation
├── ...                        # (33 total test files)
```

### Route Tests (`tests/routes/`)

Test HTTP endpoints including request validation, response format, and error handling:

```
tests/routes/
├── market.test.ts     # /api/coins, /api/price, /api/trending, etc.
├── defi.test.ts       # /api/defi/protocols, /api/defi/yields, etc.
├── health.test.ts     # /health endpoint
├── solana.test.ts     # /api/solana/* endpoints
├── staking.test.ts    # /api/staking/* endpoints
├── whales.test.ts     # /api/whales/* endpoints
├── portfolio.test.ts  # /api/portfolio/* endpoints
├── unlocks.test.ts    # /api/unlocks/* endpoints
├── anomaly.test.ts    # /api/anomalies/* endpoints
├── agents-orchestrate.test.ts  # /api/agents/* multi-agent flows
```

### Integration Tests (`tests/integration/`)

Test multi-route API flows that simulate real user journeys:

```typescript
// Example: portfolio flow
// 1. Search for coins
// 2. Get price data
// 3. Calculate portfolio value
// 4. Get correlation analysis
```

### E2E Tests (`tests/e2e/`)

Full server smoke tests with a real Hono server:

- **Global setup** — starts the server once, shares it across tests
- **Smoke tests** — verify all critical endpoints return 200
- **30s timeout** — allows for upstream API latency
- **Single fork** — tests share state (server process)

### Fuzz Tests (`tests/fuzz/`)

Random input testing for API robustness:

- Malformed query parameters
- Invalid JSON bodies
- Oversized payloads
- SQL injection attempts
- XSS payloads in search queries

### Benchmarks (`tests/benchmarks/`)

Performance regression detection:

- Response time P50/P95/P99
- Throughput under load
- Memory allocation patterns
- Cache hit/miss ratios

### Load Tests (`tests/load/`)

K6-based load testing profiles:

| Profile | File | Description |
|---------|------|-------------|
| Smoke | `smoke.js` | Quick validation — 1 VU, 30s |
| Soak | `soak.js` | Long-running stability — 50 VU, 1h |
| Stress | `stress.js` | Find breaking point — ramp to 500 VU |

---

## Running Tests

### Quick Reference

```bash
# Run all unit + route + integration tests
npm test

# Run tests in watch mode (re-run on file change)
npm run test:watch

# Run E2E tests (starts server)
npm run test:e2e

# Run with coverage report
npm test -- --coverage

# Run a specific test file
npm test -- tests/lib/cache.test.ts

# Run tests matching a pattern
npm test -- -t "should handle rate limiting"

# Run load tests (requires k6)
k6 run tests/load/smoke.js
```

### Configuration Files

| Config | Scope | File |
|--------|-------|------|
| Unit/Integration | `tests/**`, `src/**/__tests__/` | `vitest.config.ts` |
| E2E | `tests/e2e/**` | `vitest.e2e.config.ts` |

### Key Config Settings

**`vitest.config.ts`** (unit/integration):
- Environment: `node`
- Timeout: 10s per test
- Coverage provider: `v8`
- Coverage threshold: 50% statements
- Excludes: `tests/e2e/`, apps, packages

**`vitest.e2e.config.ts`** (E2E):
- Timeout: 30s per test
- Hook timeout: 60s
- Pool: single fork (shared server)
- Global setup: `tests/e2e/global-setup.ts`

---

## Test Structure

### Directory Layout

```
crypto-vision/
├── tests/                      # Central test directory
│   ├── lib/                    # Unit tests for src/lib/*
│   ├── routes/                 # Route-level tests
│   ├── integration/            # Multi-route flow tests
│   ├── e2e/                    # End-to-end tests
│   │   ├── global-setup.ts     # Server startup
│   │   └── smoke.test.ts       # Smoke test suite
│   ├── fuzz/                   # Fuzz tests
│   ├── benchmarks/             # Performance benchmarks
│   └── load/                   # K6 load test scripts
├── src/
│   ├── lib/__tests__/          # Co-located lib tests
│   ├── routes/__tests__/       # Co-located route tests
│   └── sources/__tests__/      # Co-located source tests
```

### Co-located vs Central

- **Central** (`tests/`) — for tests that span multiple modules or need special setup
- **Co-located** (`src/**/__tests__/`) — for unit tests tightly coupled to a single module
- Both locations are included by the vitest config

---

## Writing Tests

### Unit Test Pattern

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModuleUnderTest } from '@/lib/module';

describe('ModuleUnderTest', () => {
  let instance: ModuleUnderTest;

  beforeEach(() => {
    instance = new ModuleUnderTest();
  });

  describe('methodName', () => {
    it('should return expected result for valid input', () => {
      const result = instance.methodName('valid-input');
      expect(result).toEqual({ status: 'ok', data: [] });
    });

    it('should throw on invalid input', () => {
      expect(() => instance.methodName('')).toThrow('Input required');
    });

    it('should handle edge case', () => {
      const result = instance.methodName(null as unknown as string);
      expect(result).toBeNull();
    });
  });
});
```

### Route Test Pattern

```typescript
import { describe, it, expect } from 'vitest';
import { app } from '@/index';

describe('GET /api/endpoint', () => {
  it('should return 200 with valid data', async () => {
    const res = await app.request('/api/endpoint?limit=10');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.length).toBeLessThanOrEqual(10);
  });

  it('should return 400 for invalid params', async () => {
    const res = await app.request('/api/endpoint?limit=invalid');
    expect(res.status).toBe(400);
  });

  it('should respect rate limiting', async () => {
    // Send requests up to the limit
    for (let i = 0; i < 200; i++) {
      await app.request('/api/endpoint');
    }
    const res = await app.request('/api/endpoint');
    expect(res.status).toBe(429);
  });
});
```

### Naming Conventions

- Test files: `{module-name}.test.ts`
- Benchmark files: `{name}.bench.ts`
- Describe blocks: match class/module name
- Test names: `should {expected behavior} when {condition}`

---

## Coverage

### Thresholds

| Metric | Minimum | Target |
|--------|---------|--------|
| Statements | 50% | 80% |
| Branches | — | 70% |
| Functions | — | 75% |
| Lines | — | 80% |

### Viewing Coverage

```bash
# Generate coverage report
npm test -- --coverage

# Coverage report locations:
# - Terminal summary
# - coverage/index.html (detailed HTML report)
# - coverage/lcov.info (for CI integrations)
```

### Coverage by Module

Priority areas for coverage:

| Module | Priority | Reason |
|--------|----------|--------|
| `src/lib/cache.ts` | High | Core caching logic, many edge cases |
| `src/lib/auth.ts` | High | Security-critical |
| `src/lib/rate-limit.ts` | High | Prevents abuse |
| `src/lib/fetcher.ts` | High | Circuit breaker logic |
| `src/sources/*` | Medium | External API adapters |
| `src/routes/*` | Medium | Request validation |
| `src/lib/ai.ts` | Low | Hard to test without LLM keys |
| `src/workers/*` | Low | Depends on Pub/Sub |

---

## CI Integration

Tests run as part of the Cloud Build pipeline (`cloudbuild.yaml`):

```yaml
# Step 3 (parallel with typecheck and lint)
- name: 'node:22-alpine'
  args: ['npm', 'test']
```

### CI Test Matrix

| Check | Command | Blocking |
|-------|---------|----------|
| ESLint | `npm run lint` | Yes |
| TypeScript | `npm run typecheck` | Yes |
| Unit + Route + Integration | `npm test` | Yes |
| E2E | `npm run test:e2e` | No (optional) |
| Load | Manual trigger | No |

### Pre-Push Checklist

```bash
npm run lint && npm run typecheck && npm test
```

---

## Package Testing

Each package under `packages/` may have its own test setup:

| Package | Test Runner | Command |
|---------|-------------|---------|
| `pump-agent-swarm` | Vitest | `cd packages/pump-agent-swarm && npm test` |
| `agent-runtime` | Vitest | `cd packages/agent-runtime && npm test` |
| `binance-mcp` | MCP Inspector | `cd packages/binance-mcp && npm test` |
| `bnbchain-mcp` | Vitest | `cd packages/bnbchain-mcp && npm test` |
| `market-data` | Vitest | `cd packages/market-data && npm test` |
| `sweep` | Vitest | `cd packages/sweep && npm test` |

Package tests are independent of root tests. Run them from the package directory.
