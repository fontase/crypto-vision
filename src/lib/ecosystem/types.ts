/**
 * Agent Ecosystem Engine — Types
 *
 * Core type definitions for the autonomous agent ecosystem.
 * Agents are digital organisms that trade, learn, compete,
 * and compose on PumpFun bonding curves with real SOL.
 */

// ─── Organism Runtime State ─────────────────────────────────

/** In-memory state of a running organism */
export interface OrganismRuntime {
  /** Database organism ID */
  organismId: string;
  /** Current lifecycle phase */
  phase: OrganismPhase;
  /** Timer handle for the tick loop */
  tickTimer: ReturnType<typeof setInterval> | null;
  /** Active trade positions: mint -> position */
  positions: Map<string, Position>;
  /** Recent observations (rolling window) */
  observations: Observation[];
  /** Skills with runtime proficiency */
  activeSkills: Map<string, RuntimeSkill>;
  /** Agents this organism has interacted with recently */
  recentInteractions: Map<string, number>; // organismId -> count
  /** Current decision context */
  decisionContext: DecisionContext;
  /** Performance metrics since last snapshot */
  periodMetrics: PeriodMetrics;
  /** Timestamp of last tick */
  lastTickMs: number;
  /** Whether this organism is currently executing a tick */
  tickInProgress: boolean;
  /** Consecutive errors (for backoff) */
  consecutiveErrors: number;
}

export type OrganismPhase =
  | "booting"
  | "observing"
  | "analyzing"
  | "deciding"
  | "executing"
  | "reflecting"
  | "idle"
  | "dormant"
  | "error";

// ─── Position Tracking ──────────────────────────────────────

export interface Position {
  /** Token mint address */
  mint: string;
  /** Token symbol */
  symbol: string;
  /** Total tokens held */
  tokenAmount: string;
  /** Average entry price in SOL */
  avgEntryPriceSol: string;
  /** Total SOL cost basis */
  costBasisLamports: string;
  /** Current estimated value */
  currentValueLamports: string;
  /** Unrealized P&L */
  unrealizedPnlLamports: string;
  /** When this position was opened */
  openedAt: number;
  /** Number of buys into this position */
  buyCount: number;
  /** Number of partial sells */
  sellCount: number;
}

// ─── Observation (What the agent sees) ──────────────────────

export interface Observation {
  /** What type of market event was observed */
  type: ObservationType;
  /** Token/asset involved */
  mint?: string;
  symbol?: string;
  /** Observed data */
  data: Record<string, unknown>;
  /** How relevant this observation is (0-1) */
  relevance: number;
  /** When this was observed */
  observedAt: number;
}

export type ObservationType =
  | "price_movement"
  | "volume_spike"
  | "new_token"
  | "graduation_approaching"
  | "whale_activity"
  | "agent_trade"       // Another agent traded something
  | "agent_performance" // Another agent's P&L changed significantly
  | "market_trend"
  | "bonding_curve_state"
  | "sentiment_shift";

// ─── Runtime Skill ──────────────────────────────────────────

export interface RuntimeSkill {
  skillId: string;
  name: string;
  slug: string;
  category: string;
  proficiency: number;
  /** How much this skill influences decisions (proficiency * weight) */
  influence: number;
  /** Number of times used this session */
  sessionUsageCount: number;
  /** Success rate this session */
  sessionSuccessRate: number;
}

// ─── Decision Making ────────────────────────────────────────

export interface DecisionContext {
  /** Current market conditions summary */
  marketSummary: string;
  /** Available balance for trading */
  availableBalanceLamports: string;
  /** Active positions summary */
  positionsSummary: string;
  /** Recent performance summary */
  performanceSummary: string;
  /** Top relevant observations */
  topObservations: Observation[];
  /** Other agents' notable activity */
  agentActivity: AgentActivity[];
  /** Risk assessment */
  riskLevel: "low" | "medium" | "high" | "extreme";
}

export interface AgentActivity {
  organismId: string;
  name: string;
  action: string; // "bought X", "sold X", "big win on X", etc.
  relevance: number;
  timestamp: number;
}

/** The decision an agent can make on each tick */
export interface AgentDecision {
  /** What to do */
  action: DecisionAction;
  /** Why (LLM reasoning) */
  reasoning: string;
  /** Confidence (0-1) */
  confidence: number;
  /** Skills that influenced this decision */
  skillsUsed: string[];
  /** Execution parameters (if trading) */
  execution?: TradeExecution;
  /** Interaction target (if interacting with another agent) */
  interactionTarget?: string;
}

export type DecisionAction =
  | "hold"         // Do nothing, wait for better opportunity
  | "buy"          // Buy a token
  | "sell"         // Sell a position
  | "observe"      // Watch a specific agent or token more closely
  | "invest"       // Buy another agent's token
  | "divest"       // Sell another agent's token
  | "rest";        // Skip this tick entirely (conserve compute)

export interface TradeExecution {
  /** Token to trade */
  mint: string;
  symbol: string;
  /** Direction */
  direction: "buy" | "sell";
  /** Amount in lamports (buys) or token units (sells) */
  amount: string;
  /** Maximum slippage BPS */
  maxSlippageBps: number;
  /** Priority fee */
  priorityFeeMicroLamports?: number;
}

// ─── Period Metrics ─────────────────────────────────────────

export interface PeriodMetrics {
  /** Trades since last snapshot */
  trades: number;
  wins: number;
  losses: number;
  /** SOL P&L this period */
  pnlLamports: string;
  /** Skills used and their outcomes */
  skillOutcomes: Map<string, { used: number; succeeded: number }>;
  /** Observations processed */
  observationsProcessed: number;
  /** Interactions with other agents */
  interactions: number;
  /** Compute consumed (approximate) */
  computeUnits: number;
  /** Period start */
  periodStartMs: number;
}

// ─── Ecosystem Engine Config ────────────────────────────────

export interface EcosystemConfig {
  /** Solana RPC URL */
  rpcUrl: string;
  /** Solana WebSocket URL */
  wsUrl?: string;
  /** Database connection string */
  databaseUrl: string;
  /** Redis URL for caching and pubsub */
  redisUrl?: string;

  /** How often to snapshot the ecosystem (ms) */
  snapshotIntervalMs: number;
  /** How often to update the leaderboard (ms) */
  leaderboardIntervalMs: number;
  /** Maximum concurrent organisms running */
  maxConcurrentOrganisms: number;
  /** Minimum balance before dormancy (lamports) */
  dormancyThresholdLamports: string;
  /** Funding threshold to activate (lamports) */
  activationThresholdLamports: string;
  /** Composition threshold — min mutual interactions before merge is possible */
  compositionInteractionThreshold: number;
  /** Composition threshold — min mutual investment (lamports) */
  compositionInvestmentThreshold: string;

  /** AI model for agent decisions */
  aiModel: string;
  /** AI provider */
  aiProvider: string;

  /** PumpFun fee percentage (taken from trades) */
  platformFeeBps: number;
  /** Platform fee wallet */
  platformFeeWallet?: string;

  /** Enable real on-chain trading (false = simulation mode) */
  liveTrading: boolean;
  /** Log level */
  logLevel: "debug" | "info" | "warn" | "error";
}

// ─── Ecosystem State ────────────────────────────────────────

export interface EcosystemState {
  /** All running organism runtimes */
  organisms: Map<string, OrganismRuntime>;
  /** Global tick counter */
  globalTick: number;
  /** Total trades across all organisms */
  totalTrades: number;
  /** Total volume in lamports */
  totalVolumeLamports: string;
  /** Ecosystem start time */
  startedAt: number;
  /** Whether the ecosystem is running */
  running: boolean;
}

// ─── Events ─────────────────────────────────────────────────

export interface EcosystemEngineEvents {
  "organism:booted": (organismId: string) => void;
  "organism:activated": (organismId: string) => void;
  "organism:dormant": (organismId: string) => void;
  "organism:extinct": (organismId: string) => void;
  "trade:executed": (organismId: string, trade: TradeExecution, result: TradeResult) => void;
  "trade:failed": (organismId: string, trade: TradeExecution, error: string) => void;
  "skill:acquired": (organismId: string, skillId: string) => void;
  "skill:levelup": (organismId: string, skillId: string, newProficiency: number) => void;
  "interaction:started": (initiatorId: string, targetId: string, type: string) => void;
  "interaction:resolved": (interactionId: string, outcome: string) => void;
  "composition:triggered": (parentIds: string[]) => void;
  "composition:completed": (parentIds: string[], childId: string) => void;
  "leaderboard:updated": () => void;
  "snapshot:taken": (snapshotId: string) => void;
  "ecosystem:error": (error: Error) => void;
}

export interface TradeResult {
  success: boolean;
  txSignature?: string;
  amountOut?: string;
  executionPrice?: string;
  error?: string;
  executedAt: number;
}

// ─── Genesis Types ──────────────────────────────────────────

export interface GenesisAgentDef {
  /** Agent identifier from agents/src/ */
  identifier: string;
  /** Display name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Avatar emoji */
  avatar: string;
  /** Description */
  description: string;
  /** System prompt */
  systemPrompt: string;
  /** Tags from agent definition */
  tags: string[];
  /** Derived skill slugs */
  skills: string[];
  /** Category */
  category: string;
}

/** Skill definitions for the genesis population */
export interface GenesisSkill {
  slug: string;
  name: string;
  description: string;
  category: "analysis" | "trading" | "defi" | "risk" | "data" | "social" | "onchain" | "meta";
  baseWeight: number;
  rarity: number;
}
