/**
 * Alert Manager — Auto-generated alerts and threshold monitoring
 *
 * Features:
 * - Auto-generates alerts from risk events, health degradation, agent failures
 * - Configurable threshold monitoring with custom metric getters
 * - Alert lifecycle: active → acknowledged → resolved
 * - Deduplication prevents alert spam within configurable windows
 * - Auto-resolve cleans up stale info alerts
 * - Subscriber callbacks for real-time alert delivery
 */

import { v4 as uuidv4 } from 'uuid';

import type { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Types ────────────────────────────────────────────────────

export type AlertLevel = 'info' | 'warning' | 'critical';

export interface Alert {
  /** Unique alert ID */
  id: string;
  /** Alert severity level */
  level: AlertLevel;
  /** Short alert title */
  title: string;
  /** Detailed message */
  message: string;
  /** Category for grouping */
  category: 'risk' | 'health' | 'pnl' | 'agent' | 'trading' | 'system';
  /** Creation timestamp */
  createdAt: number;
  /** Acknowledgement timestamp (null if not acknowledged) */
  acknowledgedAt: number | null;
  /** Resolution timestamp (null if not resolved) */
  resolvedAt: number | null;
  /** Alert state */
  state: 'active' | 'acknowledged' | 'resolved';
  /** Source agent ID if applicable */
  agentId?: string;
  /** Additional context data */
  metadata: Record<string, unknown>;
  /** Auto-resolve condition description */
  autoResolveCondition?: string;
}

export interface AlertConfig {
  /** Maximum alerts to retain (default: 1000) */
  maxAlerts: number;
  /** Auto-resolve info alerts after ms (default: 300000 — 5 min) */
  autoResolveInfoMs: number;
  /** Enable auto-generated alerts from events (default: true) */
  autoGenerate: boolean;
  /** Dedup window — don't create duplicate alerts within ms (default: 60000) */
  dedupWindowMs: number;
}

export interface ThresholdConfig {
  /** Metric name to monitor */
  metric: string;
  /** Threshold value */
  threshold: number;
  /** Comparison operator */
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  /** Alert level to create when threshold breached */
  level: AlertLevel;
  /** Custom message template (use {value} and {threshold} placeholders) */
  messageTemplate: string;
  /** Check interval in ms (default: 10000) */
  checkIntervalMs: number;
  /** Getter function to fetch current metric value */
  getValue: () => number | Promise<number>;
}

export interface CreateAlertInput {
  level: AlertLevel;
  title: string;
  message: string;
  category: Alert['category'];
  agentId?: string;
  metadata?: Record<string, unknown>;
  autoResolveCondition?: string;
}

// ─── Constants ────────────────────────────────────────────────

const DEFAULT_CONFIG: AlertConfig = {
  maxAlerts: 1000,
  autoResolveInfoMs: 300_000, // 5 minutes
  autoGenerate: true,
  dedupWindowMs: 60_000, // 1 minute
};

const OPERATOR_FNS: Record<
  ThresholdConfig['operator'],
  (value: number, threshold: number) => boolean
> = {
  gt: (v, t) => v > t,
  lt: (v, t) => v < t,
  gte: (v, t) => v >= t,
  lte: (v, t) => v <= t,
  eq: (v, t) => v === t,
};

const OPERATOR_LABELS: Record<ThresholdConfig['operator'], string> = {
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  eq: '==',
};

// ─── AlertManager ─────────────────────────────────────────────

export class AlertManager {
  private readonly config: AlertConfig;
  private readonly alerts: Alert[] = [];
  private readonly subscribers = new Map<
    string,
    (alert: Alert) => void
  >();
  private readonly thresholds = new Map<string, ThresholdConfig>();
  private readonly thresholdTimers = new Map<
    string,
    ReturnType<typeof setInterval>
  >();
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;
  private readonly eventSubscriptionIds: string[] = [];
  private autoResolveTimer: ReturnType<typeof setInterval> | undefined;
  private monitoring = false;

  constructor(eventBus: SwarmEventBus, config?: Partial<AlertConfig>) {
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = SwarmLogger.create('alert-manager', 'system');

    if (this.config.autoGenerate) {
      this.registerEventListeners();
    }

    this.logger.info('Alert manager initialized', {
      maxAlerts: this.config.maxAlerts,
      autoResolveInfoMs: this.config.autoResolveInfoMs,
      autoGenerate: this.config.autoGenerate,
      dedupWindowMs: this.config.dedupWindowMs,
    });
  }

  // ─── Alert CRUD ─────────────────────────────────────────────

  /**
   * Manually create a new alert. Returns the alert ID.
   * Respects deduplication — if an identical alert (same title + category)
   * was created within the dedup window, the existing alert ID is returned.
   */
  createAlert(input: CreateAlertInput): string {
    // Dedup check
    const existingId = this.findDuplicate(input.title, input.category);
    if (existingId) {
      this.logger.debug('Duplicate alert suppressed', {
        title: input.title,
        category: input.category,
        existingId,
      });
      return existingId;
    }

    const alert: Alert = {
      id: uuidv4(),
      level: input.level,
      title: input.title,
      message: input.message,
      category: input.category,
      createdAt: Date.now(),
      acknowledgedAt: null,
      resolvedAt: null,
      state: 'active',
      metadata: input.metadata ?? {},
      ...(input.agentId !== undefined && { agentId: input.agentId }),
      ...(input.autoResolveCondition !== undefined && {
        autoResolveCondition: input.autoResolveCondition,
      }),
    };

    this.alerts.push(alert);
    this.enforceMaxAlerts();

    this.logger.info(`Alert created: ${alert.title}`, {
      id: alert.id,
      level: alert.level,
      category: alert.category,
    });

    // Notify subscribers
    for (const callback of this.subscribers.values()) {
      try {
        callback(alert);
      } catch (err) {
        this.logger.error(
          'Alert subscriber threw an error',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    // Emit to event bus
    this.eventBus.emit(
      'alert:created',
      'system',
      'alert-manager',
      {
        alertId: alert.id,
        level: alert.level,
        title: alert.title,
        category: alert.category,
      },
    );

    return alert.id;
  }

  /** Mark an alert as acknowledged */
  acknowledgeAlert(id: string): void {
    const alert = this.findAlertById(id);
    if (!alert) {
      this.logger.warn('Cannot acknowledge alert — not found', { id });
      return;
    }
    if (alert.state === 'resolved') {
      this.logger.warn('Cannot acknowledge alert — already resolved', {
        id,
      });
      return;
    }

    alert.state = 'acknowledged';
    alert.acknowledgedAt = Date.now();

    this.logger.info('Alert acknowledged', {
      id,
      title: alert.title,
    });

    this.eventBus.emit(
      'alert:acknowledged',
      'system',
      'alert-manager',
      { alertId: id, title: alert.title },
    );
  }

  /** Mark an alert as resolved */
  resolveAlert(id: string): void {
    const alert = this.findAlertById(id);
    if (!alert) {
      this.logger.warn('Cannot resolve alert — not found', { id });
      return;
    }
    if (alert.state === 'resolved') {
      return; // already resolved, no-op
    }

    alert.state = 'resolved';
    alert.resolvedAt = Date.now();

    this.logger.info('Alert resolved', {
      id,
      title: alert.title,
    });

    this.eventBus.emit(
      'alert:resolved',
      'system',
      'alert-manager',
      { alertId: id, title: alert.title },
    );
  }

  // ─── Queries ────────────────────────────────────────────────

  /** Get all unresolved alerts (active + acknowledged) */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter((a) => a.state !== 'resolved');
  }

  /** Get all alerts including resolved, most recent first */
  getAlertHistory(limit?: number): Alert[] {
    const sorted = [...this.alerts].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }

  /** Filter alerts by severity level */
  getAlertsByLevel(level: AlertLevel): Alert[] {
    return this.alerts.filter((a) => a.level === level);
  }

  // ─── Threshold Configuration ────────────────────────────────

  /** Configure a named threshold monitor */
  configureThreshold(name: string, config: ThresholdConfig): void {
    // Remove existing if reconfiguring
    if (this.thresholds.has(name)) {
      this.removeThreshold(name);
    }

    this.thresholds.set(name, config);
    this.logger.info('Threshold configured', {
      name,
      metric: config.metric,
      operator: OPERATOR_LABELS[config.operator],
      threshold: config.threshold,
      checkIntervalMs: config.checkIntervalMs,
    });

    // If monitoring is active, start checking immediately
    if (this.monitoring) {
      this.startThresholdCheck(name, config);
    }
  }

  /** Remove a named threshold monitor */
  removeThreshold(name: string): void {
    this.thresholds.delete(name);
    const timer = this.thresholdTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.thresholdTimers.delete(name);
    }
    this.logger.info('Threshold removed', { name });
  }

  /** Get all configured thresholds */
  getThresholds(): Map<string, ThresholdConfig> {
    return new Map(this.thresholds);
  }

  // ─── Subscriptions ─────────────────────────────────────────

  /**
   * Subscribe to new alerts. Returns an unsubscribe function.
   */
  onAlert(callback: (alert: Alert) => void): () => void {
    const id = uuidv4();
    this.subscribers.set(id, callback);
    return () => {
      this.subscribers.delete(id);
    };
  }

  // ─── Monitoring Lifecycle ───────────────────────────────────

  /** Begin threshold monitoring and auto-resolve timer */
  startMonitoring(): void {
    if (this.monitoring) {
      this.logger.warn('Monitoring already active');
      return;
    }

    this.monitoring = true;

    // Start all threshold checks
    for (const [name, config] of this.thresholds) {
      this.startThresholdCheck(name, config);
    }

    // Start auto-resolve timer for info alerts
    this.autoResolveTimer = setInterval(() => {
      this.autoResolveStaleAlerts();
    }, Math.min(this.config.autoResolveInfoMs, 30_000));

    this.logger.info('Alert monitoring started', {
      thresholdCount: this.thresholds.size,
    });
  }

  /** Stop threshold monitoring and auto-resolve timer */
  stopMonitoring(): void {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;

    // Clear all threshold timers
    for (const [name, timer] of this.thresholdTimers) {
      clearInterval(timer);
      this.thresholdTimers.delete(name);
      this.logger.debug('Threshold timer cleared', { name });
    }

    // Clear auto-resolve timer
    if (this.autoResolveTimer) {
      clearInterval(this.autoResolveTimer);
      this.autoResolveTimer = undefined;
    }

    this.logger.info('Alert monitoring stopped');
  }

  // ─── Cleanup ────────────────────────────────────────────────

  /** Tear down all subscriptions, timers, and listeners */
  destroy(): void {
    this.stopMonitoring();

    // Unsubscribe from event bus
    for (const subId of this.eventSubscriptionIds) {
      this.eventBus.unsubscribe(subId);
    }
    this.eventSubscriptionIds.length = 0;

    // Clear subscribers
    this.subscribers.clear();

    this.logger.info('Alert manager destroyed');
  }

  // ─── Private — Event Bus Listeners ──────────────────────────

  private registerEventListeners(): void {
    // risk:circuit-breaker → critical
    this.subscribeEvent('risk:circuit-breaker', (event) => {
      this.createAlert({
        level: 'critical',
        title: 'Circuit breaker triggered',
        message: 'Circuit breaker triggered — all trading halted',
        category: 'risk',
        agentId: event.source,
        metadata: { ...event.payload },
      });
    });

    // risk:stop-loss → warning
    this.subscribeEvent('risk:stop-loss', (event) => {
      const agentId =
        typeof event.payload['agentId'] === 'string'
          ? event.payload['agentId']
          : event.source;
      this.createAlert({
        level: 'warning',
        title: `Stop-loss triggered for agent ${agentId}`,
        message: `Stop-loss triggered for agent ${agentId}`,
        category: 'risk',
        agentId,
        metadata: { ...event.payload },
      });
    });

    // health:degraded → warning
    this.subscribeEvent('health:degraded', (event) => {
      const reason =
        typeof event.payload['reason'] === 'string'
          ? event.payload['reason']
          : 'unknown';
      this.createAlert({
        level: 'warning',
        title: 'Swarm health degraded',
        message: `Swarm health degraded: ${reason}`,
        category: 'health',
        metadata: { ...event.payload },
      });
    });

    // health:critical → critical
    this.subscribeEvent('health:critical', (event) => {
      const reason =
        typeof event.payload['reason'] === 'string'
          ? event.payload['reason']
          : 'unknown';
      this.createAlert({
        level: 'critical',
        title: 'Swarm health critical',
        message: `Swarm health critical: ${reason}`,
        category: 'health',
        metadata: { ...event.payload },
      });
    });

    // agent:error → warning
    this.subscribeEvent('agent:error', (event) => {
      const agentId =
        typeof event.payload['agentId'] === 'string'
          ? event.payload['agentId']
          : event.source;
      const errorMessage =
        typeof event.payload['message'] === 'string'
          ? event.payload['message']
          : 'unknown error';
      this.createAlert({
        level: 'warning',
        title: `Agent ${agentId} error`,
        message: `Agent ${agentId} encountered error: ${errorMessage}`,
        category: 'agent',
        agentId,
        metadata: { ...event.payload },
      });
    });

    // agent:unresponsive → critical
    this.subscribeEvent('agent:unresponsive', (event) => {
      const agentId =
        typeof event.payload['agentId'] === 'string'
          ? event.payload['agentId']
          : event.source;
      const duration =
        typeof event.payload['duration'] === 'number'
          ? event.payload['duration']
          : 0;
      this.createAlert({
        level: 'critical',
        title: `Agent ${agentId} unresponsive`,
        message: `Agent ${agentId} unresponsive — no heartbeat for ${duration}s`,
        category: 'agent',
        agentId,
        metadata: { ...event.payload },
      });
    });

    // trade:failed → info
    this.subscribeEvent('trade:failed', (event) => {
      const agentId =
        typeof event.payload['agentId'] === 'string'
          ? event.payload['agentId']
          : event.source;
      const reason =
        typeof event.payload['reason'] === 'string'
          ? event.payload['reason']
          : 'unknown reason';
      this.createAlert({
        level: 'info',
        title: `Trade failed for agent ${agentId}`,
        message: `Trade failed for agent ${agentId}: ${reason}`,
        category: 'trading',
        agentId,
        metadata: { ...event.payload },
      });
    });

    this.logger.info('Auto-generated alert rules registered', {
      ruleCount: this.eventSubscriptionIds.length,
    });
  }

  /** Helper to subscribe to event bus and track subscription IDs */
  private subscribeEvent(
    pattern: string,
    handler: (event: { source: string; payload: Record<string, unknown> }) => void,
  ): void {
    const subId = this.eventBus.subscribe(pattern, handler);
    this.eventSubscriptionIds.push(subId);
  }

  // ─── Private — Threshold Monitoring ─────────────────────────

  private startThresholdCheck(
    name: string,
    config: ThresholdConfig,
  ): void {
    const intervalMs = config.checkIntervalMs > 0 ? config.checkIntervalMs : 10_000;
    const check = OPERATOR_FNS[config.operator];

    const timer = setInterval(async () => {
      try {
        const value = await config.getValue();
        const breached = check(value, config.threshold);

        if (breached) {
          const message = config.messageTemplate
            .replace('{value}', String(value))
            .replace('{threshold}', String(config.threshold));

          this.createAlert({
            level: config.level,
            title: `Threshold breached: ${name}`,
            message,
            category: 'system',
            metadata: {
              thresholdName: name,
              metric: config.metric,
              value,
              threshold: config.threshold,
              operator: config.operator,
            },
          });
        }
      } catch (err) {
        this.logger.error(
          `Threshold check failed: ${name}`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }, intervalMs);

    this.thresholdTimers.set(name, timer);
  }

  // ─── Private — Deduplication ────────────────────────────────

  /**
   * Find an active (non-resolved) alert with the same title and category
   * created within the dedup window. Returns the alert ID if found.
   */
  private findDuplicate(
    title: string,
    category: Alert['category'],
  ): string | undefined {
    const cutoff = Date.now() - this.config.dedupWindowMs;

    for (let i = this.alerts.length - 1; i >= 0; i--) {
      const a = this.alerts[i]!;
      // Stop searching once we're past the dedup window
      if (a.createdAt < cutoff) break;

      if (
        a.title === title &&
        a.category === category &&
        a.state !== 'resolved'
      ) {
        return a.id;
      }
    }

    return undefined;
  }

  // ─── Private — Auto-resolve ─────────────────────────────────

  /** Auto-resolve info-level alerts older than autoResolveInfoMs */
  private autoResolveStaleAlerts(): void {
    const cutoff = Date.now() - this.config.autoResolveInfoMs;
    let resolved = 0;

    for (const alert of this.alerts) {
      if (
        alert.level === 'info' &&
        alert.state !== 'resolved' &&
        alert.createdAt < cutoff
      ) {
        alert.state = 'resolved';
        alert.resolvedAt = Date.now();
        resolved++;
      }
    }

    if (resolved > 0) {
      this.logger.debug('Auto-resolved stale info alerts', {
        count: resolved,
      });
    }
  }

  // ─── Private — Capacity Enforcement ─────────────────────────

  /** Remove oldest resolved alerts when capacity is exceeded */
  private enforceMaxAlerts(): void {
    if (this.alerts.length <= this.config.maxAlerts) return;

    // First try to evict resolved alerts (oldest first)
    const toRemove = this.alerts.length - this.config.maxAlerts;
    let removed = 0;

    for (let i = 0; i < this.alerts.length && removed < toRemove; i++) {
      if (this.alerts[i]!.state === 'resolved') {
        this.alerts.splice(i, 1);
        removed++;
        i--; // adjust index after splice
      }
    }

    // If still over capacity, remove oldest regardless of state
    while (this.alerts.length > this.config.maxAlerts) {
      this.alerts.shift();
    }
  }

  // ─── Private — Lookup ───────────────────────────────────────

  private findAlertById(id: string): Alert | undefined {
    return this.alerts.find((a) => a.id === id);
  }
}
