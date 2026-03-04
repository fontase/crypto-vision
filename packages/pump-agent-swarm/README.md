# Pump.fun Agent Swarm

**Creator agents mint tokens → Trader agents trade them → x402 pays for intelligence**

A multi-agent system for Pump.fun token lifecycle management. One agent creates a token on Pump.fun's bonding curve; multiple trader agents buy and sell it. An optional x402-paid analytics layer provides real-time bonding curve intelligence.

## What It Actually Looks Like

```
┌────────────────────────────────────────────────────────────────┐
│  USER PROMPT (in Claude, ChatGPT, or any agent UI)            │
│                                                                │
│  "Launch a memecoin called AI Agent Coin ($AIAC) on Pump.fun, │
│   dev buy 0.5 SOL, run 3 traders for 30 minutes"              │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│  CREATOR AGENT                                                 │
│                                                                │
│  1. Generates mint keypair                                     │
│  2. Calls PUMP_SDK.createV2Instruction()                       │
│  3. Atomic dev buy: 0.5 SOL → tokens in same tx               │
│  4. Reports: mint address, bonding curve PDA, tx signature     │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│  TRADER AGENTS (3 concurrent, independent wallets)             │
│                                                                │
│  Trader 0 ────── BUY 0.03 SOL ─────── wait 45s ─── SELL 30%   │
│  Trader 1 ────── BUY 0.05 SOL ─────── wait 22s ─── BUY 0.02  │
│  Trader 2 ────── SELL 50% ──────────── wait 67s ─── BUY 0.04  │
│                                                                │
│  Each trader follows a strategy (interval, size, buy/sell      │
│  ratio) with randomization so it looks organic.                │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│  x402 ANALYTICS (optional, auto-paid per request)              │
│                                                                │
│  Every 60s, the swarm calls:                                   │
│    GET /api/premium/pump/analytics?mint=4xPq...                │
│                                                                │
│  → API returns HTTP 402 + X-PAYMENT-REQUIRED header            │
│  → Agent's EVM wallet auto-signs USDC payment (0.02)           │
│  → Request retries with X-PAYMENT proof                        │
│  → Returns: curve state, holders, rug score, graduation %      │
│                                                                │
│  The user never sees the payment. The agent just gets smarter. │
└────────────────────────────────────────────────────────────────┘
```

## Quick Start

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

  // Optional: pay for premium on-chain analytics via x402
  analyticsApiUrl: 'https://api.cryptovision.dev',
  x402PrivateKey: process.env.X402_PRIVATE_KEY,
});

swarm.on('token:created', (r) => console.log('Minted:', r.mint));
swarm.on('trade:executed', (r) => console.log('Trade:', r.order.direction));

const status = await swarm.run();
```

## Preset Strategies

| Strategy       | Interval    | Size             | Buy/Sell | Budget         |
|----------------|-------------|------------------|----------|----------------|
| `ORGANIC`      | 30-120s     | 0.01-0.05 SOL    | 70/30    | 2 SOL/trader   |
| `VOLUME`       | 5-20s       | 0.02-0.10 SOL    | 50/50    | 5 SOL/trader   |
| `GRADUATION`   | 10-30s      | 0.10-0.50 SOL    | 90/10    | 10 SOL/trader  |
| `EXIT`         | 3-10s       | 0.05-0.20 SOL    | 20/80    | 3 SOL/trader   |

## x402 Analytics Pricing

These endpoints are available at `api.cryptovision.dev` and gated behind x402 micropayments:

| Endpoint                         | Price   | Description                                    |
|----------------------------------|---------|------------------------------------------------|
| `/api/premium/pump/analytics`    | $0.02   | Full token analytics (curve, holders, rug)     |
| `/api/premium/pump/curve`        | $0.005  | Bonding curve state only                       |
| `/api/premium/pump/launches`     | $0.01   | Recent launches with filtering                 |
| `/api/premium/pump/signals`      | $0.03   | AI buy/sell/hold signals                       |
| `/api/premium/pump/holders`      | $0.02   | Holder analysis and cluster detection          |

When an agent calls any of these, here's what happens under the hood:

```
Agent                          API Server                    x402 Facilitator
  │                                │                              │
  │── GET /pump/analytics ────────►│                              │
  │                                │                              │
  │◄── 402 + X-PAYMENT-REQUIRED ──│                              │
  │   (amount: 0.02 USDC,         │                              │
  │    payTo: 0xABC...,            │                              │
  │    network: base)              │                              │
  │                                │                              │
  │── Sign EIP-712 USDC authz ──► │                              │
  │                                │                              │
  │── GET /pump/analytics ────────►│                              │
  │   + X-PAYMENT header           │── verify payment ──────────►│
  │                                │◄── payment valid ───────────│
  │◄── 200 + analytics data ──────│                              │
```

## Architecture

```
packages/pump-agent-swarm/
├── src/
│   ├── index.ts              # Public exports
│   ├── types.ts              # Shared type definitions
│   ├── swarm.ts              # SwarmCoordinator (main orchestrator)
│   ├── strategies.ts         # Preset trading strategies
│   ├── wallet-manager.ts     # Solana wallet pool management
│   ├── agents/
│   │   ├── creator-agent.ts  # Mints tokens via Pump SDK
│   │   └── trader-agent.ts   # Buys/sells on bonding curve
│   ├── analytics/
│   │   └── x402-client.ts    # x402 auto-payment middleware
│   └── examples/
│       └── run-swarm.ts      # Runnable example
```

## How This Fits Into the Visual Builder

If you're building a visual workflow builder, here are the nodes:

1. **User Prompt Node** — The user's natural language request
2. **Config Node** — Token name, symbol, metadata, strategy selection
3. **Wallet Pool Node** — Shows creator + trader wallet addresses/balances
4. **Creator Agent Node** — Mint transaction, dev buy amount, bonding curve PDA
5. **Trader Agent Nodes** (N parallel) — Each shows buy/sell activity, P&L
6. **x402 Payment Node** — Shows 402 → payment → retry → data flow
7. **Analytics Node** — Real-time bonding curve visualization
8. **Status Node** — Overall swarm health, graduation progress, total P&L

Each node connects with edges showing data flow and x402 payment events.

## License

MIT
