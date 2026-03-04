/**
 * Bundle System — barrel exports
 */

// Bundle Coordinator
export { BundleCoordinator } from './bundle-coordinator.js';
export type {
  BundleCoordinatorConfig,
  BundleResult,
} from './bundle-coordinator.js';

// Jito Client
export { JitoClient } from './jito-client.js';
export type { JitoBundleResult, JitoBundleStatus } from './jito-client.js';

// Supply Distributor
export { SupplyDistributor } from './supply-distributor.js';
export type {
  DistributionStrategy,
  DistributionConfig,
  DistributionPlan,
  DistributionResult,
  TokenDistribution,
  DistributionAnalysis,
} from './supply-distributor.js';

// Anti-Detection
export { AntiDetection, createDefaultAntiDetectionConfig } from './anti-detection.js';
export type {
  AntiDetectionConfig,
  TradeTimingProfile,
  TradeHistoryEntry,
  OnChainActivity,
  DetectionRiskScore,
  WalletRotationPlan,
  NoiseTransactionType,
  NoiseTransactionConfig,
  TradeSequenceValidation,
} from './anti-detection.js';

// Timing Engine
export { TimingEngine } from './timing-engine.js';
export type {
  SlotTracker,
  SyncResult,
  SubmissionWindow,
  LatencyReport,
  TimingCountdown,
} from './timing-engine.js';

// Bundle Validator
export { BundleValidator } from './bundle-validator.js';
export type {
  BundleToValidate,
  ExpectedOutcome,
  BundleValidationResult,
  ValidationError,
  ValidationWarning,
  SimulationResult,
  AccountChange,
  BalanceCheckResult,
  WalletBalanceDetail,
  FeeEstimate,
  ConflictDetection,
  AccountConflict,
  InstructionValidation,
} from './bundle-validator.js';

// Launch Sequencer
export { LaunchSequencer } from './launch-sequencer.js';
export type {
  LaunchPhase,
  LaunchPlan,
  LaunchResult as LaunchSequencerResult,
  LaunchStatus,
  LaunchCostEstimate,
  LaunchSequencerConfig,
  LaunchSequencerDeps,
} from './launch-sequencer.js';

// Dev Buy Optimizer
export { DevBuyOptimizer } from './dev-buy-optimizer.js';
export type {
  PumpFunCurveParams,
  DevBuyParams,
  DevBuyRecommendation,
  DevBuySimulation,
  DevBuyOptimizerConfig,
} from './dev-buy-optimizer.js';

// Wallet Funder
export { WalletFunder } from './wallet-funder.js';
export type {
  FundingRole,
  FundingTarget,
  WalletFunderConfig,
  FundingResult,
  FundingTransferResult,
  FundingVerification,
  FundingCostEstimate,
  ReclaimResult,
} from './wallet-funder.js';

// Bundle Analytics
export { BundleAnalytics } from './bundle-analytics.js';
export type {
  LaunchResult,
  TimingAnalysis,
  CostAnalysis,
  SupplyAnalysis,
  CurveImpactAnalysis,
  LaunchAnalysis,
  LaunchReport,
  BaselineComparison,
} from './bundle-analytics.js';
