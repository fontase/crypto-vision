/**
 * Infrastructure — barrel exports
 */

// RPC Pool
export { RpcPool, DEFAULT_RPC_ENDPOINTS } from './rpc-pool.js';

// Event Bus
export { SwarmEventBus } from './event-bus.js';
export type { SubscribeOptions } from './event-bus.js';

// State Machine
export { SwarmStateMachine, DEFAULT_SWARM_TRANSITIONS } from './state-machine.js';
export type { PhaseHistoryEntry, AuditLogEntry } from './state-machine.js';

// Logger
export { SwarmLogger } from './logger.js';
export type { LogLevel, LogEntry, LoggerOptions } from './logger.js';

// Metrics
export { MetricsCollector, Counter, Gauge, Histogram, Rate } from './metrics.js';
export type { MetricSnapshot } from './metrics.js';

// Error Handler
export { SwarmErrorHandler, CircuitBreakerOpenError } from './error-handler.js';
export type {
  ErrorSeverity,
  ErrorCategory,
  ClassifiedError,
  RetryOptions,
  CircuitBreakerConfig,
} from './error-handler.js';
