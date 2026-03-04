# PumpFun x402 — Agent Micropayment Analytics

> **Real example**: An AI agent pays $0.03 USDC to analyze a pump.fun token. The user just sees the answer.

## What This Is

This module demonstrates x402 in production: a premium pump.fun analytics API that charges per-request via on-chain USDC micropayments. No API keys, no subscriptions, no credit cards — just crypto.

## The Realistic Scenario

A user is in Claude (or any AI chat) and asks:

```
User: "Analyze this pump.fun token: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
```

Behind the scenes, the agent:

1. **Calls the free pump.fun API** → gets basic token info (name, price, market cap)
2. **Calls the premium analytics API** → gets deep analysis (whale tracking, rug risk, graduation odds)
3. **The premium API returns HTTP 402** with payment instructions
4. **The agent's x402 middleware auto-pays** $0.03 USDC on Base
5. **The API verifies payment** and returns premium data
6. **The agent formats and responds** — the user just sees the analysis

**Total cost: $0.03. Time: ~2 seconds. User sees: just the answer.**

## Architecture

```
┌─────────────┐
│    User      │  "Analyze this pump.fun token"
└──────┬───────┘
       │ prompt
       ▼
┌──────────────────────────────────────────────────────────┐
│                     AI Agent                              │
│                                                          │
│  ┌─────────────────┐    ┌──────────────────────────────┐ │
│  │  Free Tools      │    │  Premium Tools (x402)        │ │
│  │                  │    │                              │ │
│  │  pump_lookup     │    │  pump_deep_analysis  $0.03   │ │
│  │  pump_get_price  │    │  pump_whale_tracker  $0.05   │ │
│  │  pump_list_new   │    │  pump_smart_money    $0.05   │ │
│  │                  │    │  pump_sniper_detect  $0.02   │ │
│  │  (pump.fun API)  │    │  pump_graduation     $0.03   │ │
│  └─────────────────┘    └──────────┬───────────────────┘ │
│                                     │                     │
│  ┌──────────────────────────────────┴──────────────────┐  │
│  │              x402 Client Middleware                  │  │
│  │                                                     │  │
│  │  1. Agent calls premium endpoint                    │  │
│  │  2. Gets HTTP 402 + payment requirements            │  │
│  │  3. Signs USDC transfer (EIP-3009, gasless)         │  │
│  │  4. Retries with X-PAYMENT header                   │  │
│  │  5. Returns data transparently                      │  │
│  │                                                     │  │
│  │  Wallet: embedded private key (env var / KMS)       │  │
│  │  Budget: max $0.10/request, $5/day                  │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                          │
                          │ HTTP + X-PAYMENT header
                          ▼
┌──────────────────────────────────────────────────────────┐
│               PumpFun Analytics API                       │
│               (x402-paywalled server)                     │
│                                                          │
│  Endpoints:                                              │
│  GET /api/pump/analysis/{mint}        → $0.03 USDC       │
│  GET /api/pump/whales/{mint}          → $0.05 USDC       │
│  GET /api/pump/smart-money/{mint}     → $0.05 USDC       │
│  GET /api/pump/snipers/{mint}         → $0.02 USDC       │
│  GET /api/pump/graduation-odds/{mint} → $0.03 USDC       │
│                                                          │
│  1. No payment? → return HTTP 402 + requirements         │
│  2. Has payment? → verify via x402 facilitator           │
│  3. Valid? → run on-chain analysis → return data         │
│                                                          │
│  Revenue: USDC goes directly to provider's wallet        │
│  No Stripe. No billing. No invoices. Just on-chain.      │
└──────────────────────────────────────────────────────────┘
```

## Run the Visual Demo

```bash
# See the complete x402 flow step-by-step in your terminal
npx tsx packages/mcp-server/modules/pump-fun/demo.ts --dry-run
```

This prints a colorful walkthrough of every step — the 402 response, the payment signing, the retry, and the final response. Great for presentations.

## Run the Real API Server

```bash
# 1. Set your USDC receiving address
export X402_PAY_TO_ADDRESS="0xYourWalletAddress"
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"

# 2. Start the paywalled API
npx tsx packages/mcp-server/modules/pump-fun/server.ts

# 3. Test it (will get 402 without payment)
curl -i http://localhost:4020/api/pump/analysis/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

# 4. Check the x402 discovery document
curl http://localhost:4020/.well-known/x402
```

## Use from an AI Agent (MCP)

Add to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "crypto-mcp": {
      "command": "npx",
      "args": ["tsx", "packages/mcp-server/index.ts"],
      "env": {
        "X402_EVM_PRIVATE_KEY": "0xYourAgentWalletPrivateKey",
        "PUMP_ANALYTICS_API_URL": "https://your-deployed-api.com"
      }
    }
  }
}
```

Then just prompt Claude:

```
Analyze this pump.fun token: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

Claude will call `pump_lookup_token` (free) then `pump_deep_analysis` ($0.03) and format the response. The payment is invisible to you.

## How the Payment Works (Step by Step)

### 1. Agent calls the API

```typescript
const response = await fetch("https://analytics.example.com/api/pump/analysis/TOKEN_MINT")
```

### 2. Server returns 402

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "paymentRequirements": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "maxAmountRequired": "30000",
    "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xAnalyticsProviderAddress",
    "description": "Deep pump.fun token analysis"
  }]
}
```

### 3. x402 middleware signs payment

The agent has an embedded wallet (private key in an env var or KMS). The middleware:

- Reads the 402 requirements
- Signs a USDC `TransferWithAuthorization` (EIP-3009 — gasless, no ETH needed)
- Encodes the signed payload as base64

```typescript
// This is what the x402 middleware does automatically:
const payment = await signTransferWithAuthorization({
  token: USDC_ADDRESS,
  from: agentWallet.address,
  to: "0xAnalyticsProvider...",
  value: 30000n, // $0.03 USDC
  validAfter: 0,
  validBefore: Math.floor(Date.now() / 1000) + 60,
  nonce: randomBytes(32),
})
```

### 4. Retry with payment header

```http
GET /api/pump/analysis/TOKEN_MINT
X-PAYMENT: eyJwYXlsb2FkIjp7InR5cGUiOiJleGFjdCIsIm5ldHdvcmsiOiJlaXAxNTU6ODQ1MyIsI...
```

### 5. Server verifies and responds

The server sends the payment to the x402 facilitator for on-chain verification. If valid, the USDC is transferred and the data is returned.

```http
HTTP/1.1 200 OK

{
  "success": true,
  "data": {
    "analytics": {
      "healthScore": 72,
      "rugPullRisk": "low",
      "graduationProbability": 0.65,
      ...
    }
  }
}
```

## Give an Agent a Wallet

Three approaches, from simplest to most secure:

### Approach 1: Environment Variable (dev/testing)

```bash
# Generate a new wallet for your agent
export X402_EVM_PRIVATE_KEY="0x$(openssl rand -hex 32)"

# Fund it with USDC on Base
# Send $5 USDC to the address derived from that key
```

### Approach 2: KMS / HSM (production)

```typescript
// Private key never leaves the hardware security module
const agentSigner = await createKmsSigner({
  keyId: "arn:aws:kms:us-east-1:123456:key/agent-wallet-key",
  region: "us-east-1",
})
```

### Approach 3: Delegated Wallet (user-funded)

```typescript
// User approves agent to spend up to 1 USDC
await usdc.approve(agentAddress, parseUnits("1", 6))

// Agent spends from user's balance (up to approved limit)
```

### Approach 4: Session Keys / Account Abstraction (ERC-4337)

```typescript
// User's smart contract wallet grants scoped session key:
// - Can spend up to 0.50 USDC per call
// - Max 5 USDC per day
// - Only to whitelisted API addresses
// - Expires in 24 hours
```

## Why This Matters

| Traditional API | x402 API |
|----------------|----------|
| Sign up for account | Just call the endpoint |
| Enter credit card | Agent wallet auto-pays |
| Monthly subscription ($99/mo) | Pay per request ($0.03) |
| API key management | No keys needed |
| Usage limits / tiers | Pay for what you use |
| Billing disputes | On-chain settlement |
| 30-day invoices | Instant payment |
| KYC / identity | Pseudonymous |
| Revenue after fees (Stripe 2.9%) | Revenue direct to wallet |

**For developers**: Deploy an API, put x402 on it, earn USDC per request. No Stripe, no billing dashboard, no customer support for billing issues.

**For agents**: Give it a wallet, point it at any x402 API, and it can pay for data automatically. Works with any x402 provider without pre-registration.

## Files

| File | Purpose |
|------|---------|
| [index.ts](index.ts) | Module entry — registers tools + prompts |
| [tools.ts](tools.ts) | 8 MCP tools (3 free, 5 premium) |
| [client.ts](client.ts) | x402-enabled HTTP client for premium APIs |
| [server.ts](server.ts) | Standalone x402-paywalled analytics API |
| [prompts.ts](prompts.ts) | Pre-built analysis workflow prompts |
| [types.ts](types.ts) | TypeScript type definitions |
| [demo.ts](demo.ts) | Visual terminal demo of the full flow |
