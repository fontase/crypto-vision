/**
 * Default Configuration Values
 *
 * Sensible defaults for every section of SwarmMasterConfig.
 * These are merged with env-loaded values and user overrides so the
 * swarm can start with minimal configuration.
 */

import BN from 'bn.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import type {
  RpcPoolConfig,
  WalletVaultConfig,
  BundleBuyConfig,
  IntelligenceConfig,
  DashboardConfig,
  AnalyticsConfig,
  EmergencyExitConfig,
  AgentRole,
  SwarmMasterConfig,
} from '../types.js';
import { STRATEGY_ORGANIC } from '../strategies.js';

// ─── RPC Defaults ─────────────────────────────────────────────

export const DEFAULT_RPC_CONFIG: RpcPoolConfig = {
  endpoints: [
    {
      url: 'https://api.mainnet-beta.solana.com',
      weight: 1,
      rateLimit: 10,
      supportsJito: false,
      healthy: true,
      avgLatencyMs: 0,
      errorCount: 0,
      lastSuccessAt: 0,
      provider: 'solana-public',
    },
  ],
  healthCheckIntervalMs: 30_000,
  maxConsecutiveFailures: 3,
  requestTimeoutMs: 30_000,
  maxRetries: 3,
  preferLowLatency: true,
};

// ─── Wallet Defaults ──────────────────────────────────────────

export const DEFAULT_WALLET_CONFIG: WalletVaultConfig = {
  poolSize: 8,
  minBalanceLamports: new BN(0.01 * LAMPORTS_PER_SOL),
  maxBalanceLamports: new BN(10 * LAMPORTS_PER_SOL),
  encryptAtRest: false,
};

// ─── Bundle Defaults ──────────────────────────────────────────

export const DEFAULT_BUNDLE_CONFIG: BundleBuyConfig = {
  devBuyLamports: new BN(0.5 * LAMPORTS_PER_SOL),
  bundleWallets: [],
  slippageBps: 500,
};

// ─── Intelligence Defaults ────────────────────────────────────

export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  llmProvider: 'openrouter',
  llmApiKey: '',
  llmModel: 'openai/gpt-4o-mini',
  enableSignals: false,
  enableSentiment: false,
  riskTolerance: 0.5,
  maxAllocationPerToken: 0.2,
};

// ─── Dashboard Defaults ───────────────────────────────────────

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  port: 8080,
  enableWebSocket: true,
  updateIntervalMs: 2_000,
  publicAccess: false,
};

// ─── Analytics Defaults ───────────────────────────────────────

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsConfig = {
  apiBaseUrl: 'https://api.cryptovision.dev',
  maxPaymentPerRequest: '0.01',
  totalBudget: '1.00',
  pollIntervalMs: 60_000,
};

// ─── Emergency Exit Defaults ──────────────────────────────────

export const DEFAULT_EMERGENCY_EXIT_CONFIG: EmergencyExitConfig = {
  maxLossLamports: new BN(5 * LAMPORTS_PER_SOL),
  maxLossPercent: 50,
  maxSilenceMs: 300_000, // 5 minutes without a successful trade
  sellAllOnExit: true,
  reclaimOnExit: true,
};

// ─── Agent Count Defaults ─────────────────────────────────────

export const DEFAULT_AGENT_COUNTS: Record<AgentRole, number> = {
  creator: 1,
  trader: 5,
  sniper: 0,
  market_maker: 0,
  volume_bot: 0,
  accumulator: 0,
  exit_manager: 1,
  sentinel: 1,
  scanner: 0,
  narrator: 1,
};

// ─── Full Default Config ──────────────────────────────────────

/**
 * Complete default swarm configuration.
 *
 * Every field has a sensible default so the swarm can start with
 * only the required overrides (RPC URL, wallet key, token info).
 */
export const DEFAULT_SWARM_CONFIG: Partial<SwarmMasterConfig> = {
  network: 'mainnet-beta',
  rpc: DEFAULT_RPC_CONFIG,
  wallets: DEFAULT_WALLET_CONFIG,
  agentCounts: DEFAULT_AGENT_COUNTS,
  strategy: STRATEGY_ORGANIC,
  bundle: DEFAULT_BUNDLE_CONFIG,
  intelligence: DEFAULT_INTELLIGENCE_CONFIG,
  dashboard: DEFAULT_DASHBOARD_CONFIG,
  analytics: DEFAULT_ANALYTICS_CONFIG,
  logLevel: 'info',
  enableMetrics: true,
  emergencyExit: DEFAULT_EMERGENCY_EXIT_CONFIG,
};
