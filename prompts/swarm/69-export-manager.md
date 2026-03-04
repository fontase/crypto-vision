# Prompt 69 — Export Manager

## Agent Identity & Rules

```
You are the EXPORT-MANAGER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real data export, real file generation, real formatting
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add session data export manager with JSON, CSV, and Markdown output"
```

## Objective

Create `packages/pump-agent-swarm/src/dashboard/export-manager.ts` — exports all session data (trades, events, P&L, audit trail, agent metrics) in multiple formats for post-mortem analysis and record keeping.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/dashboard/export-manager.ts`

## Dependencies

- `./trade-visualizer` — TradeVisualizer (P63)
- `./pnl-dashboard` — PnLDashboard (P65)
- `./agent-monitor` — AgentMonitor (P64)
- `./event-timeline` — EventTimeline (P67)
- `../coordination/audit-logger` — AuditLogger (P58)

## Deliverables

### Create `packages/pump-agent-swarm/src/dashboard/export-manager.ts`

1. **`ExportManager` class**:
   - `constructor(context: ExportContext)`
   - `exportSession(): SessionExport` — full session data as structured object
   - `exportTrades(): string` — CSV format of all trades
   - `exportAudit(): string` — JSON format of audit trail
   - `exportPnL(): string` — CSV format of P&L time series
   - `exportAgentMetrics(): string` — CSV format of per-agent performance
   - `exportEvents(): string` — JSON format of event timeline
   - `exportFullReport(): string` — comprehensive Markdown report
   - `exportToFile(format: ExportFormat, outputPath: string): Promise<void>` — write to disk

2. **`ExportContext` interface**:
   ```typescript
   interface ExportContext {
     tradeVisualizer: TradeVisualizer;
     pnlDashboard: PnLDashboard;
     agentMonitor: AgentMonitor;
     eventTimeline: EventTimeline;
     auditLogger: AuditLogger;
     sessionId: string;
     startedAt: number;
   }
   ```

3. **`SessionExport` interface**:
   ```typescript
   interface SessionExport {
     /** Export metadata */
     meta: {
       sessionId: string;
       exportedAt: number;
       startedAt: number;
       duration: number;
       version: string;
     };
     /** Summary statistics */
     summary: {
       totalTrades: number;
       successfulTrades: number;
       totalVolumeSol: number;
       finalPnl: number;
       roi: number;
       maxDrawdown: number;
       agentCount: number;
       phaseHistory: string[];
     };
     /** All trade records */
     trades: Array<{
       id: string;
       timestamp: number;
       agentId: string;
       direction: string;
       solAmount: number;
       tokenAmount: number;
       price: number;
       signature: string;
       success: boolean;
     }>;
     /** P&L time series */
     pnl: Array<{
       timestamp: number;
       realized: number;
       unrealized: number;
       total: number;
     }>;
     /** Agent performance summary */
     agents: Array<{
       id: string;
       type: string;
       tradeCount: number;
       pnl: number;
       winRate: number;
       volumeTraded: number;
     }>;
     /** Audit trail */
     audit: Array<{
       timestamp: number;
       type: string;
       agentId: string;
       action: string;
       details: Record<string, unknown>;
     }>;
     /** Key events */
     events: Array<{
       timestamp: number;
       category: string;
       severity: string;
       title: string;
       description: string;
     }>;
   }
   ```

4. **`ExportFormat` type**:
   ```typescript
   type ExportFormat = 'json' | 'csv' | 'markdown' | 'full';
   ```

5. **CSV generation**:
   - Trades CSV columns: `timestamp,agent_id,direction,sol_amount,token_amount,price,slippage,signature,success`
   - P&L CSV columns: `timestamp,realized,unrealized,total,roi`
   - Agent CSV columns: `agent_id,type,trade_count,pnl,win_rate,volume_traded,best_trade,worst_trade`
   - Proper CSV escaping for strings with commas/quotes

6. **Markdown report generation**:
   ```markdown
   # Swarm Session Report
   
   ## Session Info
   - **Session ID**: {id}
   - **Duration**: {duration}
   - **Started**: {date}
   
   ## Summary
   | Metric | Value |
   |--------|-------|
   | Total Trades | {n} |
   | Volume | {sol} SOL |
   | P&L | {pnl} SOL |
   | ROI | {roi}% |
   | Max Drawdown | {dd}% |
   
   ## Agent Performance
   | Agent | Type | Trades | P&L | Win Rate |
   ...
   
   ## Key Events
   - {timestamp}: {event}
   ...
   
   ## Trade Log
   | Time | Agent | Direction | SOL | Tokens | Price |
   ...
   ```

### Success Criteria

- JSON export contains all session data in structured format
- CSV exports are valid CSV with proper escaping
- Markdown report is human-readable with formatted tables
- File export writes to disk successfully
- All data sources queried correctly from context components
- Compiles with `npx tsc --noEmit`
