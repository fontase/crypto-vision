/**
 * PumpFun x402 Module — Entry Point
 *
 * Registers pump.fun token intelligence tools with the MCP server.
 * Combines free public data with x402-gated premium analytics.
 *
 * @author nirholas
 * @license Apache-2.0
 *
 * ## Architecture
 *
 * ```
 * User: "Analyze this pump.fun token"
 *          │
 *          ▼
 *   AI Agent (Claude/GPT)
 *          │
 *          ├── pump_lookup_token (FREE)
 *          │     └── pump.fun public API
 *          │
 *          ├── pump_deep_analysis ($0.03 USDC)
 *          │     ├── 1. GET /api/pump/analysis/{mint}
 *          │     ├── 2. Server returns HTTP 402 + payment requirements
 *          │     ├── 3. x402 middleware auto-signs USDC transfer
 *          │     ├── 4. Retry with payment proof → get data
 *          │     └── 5. Agent formats & returns to user
 *          │
 *          └── pump_graduation_odds ($0.03 USDC)
 *                └── (same x402 payment flow)
 *
 * Total cost: ~$0.06 USDC
 * User sees: just the analysis
 * ```
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { registerPumpFunTools } from "./tools.js"
import { registerPumpFunPrompts } from "./prompts.js"

/**
 * Register the PumpFun x402 module with the MCP server.
 *
 * Tools registered:
 * - pump_lookup_token (free)
 * - pump_get_price (free)
 * - pump_list_new (free)
 * - pump_deep_analysis ($0.03 USDC via x402)
 * - pump_whale_tracker ($0.05 USDC via x402)
 * - pump_smart_money ($0.05 USDC via x402)
 * - pump_sniper_detection ($0.02 USDC via x402)
 * - pump_graduation_odds ($0.03 USDC via x402)
 */
export function registerPumpFun(server: McpServer): void {
  registerPumpFunTools(server)
  registerPumpFunPrompts(server)
}
