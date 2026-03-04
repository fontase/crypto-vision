/**
 * Dashboard API Routes — REST API endpoints for dashboard data access and swarm control
 *
 * Registers all read (GET) and write (PUT/POST) routes on a Hono app.
 * Read endpoints serve monitoring data; write endpoints control the swarm.
 *
 * All responses wrapped in a consistent { success, data, timestamp, error? } envelope.
 */

import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';

import type { SwarmConfigManager, ConfigUpdateResult } from '../coordination/swarm-config-manager.js';
import type { AuditLogger, AuditFilter, AuditEntry } from '../coordination/audit-logger.js';
import type { AgentMonitor, AgentDetail, AgentSummaryView, AgentHistoryEntry, AgentPerformanceMetrics } from './agent-monitor.js';
import type { PnLDashboard, PnLTimeSeries, PnLSnapshot } from './pnl-dashboard.js';
import type { EventTimeline, EventFilter, TimelineEvent, EventCategory, EventSeverity } from './event-timeline.js';
import type { ExportManager, ExportFormat } from './export-manager.js';

// ─── Interfaces for components from other prompts ─────────────

/**
 * Subset of SwarmOrchestrator (P50) that the API routes rely on.
 * The concrete class lives in `../coordination/swarm-orchestrator`.
 */
export interface SwarmOrchestrator {
  getPhase(): string;
  getStartedAt(): number | null;
  getTokenMint(): string | null;
  getAgentCount(): number;
  getActiveAgentCount(): number;
  getTotalTrades(): number;
  getTotalVolumeSol(): number;
  getCurrentPnl(): number;
  pause(): void;
  resume(): void;
  triggerExit(): void;
  emergencyStop(): void;
}

/**
 * Subset of HealthMonitor (P55) that the API routes rely on.
 * The concrete class lives in `../coordination/health-monitor`.
 */
export interface HealthMonitor {
  getHealthReport(): HealthReport;
}

export interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  agents: Array<{
    id: string;
    type: string;
    status: string;
    lastHeartbeat: number;
    errorCount: number;
  }>;
  metrics: {
    cpuUsage?: number;
    memoryUsage?: number;
    rpcLatency: number;
    eventBusBacklog: number;
  };
  checks: Array<{
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
  }>;
  timestamp: number;
}

/**
 * Subset of TradeVisualizer (P63) that the API routes rely on.
 * The concrete class lives in `./trade-visualizer`.
 */
export interface TradeVisualizer {
  getTradeHistory(options: TradeHistoryOptions): TradeHistoryResult;
  getTradeFlow(): TradeFlowData;
}

export interface TradeHistoryOptions {
  limit: number;
  offset: number;
  agent?: string;
  direction?: 'buy' | 'sell';
}

export interface TradeHistoryResult {
  trades: TradeEntry[];
  total: number;
  hasMore: boolean;
}

export interface TradeEntry {
  id: string;
  timestamp: number;
  agentId: string;
  direction: 'buy' | 'sell';
  solAmount: number;
  tokenAmount: number;
  price: number;
  signature: string;
  success: boolean;
  slippage?: number;
}

export interface TradeFlowData {
  nodes: Array<{ id: string; label: string; type: string }>;
  links: Array<{ source: string; target: string; value: number; count: number }>;
}

/**
 * Subset of SupplyChart (P66) that the API routes rely on.
 * The concrete class lives in `./supply-chart`.
 */
export interface SupplyChart {
  getDistribution(): SupplyDistribution;
}

export interface SupplyDistribution {
  totalSupply: number;
  holders: Array<{
    address: string;
    label: string;
    balance: number;
    percentage: number;
  }>;
  bondingCurveHeld: number;
  updatedAt: number;
}

// ─── API Response Envelope ────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: number;
  error?: string;
}

// ─── Status Response ──────────────────────────────────────────

export interface StatusResponse {
  phase: string;
  uptime: number;
  tokenMint: string | null;
  totalAgents: number;
  activeAgents: number;
  totalTrades: number;
  totalVolumeSol: number;
  currentPnl: number;
  startedAt: number | null;
}

// ─── Agent Summary ────────────────────────────────────────────

export interface AgentSummary {
  id: string;
  type: string;
  status: string;
  walletAddress: string;
  solBalance: number;
  tokenBalance: number;
  pnl: number;
  tradeCount: number;
  lastAction: string | null;
  uptime: number;
}

// ─── Dashboard Context ────────────────────────────────────────

export interface DashboardContext {
  orchestrator: SwarmOrchestrator;
  configManager: SwarmConfigManager;
  auditLogger: AuditLogger;
  healthMonitor: HealthMonitor;
  tradeVisualizer: TradeVisualizer;
  pnlDashboard: PnLDashboard;
  agentMonitor: AgentMonitor;
  supplyChart: SupplyChart;
  eventTimeline: EventTimeline;
  exportManager: ExportManager;
}

// ─── Helpers ──────────────────────────────────────────────────

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, timestamp: Date.now() };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, timestamp: Date.now(), error };
}

function parseIntParam(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Route Registration ───────────────────────────────────────

/**
 * Register all REST API routes on the Hono app.
 *
 * @param app   - Hono application instance
 * @param ctx   - Dashboard context providing access to all subsystems
 */
export function registerApiRoutes(app: Hono, ctx: DashboardContext): void {
  // ── GET /api/status ──────────────────────────────────────────

  app.get('/api/status', (c: HonoContext) => {
    try {
      const startedAt = ctx.orchestrator.getStartedAt();
      const now = Date.now();
      const uptime = startedAt !== null ? (now - startedAt) / 1000 : 0;

      const data: StatusResponse = {
        phase: ctx.orchestrator.getPhase(),
        uptime,
        tokenMint: ctx.orchestrator.getTokenMint(),
        totalAgents: ctx.orchestrator.getAgentCount(),
        activeAgents: ctx.orchestrator.getActiveAgentCount(),
        totalTrades: ctx.orchestrator.getTotalTrades(),
        totalVolumeSol: ctx.orchestrator.getTotalVolumeSol(),
        currentPnl: ctx.orchestrator.getCurrentPnl(),
        startedAt,
      };

      return c.json(ok(data));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/agents ──────────────────────────────────────────

  app.get('/api/agents', (c: HonoContext) => {
    try {
      const agents = ctx.agentMonitor.getAllAgents();

      const summaries: AgentSummary[] = agents.map((a: AgentSummaryView) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        walletAddress: a.walletAddress,
        solBalance: a.solBalance,
        tokenBalance: a.tokenBalance,
        pnl: a.totalPnl,
        tradeCount: a.tradeCount,
        lastAction: a.lastActionAt !== null ? new Date(a.lastActionAt).toISOString() : null,
        uptime: a.lastActionAt !== null ? (Date.now() - a.lastActionAt) / 1000 : 0,
      }));

      return c.json(ok(summaries));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/agents/:id ──────────────────────────────────────

  app.get('/api/agents/:id', (c: HonoContext) => {
    try {
      const id = c.req.param('id');

      const detail: AgentDetail | undefined = ctx.agentMonitor.getAgentDetails(id);
      if (!detail) {
        return c.json(fail(`Agent '${id}' not found`), 404);
      }

      const history: AgentHistoryEntry[] = ctx.agentMonitor.getAgentHistory(id, 100);
      const performance: AgentPerformanceMetrics = ctx.agentMonitor.getAgentPerformance(id);

      return c.json(ok({ detail, history, performance }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/trades ──────────────────────────────────────────

  app.get('/api/trades', (c: HonoContext) => {
    try {
      const limit = clamp(parseIntParam(c.req.query('limit'), 50), 1, 500);
      const offset = parseIntParam(c.req.query('offset'), 0);
      const agent = c.req.query('agent') || undefined;
      const directionRaw = c.req.query('direction');
      const direction = directionRaw === 'buy' || directionRaw === 'sell' ? directionRaw : undefined;

      const result: TradeHistoryResult = ctx.tradeVisualizer.getTradeHistory({
        limit,
        offset,
        agent,
        direction,
      });

      return c.json(ok({
        trades: result.trades,
        total: result.total,
        hasMore: result.hasMore,
        limit,
        offset,
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/trades/flow ─────────────────────────────────────

  app.get('/api/trades/flow', (c: HonoContext) => {
    try {
      const flow: TradeFlowData = ctx.tradeVisualizer.getTradeFlow();
      return c.json(ok(flow));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/pnl ─────────────────────────────────────────────

  app.get('/api/pnl', (c: HonoContext) => {
    try {
      const series: PnLTimeSeries = ctx.pnlDashboard.getAggregatePnL();
      const snapshot: PnLSnapshot = ctx.pnlDashboard.getSnapshot();

      return c.json(ok({
        timeSeries: series,
        current: snapshot,
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/pnl/agents ──────────────────────────────────────

  app.get('/api/pnl/agents', (c: HonoContext) => {
    try {
      const perAgent: Map<string, PnLTimeSeries> = ctx.pnlDashboard.getPerAgentPnL();

      // Convert Map to a JSON-serialisable object
      const breakdown: Record<string, PnLTimeSeries> = {};
      for (const [agentId, series] of perAgent) {
        breakdown[agentId] = series;
      }

      return c.json(ok(breakdown));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/supply ──────────────────────────────────────────

  app.get('/api/supply', (c: HonoContext) => {
    try {
      const distribution: SupplyDistribution = ctx.supplyChart.getDistribution();
      return c.json(ok(distribution));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/config ──────────────────────────────────────────

  app.get('/api/config', (c: HonoContext) => {
    try {
      const config = ctx.configManager.getConfig();
      const schema = ctx.configManager.getConfigSchema();

      return c.json(ok({ config, schema }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/health ──────────────────────────────────────────

  app.get('/api/health', (c: HonoContext) => {
    try {
      const report: HealthReport = ctx.healthMonitor.getHealthReport();

      const httpStatus = report.status === 'healthy' ? 200
        : report.status === 'degraded' ? 200
          : 503;

      return c.json(ok(report), httpStatus);
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/events ──────────────────────────────────────────

  app.get('/api/events', (c: HonoContext) => {
    try {
      const categoryRaw = c.req.query('category');
      const severityRaw = c.req.query('severity');
      const limit = clamp(parseIntParam(c.req.query('limit'), 100), 1, 1000);
      const offset = parseIntParam(c.req.query('offset'), 0);
      const agentId = c.req.query('agent') || undefined;
      const fromRaw = c.req.query('from');
      const toRaw = c.req.query('to');
      const search = c.req.query('search') || undefined;

      const filter: EventFilter = {
        limit,
        offset,
        agentId,
        search,
      };

      if (categoryRaw) {
        filter.categories = categoryRaw.split(',') as EventCategory[];
      }
      if (severityRaw) {
        filter.minSeverity = severityRaw as EventSeverity;
      }
      if (fromRaw) {
        const fromTs = Number(fromRaw);
        if (Number.isFinite(fromTs)) filter.from = fromTs;
      }
      if (toRaw) {
        const toTs = Number(toRaw);
        if (Number.isFinite(toTs)) filter.to = toTs;
      }

      const events: TimelineEvent[] = ctx.eventTimeline.getEvents(filter);
      const totalCount = ctx.eventTimeline.getEventCount();

      return c.json(ok({
        events,
        total: totalCount,
        limit,
        offset,
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/audit ───────────────────────────────────────────

  app.get('/api/audit', (c: HonoContext) => {
    try {
      const typeRaw = c.req.query('type');
      const agentRaw = c.req.query('agent');
      const fromRaw = c.req.query('from');
      const toRaw = c.req.query('to');
      const limitRaw = c.req.query('limit');

      const filter: AuditFilter = {};

      if (typeRaw) {
        filter.category = typeRaw.split(',') as AuditFilter['category'];
      }
      if (agentRaw) {
        filter.agentId = agentRaw;
      }
      if (fromRaw) {
        const fromTs = Number(fromRaw);
        if (Number.isFinite(fromTs)) filter.startTime = fromTs;
      }
      if (toRaw) {
        const toTs = Number(toRaw);
        if (Number.isFinite(toTs)) filter.endTime = toTs;
      }
      if (limitRaw) {
        filter.limit = clamp(parseIntParam(limitRaw, 200), 1, 5000);
      }

      const entries: AuditEntry[] = ctx.auditLogger.getAuditTrail(filter);
      const summary = ctx.auditLogger.getTradeAudit();

      return c.json(ok({
        entries,
        summary,
        count: entries.length,
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── GET /api/export/:format ──────────────────────────────────

  app.get('/api/export/:format', (c: HonoContext) => {
    try {
      const format = c.req.param('format');

      const validFormats: ExportFormat[] = ['json', 'csv', 'markdown', 'full'];
      if (!validFormats.includes(format as ExportFormat)) {
        return c.json(fail(`Invalid export format '${format}'. Valid formats: ${validFormats.join(', ')}`), 400);
      }

      const typedFormat = format as ExportFormat;

      switch (typedFormat) {
        case 'json': {
          const session = ctx.exportManager.exportSession();
          return c.json(ok(session));
        }
        case 'csv': {
          const csv = ctx.exportManager.exportTrades();
          c.header('Content-Type', 'text/csv; charset=utf-8');
          c.header('Content-Disposition', 'attachment; filename="trades.csv"');
          return c.body(csv);
        }
        case 'markdown': {
          const md = ctx.exportManager.exportFullReport();
          c.header('Content-Type', 'text/markdown; charset=utf-8');
          c.header('Content-Disposition', 'attachment; filename="report.md"');
          return c.body(md);
        }
        case 'full': {
          const fullReport = ctx.exportManager.exportSession();
          return c.json(ok(fullReport));
        }
        default: {
          return c.json(fail(`Unsupported export format: ${format as string}`), 400);
        }
      }
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ────────────────────────────────────────────────────────────
  //  Write Endpoints
  // ────────────────────────────────────────────────────────────

  // ── PUT /api/config ──────────────────────────────────────────

  app.put('/api/config', async (c: HonoContext) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return c.json(fail('Request body must be a JSON object'), 400);
      }

      // Validate before applying
      const validationResult = ctx.configManager.validateConfig(
        body as Parameters<SwarmConfigManager['validateConfig']>[0],
      );
      if (!validationResult.valid) {
        return c.json(
          fail(`Validation failed: ${validationResult.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`),
          400,
        );
      }

      const result: ConfigUpdateResult = ctx.configManager.updateConfig(
        body as Parameters<SwarmConfigManager['updateConfig']>[0],
        'api',
      );

      ctx.auditLogger.logAction({
        category: 'system',
        severity: 'info',
        agentId: 'api',
        action: 'config:updated',
        details: `Config updated via API: ${result.applied.join(', ')}`,
        success: result.success,
        metadata: {
          applied: result.applied,
          rejected: result.rejected,
          warnings: result.warnings,
          requiresRestart: result.requiresRestart,
        },
      });

      const updatedConfig = ctx.configManager.getConfig();

      return c.json(ok({
        success: result.success,
        config: updatedConfig,
        changes: result.applied,
        warnings: result.warnings,
        errors: result.errors,
        requiresRestart: result.requiresRestart,
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── POST /api/actions/pause ──────────────────────────────────

  app.post('/api/actions/pause', (c: HonoContext) => {
    try {
      ctx.orchestrator.pause();

      ctx.auditLogger.logAction({
        category: 'system',
        severity: 'warning',
        agentId: 'api',
        action: 'swarm:paused',
        details: 'Swarm trading paused via API',
        success: true,
        metadata: { triggeredBy: 'dashboard' },
      });

      return c.json(ok({
        action: 'pause',
        phase: ctx.orchestrator.getPhase(),
        message: 'Trading paused successfully',
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── POST /api/actions/resume ─────────────────────────────────

  app.post('/api/actions/resume', (c: HonoContext) => {
    try {
      ctx.orchestrator.resume();

      ctx.auditLogger.logAction({
        category: 'system',
        severity: 'info',
        agentId: 'api',
        action: 'swarm:resumed',
        details: 'Swarm trading resumed via API',
        success: true,
        metadata: { triggeredBy: 'dashboard' },
      });

      return c.json(ok({
        action: 'resume',
        phase: ctx.orchestrator.getPhase(),
        message: 'Trading resumed successfully',
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── POST /api/actions/exit ───────────────────────────────────

  app.post('/api/actions/exit', (c: HonoContext) => {
    try {
      ctx.orchestrator.triggerExit();

      ctx.auditLogger.logAction({
        category: 'system',
        severity: 'warning',
        agentId: 'api',
        action: 'swarm:exit-triggered',
        details: 'Exit strategy triggered via API',
        success: true,
        metadata: { triggeredBy: 'dashboard' },
      });

      return c.json(ok({
        action: 'exit',
        phase: ctx.orchestrator.getPhase(),
        message: 'Exit strategy initiated',
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ── POST /api/actions/emergency-stop ─────────────────────────

  app.post('/api/actions/emergency-stop', (c: HonoContext) => {
    try {
      ctx.orchestrator.emergencyStop();

      ctx.auditLogger.logAction({
        category: 'system',
        severity: 'critical',
        agentId: 'api',
        action: 'swarm:emergency-stop',
        details: 'Emergency stop executed via API — all trading halted immediately',
        success: true,
        metadata: { triggeredBy: 'dashboard' },
      });

      return c.json(ok({
        action: 'emergency-stop',
        phase: ctx.orchestrator.getPhase(),
        message: 'Emergency stop executed — all activity halted',
      }));
    } catch (err) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });
}
