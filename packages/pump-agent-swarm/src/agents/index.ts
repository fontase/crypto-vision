/**
 * Agents — barrel exports
 */

// Narrative Agent
export { NarrativeAgent } from './narrative-agent.js';
export type {
  NarrativeOptions,
  PumpFunMetadata,
  NarrativeEvaluation,
} from './narrative-agent.js';

// Scanner Agent
export { ScannerAgent } from './scanner-agent.js';
export type {
  CriterionResult,
  RugRiskResult,
  MomentumResult,
  NarrativeResult,
  TokenEvaluation as ScannerTokenEvaluation,
  ScannedToken,
} from './scanner-agent.js';

// Creator Agent
export { CreatorAgent } from './creator-agent.js';

// Trader Agent
export { TraderAgent } from './trader-agent.js';
export type {
  TraderPersonality,
  AdvancedPnL,
  TradeInstruction,
} from './trader-agent.js';

// Sniper Agent
export { SniperAgent, DEFAULT_SNIPER_CONFIG } from './sniper-agent.js';
export type { SniperConfig } from './sniper-agent.js';

// Market Maker Agent
export { MarketMakerAgent } from './market-maker-agent.js';
export type {
  SpreadSnapshot,
  InventorySnapshot,
} from './market-maker-agent.js';

// Volume Agent
export { VolumeAgent } from './volume-agent.js';
export type { VolumeConfig, VolumeStats } from './volume-agent.js';

// Accumulator Agent
export { AccumulatorAgent } from './accumulator-agent.js';
export type {
  AccumulationStrategy,
  AccumulatorConfig,
  AccumulationProgress,
} from './accumulator-agent.js';

// Exit Agent
export { ExitAgent } from './exit-agent.js';
export type {
  ExitConfig,
  ExitConditions,
  ExitPlan,
  ExitOrder,
  ExitResult,
} from './exit-agent.js';

// Sentinel Agent
export { SentinelAgent } from './sentinel-agent.js';
export type {
  SafetyRule,
  HealthCheck as SentinelHealthCheck,
  HealthReport as SentinelHealthReport,
} from './sentinel-agent.js';
