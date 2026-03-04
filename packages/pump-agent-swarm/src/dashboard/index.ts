/**
 * Dashboard — barrel exports
 */

// Dashboard Server
export { DashboardServer, createDashboardServer } from './server.js';
export type { DashboardServerConfig } from './server.js';

// WebSocket
export { DashboardWebSocket } from './websocket.js';
export type {
  IWebSocket,
  DashboardEventType,
  DashboardEvent,
  ClientInfo,
  WebSocketConfig,
} from './websocket.js';

// API Routes
export { registerApiRoutes } from './api-routes.js';
export type {
  SwarmOrchestrator as ApiSwarmOrchestrator,
  HealthMonitor as ApiHealthMonitor,
  HealthReport as ApiHealthReport,
  TradeVisualizer as ApiTradeVisualizer,
  TradeHistoryOptions,
  TradeHistoryResult,
  TradeEntry,
  TradeFlowData as ApiTradeFlowData,
  SupplyChart as ApiSupplyChart,
  SupplyDistribution as ApiSupplyDistribution,
  ApiResponse,
  StatusResponse,
  AgentSummary,
  DashboardContext,
} from './api-routes.js';

// Trade Visualizer
export { TradeVisualizer } from './trade-visualizer.js';
export type {
  TradeRecord as VisualizerTradeRecord,
  TimeRange,
  TradeFlowNode,
  TradeFlowLink,
  TradeFlowData,
  AgentInteractionMatrix,
  TradeTimelineEntry,
  PriceChartData,
  VolumeChartData,
  TradeStatistics,
  TradeVisualizerConfig,
} from './trade-visualizer.js';

// Agent Monitor
export { AgentMonitor } from './agent-monitor.js';
export type {
  AgentRegistration,
  AgentAction,
  AgentDetail,
  AgentSummaryView,
  AgentHistoryEntry,
  AgentPerformanceMetrics,
} from './agent-monitor.js';

// P&L Dashboard
export { PnLDashboard } from './pnl-dashboard.js';
export type {
  PnLConfig,
  PnLTrade,
  PnLDataPoint as DashboardPnLDataPoint,
  PnLTimeSeries,
  PnLSnapshot as DashboardPnLSnapshot,
} from './pnl-dashboard.js';

// Supply Chart
export { SupplyChart } from './supply-chart.js';
export type {
  SwarmWalletInfo,
  SupplyHolder,
  SupplyDistribution,
  ConcentrationMetrics,
} from './supply-chart.js';

// Event Timeline
export { EventTimeline } from './event-timeline.js';
export type {
  EventCategory,
  EventSeverity,
  TimelineEvent,
  TimelineConfig,
  EventFilter,
} from './event-timeline.js';

// Alert Manager
export { AlertManager } from './alert-manager.js';
export type {
  AlertLevel,
  Alert,
  AlertConfig,
  ThresholdConfig,
  CreateAlertInput,
} from './alert-manager.js';

// Export Manager
export { ExportManager } from './export-manager.js';
export type {
  TradeVisualizerAdapter,
  PnLDashboardAdapter,
  TradeRecord as ExportTradeRecord,
  PnLSnapshot as ExportPnLSnapshot,
  ExportContext,
  SessionExport,
  ExportFormat,
} from './export-manager.js';
