/**
 * Agent Monitor — Per-agent status, performance metrics, and historical data
 *
 * Tracks every registered agent's state in real time via event bus subscriptions.
 * Provides summary views for dashboard cards and full detail views for agent pages.
 * Computes performance metrics (win rate, Sharpe ratio, profit factor, etc.) on demand
 * from actual trade history — no mocks, no stubs.
 */

import type { SwarmEventBus } from '../infra/event-bus.js';
import type { SwarmEvent } from '../types.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Interfaces ───────────────────────────────────────────────

export interface AgentRegistration {
  id: string;
  type:
    | 'creator'
    | 'trader'
    | 'market-maker'
    | 'volume'
    | 'accumulator'
    | 'exit'
    | 'sentinel'
    | 'sniper'
    | 'scanner'
    | 'narrative';
  walletAddress: string;
  startedAt: number;
  config: Record<string, unknown>;
}

export interface AgentAction {
  timestamp: number;
  type: 'trade' | 'signal' | 'decision' | 'error' | 'heartbeat' | 'phase-change';
  description: string;
  details: Record<string, unknown>;
  success: boolean;
}

export interface AgentDetail {
  id: string;
  type: string;
  status: 'active' | 'idle' | 'paused' | 'error' | 'stopped';
  walletAddress: string;
  solBalance: number;
  tokenBalance: number;
  pnl: {
    realized: number;
    unrealized: number;
    total: number;
  };
  tradeCount: number;
  successfulTrades: number;
  failedTrades: number;
  totalVolumeTraded: number;
  lastAction: AgentAction | null;
  lastHeartbeat: number;
  startedAt: number;
  uptime: number;
  errorCount: number;
  currentTask: string | null;
  config: Record<string, unknown>;
}

export interface AgentSummaryView {
  id: string;
  type: string;
  status: string;
  walletAddress: string;
  solBalance: number;
  tokenBalance: number;
  totalPnl: number;
  tradeCount: number;
  lastActionAt: number | null;
}

export interface AgentHistoryEntry {
  timestamp: number;
  action: AgentAction;
  solBalance: number;
  tokenBalance: number;
  pnl: number;
}

export interface AgentPerformanceMetrics {
  winRate: number;
  averagePnlPerTrade: number;
  bestTrade: number;
  worstTrade: number;
  averageTradeSize: number;
  tradesPerMinute: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

// ─── Internal State ───────────────────────────────────────────

/** Mutable internal state for a tracked agent. */
interface AgentState {
  registration: AgentRegistration;
  status: 'active' | 'idle' | 'paused' | 'error' | 'stopped';
  solBalance: number;
  tokenBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  successfulTrades: number;
  failedTrades: number;
  totalVolumeTraded: number;
  lastAction: AgentAction | null;
  lastHeartbeat: number;
  errorCount: number;
  currentTask: string | null;
  /** Per-trade PnL values for performance calculations */
  tradePnls: number[];
  /** Per-trade sizes (SOL volumes) for average trade size */
  tradeSizes: number[];
}

// ─── Circular Buffer ──────────────────────────────────────────

const MAX_HISTORY_PER_AGENT = 500;

/**
 * Ring buffer that evicts the oldest item once capacity is reached.
 * O(1) push, O(n) retrieval — no GC pressure from array shifts.
 */
class HistoryBuffer {
  private readonly buffer: Array<AgentHistoryEntry | undefined>;
  private head = 0;
  private _size = 0;

  constructor(private readonly capacity: number = MAX_HISTORY_PER_AGENT) {
    this.buffer = new Array<AgentHistoryEntry | undefined>(capacity);
  }

  get size(): number {
    return this._size;
  }

  push(entry: AgentHistoryEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) {
      this._size++;
    }
  }

  /** Return entries oldest → newest, optionally limited to the last `n`. */
  toArray(limit?: number): AgentHistoryEntry[] {
    if (this._size === 0) return [];

    const start = this._size < this.capacity ? 0 : this.head;
    const result: AgentHistoryEntry[] = [];

    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this.capacity;
      result.push(this.buffer[idx] as AgentHistoryEntry);
    }

    if (limit !== undefined && limit > 0 && limit < result.length) {
      return result.slice(result.length - limit);
    }
    return result;
  }
}

// ─── Constants ────────────────────────────────────────────────

/** How long without a heartbeat before an agent is considered idle (ms). */
const IDLE_TIMEOUT_MS = 60_000;
/** How long without a heartbeat before an agent is considered in error (ms). */
const ERROR_TIMEOUT_MS = 300_000;

// ─── AgentMonitor ─────────────────────────────────────────────

export class AgentMonitor {
  private readonly agents = new Map<string, AgentState>();
  private readonly histories = new Map<string, HistoryBuffer>();
  private readonly subscriptionIds: string[] = [];
  private readonly logger: SwarmLogger;

  constructor(private readonly eventBus: SwarmEventBus) {
    this.logger = SwarmLogger.create('agent-monitor', 'dashboard');
    this.subscribeToEvents();
    this.logger.info('AgentMonitor initialized');
  }

  // ─── Public API ───────────────────────────────────────────

  /** Register a new agent for monitoring. */
  registerAgent(agent: AgentRegistration): void {
    if (this.agents.has(agent.id)) {
      this.logger.warn(`Agent ${agent.id} already registered, updating registration`);
    }

    const now = Date.now();
    this.agents.set(agent.id, {
      registration: agent,
      status: 'active',
      solBalance: 0,
      tokenBalance: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      tradeCount: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalVolumeTraded: 0,
      lastAction: null,
      lastHeartbeat: now,
      errorCount: 0,
      currentTask: null,
      tradePnls: [],
      tradeSizes: [],
    });

    if (!this.histories.has(agent.id)) {
      this.histories.set(agent.id, new HistoryBuffer());
    }

    this.logger.info(`Registered agent ${agent.id} (${agent.type})`);
  }

  /** Remove an agent from monitoring. */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.histories.delete(agentId);
    this.logger.info(`Unregistered agent ${agentId}`);
  }

  /** Get full detail for a single agent. */
  getAgentDetails(id: string): AgentDetail | undefined {
    const state = this.agents.get(id);
    if (!state) return undefined;

    const now = Date.now();
    const effectiveStatus = this.resolveStatus(state, now);
    const totalPnl = state.realizedPnl + state.unrealizedPnl;

    return {
      id: state.registration.id,
      type: state.registration.type,
      status: effectiveStatus,
      walletAddress: state.registration.walletAddress,
      solBalance: state.solBalance,
      tokenBalance: state.tokenBalance,
      pnl: {
        realized: state.realizedPnl,
        unrealized: state.unrealizedPnl,
        total: totalPnl,
      },
      tradeCount: state.tradeCount,
      successfulTrades: state.successfulTrades,
      failedTrades: state.failedTrades,
      totalVolumeTraded: state.totalVolumeTraded,
      lastAction: state.lastAction,
      lastHeartbeat: state.lastHeartbeat,
      startedAt: state.registration.startedAt,
      uptime: now - state.registration.startedAt,
      errorCount: state.errorCount,
      currentTask: state.currentTask,
      config: state.registration.config,
    };
  }

  /** Get summary list of all monitored agents. */
  getAllAgents(): AgentSummaryView[] {
    const now = Date.now();
    const summaries: AgentSummaryView[] = [];

    for (const state of this.agents.values()) {
      const effectiveStatus = this.resolveStatus(state, now);
      summaries.push({
        id: state.registration.id,
        type: state.registration.type,
        status: effectiveStatus,
        walletAddress: state.registration.walletAddress,
        solBalance: state.solBalance,
        tokenBalance: state.tokenBalance,
        totalPnl: state.realizedPnl + state.unrealizedPnl,
        tradeCount: state.tradeCount,
        lastActionAt: state.lastAction?.timestamp ?? null,
      });
    }

    return summaries;
  }

  /** Get action history for an agent, most recent last. */
  getAgentHistory(id: string, limit?: number): AgentHistoryEntry[] {
    const history = this.histories.get(id);
    if (!history) return [];
    return history.toArray(limit);
  }

  /** Compute performance metrics on-demand from trade history. */
  getAgentPerformance(id: string): AgentPerformanceMetrics {
    const state = this.agents.get(id);
    if (!state || state.tradePnls.length === 0) {
      return {
        winRate: 0,
        averagePnlPerTrade: 0,
        bestTrade: 0,
        worstTrade: 0,
        averageTradeSize: 0,
        tradesPerMinute: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
      };
    }

    const pnls = state.tradePnls;
    const sizes = state.tradeSizes;
    const totalTrades = pnls.length;

    // Win rate
    const wins = pnls.filter((p) => p > 0).length;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;

    // Average PnL per trade
    const totalPnl = pnls.reduce((sum, p) => sum + p, 0);
    const averagePnlPerTrade = totalPnl / totalTrades;

    // Best / worst trade
    const bestTrade = Math.max(...pnls);
    const worstTrade = Math.min(...pnls);

    // Average trade size
    const totalSize = sizes.reduce((sum, s) => sum + s, 0);
    const averageTradeSize = sizes.length > 0 ? totalSize / sizes.length : 0;

    // Trades per minute
    const uptimeMs = Date.now() - (state.registration.startedAt || Date.now());
    const uptimeMinutes = Math.max(uptimeMs / 60_000, 1);
    const tradesPerMinute = totalTrades / uptimeMinutes;

    // Profit factor = gross profit / gross loss
    const grossProfit = pnls.filter((p) => p > 0).reduce((sum, p) => sum + p, 0);
    const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((sum, p) => sum + p, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Max drawdown (peak-to-trough)
    const maxDrawdown = this.computeMaxDrawdown(pnls);

    // Sharpe ratio approximation = mean(returns) / stddev(returns)
    const sharpeRatio = this.computeSharpeRatio(pnls);

    return {
      winRate,
      averagePnlPerTrade,
      bestTrade,
      worstTrade,
      averageTradeSize,
      tradesPerMinute,
      profitFactor,
      maxDrawdown,
      sharpeRatio,
    };
  }

  /** Update cached balances for an agent. */
  updateBalance(agentId: string, sol: number, tokens: number): void {
    const state = this.agents.get(agentId);
    if (!state) {
      this.logger.warn(`updateBalance: unknown agent ${agentId}`);
      return;
    }
    state.solBalance = sol;
    state.tokenBalance = tokens;
  }

  /** Record an action for an agent, snapshot into history. */
  recordAction(agentId: string, action: AgentAction): void {
    const state = this.agents.get(agentId);
    if (!state) {
      this.logger.warn(`recordAction: unknown agent ${agentId}`);
      return;
    }

    state.lastAction = action;

    if (action.type === 'heartbeat') {
      state.lastHeartbeat = action.timestamp;
    }

    if (action.type === 'error') {
      state.errorCount++;
    }

    if (action.type === 'trade') {
      state.tradeCount++;
      if (action.success) {
        state.successfulTrades++;
      } else {
        state.failedTrades++;
      }

      const pnl = typeof action.details['pnl'] === 'number' ? action.details['pnl'] : 0;
      const volume = typeof action.details['volume'] === 'number' ? action.details['volume'] : 0;

      state.realizedPnl += pnl;
      state.totalVolumeTraded += volume;
      state.tradePnls.push(pnl);
      state.tradeSizes.push(volume);
    }

    // Snapshot to history buffer
    const history = this.histories.get(agentId);
    if (history) {
      history.push({
        timestamp: action.timestamp,
        action,
        solBalance: state.solBalance,
        tokenBalance: state.tokenBalance,
        pnl: state.realizedPnl + state.unrealizedPnl,
      });
    }
  }

  // ─── Event Bus Integration ────────────────────────────────

  private subscribeToEvents(): void {
    const sub = (pattern: string, handler: (event: SwarmEvent) => void): void => {
      const id = this.eventBus.subscribe(pattern, handler);
      this.subscriptionIds.push(id);
    };

    sub('agent:heartbeat', (event) => this.handleHeartbeat(event));
    sub('trade:executed', (event) => this.handleTradeExecuted(event));
    sub('agent:error', (event) => this.handleAgentError(event));
    sub('agent:started', (event) => this.handleAgentStarted(event));
    sub('agent:stopped', (event) => this.handleAgentStopped(event));
  }

  private handleHeartbeat(event: SwarmEvent): void {
    const agentId = this.extractAgentId(event);
    if (!agentId) return;

    const state = this.agents.get(agentId);
    if (!state) return;

    state.lastHeartbeat = event.timestamp;
    state.status = 'active';

    const task = event.payload?.['currentTask'];
    if (typeof task === 'string') {
      state.currentTask = task;
    }

    this.recordAction(agentId, {
      timestamp: event.timestamp,
      type: 'heartbeat',
      description: 'Agent heartbeat received',
      details: event.payload ?? {},
      success: true,
    });
  }

  private handleTradeExecuted(event: SwarmEvent): void {
    const agentId = this.extractAgentId(event);
    if (!agentId) return;

    const payload = event.payload ?? {};
    const success = payload['success'] === true;
    const pnl = typeof payload['pnl'] === 'number' ? payload['pnl'] : 0;
    const volume = typeof payload['volume'] === 'number' ? payload['volume'] : 0;
    const direction = typeof payload['direction'] === 'string' ? payload['direction'] : 'unknown';
    const mint = typeof payload['mint'] === 'string' ? payload['mint'] : 'unknown';

    this.recordAction(agentId, {
      timestamp: event.timestamp,
      type: 'trade',
      description: `${direction} trade on ${mint}`,
      details: { pnl, volume, direction, mint, ...payload },
      success,
    });
  }

  private handleAgentError(event: SwarmEvent): void {
    const agentId = this.extractAgentId(event);
    if (!agentId) return;

    const state = this.agents.get(agentId);
    if (state) {
      state.status = 'error';
    }

    const errorMessage =
      typeof event.payload?.['message'] === 'string'
        ? event.payload['message']
        : 'Unknown error';

    this.recordAction(agentId, {
      timestamp: event.timestamp,
      type: 'error',
      description: errorMessage,
      details: event.payload ?? {},
      success: false,
    });
  }

  private handleAgentStarted(event: SwarmEvent): void {
    const agentId = this.extractAgentId(event);
    if (!agentId) return;

    const state = this.agents.get(agentId);
    if (state) {
      state.status = 'active';
      state.lastHeartbeat = event.timestamp;
    }

    this.recordAction(agentId, {
      timestamp: event.timestamp,
      type: 'phase-change',
      description: 'Agent started',
      details: event.payload ?? {},
      success: true,
    });
  }

  private handleAgentStopped(event: SwarmEvent): void {
    const agentId = this.extractAgentId(event);
    if (!agentId) return;

    const state = this.agents.get(agentId);
    if (state) {
      state.status = 'stopped';
      state.currentTask = null;
    }

    this.recordAction(agentId, {
      timestamp: event.timestamp,
      type: 'phase-change',
      description: 'Agent stopped',
      details: event.payload ?? {},
      success: true,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────

  /** Extract agent ID from an event payload. */
  private extractAgentId(event: SwarmEvent): string | null {
    const id = event.payload?.['agentId'] ?? event.source;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  /**
   * Resolve effective status: downgrade active → idle → error
   * if heartbeats have stopped arriving.
   */
  private resolveStatus(state: AgentState, now: number): AgentDetail['status'] {
    if (state.status === 'stopped' || state.status === 'paused') {
      return state.status;
    }

    const elapsed = now - state.lastHeartbeat;
    if (elapsed > ERROR_TIMEOUT_MS) return 'error';
    if (elapsed > IDLE_TIMEOUT_MS) return 'idle';
    return state.status;
  }

  /** Compute max peak-to-trough drawdown from a series of per-trade PnLs. */
  private computeMaxDrawdown(pnls: number[]): number {
    if (pnls.length === 0) return 0;

    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;

    for (const pnl of pnls) {
      cumulative += pnl;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /** Sharpe ratio approximation: mean(returns) / stddev(returns). */
  private computeSharpeRatio(pnls: number[]): number {
    if (pnls.length < 2) return 0;

    const n = pnls.length;
    const mean = pnls.reduce((sum, p) => sum + p, 0) / n;
    const variance = pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / (n - 1);
    const stddev = Math.sqrt(variance);

    if (stddev === 0) return 0;
    return mean / stddev;
  }
}
