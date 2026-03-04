# Pump.fun Agent Swarm

> **Autonomous multi-agent swarm for Solana Pump.fun token lifecycle** — 86 files, ~62,000 LOC

Creator agents mint tokens on Pump.fun's bonding curve, trader agents execute coordinated strategies, and an AI intelligence layer drives decisions — all orchestrated via a typed event bus with Jito bundle support, anti-detection, and a real-time monitoring dashboard.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Agents](#agents)
4. [Trading Engine](#trading-engine)
5. [Bundle System](#bundle-system)
6. [Intelligence Layer](#intelligence-layer)
7. [Coordination](#coordination)
8. [Dashboard](#dashboard)
9. [x402 Payments](#x402-payments)
10. [Configuration](#configuration)
11. [Preset Strategies](#preset-strategies)
12. [CLI](#cli)
13. [API](#api)
14. [Directory Structure](#directory-structure)

---

## Quick Start

```bash
# Install
cd packages/pump-agent-swarm
npm install

# Configure
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
export MASTER_WALLET_PRIVATE_KEY="[your-base58-key]"
export OPENROUTER_API_KEY="sk-or-..."

# Run
npm run start:swarm     # Full swarm (create + trade + intelligence)
npm run start:creator   # Creator agent only
npm run start:trader    # Trader agent only
npm run start:screener  # Screener API server
npm run cli             # Interactive CLI
```

### Programmatic Usage

```typescript
import { SwarmCoordinator, STRATEGY_ORGANIC } from '@nirholas/pump-agent-swarm';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';

const swarm = new SwarmCoordinator({
  rpcUrl: process.env.SOLANA_RPC_URL!,
  traderCount: 3,
  token: {
    name: 'AI Agent Coin',
    symbol: 'AIAC',
    metadataUri: 'https://arweave.net/metadata.json',
  },
  bundle: {
    devBuyLamports: new BN(0.5 * LAMPORTS_PER_SOL),
    bundleWallets: [],
    slippageBps: 500,
  },
  strategy: STRATEGY_ORGANIC,
  analyticsApiUrl: 'https://api.cryptovision.dev',
  x402PrivateKey: process.env.X402_PRIVATE_KEY,
});

swarm.on('token:created', (r) => console.log('Minted:', r.mint));
swarm.on('trade:executed', (r) => console.log('Trade:', r.order.direction));
swarm.on('pnl:updated', (r) => console.log('P&L:', r.totalPnl));

const status = await swarm.run();
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│               SWARM ORCHESTRATOR                            │
│  State Machine │ Phase Controller │ EventBus │ Config       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  AGENTS (10 types)                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────────┐  │
│  │ Creator │ │ Scanner │ │ Sniper  │ │ Narrative (AI)   │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────────┬─────────┘  │
│       │           │           │                │            │
│  ┌────▼───────────▼───────────▼────────────────▼─────────┐  │
│  │             BUNDLE ENGINE (Jito)                       │  │
│  │  Coordinator │ Validator │ Launch Sequencer            │  │
│  │  Anti-Detection │ Supply Distributor │ Timing          │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │              TRADING ENGINE                            │  │
│  │  ┌────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐  │  │
│  │  │ Trader │ │ Mkt Maker│ │ Volume Gen │ │ Accum.   │  │  │
│  │  └────┬───┘ └────┬─────┘ └────┬───────┘ └────┬─────┘  │  │
│  │       │          │            │               │        │  │
│  │  Wash Engine │ P&L Tracker │ Position Manager │  │
│  │  Order Router │ Slippage Calc │ Gas Optimizer │  │
│  │  Trade Scheduler │ Wallet Rotation │ Price Traj │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │             INTELLIGENCE LAYER (10 modules)            │  │
│  │  Strategy Brain │ Risk Manager │ Signal Generator      │  │
│  │  Sentiment (social APIs) │ Trend Detector │ Alpha      │  │
│  │  Market Regime │ Token Evaluator │ Narrative Gen       │  │
│  │  Portfolio Optimizer                                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │             COORDINATION (10 modules)                  │  │
│  │  Agent Messenger │ Consensus Engine │ Task Delegator   │  │
│  │  Lifecycle Manager │ Health Monitor │ Phase Controller  │  │
│  │  Rollback Manager │ Audit Logger │ Config Manager      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         DASHBOARD (Hono + WebSocket)                   │  │
│  │  Agent Monitor │ P&L │ Trades │ Supply Charts          │  │
│  │  Event Timeline │ Alerts │ Export │ REST API            │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Event-Driven Communication

All components communicate through a typed EventBus (`eventemitter3`):

```typescript
// Agents emit events
eventBus.emit('trade:executed', { agent: 'trader-0', tx, direction: 'buy', amount });
eventBus.emit('phase:changed', { from: 'LAUNCHING', to: 'TRADING' });
eventBus.emit('risk:alert', { level: 'HIGH', message: 'Drawdown exceeded 15%' });

// Other components subscribe
eventBus.on('trade:executed', (trade) => pnlTracker.recordTrade(trade));
eventBus.on('risk:alert', (alert) => sentinel.evaluateRisk(alert));
```

---

## Agents

### 10 Agent Types

| Agent | File | Lines | Role |
|-------|------|-------|------|
| **Creator** | `agents/creator-agent.ts` | 1,143 | Mints tokens on Pump.fun bonding curve with IPFS metadata upload and atomic dev buy |
| **Scanner** | `agents/scanner-agent.ts` | 1,653 | Scans Pump.fun for launch opportunities using configurable filters |
| **Trader** | `agents/trader-agent.ts` | 1,304 | Executes buy/sell strategies with timing randomization |
| **Sniper** | `agents/sniper-agent.ts` | 909 | Fast-entry on new token listings within seconds of launch |
| **Market Maker** | `agents/market-maker-agent.ts` | 933 | Maintains buy/sell spreads and manages inventory |
| **Volume** | `agents/volume-agent.ts` | 1,009 | Generates organic-looking trading volume patterns |
| **Accumulator** | `agents/accumulator-agent.ts` | 748 | Gradual position accumulation to avoid price impact |
| **Exit** | `agents/exit-agent.ts` | 1,278 | Strategic position unwinding with multi-tranche sells |
| **Sentinel** | `agents/sentinel-agent.ts` | 1,295 | Threat monitoring — rug detection, whale alerts, anomalies |
| **Narrative** | `agents/narrative-agent.ts` | 1,104 | AI-driven token branding, story generation, viral narratives |

---

## Trading Engine

12 components handling trade execution, risk management, and P&L tracking:

| Component | File | Purpose |
|-----------|------|---------|
| **Wash Engine** | `trading/wash-engine.ts` | Coordinated wash trading cycles between wallets |
| **Volume Generator** | `trading/volume-generator.ts` | Volume curves and bucket-based planning |
| **Price Trajectory** | `trading/price-trajectory.ts` | Bonding curve math (`calculateBuyOutput`, `calculateSellOutput`) |
| **Wallet Rotation** | `trading/wallet-rotation.ts` | Rotates wallets to avoid pattern detection |
| **Trade Scheduler** | `trading/trade-scheduler.ts` | Schedules orders with timing randomization |
| **Order Router** | `trading/order-router.ts` | Routes orders to best endpoint with performance tracking |
| **Slippage Calculator** | `trading/slippage-calculator.ts` | Pre-trade slippage estimation |
| **Gas Optimizer** | `trading/gas-optimizer.ts` | Priority fee optimization and congestion detection |
| **Position Manager** | `trading/position-manager.ts` | Aggregate and per-wallet position tracking |
| **P&L Tracker** | `trading/pnl-tracker.ts` | Real-time P&L with drawdown tracking and snapshots |
| **Profit Consolidator** | `trading/profit-consolidator.ts` | Profit-aware sweeping to master wallet |

---

## Bundle System

11 components for atomic multi-wallet transactions via Jito block engine:

| Component | File | Purpose |
|-----------|------|---------|
| **Bundle Coordinator** | `bundle/bundle-coordinator.ts` | Orchestrates multi-wallet atomic operations |
| **Jito Client** | `bundle/jito-client.ts` | Jito block engine submission and status tracking |
| **Supply Distributor** | `bundle/supply-distributor.ts` | Token supply distribution strategies |
| **Anti-Detection** | `bundle/anti-detection.ts` | Wallet fingerprint diversity, timing randomization |
| **Timing Engine** | `bundle/timing-engine.ts` | Optimal submission timing |
| **Bundle Validator** | `bundle/bundle-validator.ts` | Pre-submit simulation and validation |
| **Launch Sequencer** | `bundle/launch-sequencer.ts` | Full launch sequence orchestration (largest: 1,762 lines) |
| **Dev Buy Optimizer** | `bundle/dev-buy-optimizer.ts` | Bonding curve analysis for optimal dev buy |
| **Wallet Funder** | `bundle/wallet-funder.ts` | Stealth multi-wallet funding |
| **Bundle Analytics** | `bundle/bundle-analytics.ts` | Post-launch analysis (timing, cost, supply impact) |

---

## Intelligence Layer

10 AI/ML modules for market analysis and strategy decisions:

| Module | File | Purpose |
|--------|------|---------|
| **Strategy Brain** | `intelligence/strategy-brain.ts` | AI strategy decisions via OpenRouter (Gemini Flash) |
| **Signal Generator** | `intelligence/signal-generator.ts` | Trading signal generation |
| **Risk Manager** | `intelligence/risk-manager.ts` | Portfolio-level risk limits and enforcement |
| **Sentiment Analyzer** | `intelligence/sentiment-analyzer.ts` | Social media sentiment (Twitter, Reddit, Telegram) |
| **Trend Detector** | `intelligence/trend-detector.ts` | Market trend detection algorithms |
| **Token Evaluator** | `intelligence/token-evaluator.ts` | Token quality scoring and evaluation |
| **Market Regime** | `intelligence/market-regime.ts` | Market regime classification (bull/bear/range) |
| **Alpha Scanner** | `intelligence/alpha-scanner.ts` | Alpha opportunity detection |
| **Narrative Generator** | `intelligence/narrative-generator.ts` | Token narrative generation with virality scoring |
| **Portfolio Optimizer** | `intelligence/portfolio-optimizer.ts` | Portfolio-level optimization |

---

## Coordination

10 modules for swarm-level orchestration:

| Module | File | Purpose |
|--------|------|---------|
| **Swarm Orchestrator** | `coordination/swarm-orchestrator.ts` | Lifecycle orchestration (largest: 1,764 lines) |
| **Agent Messenger** | `coordination/agent-messenger.ts` | A2A inter-agent messaging |
| **Consensus Engine** | `coordination/consensus-engine.ts` | Voting and quorum-based decisions |
| **Task Delegator** | `coordination/task-delegator.ts` | Task assignment and tracking |
| **Lifecycle Manager** | `coordination/lifecycle-manager.ts` | Agent start/stop/restart lifecycle |
| **Health Monitor** | `coordination/health-monitor.ts` | Component health checks |
| **Phase Controller** | `coordination/phase-controller.ts` | Swarm phase progression |
| **Rollback Manager** | `coordination/rollback-manager.ts` | State rollback on failure |
| **Audit Logger** | `coordination/audit-logger.ts` | Comprehensive audit trail |
| **Config Manager** | `coordination/swarm-config-manager.ts` | Runtime configuration |

---

## Dashboard

11 components providing real-time monitoring via Hono HTTP + WebSocket:

| Component | File | Purpose |
|-----------|------|---------|
| **Server** | `dashboard/server.ts` | Hono HTTP server |
| **WebSocket** | `dashboard/websocket.ts` | Real-time push to clients |
| **API Routes** | `dashboard/api-routes.ts` | REST endpoints for dashboard data |
| **Agent Monitor** | `dashboard/agent-monitor.ts` | Agent status, actions, performance |
| **P&L Dashboard** | `dashboard/pnl-dashboard.ts` | P&L data formatting for UI |
| **Trade Visualizer** | `dashboard/trade-visualizer.ts` | Trade visualization data |
| **Supply Chart** | `dashboard/supply-chart.ts` | Token supply distribution charts |
| **Event Timeline** | `dashboard/event-timeline.ts` | Filtered event timeline |
| **Alert Manager** | `dashboard/alert-manager.ts` | Configurable alerts on events |
| **Export Manager** | `dashboard/export-manager.ts` | Session export (JSON, CSV) |

---

## x402 Payments

Inter-agent micropayments via HTTP 402:

```
Agent ──► Request ──► 402 Payment Required (price, payTo, network)
      ──► Pay on-chain (USDC) ──► Retry with payment proof
      ──► 200 OK (service rendered)
```

### Pricing

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/premium/pump/analytics` | $0.02 | Full token analytics |
| `/api/premium/pump/curve` | $0.005 | Bonding curve state |
| `/api/premium/pump/launches` | $0.01 | Recent launches |
| `/api/premium/pump/signals` | $0.03 | AI buy/sell signals |
| `/api/premium/pump/holders` | $0.02 | Holder analysis |

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SOLANA_RPC_URL` | Yes | Solana RPC endpoint |
| `MASTER_WALLET_PRIVATE_KEY` | Yes | Master wallet (base58) |
| `OPENROUTER_API_KEY` | Yes | AI intelligence (Gemini Flash) |
| `JITO_BLOCK_ENGINE_URL` | No | Jito for bundle submission |
| `JITO_AUTH_KEYPAIR` | No | Jito authentication |
| `X402_PRIVATE_KEY` | No | x402 payment wallet |
| `DASHBOARD_PORT` | No | Dashboard server port (default: 3000) |

---

## Preset Strategies

| Strategy | Interval | Size | Buy/Sell | Budget |
|----------|----------|------|----------|--------|
| `ORGANIC` | 30–120s | 0.01–0.05 SOL | 70/30 | 2 SOL/trader |
| `VOLUME` | 5–20s | 0.02–0.10 SOL | 50/50 | 5 SOL/trader |
| `GRADUATION` | 10–30s | 0.10–0.50 SOL | 90/10 | 10 SOL/trader |
| `EXIT` | 3–10s | 0.05–0.20 SOL | 20/80 | 3 SOL/trader |

---

## CLI

Interactive command-line interface:

```bash
npm run cli
# or
npx pump-swarm
```

Commands:
- `launch` — Launch a new token
- `trade` — Start trading agents
- `status` — View swarm status
- `pnl` — View P&L report
- `exit` — Emergency exit all positions
- `wallets` — List wallet balances
- `config` — View/update configuration

---

## API

### REST API (Screener Server)

```bash
npm run start:screener
# Starts on http://localhost:3000
```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pump/tokens` | List tracked tokens |
| GET | `/api/pump/token/:mint` | Token details + curve state |
| GET | `/api/pump/analytics/:mint` | Full analytics (x402 gated) |
| GET | `/api/pump/signals` | AI trading signals |
| POST | `/api/pump/launch` | Launch a new token |

---

## Directory Structure

```
packages/pump-agent-swarm/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts                    # Barrel exports (all sub-modules)
    ├── types.ts                    # 830 lines — comprehensive type system
    ├── swarm.ts                    # 502 lines — SwarmCoordinator
    ├── cli.ts                      # 531 lines — Interactive CLI
    ├── strategies.ts               # 117 lines — 4 preset strategies
    ├── wallet-manager.ts           # 952 lines — WalletVault + helpers
    ├── pump-sdk.d.ts               # 191 lines — Pump SDK type declarations
    │
    ├── agents/                     # 10 trading agents
    │   ├── index.ts
    │   ├── creator-agent.ts        # Token minting
    │   ├── scanner-agent.ts        # Opportunity scanning
    │   ├── trader-agent.ts         # Trade execution
    │   ├── sniper-agent.ts         # Fast-entry trading
    │   ├── market-maker-agent.ts   # Spread management
    │   ├── volume-agent.ts         # Volume generation
    │   ├── accumulator-agent.ts    # Gradual accumulation
    │   ├── exit-agent.ts           # Strategic exits
    │   ├── sentinel-agent.ts       # Threat monitoring
    │   └── narrative-agent.ts      # AI branding
    │
    ├── trading/                    # Trading engine (12 components)
    │   ├── index.ts
    │   ├── wash-engine.ts
    │   ├── volume-generator.ts
    │   ├── price-trajectory.ts
    │   ├── wallet-rotation.ts
    │   ├── trade-scheduler.ts
    │   ├── order-router.ts
    │   ├── slippage-calculator.ts
    │   ├── gas-optimizer.ts
    │   ├── position-manager.ts
    │   ├── pnl-tracker.ts
    │   └── profit-consolidator.ts
    │
    ├── bundle/                     # Jito bundle system (11 components)
    │   ├── index.ts
    │   ├── bundle-coordinator.ts
    │   ├── jito-client.ts
    │   ├── supply-distributor.ts
    │   ├── anti-detection.ts
    │   ├── timing-engine.ts
    │   ├── bundle-validator.ts
    │   ├── launch-sequencer.ts
    │   ├── dev-buy-optimizer.ts
    │   ├── wallet-funder.ts
    │   └── bundle-analytics.ts
    │
    ├── intelligence/               # AI intelligence (10 modules)
    │   ├── index.ts
    │   ├── strategy-brain.ts
    │   ├── signal-generator.ts
    │   ├── risk-manager.ts
    │   ├── sentiment-analyzer.ts
    │   ├── trend-detector.ts
    │   ├── token-evaluator.ts
    │   ├── market-regime.ts
    │   ├── alpha-scanner.ts
    │   ├── narrative-generator.ts
    │   └── portfolio-optimizer.ts
    │
    ├── coordination/               # Swarm coordination (10 modules)
    │   ├── index.ts
    │   ├── swarm-orchestrator.ts
    │   ├── agent-messenger.ts
    │   ├── consensus-engine.ts
    │   ├── task-delegator.ts
    │   ├── lifecycle-manager.ts
    │   ├── health-monitor.ts
    │   ├── phase-controller.ts
    │   ├── rollback-manager.ts
    │   ├── audit-logger.ts
    │   └── swarm-config-manager.ts
    │
    ├── dashboard/                  # Real-time monitoring (11 components)
    │   ├── index.ts
    │   ├── server.ts
    │   ├── websocket.ts
    │   ├── api-routes.ts
    │   ├── agent-monitor.ts
    │   ├── pnl-dashboard.ts
    │   ├── trade-visualizer.ts
    │   ├── supply-chart.ts
    │   ├── event-timeline.ts
    │   ├── alert-manager.ts
    │   └── export-manager.ts
    │
    ├── infra/                      # Infrastructure (7 modules)
    │   ├── index.ts
    │   ├── event-bus.ts            # Typed pub/sub
    │   ├── rpc-pool.ts             # RPC connection pool with failover
    │   ├── state-machine.ts        # Phase-based state machine
    │   ├── logger.ts               # Structured logging
    │   ├── metrics.ts              # Counter, Gauge, Histogram, Rate
    │   └── error-handler.ts        # Circuit breaker + retry logic
    │
    ├── config/                     # Configuration (4 files)
    │   ├── index.ts
    │   ├── env.ts                  # Environment variable loading
    │   ├── defaults.ts             # Default configuration values
    │   └── validation.ts           # Config validation (Zod)
    │
    ├── demo/                       # Demo & presentation
    │   ├── index.ts
    │   ├── cli-runner.ts           # Interactive CLI demo
    │   ├── demo-mode.ts            # Simulated demo
    │   └── presentation.ts         # AI-narrated presentation
    │
    ├── telegram/                   # Telegram bot integration
    │   ├── index.ts
    │   ├── bot.ts
    │   ├── commands.ts
    │   ├── notifications.ts
    │   ├── formatter.ts
    │   └── types.ts
    │
    ├── x402/                       # Micropayment protocol
    │   ├── index.ts
    │   ├── client.ts               # x402 payment client
    │   ├── server.ts               # x402 payment server
    │   └── types.ts
    │
    ├── api/                        # REST API
    │   ├── index.ts
    │   ├── routes/pump.ts          # Pump.fun API routes
    │   ├── screener-server.ts      # Screener server
    │   └── x402-middleware.ts      # Payment middleware
    │
    └── examples/
        └── run-swarm.ts            # Runnable example
```

**Total: 86 TypeScript files, ~62,000 lines of code**

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@solana/web3.js` | ^1.95 | Solana blockchain |
| `@solana/spl-token` | ^0.4 | SPL token operations |
| `@pump-fun/pump-sdk` | github:nirholas/pump-fun-sdk | Pump.fun bonding curve |
| `@coral-xyz/anchor` | ^0.30 | Program interaction |
| `hono` | ^4.7 | Dashboard HTTP server |
| `pino` | ^9.6 | Structured logging |
| `ws` | ^8.19 | WebSocket |
| `eventemitter3` | ^5.0 | Typed event bus |
| `bn.js` | ^5.2 | Big number arithmetic |

---

## License

MIT
