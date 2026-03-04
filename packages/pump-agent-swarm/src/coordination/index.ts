/**
 * Coordination Layer — barrel exports
 */

// Swarm Orchestrator
export { SwarmOrchestrator } from './swarm-orchestrator.js';
export type {
  RiskLimits as OrchestratorRiskLimits,
  SwarmOrchestratorConfig,
  SwarmOrchestratorStatus,
} from './swarm-orchestrator.js';

// Agent Messenger
export { AgentMessenger } from './agent-messenger.js';
export type {
  AgentMessageType,
  AgentMessagePriority,
  AgentMessage,
  TradeSignalPayload,
  StrategyUpdatePayload,
  RiskAlertPayload,
  StatusReportPayload,
  TaskAssignmentPayload,
  TaskCompletePayload,
  AcknowledgementPayload,
  PositionUpdatePayload,
  PhaseChangePayload,
  HealthCheckPayload,
  ShutdownRequestPayload,
  MessagePayload,
  MessageResponse,
  MessageHandler,
  MessengerStats,
} from './agent-messenger.js';

// Consensus Engine
export { ConsensusEngine } from './consensus-engine.js';
export type {
  VotingStrategy,
  VoteDirection,
  ProposalStatus,
  ConsensusDecision,
  ProposalType,
  ProposalUrgency,
  OverrideAction,
  OverrideRule,
  ConsensusConfig,
  ProposedAction,
  AgentVote,
  VoteStats,
  ConsensusResult,
  Proposal,
} from './consensus-engine.js';

// Task Delegator
export { TaskDelegator } from './task-delegator.js';
export type {
  SwarmTaskType,
  TaskStatus,
  TaskPriority,
  SwarmTask,
  TaskResult,
  TaskFilter,
  AgentCapabilities,
} from './task-delegator.js';

// Lifecycle Manager
export { LifecycleManager } from './lifecycle-manager.js';
export type {
  AgentHealthStatus,
  AgentInstance,
  AgentFactory,
  LifecycleConfig,
} from './lifecycle-manager.js';

// Health Monitor
export { HealthMonitor } from './health-monitor.js';
export type {
  HealthStatus,
  ComponentHealth,
  HealthIssue,
  HealthReport,
  HealthCheckFn,
  HealthMonitorConfig,
} from './health-monitor.js';

// Phase Controller
export { PhaseController } from './phase-controller.js';
export type {
  PhaseCondition,
  PhaseRequirements,
  PhaseTransitionCheck,
  PhaseHistoryEntry as PhaseControllerHistoryEntry,
  PhaseControllerConfig,
} from './phase-controller.js';

// Rollback Manager
export { RollbackManager } from './rollback-manager.js';
export type {
  RollbackConfig,
  SwarmState,
  Snapshot,
  SnapshotInfo,
  SnapshotDiff,
} from './rollback-manager.js';

// Audit Logger
export { AuditLogger } from './audit-logger.js';
export type {
  AuditCategory,
  AuditSeverity,
  AuditEntry,
  TradeAuditData,
  TradeAuditSummary,
  DecisionAuditData,
  AuditFilter,
  AuditConfig,
} from './audit-logger.js';

// Swarm Config Manager
export { SwarmConfigManager } from './swarm-config-manager.js';
export type {
  SwarmRuntimeConfig,
  ConfigUpdateResult,
  ConfigChange,
  ConfigValidationResult,
  ConfigSchemaInfo,
} from './swarm-config-manager.js';
