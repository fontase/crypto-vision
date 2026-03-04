/**
 * Trading Engine — barrel exports
 */

// Wash Engine
export { WashEngine } from './wash-engine.js';
export type { WashEngineConfig, CycleResult, WashStats } from './wash-engine.js';

// Volume Generator
export { VolumeGenerator } from './volume-generator.js';
export type {
  VolumeCurve,
  VolumeGeneratorConfig,
  VolumeBucket,
  VolumePlan,
} from './volume-generator.js';

// Price Trajectory
export {
  PriceTrajectoryController,
  calculateBuyOutput,
  calculateSellOutput,
  calculateSolForPriceTarget,
  simulatePriceAfterTrade,
} from './price-trajectory.js';
export type {
  TrajectoryCurve,
  PriceTrajectoryPlan,
  PriceCheckpoint,
  TrajectoryProgress,
} from './price-trajectory.js';

// Wallet Rotation
export { WalletRotation } from './wallet-rotation.js';
export type { RotationConfig, WalletUsageStats } from './wallet-rotation.js';

// Trade Scheduler
export { TradeScheduler } from './trade-scheduler.js';
export type {
  ScheduledOrder,
  SchedulerConfig,
  SchedulerStats,
} from './trade-scheduler.js';

// Order Router
export { OrderRouter, DEFAULT_ROUTER_CONFIG } from './order-router.js';
export type {
  SubmitOptions,
  OrderResult,
  OrderStatus,
  TransactionConfirmation,
  EndpointPerformance,
  RouterStats,
  RouterConfig,
} from './order-router.js';

// Slippage Calculator
export { SlippageCalculator } from './slippage-calculator.js';
export type { SlippageEstimate } from './slippage-calculator.js';

// Gas Optimizer
export { GasOptimizer, DEFAULT_GAS_CONFIG } from './gas-optimizer.js';
export type {
  FeeUrgency,
  CongestionLevel,
  GasConfig,
  FeeDataPoint,
  TransactionCostEstimate,
} from './gas-optimizer.js';

// Position Manager
export { PositionManager } from './position-manager.js';
export type {
  WalletPosition,
  AggregatePosition,
  RebalanceSuggestion,
} from './position-manager.js';

// P&L Tracker
export { PnLTracker } from './pnl-tracker.js';
export type {
  TradeRecord,
  AgentPnL,
  SwarmPnL,
  PnLDataPoint,
  DrawdownInfo,
  PnLSnapshot,
} from './pnl-tracker.js';
