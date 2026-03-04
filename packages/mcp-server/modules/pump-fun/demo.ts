#!/usr/bin/env npx tsx
/**
 * PumpFun x402 Demo — Visual End-to-End Flow
 *
 * This script demonstrates exactly what happens when an AI agent
 * uses x402 to pay for premium pump.fun analytics. Run it to see
 * the complete payment flow in your terminal.
 *
 * @author nirholas
 * @license Apache-2.0
 *
 * ## Usage
 *
 * ```bash
 * # Option 1: Against the local server
 * export X402_PAY_TO_ADDRESS="0xYourAddress"
 * npx tsx packages/mcp-server/modules/pump-fun/server.ts &
 * npx tsx packages/mcp-server/modules/pump-fun/demo.ts <token-mint>
 *
 * # Option 2: Dry run (no real payments, shows the flow)
 * npx tsx packages/mcp-server/modules/pump-fun/demo.ts --dry-run
 * ```
 */

// ============================================================================
// Visual helpers
// ============================================================================

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgRed: "\x1b[41m",
}

function log(msg: string): void {
  console.log(msg)
}

function header(text: string): void {
  const line = "═".repeat(64)
  log(`\n${COLORS.cyan}${line}${COLORS.reset}`)
  log(`${COLORS.bold}${COLORS.cyan}  ${text}${COLORS.reset}`)
  log(`${COLORS.cyan}${line}${COLORS.reset}\n`)
}

function step(num: number, text: string): void {
  log(`${COLORS.bold}${COLORS.blue}  [Step ${num}]${COLORS.reset} ${text}`)
}

function arrow(from: string, to: string, label: string): void {
  log(`${COLORS.dim}           ${from} ${COLORS.yellow}──▶${COLORS.reset} ${to}${COLORS.dim}  (${label})${COLORS.reset}`)
}

function success(text: string): void {
  log(`${COLORS.green}  ✅ ${text}${COLORS.reset}`)
}

function payment(text: string): void {
  log(`${COLORS.magenta}  💰 ${text}${COLORS.reset}`)
}

function warn(text: string): void {
  log(`${COLORS.yellow}  ⚠️  ${text}${COLORS.reset}`)
}

function info(text: string): void {
  log(`${COLORS.dim}     ${text}${COLORS.reset}`)
}

function divider(): void {
  log(`${COLORS.dim}  ${"─".repeat(56)}${COLORS.reset}`)
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Demo Flow
// ============================================================================

async function runDemo(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const mint = args.find((a) => !a.startsWith("--")) ?? "ExampleTokenMintAddress123"
  const apiBase = process.env.PUMP_ANALYTICS_API_URL ?? "http://localhost:4020"

  log("")
  log(`${COLORS.bold}${COLORS.bgBlue}${COLORS.white}                                                                ${COLORS.reset}`)
  log(`${COLORS.bold}${COLORS.bgBlue}${COLORS.white}   🚀 PumpFun x402 Demo — Agent Micropayment Flow               ${COLORS.reset}`)
  log(`${COLORS.bold}${COLORS.bgBlue}${COLORS.white}                                                                ${COLORS.reset}`)
  log("")
  log(`${COLORS.dim}  This demo shows what happens when an AI agent calls a premium`)
  log(`  pump.fun analytics API that requires x402 USDC micropayment.${COLORS.reset}`)
  log(`${COLORS.dim}  The payment is invisible to the end user.${COLORS.reset}`)
  log("")

  if (dryRun) {
    warn("DRY RUN MODE — no real API calls or payments")
    log("")
  }

  // ── Scene 1: User prompts the agent ──────────────────────────

  header("Scene 1: User Prompts the AI Agent")

  log(`${COLORS.bold}  User:${COLORS.reset} "Hey, analyze this pump.fun token: ${COLORS.cyan}${mint}${COLORS.reset}"`)
  log("")
  info("The user doesn't know (or care) that the analytics API costs money.")
  info("They just want an answer.")
  await sleep(1000)

  // ── Scene 2: Agent calls free endpoint ───────────────────────

  header("Scene 2: Agent Calls Free Endpoint (pump.fun public API)")

  step(1, "Agent calls pump.fun's public API — no payment needed")
  arrow("Agent", "pump.fun", "GET /coins/{mint}")
  log("")

  if (!dryRun) {
    try {
      const response = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`)
      if (response.ok) {
        const data = await response.json() as Record<string, unknown>
        success(`Got basic data: ${data.name} (${data.symbol})`)
        info(`Price: $${Number(data.usd_price ?? 0).toFixed(8)}`)
        info(`Market Cap: $${Number(data.usd_market_cap ?? 0).toLocaleString()}`)
        info(`Status: ${data.complete ? "Graduated" : "Bonding Curve"}`)
      } else {
        warn(`pump.fun returned ${response.status} — token may not exist`)
      }
    } catch {
      warn("Could not reach pump.fun API (offline demo)")
    }
  } else {
    success("Got basic data: EXAMPLE (EXM)")
    info("Price: $0.00001234")
    info("Market Cap: $12,345")
    info("Status: Bonding Curve (active)")
  }

  await sleep(1000)

  // ── Scene 3: Agent calls premium endpoint → gets 402 ────────

  header("Scene 3: Agent Calls Premium Endpoint → Gets HTTP 402")

  step(2, "Agent wants deep analysis — calls premium analytics API")
  arrow("Agent", "Analytics API", "GET /api/pump/analysis/{mint}")
  log("")

  log(`${COLORS.bold}${COLORS.red}  ← HTTP 402 Payment Required${COLORS.reset}`)
  log("")
  log(`${COLORS.dim}  The server responds with payment instructions:${COLORS.reset}`)
  log("")
  log(`${COLORS.yellow}  {`)
  log(`    "paymentRequirements": [{`)
  log(`      "scheme": "exact",`)
  log(`      "network": "eip155:8453",        ${COLORS.dim}// Base mainnet${COLORS.yellow}`)
  log(`      "maxAmountRequired": "30000",     ${COLORS.dim}// $0.03 USDC (6 decimals)${COLORS.yellow}`)
  log(`      "asset": "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",`)
  log(`      "payTo": "0xAnalyticsProvider...",`)
  log(`      "description": "Premium pump.fun deep analysis"`)
  log(`    }]`)
  log(`  }${COLORS.reset}`)
  log("")

  info("This is what the x402 protocol looks like under the hood.")
  info("The agent's middleware intercepts this automatically.")
  await sleep(1500)

  // ── Scene 4: x402 middleware auto-pays ──────────────────────

  header("Scene 4: x402 Middleware Auto-Signs Payment")

  step(3, "x402 client middleware intercepts the 402 response")
  log("")

  log(`${COLORS.dim}  Under the hood, the middleware:${COLORS.reset}`)
  log("")

  log(`  ${COLORS.magenta}a)${COLORS.reset} Reads payment requirements from the 402 response`)
  await sleep(500)
  log(`  ${COLORS.magenta}b)${COLORS.reset} Checks: "Do I have enough USDC?" ← Yes (agent wallet has $10 USDC)`)
  await sleep(500)
  log(`  ${COLORS.magenta}c)${COLORS.reset} Checks: "Is $0.03 within my per-request budget cap?" ← Yes (cap: $0.10)`)
  await sleep(500)
  log(`  ${COLORS.magenta}d)${COLORS.reset} Signs an EIP-3009 TransferWithAuthorization`)
  log(`     ${COLORS.dim}(gasless USDC transfer — no ETH needed for gas)${COLORS.reset}`)
  await sleep(500)
  log(`  ${COLORS.magenta}e)${COLORS.reset} Encodes payment proof as base64 → X-PAYMENT header`)
  await sleep(500)
  log(`  ${COLORS.magenta}f)${COLORS.reset} Retries the original request with the payment header`)
  log("")

  payment("Agent wallet signed: 0.03 USDC → Analytics Provider")
  info("The user sees NONE of this. It's fully automatic.")
  await sleep(1000)

  // ── Scene 5: Server verifies and responds ───────────────────

  header("Scene 5: Server Verifies Payment → Returns Data")

  step(4, "Analytics API receives the retry with payment proof")
  arrow("Agent", "Analytics API", "GET /api/pump/analysis/{mint} + X-PAYMENT header")
  log("")

  log(`${COLORS.dim}  Server verification flow:${COLORS.reset}`)
  log(`  ${COLORS.green}1.${COLORS.reset} Decode X-PAYMENT header (base64 → JSON)`)
  log(`  ${COLORS.green}2.${COLORS.reset} Forward to x402 facilitator for on-chain verification`)
  log(`  ${COLORS.green}3.${COLORS.reset} Facilitator confirms USDC transfer on Base`)
  log(`  ${COLORS.green}4.${COLORS.reset} Payment valid → return premium data`)
  log("")

  success("Payment verified! Returning deep analysis...")
  log("")

  // Show example response
  log(`${COLORS.bold}${COLORS.green}  ← HTTP 200 OK${COLORS.reset}`)
  log("")
  log(`${COLORS.green}  {`)
  log(`    "success": true,`)
  log(`    "data": {`)
  log(`      "analytics": {`)
  log(`        "healthScore": 72,`)
  log(`        "rugPullRisk": "low",`)
  log(`        "graduationProbability": 0.65,`)
  log(`        "top10HolderPercentage": 28.5,`)
  log(`        "creatorHolding": 4.2,`)
  log(`        "priceImpact1Sol": 3.1`)
  log(`      },`)
  log(`      "signals": [`)
  log(`        { "type": "buy", "strength": "moderate", "reason": "Strong graduation momentum" }`)
  log(`      ]`)
  log(`    },`)
  log(`    "meta": {`)
  log(`      "paymentRequired": true,`)
  log(`      "costUsd": 0.03`)
  log(`    }`)
  log(`  }${COLORS.reset}`)
  await sleep(1000)

  // ── Scene 6: Agent formats response for user ───────────────

  header("Scene 6: Agent Formats Response for User")

  step(5, "Agent receives premium data and formats a human-readable response")
  log("")

  log(`${COLORS.bold}  Agent:${COLORS.reset}`)
  log(`  ┌──────────────────────────────────────────────────────┐`)
  log(`  │ ${COLORS.bold}Deep Analysis: EXAMPLE (EXM)${COLORS.reset}                        │`)
  log(`  │                                                      │`)
  log(`  │ ${COLORS.green}Health Score: 72/100 🟢${COLORS.reset}                             │`)
  log(`  │ Rug Pull Risk: ${COLORS.green}LOW${COLORS.reset}                                  │`)
  log(`  │ Graduation Probability: ${COLORS.green}65%${COLORS.reset}                         │`)
  log(`  │ Est. Time to Graduation: 3-8 hours                   │`)
  log(`  │                                                      │`)
  log(`  │ Top 10 holders: 28.5% of supply                      │`)
  log(`  │ Creator holding: 4.2%                                │`)
  log(`  │ 1 SOL buy impact: 3.1%                               │`)
  log(`  │                                                      │`)
  log(`  │ ${COLORS.green}🟢 BUY (moderate):${COLORS.reset} Strong graduation momentum       │`)
  log(`  │                                                      │`)
  log(`  │ ${COLORS.dim}This analysis was paid via x402 ($0.03 USDC).${COLORS.reset}        │`)
  log(`  │ ${COLORS.dim}No subscription. No API key. No credit card.${COLORS.reset}          │`)
  log(`  └──────────────────────────────────────────────────────┘`)
  log("")

  info("The user just sees the analysis. The payment was invisible.")
  await sleep(500)

  // ── Summary ────────────────────────────────────────────────

  header("Summary: What Just Happened")

  log(`${COLORS.bold}  The Complete Flow:${COLORS.reset}`)
  log("")
  log(`  ${COLORS.cyan}User${COLORS.reset} ──prompt──▶ ${COLORS.blue}AI Agent${COLORS.reset} ──GET──▶ ${COLORS.yellow}Analytics API${COLORS.reset}`)
  log(`                     ${COLORS.blue}│${COLORS.reset}           ${COLORS.red}◀── 402 ──${COLORS.reset}${COLORS.yellow}│${COLORS.reset}`)
  log(`                     ${COLORS.blue}│${COLORS.reset}                        ${COLORS.yellow}│${COLORS.reset}`)
  log(`                     ${COLORS.blue}│${COLORS.reset} ${COLORS.magenta}x402 middleware:${COLORS.reset}        ${COLORS.yellow}│${COLORS.reset}`)
  log(`                     ${COLORS.blue}│${COLORS.reset} ${COLORS.magenta}sign USDC payment${COLORS.reset}      ${COLORS.yellow}│${COLORS.reset}`)
  log(`                     ${COLORS.blue}│${COLORS.reset} ${COLORS.magenta}retry with proof${COLORS.reset}       ${COLORS.yellow}│${COLORS.reset}`)
  log(`                     ${COLORS.blue}│${COLORS.reset}           ${COLORS.green}──▶ 200 ──▶${COLORS.reset}${COLORS.yellow}│${COLORS.reset}`)
  log(`  ${COLORS.cyan}User${COLORS.reset} ◀──answer── ${COLORS.blue}AI Agent${COLORS.reset}      ${COLORS.green}(data)${COLORS.reset}    ${COLORS.yellow}Analytics API${COLORS.reset}`)
  log("")

  log(`${COLORS.bold}  Key Points:${COLORS.reset}`)
  log(`  • User prompted normally — never saw the payment`)
  log(`  • Agent has an embedded wallet (private key in env var or KMS)`)
  log(`  • Payment was $0.03 USDC on Base — settled on-chain`)
  log(`  • No API key, no subscription, no credit card`)
  log(`  • Any agent with a funded wallet can use this API`)
  log(`  • The API developer earns per request — true pay-per-use`)
  log("")

  divider()
  log("")
  log(`${COLORS.bold}  Code to build this yourself:${COLORS.reset}`)
  log("")
  log(`${COLORS.dim}  // Agent side — auto-pay for premium APIs:${COLORS.reset}`)
  log(`${COLORS.cyan}  import { createPaymentFetch } from "@x402/fetch"`)
  log(`  const fetch = createPaymentFetch({ privateKey: process.env.AGENT_KEY })`)
  log(`  const data = await fetch("https://your-api.com/premium-endpoint")${COLORS.reset}`)
  log("")
  log(`${COLORS.dim}  // Server side — put x402 on your endpoints:${COLORS.reset}`)
  log(`${COLORS.cyan}  if (!paymentHeader) return new Response(paymentRequirements, { status: 402 })${COLORS.reset}`)
  log("")
  log(`${COLORS.dim}  See the full implementation:${COLORS.reset}`)
  log(`  ${COLORS.blue}packages/mcp-server/modules/pump-fun/server.ts${COLORS.reset}  ← API server`)
  log(`  ${COLORS.blue}packages/mcp-server/modules/pump-fun/client.ts${COLORS.reset}  ← Agent client`)
  log(`  ${COLORS.blue}packages/mcp-server/modules/pump-fun/tools.ts${COLORS.reset}   ← MCP tools`)
  log("")
}

// Run
runDemo().catch(console.error)
