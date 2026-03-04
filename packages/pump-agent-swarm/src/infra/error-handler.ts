/**
 * Swarm Error Handler — Centralized error handling with circuit breakers
 *
 * Features:
 * - Error classification by severity, category, and suggested recovery action
 * - Solana-specific error pattern matching (rate limits, blockhash, simulation)
 * - Retry with exponential backoff and jitter (prevents thundering herd)
 * - Per-operation circuit breakers (closed → open → half-open → closed)
 * - Automatic event bus integration: every classified error emits to bus
 * - Composable: withRetry and withCircuitBreaker can be nested
 */

import { SwarmEventBus } from './event-bus.js';
import { SwarmLogger } from './logger.js';

// ─── Types ────────────────────────────────────────────────────

export type ErrorSeverity = 'recoverable' | 'degraded' | 'critical' | 'fatal';
export type ErrorCategory =
  | 'rpc'
  | 'transaction'
  | 'wallet'
  | 'intelligence'
  | 'bundle'
  | 'unknown';

export interface ClassifiedError {
  /** The original error instance */
  original: Error;
  /** How severe the error is */
  severity: ErrorSeverity;
  /** Which subsystem produced it */
  category: ErrorCategory;
  /** Whether the operation can be retried */
  retryable: boolean;
  /** Recommended recovery action */
  suggestedAction: 'retry' | 'skip' | 'pause' | 'exit' | 'switch_rpc';
  /** Arbitrary context attached by the caller */
  context: Record<string, unknown>;
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds before the first retry (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Multiplier applied to the delay after each retry (default: 2) */
  backoffMultiplier: number;
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter: boolean;
  /** Error message patterns that are retryable (overrides classification) */
  retryableErrors?: string[];
  /** Callback invoked before each retry attempt */
  onRetry?: (attempt: number, error: Error) => void;
}

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Rolling window in ms for counting failures (default: 60000) */
  windowMs: number;
  /** Time in ms to wait before transitioning from open to half-open (default: 30000) */
  resetTimeoutMs: number;
}

type CircuitBreakerState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerEntry {
  state: CircuitBreakerState;
  /** Timestamps of failures within the current window */
  failures: number[];
  /** Timestamp when the circuit was opened */
  openedAt: number;
  /** Configuration for this circuit breaker */
  config: CircuitBreakerConfig;
}

// ─── Error Pattern Rules ──────────────────────────────────────

interface ErrorRule {
  /** Patterns to match against the error message (case-insensitive) */
  patterns: string[];
  severity: ErrorSeverity;
  category: ErrorCategory;
  retryable: boolean;
  suggestedAction: ClassifiedError['suggestedAction'];
}

/**
 * Ordered list of error classification rules.
 * First match wins. Patterns are matched case-insensitively.
 */
const ERROR_RULES: ErrorRule[] = [
  // RPC rate limiting
  {
    patterns: ['429', 'rate limit'],
    severity: 'recoverable',
    category: 'rpc',
    retryable: true,
    suggestedAction: 'retry',
  },
  // Insufficient funds
  {
    patterns: ['insufficient funds', '0x1'],
    severity: 'critical',
    category: 'wallet',
    retryable: false,
    suggestedAction: 'pause',
  },
  // Blockhash expired
  {
    patterns: ['blockhash not found'],
    severity: 'recoverable',
    category: 'transaction',
    retryable: true,
    suggestedAction: 'retry',
  },
  // Simulation failure
  {
    patterns: ['transaction simulation failed'],
    severity: 'recoverable',
    category: 'transaction',
    retryable: false,
    suggestedAction: 'skip',
  },
  // Confirmation timeout
  {
    patterns: ['unable to confirm'],
    severity: 'recoverable',
    category: 'transaction',
    retryable: true,
    suggestedAction: 'retry',
  },
  // Network failure
  {
    patterns: ['network request failed'],
    severity: 'recoverable',
    category: 'rpc',
    retryable: true,
    suggestedAction: 'switch_rpc',
  },
  // Account not found
  {
    patterns: ['account not found'],
    severity: 'degraded',
    category: 'transaction',
    retryable: false,
    suggestedAction: 'skip',
  },
  // Custom program error
  {
    patterns: ['custom program error'],
    severity: 'degraded',
    category: 'transaction',
    retryable: false,
    suggestedAction: 'skip',
  },
];

// ─── Constants ────────────────────────────────────────────────

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitter: true,
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  windowMs: 60_000,
  resetTimeoutMs: 30_000,
};

// ─── SwarmErrorHandler ────────────────────────────────────────

/**
 * Centralized error handler for the pump-agent swarm.
 *
 * Provides error classification (Solana-specific patterns), retry with
 * exponential backoff + jitter, per-operation circuit breakers, and
 * automatic event bus integration.
 *
 * ```typescript
 * const handler = new SwarmErrorHandler();
 *
 * // Wrap an RPC call with retry + circuit breaker
 * const result = await handler.withCircuitBreaker('rpc', () =>
 *   handler.withRetry(() => connection.getLatestBlockhash()),
 * );
 *
 * // Check stats
 * console.log(handler.getErrorStats());
 * ```
 */
export class SwarmErrorHandler {
  private readonly logger: SwarmLogger;
  private readonly bus: SwarmEventBus;
  private readonly circuitBreakers = new Map<string, CircuitBreakerEntry>();
  private readonly defaultCircuitBreakerConfig: CircuitBreakerConfig;

  // ── Error statistics ──────────────────────────────────────
  private totalErrors = 0;
  private readonly categoryCounters: Record<ErrorCategory, number> = {
    rpc: 0,
    transaction: 0,
    wallet: 0,
    intelligence: 0,
    bundle: 0,
    unknown: 0,
  };
  private readonly severityCounters: Record<ErrorSeverity, number> = {
    recoverable: 0,
    degraded: 0,
    critical: 0,
    fatal: 0,
  };
  /** Track unrecognized error messages for frequency-based severity */
  private readonly unknownErrorFrequency = new Map<string, number>();

  constructor(
    bus?: SwarmEventBus,
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>,
  ) {
    this.logger = SwarmLogger.create('error-handler', 'error');
    this.bus = bus ?? SwarmEventBus.getInstance();
    this.defaultCircuitBreakerConfig = {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...circuitBreakerConfig,
    };
  }

  // ─── Error Classification ─────────────────────────────────

  /**
   * Classify an error based on its message against known Solana error patterns.
   * Unrecognized errors are assigned severity based on frequency:
   * - ≤2 occurrences → recoverable
   * - 3–9 → degraded
   * - ≥10 → critical
   */
  classify(
    error: Error,
    context: Record<string, unknown> = {},
  ): ClassifiedError {
    const messageLower = error.message.toLowerCase();

    for (const rule of ERROR_RULES) {
      const matched = rule.patterns.some((pattern) =>
        messageLower.includes(pattern.toLowerCase()),
      );
      if (matched) {
        return {
          original: error,
          severity: rule.severity,
          category: rule.category,
          retryable: rule.retryable,
          suggestedAction: rule.suggestedAction,
          context,
        };
      }
    }

    // Unknown error — severity based on how often we've seen it
    const key = error.message.slice(0, 200);
    const count = (this.unknownErrorFrequency.get(key) ?? 0) + 1;
    this.unknownErrorFrequency.set(key, count);

    let severity: ErrorSeverity;
    if (count >= 10) {
      severity = 'critical';
    } else if (count >= 3) {
      severity = 'degraded';
    } else {
      severity = 'recoverable';
    }

    return {
      original: error,
      severity,
      category: 'unknown',
      retryable: severity === 'recoverable',
      suggestedAction: severity === 'critical' ? 'pause' : 'retry',
      context,
    };
  }

  // ─── Error Handling ───────────────────────────────────────

  /**
   * Handle an error: classify it, update stats, log it, and emit to the event bus.
   */
  async handle(
    error: Error,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    const classified = this.classify(error, context);

    // Update counters
    this.totalErrors++;
    this.categoryCounters[classified.category]++;
    this.severityCounters[classified.severity]++;

    // Log with appropriate level
    const logData: Record<string, unknown> = {
      severity: classified.severity,
      category: classified.category,
      retryable: classified.retryable,
      suggestedAction: classified.suggestedAction,
      ...context,
    };

    switch (classified.severity) {
      case 'fatal':
        this.logger.error(
          `[FATAL] ${error.message}`,
          error,
          logData,
        );
        break;
      case 'critical':
        this.logger.error(
          `[CRITICAL] ${error.message}`,
          error,
          logData,
        );
        break;
      case 'degraded':
        this.logger.warn(`[DEGRADED] ${error.message}`, logData);
        break;
      case 'recoverable':
        this.logger.info(`[RECOVERABLE] ${error.message}`, logData);
        break;
    }

    // Emit to event bus
    this.bus.emit(
      `error:${classified.category}`,
      'error',
      'error-handler',
      {
        message: error.message,
        stack: error.stack,
        severity: classified.severity,
        category: classified.category,
        retryable: classified.retryable,
        suggestedAction: classified.suggestedAction,
        ...context,
      },
    );
  }

  // ─── Retry Logic ──────────────────────────────────────────

  /**
   * Execute an async function with exponential backoff retry logic.
   *
   * Applies jitter to prevent thundering herd when multiple agents
   * retry simultaneously. Delays are capped at `maxDelayMs`.
   *
   * @throws The last error if all retries are exhausted
   */
  async withRetry<T>(
    fn: () => Promise<T>,
    options?: Partial<RetryOptions>,
  ): Promise<T> {
    const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;

        // Check if this is the last attempt
        if (attempt >= opts.maxRetries) {
          break;
        }

        // Check if the error is retryable
        if (!this.isRetryable(error, opts)) {
          break;
        }

        // Calculate delay with exponential backoff
        const baseDelay =
          opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt);
        const cappedDelay = Math.min(baseDelay, opts.maxDelayMs);

        // Apply jitter: randomize between 0 and cappedDelay to spread out retries
        const delay = opts.jitter
          ? Math.floor(Math.random() * cappedDelay) + 1
          : cappedDelay;

        // Notify caller before retrying
        if (opts.onRetry) {
          opts.onRetry(attempt + 1, error);
        }

        this.logger.info(
          `Retry attempt ${attempt + 1}/${opts.maxRetries}`,
          {
            delay,
            error: error.message,
          },
        );

        await sleep(delay);
      }
    }

    // Handle the error before re-throwing
    if (lastError) {
      await this.handle(lastError);
    }

    throw lastError;
  }

  // ─── Circuit Breaker ──────────────────────────────────────

  /**
   * Execute an async function protected by a named circuit breaker.
   *
   * - **Closed**: normal operation — failures are counted
   * - **Open**: immediately rejects with a `CircuitBreakerOpenError`
   * - **Half-open**: allows a single probe call; success closes, failure re-opens
   *
   * Different circuit breakers are maintained per `name`, allowing separate
   * breakers for RPC, trade, and bundle operations.
   *
   * @throws `CircuitBreakerOpenError` when the circuit is open
   */
  async withCircuitBreaker<T>(
    name: string,
    fn: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>,
  ): Promise<T> {
    const breaker = this.getOrCreateBreaker(name, config);

    // If currently open, check if enough time has passed to go half-open
    if (breaker.state === 'open') {
      const elapsed = Date.now() - breaker.openedAt;
      if (elapsed >= breaker.config.resetTimeoutMs) {
        breaker.state = 'half-open';
        this.logger.info(`Circuit breaker '${name}' → half-open (probing)`, {
          circuitBreaker: name,
        });
        this.bus.emit(
          'circuit-breaker:half-open',
          'system',
          'error-handler',
          { name },
        );
      } else {
        this.logger.warn(`Circuit breaker '${name}' is OPEN — rejecting`, {
          circuitBreaker: name,
          remainingMs: breaker.config.resetTimeoutMs - elapsed,
        });
        throw new CircuitBreakerOpenError(name);
      }
    }

    try {
      const result = await fn();

      // Success in half-open → close the circuit
      if (breaker.state === 'half-open') {
        breaker.state = 'closed';
        breaker.failures = [];
        this.logger.info(`Circuit breaker '${name}' → closed (recovered)`, {
          circuitBreaker: name,
        });
        this.bus.emit(
          'circuit-breaker:closed',
          'system',
          'error-handler',
          { name },
        );
      }

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Record the failure
      this.recordFailure(breaker, name);

      // In half-open, any failure immediately re-opens
      if (breaker.state === 'half-open') {
        breaker.state = 'open';
        breaker.openedAt = Date.now();
        this.logger.warn(
          `Circuit breaker '${name}' → open (half-open probe failed)`,
          { circuitBreaker: name, error: error.message },
        );
        this.bus.emit('circuit-breaker:open', 'system', 'error-handler', {
          name,
          reason: 'half-open probe failed',
          error: error.message,
        });
      }

      throw error;
    }
  }

  /**
   * Get the current state of a named circuit breaker.
   * Returns `'closed'` if the breaker does not exist.
   */
  getCircuitBreakerState(name: string): CircuitBreakerState {
    const breaker = this.circuitBreakers.get(name);
    if (!breaker) return 'closed';

    // Check if an open breaker has timed out to half-open
    if (breaker.state === 'open') {
      const elapsed = Date.now() - breaker.openedAt;
      if (elapsed >= breaker.config.resetTimeoutMs) {
        return 'half-open';
      }
    }

    return breaker.state;
  }

  /**
   * Manually reset a circuit breaker to the closed state.
   * Clears all recorded failures.
   */
  resetCircuitBreaker(name: string): void {
    const breaker = this.circuitBreakers.get(name);
    if (breaker) {
      breaker.state = 'closed';
      breaker.failures = [];
      breaker.openedAt = 0;
      this.logger.info(`Circuit breaker '${name}' manually reset to closed`, {
        circuitBreaker: name,
      });
      this.bus.emit(
        'circuit-breaker:reset',
        'system',
        'error-handler',
        { name },
      );
    }
  }

  // ─── Statistics ───────────────────────────────────────────

  /**
   * Return aggregate error statistics.
   */
  getErrorStats(): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
  } {
    return {
      total: this.totalErrors,
      byCategory: { ...this.categoryCounters },
      bySeverity: { ...this.severityCounters },
    };
  }

  // ─── Internals ────────────────────────────────────────────

  /**
   * Determine if an error is retryable given the current options.
   * If `retryableErrors` patterns are provided, those override classification.
   */
  private isRetryable(error: Error, opts: RetryOptions): boolean {
    // If explicit patterns are given, match against them
    if (opts.retryableErrors && opts.retryableErrors.length > 0) {
      const msgLower = error.message.toLowerCase();
      return opts.retryableErrors.some((pattern) =>
        msgLower.includes(pattern.toLowerCase()),
      );
    }

    // Otherwise, defer to classification
    const classified = this.classify(error);
    return classified.retryable;
  }

  /**
   * Get or create a circuit breaker entry for the given name.
   */
  private getOrCreateBreaker(
    name: string,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreakerEntry {
    let entry = this.circuitBreakers.get(name);
    if (!entry) {
      entry = {
        state: 'closed',
        failures: [],
        openedAt: 0,
        config: { ...this.defaultCircuitBreakerConfig, ...config },
      };
      this.circuitBreakers.set(name, entry);
    }
    return entry;
  }

  /**
   * Record a failure in the circuit breaker and transition to open if threshold is reached.
   */
  private recordFailure(breaker: CircuitBreakerEntry, name: string): void {
    const now = Date.now();

    // Prune failures outside the current window
    breaker.failures = breaker.failures.filter(
      (ts) => now - ts < breaker.config.windowMs,
    );

    breaker.failures.push(now);

    // Check if we've exceeded the failure threshold
    if (
      breaker.state === 'closed' &&
      breaker.failures.length >= breaker.config.failureThreshold
    ) {
      breaker.state = 'open';
      breaker.openedAt = now;
      this.logger.warn(
        `Circuit breaker '${name}' → open (${breaker.failures.length} failures in ${breaker.config.windowMs}ms)`,
        {
          circuitBreaker: name,
          failureCount: breaker.failures.length,
          threshold: breaker.config.failureThreshold,
        },
      );
      this.bus.emit('circuit-breaker:open', 'system', 'error-handler', {
        name,
        reason: 'failure threshold exceeded',
        failureCount: breaker.failures.length,
        threshold: breaker.config.failureThreshold,
        windowMs: breaker.config.windowMs,
      });
    }
  }
}

// ─── CircuitBreakerOpenError ──────────────────────────────────

/**
 * Thrown when a call is rejected because the circuit breaker is open.
 */
export class CircuitBreakerOpenError extends Error {
  readonly circuitBreakerName: string;

  constructor(name: string) {
    super(`Circuit breaker '${name}' is open — call rejected`);
    this.name = 'CircuitBreakerOpenError';
    this.circuitBreakerName = name;
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/** Non-blocking sleep using setTimeout */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
