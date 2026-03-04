/**
 * @nirholas/pump-agent-swarm
 *
 * Pump.fun agent swarm — creator agents mint tokens,
 * trader agents trade them back and forth on the bonding curve,
 * all coordinated with optional x402-paid analytics.
 *
 * Quick start:
 * ```typescript
 * import { SwarmCoordinator, STRATEGY_ORGANIC } from '@nirholas/pump-agent-swarm';
 * import BN from 'bn.js';
 * import { LAMPORTS_PER_SOL } from '@solana/web3.js';
 *
 * const swarm = new SwarmCoordinator({
 *   rpcUrl: 'https://api.mainnet-beta.solana.com',
 *   traderCount: 3,
 *   token: {
 *     name: 'AI Agent Coin',
 *     symbol: 'AIAC',
 *     metadataUri: 'https://arweave.net/your-metadata.json',
 *   },
 *   bundle: {
 *     devBuyLamports: new BN(0.5 * LAMPORTS_PER_SOL),
 *     bundleWallets: [],
 *     slippageBps: 500,
 *   },
 *   strategy: STRATEGY_ORGANIC,
 *   // Optional: pay for premium analytics via x402
 *   analyticsApiUrl: 'https://api.cryptovision.dev',
 *   x402PrivateKey: process.env.X402_PRIVATE_KEY,
 * });
 *
 * // Listen to events
 * swarm.on('token:created', (result) => console.log('Minted:', result.mint));
 * swarm.on('trade:executed', (result) => console.log('Trade:', result.order.direction));
 * swarm.on('analytics:x402-payment', (amt) => console.log('Paid for analytics:', amt));
 *
 * // Run the full lifecycle
 * const status = await swarm.run();
 * console.log('Final P&L:', status.netPnlSol.toString(), 'lamports');
 * ```
 */

// ─── Main ─────────────────────────────────────────────────────
export { SwarmCoordinator } from './swarm.js';

// ─── Agents ───────────────────────────────────────────────────
export { CreatorAgent } from './agents/creator-agent.js';
export { TraderAgent } from './agents/trader-agent.js';

// ─── Analytics (x402) ─────────────────────────────────────────
export { AnalyticsClient } from './analytics/x402-client.js';

// ─── Wallet Management ────────────────────────────────────────
export {
  createAgentWallet,
  restoreAgentWallet,
  generateWalletPool,
  refreshBalances,
  fundTraders,
  reclaimFunds,
  exportWalletKeys,
  getPoolSummary,
} from './wallet-manager.js';

// ─── Strategies ───────────────────────────────────────────────
export {
  STRATEGY_ORGANIC,
  STRATEGY_VOLUME,
  STRATEGY_GRADUATION,
  STRATEGY_EXIT,
  PRESET_STRATEGIES,
} from './strategies.js';

// ─── Types ────────────────────────────────────────────────────
export type {
  AgentWallet,
  WalletPool,
  TokenConfig,
  MintResult,
  BundleBuyConfig,
  TradeDirection,
  TradeOrder,
  TradeResult,
  BondingCurveState,
  TradingStrategy,
  SwarmConfig,
  TokenAnalytics,
  SwarmStatus,
  TraderStats,
  SwarmEvents,
} from './types.js';
