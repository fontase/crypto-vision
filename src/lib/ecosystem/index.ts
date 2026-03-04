/**
 * Agent Ecosystem — Main Exports
 *
 * PumpFun for AI Agents: autonomous digital organisms that trade,
 * compete, learn, and compose on real markets.
 *
 * @copyright 2024-2026 nirholas. All rights reserved.
 */

export { EcosystemEngine } from "./engine.js";
export {
  agentToGenesisDef,
  categorizeAgent,
  deriveSkillsFromTags,
  generateSymbol,
  GENESIS_SKILLS,
} from "./genesis.js";
export type {
  AgentActivity,
  AgentDecision,
  DecisionAction,
  DecisionContext,
  EcosystemConfig,
  EcosystemEngineEvents,
  EcosystemState,
  GenesisAgentDef,
  GenesisSkill,
  Observation,
  ObservationType,
  OrganismPhase,
  OrganismRuntime,
  PeriodMetrics,
  Position,
  RuntimeSkill,
  TradeExecution,
  TradeResult,
} from "./types.js";
