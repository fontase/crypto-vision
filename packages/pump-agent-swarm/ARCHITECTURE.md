# Pump Agent Swarm — Architecture Plan

> **Package**: `@nirholas/pump-agent-swarm` v0.1.0  
> **Codebase**: ~14,264 lines across 38 source files  
> **Runtime**: Node.js 18+ (ESM)  
> **Chain**: Solana mainnet-beta / devnet  
> **Status**: Core built, ready for integration testing

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Swarm Lifecycle](#2-swarm-lifecycle)
3. [Agent Fleet](#3-agent-fleet)
4. [Trading Engine](#4-trading-engine)
5. [Bundle & Distribution Layer](#5-bundle--distribution-layer)
6. [Wallet Management](#6-wallet-management)
7. [Infrastructure Layer](#7-infrastructure-layer)
8. [x402 Analytics](#8-x402-analytics)
9. [Configuration System](#9-configuration-system)
10. [Module Inventory](#10-module-inventory)
11. [Data Flow](#11-data-flow)
12. [Security Model](#12-security-model)
13. [Extension Points](#13-extension-points)
14. [Build & Run](#14-build--run)
15. [Roadmap](#15-roadmap)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER LAYER                                     │
│   ┌──────────┐    ┌───────────┐    ┌──────────────────┐                │
│   │   CLI    │    │  SDK API  │    │    Dashboard     │                │
│   │ cli.ts   │    │ index.ts  │    │    (Future)      │                │
│   └────┬─────┘    └─────┬─────┘    └────────┬─────────┘                │
│        └────────────────┼───────────────────┘                          │
│                         ▼                                               │
│              ┌──────────────────────┐                                   │
│              │  Configuration       │                                   │
│              │  defaults + env +    │                                   │
│              │  overrides → validate│                                   │
│              └──────────┬───────────┘                                   │
├─────────────────────────┼───────────────────────────────────────────────┤
│                         ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    COORDINATOR LAYER                              │   │
│  │  ┌────────────────┐  ┌──────────────┐  ┌───────────────────┐    │   │
│  │  │ SwarmCoordinator│  │ StateMachine │  │    Strategies     │    │   │
│  │  │   (swarm.ts)   │──│ 18 phases    │  │ organic/volume/   │    │   │
│  │  │   Orchestrator │  │ typed guards │  │ graduation/exit   │    │   │
│  │  └───────┬────────┘  └──────────────┘  └───────────────────┘    │   │
│  └──────────┼──────────────────────────────────────────────────────┘   │
│             │                                                           │
│    ┌────────┼──────────────────────────────┐                           │
│    │        ▼                              │                           │
│  ┌─┴────────────────────────────────────────┴──┐                       │
│  │              AGENT FLEET (7 agents)          │                       │
│  │  Creator · Trader · Sniper · Accumulator     │                       │
│  │  Volume · Narrative · Sentinel               │                       │
│  └──────────┬──────────────────────────┬────────┘                       │
│             │                          │                                │
│  ┌──────────▼──────────┐  ┌────────────▼─────────────┐                 │
│  │   TRADING ENGINE    │  │   BUNDLE & DISTRIBUTION   │                │
│  │  TradeScheduler     │  │   JitoClient              │                │
│  │  GasOptimizer       │  │   DevBuyOptimizer         │                │
│  │  WashEngine         │  │   SupplyDistributor       │                │
│  │  VolumeGenerator    │  │                           │                │
│  │  PriceTrajectory    │  └───────────────────────────┘                │
│  │  PositionManager    │                                               │
│  │  WalletRotation     │                                               │
│  └─────────────────────┘                                               │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    INFRASTRUCTURE                                │   │
│  │  EventBus · RpcPool · Logger · Metrics · ErrorHandler            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  WALLET LAYER          │  x402 ANALYTICS                         │   │
│  │  WalletVault (HD+AES)  │  EVM client · Solana client · Server   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    EXTERNAL SERVICES                              │   │
│  │  Solana RPC · @pump-fun/pump-sdk · Jito Block Engine             │   │
│  │  LLM APIs (OpenRouter/OpenAI/Anthropic) · x402 API              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Event-driven** | All components communicate via `SwarmEventBus`; no direct coupling between agents |
| **State-machine governed** | 18-phase FSM with typed guards prevents illegal transitions |
| **Fail-safe** | SentinelAgent monitors all positions; automatic emergency exit on anomalies |
| **HD wallet isolation** | All wallets derived from single BIP-39 mnemonic; AES-256-GCM encrypted at rest |
| **MEV-protected** | Jito bundle submission for atomic operations (create + dev buy) |
| **Observable** | Structured logging, Prometheus metrics, event replay buffer |
| **Strategy-pluggable** | 4 presets (organic/volume/graduation/exit); easily extendable |

---

## 2. Swarm Lifecycle

The swarm progresses through **18 distinct phases**, governed by a typed finite state machine with async transition guards, per-phase timeouts, and an immutable audit trail.

```
idle → initializing → wallet_setup → funding → narrative_gen → token_config
  → minting → dev_buying → bundle_buying → supply_distribution
  → sniping → accumulating → trading → volume_generation → market_making
  → graduating → completed → cleanup → stopped

Emergency path: any active phase → emergency_exit → cleanup → stopped
Error path: any phase → error → cleanup → stopped
```

### Phase Details

| # | Phase | Agent(s) | Description |
|---|-------|----------|-------------|
| 0 | `idle` | — | Awaiting `start()` call |
| 1 | `initializing` | Coordinator | Validate config, connect RPC pool, init event bus |
| 2 | `wallet_setup` | WalletVault | Derive HD wallets for all agent roles |
| 3 | `funding` | WalletVault | Distribute SOL from master wallet to agent wallets |
| 4 | `narrative_gen` | NarrativeAgent | Generate token name, ticker, description, image prompt via LLM |
| 5 | `token_config` | Coordinator | Finalize token parameters, compute optimal dev buy |
| 6 | `minting` | CreatorAgent | Call Pump SDK `createV2AndBuyInstructions` to mint token |
| 7 | `dev_buying` | CreatorAgent | Execute dev buy atomically via Jito bundle |
| 8 | `bundle_buying` | CreatorAgent | Additional wallets buy at bonding curve floor |
| 9 | `supply_distribution` | SupplyDistributor | Redistribute tokens across agent wallets (pyramid/gaussian/etc.) |
| 10 | `sniping` | SniperAgent | Fast buys at lowest curve price (for external launches) |
| 11 | `accumulating` | AccumulatorAgent | Gradual position building (TWAP/VWAP/Iceberg) |
| 12 | `trading` | TraderAgent | Buy/sell cycles on bonding curve |
| 13 | `volume_generation` | VolumeAgent | Generate organic-looking volume via wash engine |
| 14 | `market_making` | TraderAgent + VolumeAgent | Active market making toward graduation |
| 15 | `graduating` | Coordinator | Monitor bonding curve ≥85% → Raydium migration |
| 16 | `completed` | — | Successfully graduated to Raydium |
| 17 | `emergency_exit` | SentinelAgent | Force-sell all positions, reclaim SOL |
| 18 | `cleanup` | Coordinator | Close ATAs, reclaim rent, log final metrics |

### State Machine Features

- **Typed transitions**: Only valid phase pairs are allowed (compile-time + runtime)
- **Async guards**: Each transition can have a guard function that returns `boolean`
- **Phase timeouts**: Configurable per-phase max duration (auto-escalate to error)
- **Enter/exit hooks**: Run async callbacks on phase entry and exit
- **Pause/resume**: Freeze the machine mid-phase without losing state
- **Audit trail**: Immutable array of `{ from, to, timestamp, metadata }` records

---

## 3. Agent Fleet

### 3.1 CreatorAgent (`agents/creator-agent.ts` — 312 lines)

**Purpose**: Mint new tokens on Pump.fun's bonding curve.

```
Input:  TokenConfig { name, symbol, metadataUri, devBuyAmount }
Output: MintResult  { mint: PublicKey, signature, slot, initialSupply }
```

- Uses `@pump-fun/pump-sdk` → `createV2AndBuyInstructions` for atomic create + initial buy
- Lazy-initializes `OnlinePumpSdk` via `getOnlineSdk()` helper
- Supports sequential bundle buys across multiple wallets post-creation
- Reads bonding curve state via `bondingCurvePda()` + account deserialization

### 3.2 TraderAgent (`agents/trader-agent.ts` — 462 lines)

**Purpose**: Execute buy/sell cycles on the bonding curve to generate activity and push price.

```
Loop:
  1. decideDirection() → 'buy' | 'sell' (based on strategy bias + randomization)
  2. buy() or sell() → build tx via Pump SDK
  3. scheduleNextTrade() → random delay within strategy bounds
  4. shouldStop() → check P&L limits, max trades, time bounds
```

- Fetches real on-chain state via `fetchBuyState` / `fetchSellState`
- Configurable buy/sell bias (e.g., 70/30 for organic strategy)
- Tracks per-agent P&L with `tradeResults[]`

### 3.3 SniperAgent (`agents/sniper-agent.ts` — 910 lines)

**Purpose**: Detect new Pump.fun token launches and buy at the absolute lowest bonding curve price.

**Detection Methods** (parallel, first-wins):
1. WebSocket subscription to Pump program account changes
2. Transaction log subscription filtering for `create` events
3. Polling fallback at configurable interval

**Speed Optimizations**:
- Pre-cached global Pump state (fetched once at init)
- Pre-built transaction skeletons (fill in mint + blockhash at detection)
- `skipPreflight: true` for minimum RPC latency
- Multi-RPC fanout (send same tx to all endpoints simultaneously)
- Jito bundle submission for MEV protection
- Trailing stop auto-sell (lock in gains, exit on reversal)

### 3.4 AccumulatorAgent (`agents/accumulator-agent.ts` — 750 lines)

**Purpose**: Build large positions gradually with minimal price impact.

| Strategy | Behavior |
|----------|----------|
| **TWAP** | Equal-sized buys at fixed intervals |
| **VWAP** | Volume-weighted sizing based on observed market volume |
| **Iceberg** | Large order split into small visible chunks |
| **Adaptive** | Dynamic sizing based on real-time price impact feedback |

### 3.5 NarrativeAgent (`agents/narrative-agent.ts` — 1,105 lines)

**Purpose**: AI-powered token identity generation.

- Calls LLM APIs (OpenRouter, OpenAI, or Anthropic) with structured prompts
- Generates: token name, ticker symbol, description, image prompt, metadata JSON, social media hooks
- Supports multiple narrative styles (meme, utility, community, etc.)
- Output feeds directly into `token_config` phase

### 3.6 VolumeAgent (`agents/volume-agent.ts` — 1,009 lines)

**Purpose**: Generate realistic trading volume across multiple wallets.

- Orchestrates wash trades via `WashEngine` (agent-to-agent coordinated trades)
- Uses `VolumeGenerator` for time-based volume curves (bell, ramp, burst, natural)
- Rotates wallets via `WalletRotation` to avoid on-chain pattern detection
- Back-pressure: slows down if trades are failing

### 3.7 SentinelAgent (`agents/sentinel-agent.ts` — 1,296 lines)

**Purpose**: Safety watchdog that monitors the entire swarm and triggers emergency actions.

**Monitored Conditions**:
- Wallet SOL balances (prevent drain)
- Aggregate P&L across all agents (stop-loss thresholds)
- Trade success rate (circuit-break if too many failures)
- Bonding curve state (detect rugs, abnormal reserve changes)
- Holder count changes (detect whale accumulation)
- Price movement velocity (detect pump-and-dumps)
- RPC endpoint health (failover triggers)
- Individual agent health (heartbeat monitoring)

**Actions**: Can trigger `emergency_exit` phase, pause individual agents, or alert via event bus.

---

## 4. Trading Engine

The trading engine is a 7-module pipeline that handles all trade execution logic:

### 4.1 TradeScheduler (`trading/trade-scheduler.ts` — 651 lines)

Central coordination engine with a **priority queue** (4 levels: critical / high / normal / low).

- **Conflict detection**: Prevents multiple agents from executing contradictory trades simultaneously
- **Execution windowing**: Batches trades into time windows for efficiency
- **Dependency chains**: Trade B can depend on Trade A completing first
- **Pause/resume/drain**: Graceful shutdown support

### 4.2 GasOptimizer (`trading/gas-optimizer.ts` — 545 lines)

Dynamic Solana priority fee and compute budget management.

- **Real-time fee sampling**: Polls recent transactions for priority fee distribution
- **Percentile calculation**: Uses configurable percentile (e.g., p75) for fee estimation
- **Compute unit simulation**: Simulates transactions to set accurate compute budgets
- **Congestion detection**: Monitors slot production to detect network congestion, adjusts fees accordingly

### 4.3 WashEngine (`trading/wash-engine.ts` — 725 lines)

Coordinated agent-to-agent trading for volume generation.

- **Pareto-distributed sizing**: Trade sizes follow Pareto distribution (realistic variance)
- **Per-wallet personality**: Each wallet has persistent traits (avg size, timing, direction preference)
- **Configurable price drift**: Trades can nudge price up/down within bounds
- **Back-pressure**: Automatically slows trade rate when execution failures increase

### 4.4 VolumeGenerator (`trading/volume-generator.ts` — 517 lines)

Time-based volume planning with **7 configurable curves**:

| Curve | Shape | Use Case |
|-------|-------|----------|
| `constant` | Flat line | Baseline activity |
| `ramp-up` | Linear increase | Launch buildup |
| `ramp-down` | Linear decrease | Graceful exit |
| `bell-curve` | Gaussian | Organic peak pattern |
| `burst` | Spike then decay | Attention-grabbing |
| `natural` | Random walk with drift | Most realistic |
| `custom` | User-defined points | Full control |

### 4.5 PriceTrajectoryController (`trading/price-trajectory.ts` — 855 lines)

Plans and executes price paths on the bonding curve.

- **Curve types**: Linear, exponential, step, S-curve
- **AMM math**: Constant-product bonding curve simulation (`x * y = k`)
- **Checkpoint tracking**: Verifies actual price against planned trajectory at intervals
- **Auto-correction**: Adjusts trade sizes to bring price back to planned path

### 4.6 PositionManager (`trading/position-manager.ts` — 987 lines)

Cross-agent aggregate position tracking.

- **Total tokens**: Sum across all agent wallets
- **Cost basis**: Weighted average entry price
- **P&L**: Real-time unrealized and realized P&L
- **Supply %**: Percentage of total token supply held by swarm
- **Position limits**: Configurable max supply %, max SOL exposure
- **Wallet rebalancing**: SPL token transfers between agent wallets
- **Auto-refresh**: Periodic on-chain balance reconciliation

### 4.7 WalletRotation (`trading/wallet-rotation.ts` — 436 lines)

Anti-pattern trading via wallet rotation strategies.

| Strategy | Behavior |
|----------|----------|
| `round-robin` | Cycle through wallets sequentially |
| `random` | Random wallet selection |
| `least-used` | Prefer wallets with fewest recent trades |
| `weighted-random` | Weighted by available balance |

- **Cooldown management**: Enforce minimum time between trades per wallet
- **Per-wallet hourly limits**: Prevent overuse of any single wallet
- **Direction preferences**: Some wallets prefer buying, others selling (realistic pattern)

---

## 5. Bundle & Distribution Layer

### 5.1 JitoClient (`bundle/jito-client.ts` — 680 lines)

MEV-protected atomic bundle submission to Jito Block Engine.

- Bundles up to 5 transactions atomically (all-or-nothing execution)
- Automatic tip account selection (rotates through Jito's 8 tip accounts)
- Status polling with exponential backoff
- Retry logic for dropped bundles
- Supports mainnet and devnet Jito endpoints

### 5.2 DevBuyOptimizer (`bundle/dev-buy-optimizer.ts` — 863 lines)

Calculates the optimal dev buy amount using bonding curve mathematics.

```
Constant-Product AMM: x * y = k

Given curve state:
  virtualSolReserves (x)
  virtualTokenReserves (y)

For input SOL amount (Δx):
  tokensOut = y - (k / (x + Δx))
  priceImpact = (newPrice - oldPrice) / oldPrice

Optimizer finds:
  - Maximum tokens per SOL spent
  - Target supply % acquisition
  - Graduation threshold analysis (how much SOL to reach Raydium migration)
```

### 5.3 SupplyDistributor (`bundle/supply-distributor.ts` — 1,055 lines)

Post-launch token redistribution across agent wallets.

| Strategy | Distribution |
|----------|-------------|
| `equal` | Even split across all wallets |
| `weighted` | Proportional to wallet role importance |
| `random` | Random amounts (Pareto distributed) |
| `pyramid` | Decreasing amounts per wallet tier |
| `gaussian` | Normal distribution centered on median |

**Features**:
- Automatic Associated Token Account (ATA) creation
- Batched transactions (5 transfers per tx to fit compute budget)
- Staggered timing between batches (anti-detection)
- Gini coefficient tracking (measures distribution inequality)

---

## 6. Wallet Management

### WalletVault (`wallet-manager.ts` — 953 lines)

Hierarchical deterministic wallet management with encrypted storage.

```
                     BIP-39 Mnemonic
                          │
                     Master Seed
                          │
              ┌───────────┼───────────┐
              │           │           │
         m/44'/501'/0'  m/44'/501'/1'  m/44'/501'/N'
              │           │           │
          Wallet 0    Wallet 1    Wallet N
           (creator)   (trader)    (volume)
```

**Key Features**:

| Feature | Implementation |
|---------|---------------|
| HD Derivation | BIP-39 mnemonic → ed25519 keys via `m/44'/501'/{i}'/0'` |
| Assignment | Wallets locked to agent roles; auto-unlock after configurable timeout |
| Encryption | AES-256-GCM + scrypt key derivation; file-based encrypted vault |
| Fund Distribution | 3 strategies: equal, weighted, random |
| Balance Monitoring | Periodic checks with low-balance event emission |
| Key Import/Export | Import external keypairs; export for backup |
| Reclaim | Sweep funds from all agent wallets back to master |

**Standalone Functions** (for simpler use cases):
- `createAgentWallet()` — Generate a new random wallet
- `restoreAgentWallet()` — Restore from secret key bytes
- `generateWalletPool()` — Create N wallets at once
- `refreshBalances()` — Update all wallet balances from chain
- `fundTraders()` — Distribute SOL from master to pool
- `reclaimFunds()` — Sweep all SOL back to master
- `exportWalletKeys()` — Get all secret keys for backup

---

## 7. Infrastructure Layer

### 7.1 SwarmEventBus (`infra/event-bus.ts` — 501 lines)

High-performance decoupled event communication backbone.

```
Publishers ──publish()──→ EventBus ──subscribe()──→ Subscribers
                              │
                         ┌────┴────┐
                    replay()    waitFor()
                 (10K buffer)  (Promise-based)
```

- **Wildcard pattern matching**: Subscribe to `trade.*` catches `trade.executed`, `trade.failed`, etc.
- **Circular buffer**: Last 10,000 events retained for replay
- **Async handlers**: Event handlers can be async; errors are caught and logged
- **Correlation tracking**: Events carry correlation IDs for distributed tracing
- **Pipe/debounce**: Chain event streams with transformations and debounce

### 7.2 RpcPool (`infra/rpc-pool.ts` — 511 lines)

Load-balanced Solana RPC connection pool.

- **Health checks**: Periodic latency probes; unhealthy endpoints removed from rotation
- **Failover**: Automatic retry on next endpoint when one fails
- **Rate limiting**: Per-endpoint request rate limits
- **Latency tracking**: P50/P95/P99 latency histograms per endpoint
- **Strategy**: Round-robin with health weighting

### 7.3 SwarmLogger (`infra/logger.ts` — 319 lines)

Structured logging with agent-aware context.

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "agentId": "trader-0x1a2b",
  "phase": "trading",
  "category": "trade",
  "correlationId": "uuid-v4",
  "message": "Buy executed",
  "data": { "sol": 0.5, "tokens": 125000 }
}
```

- JSON format for production (machine-parseable)
- Colorized output for development
- Per-category log level filtering

### 7.4 MetricsCollector (`infra/metrics.ts` — 699 lines)

In-process metrics collection and export.

| Metric Type | Description | Example |
|-------------|-------------|---------|
| Counter | Monotonically increasing | `trades_total`, `errors_total` |
| Gauge | Current value | `active_agents`, `sol_balance` |
| Histogram | Distribution | `trade_latency_ms`, `price_impact_bps` |
| Rate | Events per second | `trades_per_second` |

**Export formats**:
- **Prometheus text**: `GET /metrics` compatible
- **JSON dashboard**: Structured object for real-time UI

### 7.5 SwarmErrorHandler (`infra/error-handler.ts` — 673 lines)

Centralized error classification and recovery.

- **Solana-specific patterns**: Recognizes `BlockhashNotFound`, `InsufficientFunds`, `AccountNotFound`, compute budget exceeded, etc.
- **Error classification**: `transient` (retry), `permanent` (skip), `critical` (escalate)
- **Circuit breakers**: Per-operation circuit breakers (open after N failures, half-open after timeout)
- **Retry with backoff**: Exponential backoff + jitter, configurable max retries
- **Error context**: Enriches errors with agent ID, phase, wallet, and operation metadata

### 7.6 StateMachine (`infra/state-machine.ts` — 706 lines)

Typed finite state machine governing swarm lifecycle. See [Section 2](#2-swarm-lifecycle) for phase details.

---

## 8. x402 Analytics

### Dual Implementation

The package includes **two** x402 implementations for different networks:

#### 8.1 EVM x402 Client (`analytics/x402-client.ts` — 336 lines)

HTTP x402 auto-payment middleware for analytics API access.

| Endpoint | Cost | Returns |
|----------|------|---------|
| `getTokenAnalytics(mint)` | $0.02 | Volume, holders, price history |
| `getBondingCurveState(mint)` | $0.005 | Reserve balances, progress % |
| `getNewLaunches(limit)` | $0.01 | Recent token launches |
| `getTradingSignals(mint)` | $0.03 | Signal, confidence, reasoning |

- Uses `ethers.js` for EIP-712 signature generation
- Pays with Base USDC via facilitator contract
- Budget tracking: per-session spend limits

#### 8.2 Solana-Native x402 (`x402/` — 1,469 lines)

Pure Solana x402 implementation (no EVM, no facilitator).

| Component | Purpose |
|-----------|---------|
| `SolanaX402Client` (590 lines) | Client-side: USDC transfer + Memo program for payment proof |
| `SolanaX402Server` (561 lines) | Server-side: 402 response generation, RPC payment verification |
| Types (276 lines) | Constants (USDC mints, MEMO_PROGRAM_ID), interfaces |

**Payment Flow**:
```
Client → request → Server returns 402 + payment instructions
Client → USDC transfer + memo(receipt) → Solana
Client → retry request + payment proof → Server verifies on-chain → 200 + data
```

---

## 9. Configuration System

### 9.1 Configuration Factory (`config/` — 857 lines)

```
                    ┌──────────────┐
                    │  defaults.ts │ ← Sensible defaults for all settings
                    └──────┬───────┘
                           │ merge
                    ┌──────▼───────┐
                    │    env.ts    │ ← Environment variable overrides
                    └──────┬───────┘
                           │ merge
                    ┌──────▼───────┐
                    │  overrides   │ ← Programmatic overrides
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ validation   │ ← Field-by-field validation
                    │ .ts          │   with errors + warnings
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ SwarmConfig  │ ← Final validated config
                    └──────────────┘
```

### 9.2 Key Configuration Areas

```typescript
interface SwarmMasterConfig {
  // Token creation
  token: { name, symbol, metadataUri, devBuyAmount, description, image }
  
  // Trading parameters
  trading: { strategy, maxConcurrentTraders, tradeInterval, maxTrades, ... }
  
  // Wallet management
  wallets: { count, fundingAmount, mnemonic, derivationPath, ... }
  
  // Bonding curve targets
  graduation: { targetProgress, maxSolExposure, ... }
  
  // Safety limits
  safety: { maxLossPercent, minBalance, emergencyExitThreshold, ... }
  
  // Infrastructure
  rpc: { endpoints[], healthCheckInterval, maxRetries, ... }
  analytics: { enabled, apiUrl, budget, ... }
}
```

### 9.3 Strategy Presets

| Preset | Trade Interval | Buy/Sell Ratio | Max SOL | Use Case |
|--------|---------------|----------------|---------|----------|
| `organic` | 30-120s | 70/30 | 2 SOL | Slow, organic-looking growth |
| `volume` | 5-20s | 50/50 | 5 SOL | High volume, price neutral |
| `graduation` | 10-30s | 90/10 | 10 SOL | Push toward Raydium migration |
| `exit` | 3-10s | 20/80 | 3 SOL | Rapid position unwinding |

---

## 10. Module Inventory

### Source Files (38 total, ~14,264 lines)

| Directory | File | Lines | Purpose |
|-----------|------|-------|---------|
| `src/` | `types.ts` | 829 | All shared type definitions (40+ interfaces) |
| `src/` | `swarm.ts` | 500 | SwarmCoordinator — main orchestrator |
| `src/` | `wallet-manager.ts` | 953 | Wallet pool + WalletVault (HD + AES) |
| `src/` | `strategies.ts` | 118 | 4 preset trading strategies |
| `src/` | `index.ts` | 273 | Public API barrel exports |
| `src/` | `cli.ts` | 532 | Full CLI binary (`pump-swarm`) |
| `src/` | `pump-sdk.d.ts` | 192 | Custom type declarations for Pump SDK |
| **agents/** | `creator-agent.ts` | 312 | Token minting via Pump SDK |
| **agents/** | `trader-agent.ts` | 462 | Buy/sell cycles on bonding curve |
| **agents/** | `sniper-agent.ts` | 910 | Ultra-fast launch detection + buy |
| **agents/** | `accumulator-agent.ts` | 750 | Gradual position building (TWAP/VWAP) |
| **agents/** | `narrative-agent.ts` | 1,105 | AI-powered token identity generation |
| **agents/** | `volume-agent.ts` | 1,009 | Multi-wallet volume orchestration |
| **agents/** | `sentinel-agent.ts` | 1,296 | Safety monitoring + emergency actions |
| **bundle/** | `jito-client.ts` | 680 | MEV-protected bundle submission |
| **bundle/** | `dev-buy-optimizer.ts` | 863 | Bonding curve math for optimal dev buy |
| **bundle/** | `supply-distributor.ts` | 1,055 | Post-launch token redistribution |
| **config/** | `defaults.ts` | 140 | Default configuration values |
| **config/** | `env.ts` | 260 | Environment variable loader |
| **config/** | `validation.ts` | 336 | Config validation with error paths |
| **config/** | `index.ts` | 121 | Config factory function |
| **infra/** | `rpc-pool.ts` | 511 | Load-balanced RPC connection pool |
| **infra/** | `logger.ts` | 319 | Structured JSON + colorized logging |
| **infra/** | `metrics.ts` | 699 | In-process metrics (Prometheus export) |
| **infra/** | `error-handler.ts` | 673 | Error classification + circuit breakers |
| **infra/** | `event-bus.ts` | 501 | Decoupled event communication |
| **infra/** | `state-machine.ts` | 706 | 18-phase typed FSM |
| **trading/** | `gas-optimizer.ts` | 545 | Dynamic priority fee management |
| **trading/** | `volume-generator.ts` | 517 | Time-based volume curve planning |
| **trading/** | `wash-engine.ts` | 725 | Coordinated agent-to-agent trading |
| **trading/** | `wallet-rotation.ts` | 436 | Anti-pattern wallet cycling |
| **trading/** | `price-trajectory.ts` | 855 | Price path planning + execution |
| **trading/** | `trade-scheduler.ts` | 651 | Priority queue trade coordination |
| **trading/** | `position-manager.ts` | 987 | Cross-agent position tracking |
| **analytics/** | `x402-client.ts` | 336 | EVM x402 analytics client |
| **x402/** | `client.ts` | 590 | Solana-native x402 client |
| **x402/** | `server.ts` | 561 | Solana-native x402 server |
| **x402/** | `types.ts` | 276 | x402 constants and interfaces |
| **x402/** | `index.ts` | 42 | Barrel exports |

---

## 11. Data Flow

### 11.1 Token Launch Flow

```
User Config
    │
    ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  NarrativeAgent  │────▶│  DevBuyOptimizer  │────▶│  CreatorAgent    │
│  Generate name,  │     │  Calculate optimal│     │  createV2 + buy  │
│  ticker, story   │     │  SOL amount       │     │  via Pump SDK    │
└──────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                           │
                                                    ┌──────▼─────────┐
                                                    │   JitoClient   │
                                                    │  Submit atomic │
                                                    │  bundle (MEV   │
                                                    │  protected)    │
                                                    └──────┬─────────┘
                                                           │
                                                    ┌──────▼─────────┐
                                                    │  Supply        │
                                                    │  Distributor   │
                                                    │  Spread tokens │
                                                    │  to agents     │
                                                    └──────┬─────────┘
                                                           │
                              ┌────────────────────────────┼─────────────┐
                              │                            │             │
                       ┌──────▼──────┐  ┌──────────▼──────┐  ┌──────▼──────┐
                       │  Trader     │  │  VolumeAgent    │  │ Accumulator │
                       │  Agent      │  │  (wash trades)  │  │  Agent      │
                       └──────┬──────┘  └──────────┬──────┘  └──────┬──────┘
                              │                    │                 │
                              └────────────────────┼─────────────────┘
                                                   │
                                            ┌──────▼──────┐
                                            │  Bonding    │
                                            │  Curve      │
                                            │  → Raydium  │
                                            └─────────────┘
```

### 11.2 Event Flow

```
Agent Action ──▶ EventBus.publish()
                       │
          ┌────────────┼─────────────┬──────────────┐
          ▼            ▼             ▼              ▼
     SwarmLogger  MetricsCollector  SentinelAgent  TradeScheduler
     (log event)  (update counters) (check rules)  (update queue)
                                         │
                                    [anomaly?]
                                         │
                                    ┌────▼────┐
                                    │emergency│
                                    │_exit    │
                                    └─────────┘
```

---

## 12. Security Model

| Layer | Mechanism |
|-------|-----------|
| **Key Storage** | AES-256-GCM encryption with scrypt-derived key; never stored in plaintext |
| **HD Derivation** | Single mnemonic → all wallets; deterministic recreation without storing individual keys |
| **Wallet Isolation** | Each agent role has dedicated wallets; no cross-role access |
| **RPC Security** | API keys loaded from env vars; never logged or exposed |
| **Error Handling** | Secrets are stripped from error messages and stack traces |
| **Transaction Safety** | Jito bundles for atomic execution; GasOptimizer prevents overpaying |
| **Position Limits** | SentinelAgent enforces max supply %, max SOL exposure, stop-loss |
| **x402 Payments** | Cryptographic payment proofs; server-side on-chain verification |
| **Config Validation** | All user inputs validated before use; injection-safe |

---

## 13. Extension Points

### Adding a New Agent

1. Create `src/agents/my-agent.ts` implementing the agent interface
2. Add agent role to `AgentRole` enum in `types.ts`
3. Register in `SwarmCoordinator.initialize()`
4. Subscribe to relevant events via `SwarmEventBus`
5. Export from `src/index.ts`

### Adding a New Trading Strategy

1. Define strategy parameters in `strategies.ts`
2. Add to `PRESET_STRATEGIES` record
3. Strategy is automatically available via CLI `--strategy` flag

### Adding a New Volume Curve

1. Add curve type to `VolumeGenerator.curves` map
2. Implement the curve function `(t: number) => number` where `t ∈ [0, 1]`
3. Curve is automatically available in `VolumeAgent` configuration

### Adding a New Distribution Strategy

1. Add strategy to `SupplyDistributor.strategies` switch
2. Implement `(wallets: PublicKey[], total: number) => number[]`
3. Strategy is automatically available via config

### Adding New x402 Endpoints

1. Add pricing to `SolanaX402Server.routes`
2. Implement handler returning data
3. Add client method in `SolanaX402Client`

---

## 14. Build & Run

### Build

```bash
cd packages/pump-agent-swarm
npm install
npm run build          # TypeScript → dist/
npm run type-check     # Type validation only
```

### CLI Usage

```bash
# Via npx
npx pump-swarm \
  --name "My Token" \
  --symbol "MTK" \
  --metadata-uri "https://arweave.net/..." \
  --strategy organic \
  --wallet-count 5 \
  --dev-buy 1.0

# With environment-based config
export SWARM_RPC_URL="https://api.mainnet-beta.solana.com"
export SWARM_MASTER_KEY="base58..."
export SWARM_MNEMONIC="word1 word2 ... word12"
npx pump-swarm --name "Auto Token" --symbol "AUTO"
```

### SDK Usage

```typescript
import { SwarmCoordinator, createSwarmConfig, PRESET_STRATEGIES } from '@nirholas/pump-agent-swarm';

const config = createSwarmConfig({
  token: { name: 'My Token', symbol: 'MTK', metadataUri: '...' },
  trading: PRESET_STRATEGIES.organic,
});

const swarm = new SwarmCoordinator(config);
const status = await swarm.run();
console.log(status.summary);
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SWARM_RPC_URL` | Yes | Solana RPC endpoint |
| `SWARM_MASTER_KEY` | Yes | Master wallet secret key (base58) |
| `SWARM_MNEMONIC` | No | BIP-39 mnemonic for HD wallet derivation |
| `SWARM_JITO_URL` | No | Jito block engine URL |
| `SWARM_JITO_AUTH` | No | Jito authentication token |
| `OPENROUTER_API_KEY` | No | For NarrativeAgent LLM calls |
| `OPENAI_API_KEY` | No | Alternative LLM provider |
| `ANTHROPIC_API_KEY` | No | Alternative LLM provider |
| `X402_API_URL` | No | Analytics API base URL |
| `X402_PRIVATE_KEY` | No | EVM private key for x402 payments |

---

## 15. Roadmap

### Phase 1: Integration Testing (Current → Next)

- [ ] End-to-end test on Solana devnet
- [ ] JitoClient integration test with devnet block engine
- [ ] WalletVault encryption/decryption round-trip tests
- [ ] SniperAgent detection latency benchmarks
- [ ] Event bus stress test (10K events/second)

### Phase 2: Dashboard Integration

- [ ] Real-time WebSocket feed from EventBus → Dashboard
- [ ] Visual swarm status (phase, agents, positions)
- [ ] Live P&L charts per agent and aggregate
- [ ] Wallet balance monitoring panel
- [ ] Trade history table with filtering
- [ ] Bonding curve progress visualization

### Phase 3: Advanced Features

- [ ] Multi-token swarm (run N tokens simultaneously)
- [ ] Cross-token arbitrage between swarm tokens
- [ ] Automated Raydium LP provision post-graduation
- [ ] Social media integration (Twitter/Telegram auto-posting)
- [ ] Token metadata auto-generation with AI images
- [ ] Mobile push notifications for alerts

### Phase 4: Hardening

- [ ] Rate limiter per wallet to avoid detection
- [ ] Tor/proxy support for RPC diversity
- [ ] Hardware wallet support (Ledger) for master key
- [ ] Multi-sig emergency exit trigger
- [ ] Audit trail export (JSON → BigQuery pipeline)
- [ ] Automated compliance checks

---

*Architecture document generated from codebase analysis of 38 source files (~14,264 lines).*
