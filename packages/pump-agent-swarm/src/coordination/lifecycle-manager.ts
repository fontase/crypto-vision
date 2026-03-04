/**
 * Agent Lifecycle Manager — Spawning, heartbeat monitoring, failure detection & auto-restart
 *
 * Features:
 * - Factory-based agent spawning for any agent type
 * - Heartbeat monitoring with configurable thresholds
 * - Health status transitions: starting → healthy → degraded → unresponsive → dead
 * - Automatic restart with exponential backoff
 * - Graceful shutdown with configurable timeout
 * - Full event-driven status reporting via SwarmEventBus
 */

import { v4 as uuidv4 } from 'uuid';

import { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Types ────────────────────────────────────────────────────

export type AgentHealthStatus =
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'unresponsive'
  | 'dead'
  | 'stopping'
  | 'stopped';

export interface AgentInstance {
  /** Unique agent instance ID */
  id: string;
  /** Agent type (e.g., 'trader', 'market-maker', 'sentinel') */
  type: string;
  /** Current health status */
  status: AgentHealthStatus;
  /** Config used to spawn this agent */
  config: Record<string, unknown>;
  /** Epoch ms when the agent was started */
  startedAt: number;
  /** Epoch ms of last heartbeat received */
  lastHeartbeat: number;
  /** Number of consecutive missed heartbeats */
  missedHeartbeats: number;
  /** Total restart attempts since creation */
  restartCount: number;
  /** Epoch ms of the last restart */
  lastRestartAt?: number;
  /** Uptime in ms (computed dynamically) */
  uptime: number;
  /** Total error count recorded for this agent */
  errorCount: number;
  /** Last error message */
  lastError?: string;
  /** Reference to the actual agent object */
  ref: unknown;
}

/**
 * Factory function that creates an agent of a given type.
 * Returns the agent instance plus lifecycle hooks.
 */
export type AgentFactory = (config: Record<string, unknown>) => Promise<{
  instance: unknown;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export interface LifecycleConfig {
  /** Expected heartbeat interval in ms */
  heartbeatInterval: number;
  /** Mark degraded after this many missed heartbeats */
  unhealthyThreshold: number;
  /** Mark dead after this many missed heartbeats */
  deadThreshold: number;
  /** Automatically restart dead agents */
  autoRestart: boolean;
  /** Max restart attempts before permanently marking dead */
  maxRestarts: number;
  /** Base delay for exponential restart backoff in ms */
  restartBackoffBase: number;
  /** Maximum restart backoff delay in ms */
  maxRestartBackoff: number;
  /** Timeout for graceful shutdown before force-kill in ms */
  gracefulShutdownTimeout: number;
}

// ─── Internal Types ───────────────────────────────────────────

interface ManagedAgent {
  id: string;
  type: string;
  status: AgentHealthStatus;
  config: Record<string, unknown>;
  startedAt: number;
  lastHeartbeat: number;
  missedHeartbeats: number;
  restartCount: number;
  lastRestartAt?: number;
  errorCount: number;
  lastError?: string;
  ref: unknown;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

// ─── Defaults ─────────────────────────────────────────────────

const DEFAULT_CONFIG: LifecycleConfig = {
  heartbeatInterval: 5_000,
  unhealthyThreshold: 3,
  deadThreshold: 6,
  autoRestart: true,
  maxRestarts: 3,
  restartBackoffBase: 1_000,
  maxRestartBackoff: 30_000,
  gracefulShutdownTimeout: 10_000,
};

// ─── LifecycleManager ─────────────────────────────────────────

export class LifecycleManager {
  private readonly eventBus: SwarmEventBus;
  private readonly config: LifecycleConfig;
  private readonly logger: SwarmLogger;
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly factories = new Map<string, AgentFactory>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private destroyed = false;
  private readonly restartLocks = new Set<string>();
  private heartbeatUnsubId: string | undefined;

  constructor(eventBus: SwarmEventBus, config?: Partial<LifecycleConfig>) {
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = SwarmLogger.create('lifecycle-manager', 'coordination');

    // Listen for heartbeat events emitted by agents on the event bus
    const sub = this.eventBus.subscribe('agent:heartbeat', (event) => {
      const agentId = event.payload['agentId'];
      if (typeof agentId === 'string') {
        this.handleHeartbeat(agentId);
      }
    });
    this.heartbeatUnsubId = sub;

    this.logger.info('LifecycleManager created', {
      heartbeatInterval: this.config.heartbeatInterval,
      unhealthyThreshold: this.config.unhealthyThreshold,
      deadThreshold: this.config.deadThreshold,
      autoRestart: this.config.autoRestart,
      maxRestarts: this.config.maxRestarts,
    });
  }

  // ─── Factory Registration ─────────────────────────────────

  /**
   * Register a factory function for a given agent type.
   * The factory is invoked each time an agent of that type is spawned.
   */
  registerAgentFactory(type: string, factory: AgentFactory): void {
    if (this.factories.has(type)) {
      this.logger.warn(`Overwriting existing factory for agent type "${type}"`);
    }
    this.factories.set(type, factory);
    this.logger.info(`Registered factory for agent type "${type}"`);
  }

  // ─── Spawn ────────────────────────────────────────────────

  /**
   * Spawn a new agent of the given type with the provided config.
   * Uses the registered factory to create and start the agent.
   */
  async spawnAgent(type: string, config: Record<string, unknown>): Promise<AgentInstance> {
    if (this.destroyed) {
      throw new Error('LifecycleManager has been destroyed');
    }

    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`No factory registered for agent type "${type}". Register one via registerAgentFactory()`);
    }

    const agentId = `${type}-${uuidv4().slice(0, 8)}`;
    const now = Date.now();

    this.logger.info(`Spawning agent "${agentId}" (type: ${type})`);

    const { instance, start, stop } = await factory(config);

    const managed: ManagedAgent = {
      id: agentId,
      type,
      status: 'starting',
      config,
      startedAt: now,
      lastHeartbeat: now,
      missedHeartbeats: 0,
      restartCount: 0,
      errorCount: 0,
      ref: instance,
      start,
      stop,
    };

    this.agents.set(agentId, managed);

    try {
      await start();
      managed.status = 'healthy';
      managed.lastHeartbeat = Date.now();

      this.emitEvent('agent:spawned', agentId, {
        type,
        config,
      });

      this.emitEvent('agent:healthy', agentId, {
        type,
      });

      this.logger.info(`Agent "${agentId}" spawned and started successfully`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      managed.status = 'dead';
      managed.errorCount++;
      managed.lastError = errorMessage;

      this.emitEvent('agent:dead', agentId, {
        type,
        error: errorMessage,
      });

      this.logger.error(`Agent "${agentId}" failed to start: ${errorMessage}`);
      throw new Error(`Failed to start agent "${agentId}": ${errorMessage}`);
    }

    return this.toAgentInstance(managed);
  }

  // ─── Kill ─────────────────────────────────────────────────

  /**
   * Kill an agent instance. By default uses graceful shutdown.
   *
   * Graceful: sets status to 'stopping', calls stop(), waits up to
   * gracefulShutdownTimeout, then force-stops if not done.
   *
   * Non-graceful: immediately marks as stopped without calling stop().
   */
  async killAgent(agentId: string, graceful = true): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    if (agent.status === 'stopped' || agent.status === 'stopping') {
      this.logger.warn(`Agent "${agentId}" is already ${agent.status}`);
      return;
    }

    this.logger.info(`Killing agent "${agentId}" (graceful: ${graceful})`);

    if (graceful) {
      agent.status = 'stopping';

      const stopPromise = agent.stop().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error during graceful stop of "${agentId}": ${msg}`);
        agent.errorCount++;
        agent.lastError = msg;
      });

      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), this.config.gracefulShutdownTimeout);
      });

      const result = await Promise.race([
        stopPromise.then(() => 'stopped' as const),
        timeoutPromise,
      ]);

      if (result === 'timeout') {
        this.logger.warn(`Graceful shutdown of "${agentId}" timed out after ${this.config.gracefulShutdownTimeout}ms, force-killing`);
      }
    }

    agent.status = 'stopped';
    this.agents.delete(agentId);

    this.emitEvent('agent:stopped', agentId, {
      type: agent.type,
      uptime: Date.now() - agent.startedAt,
    });

    this.logger.info(`Agent "${agentId}" stopped`);
  }

  // ─── Restart ──────────────────────────────────────────────

  /**
   * Restart an agent: kill it, then re-spawn using the same factory and config.
   * Applies exponential backoff between restart attempts.
   */
  async restartAgent(agentId: string): Promise<AgentInstance> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    if (this.restartLocks.has(agentId)) {
      throw new Error(`Agent "${agentId}" is already restarting`);
    }

    return this.performRestart(agent);
  }

  // ─── Status Queries ───────────────────────────────────────

  /** Get the current status of a specific agent */
  getAgentStatus(agentId: string): AgentHealthStatus {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    return agent.status;
  }

  /** Get all managed agent instances */
  getAllAgents(): AgentInstance[] {
    return [...this.agents.values()].map((a) => this.toAgentInstance(a));
  }

  /** Get only agents with 'healthy' status */
  getHealthyAgents(): AgentInstance[] {
    return [...this.agents.values()]
      .filter((a) => a.status === 'healthy')
      .map((a) => this.toAgentInstance(a));
  }

  /** Get agents that are not healthy (degraded, unresponsive, dead, starting) */
  getUnhealthyAgents(): AgentInstance[] {
    return [...this.agents.values()]
      .filter((a) => a.status !== 'healthy' && a.status !== 'stopped')
      .map((a) => this.toAgentInstance(a));
  }

  // ─── Heartbeat ────────────────────────────────────────────

  /** Start the periodic heartbeat monitoring loop */
  startHeartbeatMonitoring(): void {
    if (this.heartbeatTimer) {
      this.logger.warn('Heartbeat monitoring is already running');
      return;
    }

    this.logger.info('Starting heartbeat monitoring', {
      interval: this.config.heartbeatInterval,
    });

    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.config.heartbeatInterval);
  }

  /** Stop the periodic heartbeat monitoring loop */
  stopHeartbeatMonitoring(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.logger.info('Stopped heartbeat monitoring');
  }

  /**
   * Handle a heartbeat from an agent. Resets missed heartbeat counter
   * and transitions status back to healthy if it was degraded/unresponsive.
   */
  handleHeartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn(`Heartbeat received for unknown agent "${agentId}"`);
      return;
    }

    if (agent.status === 'stopping' || agent.status === 'stopped') {
      return;
    }

    const previousStatus = agent.status;
    agent.lastHeartbeat = Date.now();
    agent.missedHeartbeats = 0;

    if (previousStatus !== 'healthy' && previousStatus !== 'starting') {
      agent.status = 'healthy';
      this.emitEvent('agent:healthy', agentId, {
        type: agent.type,
        previousStatus,
      });
      this.logger.info(`Agent "${agentId}" recovered to healthy (was ${previousStatus})`);
    }
  }

  // ─── Destroy ──────────────────────────────────────────────

  /**
   * Cleanly shut down the lifecycle manager:
   * stops monitoring, gracefully kills all agents, clears state.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.logger.info('Destroying LifecycleManager...');

    // Stop heartbeat monitoring
    this.stopHeartbeatMonitoring();

    // Unsubscribe from event bus heartbeat events
    if (this.heartbeatUnsubId) {
      this.eventBus.unsubscribe(this.heartbeatUnsubId);
      this.heartbeatUnsubId = undefined;
    }

    // Gracefully stop all agents in parallel
    const killPromises = [...this.agents.keys()].map((id) =>
      this.killAgent(id, true).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error killing agent "${id}" during destroy: ${msg}`);
      }),
    );

    await Promise.all(killPromises);

    this.agents.clear();
    this.factories.clear();
    this.restartLocks.clear();

    this.logger.info('LifecycleManager destroyed');
  }

  // ─── Private: Heartbeat Check ─────────────────────────────

  private checkHeartbeats(): void {
    const now = Date.now();

    for (const agent of this.agents.values()) {
      // Skip agents that are not in a monitorable state
      if (
        agent.status === 'starting' ||
        agent.status === 'stopping' ||
        agent.status === 'stopped'
      ) {
        continue;
      }

      const elapsed = now - agent.lastHeartbeat;
      const expectedBeats = Math.floor(elapsed / this.config.heartbeatInterval);
      const previousStatus = agent.status;

      if (expectedBeats > 0 && expectedBeats > agent.missedHeartbeats) {
        agent.missedHeartbeats = expectedBeats;
      }

      if (agent.missedHeartbeats >= this.config.deadThreshold) {
        if (agent.status !== 'dead') {
          agent.status = 'dead';
          this.emitEvent('agent:dead', agent.id, {
            type: agent.type,
            missedHeartbeats: agent.missedHeartbeats,
            lastHeartbeat: agent.lastHeartbeat,
          });
          this.logger.error(
            `Agent "${agent.id}" is DEAD (${agent.missedHeartbeats} missed heartbeats)`,
          );

          // Auto-restart if enabled and under limit
          if (
            this.config.autoRestart &&
            agent.restartCount < this.config.maxRestarts &&
            !this.restartLocks.has(agent.id)
          ) {
            this.scheduleRestart(agent);
          } else if (agent.restartCount >= this.config.maxRestarts) {
            this.emitEvent('agent:permanently-dead', agent.id, {
              type: agent.type,
              restartCount: agent.restartCount,
              maxRestarts: this.config.maxRestarts,
            });
            this.logger.error(
              `Agent "${agent.id}" is permanently dead after ${agent.restartCount} restart attempts`,
            );
          }
        }
      } else if (agent.missedHeartbeats >= this.config.unhealthyThreshold) {
        if (previousStatus !== 'unresponsive') {
          agent.status = 'unresponsive';
          this.emitEvent('agent:unresponsive', agent.id, {
            type: agent.type,
            missedHeartbeats: agent.missedHeartbeats,
          });
          this.logger.warn(
            `Agent "${agent.id}" is unresponsive (${agent.missedHeartbeats} missed heartbeats)`,
          );
        }
      } else if (agent.missedHeartbeats > 0) {
        if (previousStatus !== 'degraded' && previousStatus !== 'dead') {
          agent.status = 'degraded';
          this.emitEvent('agent:degraded', agent.id, {
            type: agent.type,
            missedHeartbeats: agent.missedHeartbeats,
          });
          this.logger.warn(
            `Agent "${agent.id}" is degraded (${agent.missedHeartbeats} missed heartbeats)`,
          );
        }
      }
    }
  }

  // ─── Private: Restart Logic ───────────────────────────────

  /**
   * Schedule a restart with exponential backoff.
   * Does not block — fires asynchronously.
   */
  private scheduleRestart(agent: ManagedAgent): void {
    if (this.restartLocks.has(agent.id)) {
      return;
    }

    const backoff = Math.min(
      this.config.restartBackoffBase * Math.pow(2, agent.restartCount),
      this.config.maxRestartBackoff,
    );

    this.logger.info(
      `Scheduling restart of "${agent.id}" in ${backoff}ms (attempt ${agent.restartCount + 1}/${this.config.maxRestarts})`,
    );

    this.emitEvent('agent:restarting', agent.id, {
      type: agent.type,
      attempt: agent.restartCount + 1,
      maxAttempts: this.config.maxRestarts,
      backoffMs: backoff,
    });

    this.restartLocks.add(agent.id);

    setTimeout(() => {
      if (this.destroyed) {
        this.restartLocks.delete(agent.id);
        return;
      }

      this.performRestart(agent).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Scheduled restart of "${agent.id}" failed: ${msg}`);
      });
    }, backoff);
  }

  /**
   * Perform the actual restart sequence:
   * 1. Kill agent gracefully
   * 2. Re-create via factory with original config
   * 3. Start the new agent
   * 4. Replace in the agents map under the same ID
   */
  private async performRestart(agent: ManagedAgent): Promise<AgentInstance> {
    const agentId = agent.id;
    const { type, config } = agent;

    this.restartLocks.add(agentId);

    try {
      // Kill the existing agent
      if (agent.status !== 'stopped') {
        await this.killAgentInternal(agent);
      }

      const factory = this.factories.get(type);
      if (!factory) {
        throw new Error(`No factory for type "${type}" — cannot restart`);
      }

      // Create a new instance
      const { instance, start, stop } = await factory(config);
      const now = Date.now();

      const restarted: ManagedAgent = {
        id: agentId,
        type,
        status: 'starting',
        config,
        startedAt: now,
        lastHeartbeat: now,
        missedHeartbeats: 0,
        restartCount: agent.restartCount + 1,
        lastRestartAt: now,
        errorCount: agent.errorCount,
        lastError: agent.lastError,
        ref: instance,
        start,
        stop,
      };

      this.agents.set(agentId, restarted);

      await start();
      restarted.status = 'healthy';
      restarted.lastHeartbeat = Date.now();

      this.emitEvent('agent:restarted', agentId, {
        type,
        restartCount: restarted.restartCount,
      });

      this.logger.info(
        `Agent "${agentId}" restarted successfully (attempt ${restarted.restartCount}/${this.config.maxRestarts})`,
      );

      return this.toAgentInstance(restarted);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      agent.restartCount++;
      agent.errorCount++;
      agent.lastError = errorMessage;

      this.logger.error(`Restart of "${agentId}" failed: ${errorMessage}`);

      if (agent.restartCount >= this.config.maxRestarts) {
        agent.status = 'dead';
        this.agents.set(agentId, agent);

        this.emitEvent('agent:permanently-dead', agentId, {
          type,
          restartCount: agent.restartCount,
          maxRestarts: this.config.maxRestarts,
          lastError: errorMessage,
        });

        this.logger.error(
          `Agent "${agentId}" permanently dead after ${agent.restartCount} failed restart attempts`,
        );
      }

      throw new Error(`Restart of "${agentId}" failed: ${errorMessage}`);
    } finally {
      this.restartLocks.delete(agentId);
    }
  }

  /**
   * Internal kill that doesn't remove from the map or emit stopped event.
   * Used during restart to avoid losing the agent entry.
   */
  private async killAgentInternal(agent: ManagedAgent): Promise<void> {
    agent.status = 'stopping';

    const stopPromise = agent.stop().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error during internal stop of "${agent.id}": ${msg}`);
      agent.errorCount++;
      agent.lastError = msg;
    });

    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), this.config.gracefulShutdownTimeout);
    });

    const result = await Promise.race([
      stopPromise.then(() => 'stopped' as const),
      timeoutPromise,
    ]);

    if (result === 'timeout') {
      this.logger.warn(
        `Internal graceful shutdown of "${agent.id}" timed out, force-killing`,
      );
    }

    agent.status = 'stopped';
  }

  // ─── Private: Helpers ─────────────────────────────────────

  /** Convert internal ManagedAgent to the public AgentInstance shape */
  private toAgentInstance(agent: ManagedAgent): AgentInstance {
    return {
      id: agent.id,
      type: agent.type,
      status: agent.status,
      config: agent.config,
      startedAt: agent.startedAt,
      lastHeartbeat: agent.lastHeartbeat,
      missedHeartbeats: agent.missedHeartbeats,
      restartCount: agent.restartCount,
      lastRestartAt: agent.lastRestartAt,
      uptime: Date.now() - agent.startedAt,
      errorCount: agent.errorCount,
      lastError: agent.lastError,
      ref: agent.ref,
    };
  }

  /** Emit a lifecycle event on the SwarmEventBus */
  private emitEvent(
    type: string,
    agentId: string,
    payload: Record<string, unknown>,
  ): void {
    this.eventBus.emit(type, 'lifecycle', agentId, {
      agentId,
      ...payload,
      timestamp: Date.now(),
    });
  }
}
