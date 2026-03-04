/**
 * Pump Agent Swarm — Core Types
 *
 * Shared type definitions for the creator agent, trader agents,
 * analytics service, and swarm coordinator.
 */

import type { Keypair } from '@solana/web3.js';
import type BN from 'bn.js';

// ─── Wallet Types ─────────────────────────────────────────────

export interface AgentWallet {
  /** Solana keypair for signing transactions */
  keypair: Keypair;
  /** Base58-encoded public key */
  address: string;
  /** Human-readable label */
  label: string;
  /** SOL balance in lamports (updated by wallet manager) */
  balanceLamports: BN;
}

export interface WalletPool {
  /** The creator wallet (funds the initial dev buy) */
  creator: AgentWallet;
  /** Trader wallets (buy/sell the token) */
  traders: AgentWallet[];
  /** Optional fee recipient wallet */
  feeRecipient?: AgentWallet;
}

// ─── Token Types ──────────────────────────────────────────────

export interface TokenConfig {
  /** Token name (e.g. "AI Agent Coin") */
  name: string;
  /** Token symbol (e.g. "AIAC") */
  symbol: string;
  /** Arweave/IPFS URI for metadata JSON */
  metadataUri: string;
  /** Optional: vanity mint address prefix */
  vanityPrefix?: string;
}

export interface MintResult {
  /** The mint address (base58) */
  mint: string;
  /** The mint keypair (needed for first signature) */
  mintKeypair: Keypair;
  /** Transaction signature */
  signature: string;
  /** Bonding curve PDA */
  bondingCurve: string;
  /** Creator's token account */
  creatorTokenAccount: string;
  /** Tokens received from dev buy (if any) */
  devBuyTokens?: BN;
  /** SOL spent on dev buy (if any) */
  devBuySol?: BN;
  /** Timestamp */
  createdAt: number;
}

export interface BundleBuyConfig {
  /** SOL amount for the creator's dev buy (in lamports) */
  devBuyLamports: BN;
  /** Additional wallets that buy atomically with creation */
  bundleWallets: Array<{
    wallet: AgentWallet;
    /** SOL to spend (in lamports) */
    amountLamports: BN;
  }>;
  /** Max slippage BPS (e.g. 500 = 5%) */
  slippageBps: number;
}

// ─── Trading Types ────────────────────────────────────────────

export type TradeDirection = 'buy' | 'sell';

export interface TradeOrder {
  /** Unique order ID */
  id: string;
  /** Which trader agent is executing */
  traderId: string;
  /** Token mint address */
  mint: string;
  /** Buy or sell */
  direction: TradeDirection;
  /** SOL amount for buys (lamports) / Token amount for sells */
  amount: BN;
  /** Max slippage BPS */
  slippageBps: number;
  /** Priority fee in microlamports */
  priorityFeeMicroLamports?: number;
  /** Jito tip in lamports (for MEV protection) */
  jitoTipLamports?: number;
}

export interface TradeResult {
  /** The order that was executed */
  order: TradeOrder;
  /** Transaction signature */
  signature: string;
  /** Tokens received (for buys) or SOL received (for sells) */
  amountOut: BN;
  /** Price at execution (SOL per token) */
  executionPrice: BN;
  /** Fees paid */
  feesPaid: BN;
  /** Whether the trade succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  executedAt: number;
}

// ─── Bonding Curve State ──────────────────────────────────────

export interface BondingCurveState {
  /** Token mint address */
  mint: string;
  /** Current virtual SOL reserves */
  virtualSolReserves: BN;
  /** Current virtual token reserves */
  virtualTokenReserves: BN;
  /** Real SOL reserves (actual SOL in the curve) */
  realSolReserves: BN;
  /** Real token reserves */
  realTokenReserves: BN;
  /** Whether the curve has graduated to AMM */
  complete: boolean;
  /** Current token price in SOL (derived) */
  currentPriceSol: number;
  /** Market cap in SOL (derived) */
  marketCapSol: number;
  /** Progress toward graduation (0-100%) */
  graduationProgress: number;
}

// ─── Strategy Types ───────────────────────────────────────────

export interface TradingStrategy {
  /** Strategy identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Min seconds between trades for each trader */
  minIntervalSeconds: number;
  /** Max seconds between trades */
  maxIntervalSeconds: number;
  /** Min SOL per trade (lamports) */
  minTradeSizeLamports: BN;
  /** Max SOL per trade (lamports) */
  maxTradeSizeLamports: BN;
  /** Target buy/sell ratio (1.0 = balanced, >1 = net buyer, <1 = net seller) */
  buySellRatio: number;
  /** Stop if market cap exceeds this SOL amount */
  maxMarketCapSol?: number;
  /** Stop if market cap drops below this SOL amount */
  minMarketCapSol?: number;
  /** Max total SOL to spend across all traders */
  maxTotalBudgetLamports: BN;
  /** Whether to use Jito bundles for MEV protection */
  useJitoBundles: boolean;
  /** Priority fee in microlamports */
  priorityFeeMicroLamports: number;
  /** Max number of trades before stopping */
  maxTrades?: number;
  /** Max duration in seconds before stopping */
  maxDurationSeconds?: number;
}

// ─── Swarm Configuration ──────────────────────────────────────

export interface SwarmConfig {
  /** Solana RPC endpoint */
  rpcUrl: string;
  /** Solana WebSocket endpoint (for subscriptions) */
  wsUrl?: string;
  /** Number of trader agents to spawn */
  traderCount: number;
  /** Token to create */
  token: TokenConfig;
  /** Dev buy / bundle config */
  bundle: BundleBuyConfig;
  /** Trading strategy */
  strategy: TradingStrategy;
  /** x402 analytics API base URL (if using paid analytics) */
  analyticsApiUrl?: string;
  /** x402 payment wallet (EVM, for paying analytics APIs) */
  x402PrivateKey?: string;
  /** Whether to skip x402 payments (dev mode) */
  devMode?: boolean;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// ─── Analytics Types (x402-gated) ─────────────────────────────

export interface TokenAnalytics {
  /** Token mint address */
  mint: string;
  /** Current bonding curve state */
  bondingCurve: BondingCurveState;
  /** Holder count */
  holderCount: number;
  /** Top holders with percentage */
  topHolders: Array<{
    address: string;
    balance: BN;
    percentage: number;
  }>;
  /** Trade volume in last N minutes */
  recentVolumeSol: number;
  /** Number of trades in last N minutes */
  recentTradeCount: number;
  /** Buy/sell ratio in recent trades */
  recentBuySellRatio: number;
  /** Rug risk score (0-100, higher = riskier) */
  rugScore: number;
  /** Whether creator still holds tokens */
  creatorHolding: boolean;
  /** Creator's token percentage */
  creatorPercentage: number;
  /** Timestamp of analysis */
  analyzedAt: number;
}

export interface SwarmStatus {
  /** Current phase */
  phase: 'initializing' | 'minting' | 'trading' | 'graduating' | 'completed' | 'stopped' | 'error';
  /** Token mint (once created) */
  mint?: string;
  /** Total trades executed */
  totalTrades: number;
  /** Successful trades */
  successfulTrades: number;
  /** Failed trades */
  failedTrades: number;
  /** Total SOL spent */
  totalSolSpent: BN;
  /** Total SOL received */
  totalSolReceived: BN;
  /** Net P&L in SOL */
  netPnlSol: BN;
  /** Current market cap in SOL */
  currentMarketCapSol?: number;
  /** Graduation progress */
  graduationProgress?: number;
  /** Active trader count */
  activeTraders: number;
  /** Uptime in seconds */
  uptimeSeconds: number;
  /** Per-trader stats */
  traderStats: Map<string, TraderStats>;
  /** x402 payments made for analytics */
  x402PaymentsMade: number;
  /** Total USDC spent on x402 */
  x402TotalSpentUsdc: number;
}

export interface TraderStats {
  traderId: string;
  address: string;
  totalBuys: number;
  totalSells: number;
  solSpent: BN;
  solReceived: BN;
  tokensHeld: BN;
  lastTradeAt?: number;
}

// ─── Events ───────────────────────────────────────────────────

export interface SwarmEvents {
  'phase:change': (phase: SwarmStatus['phase']) => void;
  'token:created': (result: MintResult) => void;
  'trade:executed': (result: TradeResult) => void;
  'trade:failed': (order: TradeOrder, error: Error) => void;
  'analytics:fetched': (analytics: TokenAnalytics) => void;
  'analytics:x402-payment': (amount: string, endpoint: string) => void;
  'curve:graduated': (mint: string) => void;
  'budget:exhausted': (traderId: string) => void;
  'swarm:stopped': (status: SwarmStatus) => void;
  'error': (error: Error) => void;
}
