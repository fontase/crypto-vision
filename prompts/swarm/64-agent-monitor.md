# Prompt 64 — Agent Monitor

## Agent Identity & Rules

```
You are the AGENT-MONITOR builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real agent data, real performance tracking
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add per-agent monitor with performance tracking and history"
```

## Objective

Create `packages/pump-agent-swarm/src/dashboard/agent-monitor.ts` — tracks per-agent status, performance metrics, and historical data for the dashboard to display agent cards and detail views.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/dashboard/agent-monitor.ts`

## Dependencies

- `../infra/event-bus` — SwarmEventBus (P04)
- `../types` — AgentWallet, TradeResult (P01)
- `../infra/logging` — SwarmLogger (P07)

## Deliverables

### Create `packages/pump-agent-swarm/src/dashboard/agent-monitor.ts`

1. **`AgentMonitor` class**:
   - `constructor(eventBus: SwarmEventBus)`
   - `registerAgent(agent: AgentRegistration): void` — register an agent for monitoring
   - `unregisterAgent(agentId: string): void` — remove agent from monitoring
   - `getAgentDetails(id: string): AgentDetail | undefined` — full detail for one agent
   - `getAllAgents(): AgentSummaryView[]` — summary list of all agents
   - `getAgentHistory(id: string, limit?: number): AgentHistoryEntry[]` — action history
   - `getAgentPerformance(id: string): AgentPerformanceMetrics` — performance stats
   - `updateBalance(agentId: string, sol: number, tokens: number): void` — update cached balances
   - `recordAction(agentId: string, action: AgentAction): void` — record an agent action

2. **`AgentRegistration` interface**:
   ```typescript
   interface AgentRegistration {
     id: string;
     type: 'creator' | 'trader' | 'market-maker' | 'volume' | 'accumulator' | 'exit' | 'sentinel' | 'sniper' | 'scanner' | 'narrative';
     walletAddress: string;
     startedAt: number;
     config: Record<string, unknown>;
   }
   ```

3. **`AgentDetail` interface**:
   ```typescript
   interface AgentDetail {
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
   ```

4. **`AgentSummaryView` interface**:
   ```typescript
   interface AgentSummaryView {
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
   ```

5. **`AgentAction` interface**:
   ```typescript
   interface AgentAction {
     timestamp: number;
     type: 'trade' | 'signal' | 'decision' | 'error' | 'heartbeat' | 'phase-change';
     description: string;
     details: Record<string, unknown>;
     success: boolean;
   }
   ```

6. **`AgentHistoryEntry` interface**:
   ```typescript
   interface AgentHistoryEntry {
     timestamp: number;
     action: AgentAction;
     solBalance: number;
     tokenBalance: number;
     pnl: number;
   }
   ```

7. **`AgentPerformanceMetrics` interface**:
   ```typescript
   interface AgentPerformanceMetrics {
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
   ```

8. **Core behavior**:
   - Auto-subscribe to event bus: `agent:heartbeat`, `trade:executed`, `agent:error`, `agent:started`, `agent:stopped`
   - Keep action history per agent (circular buffer, max 500 entries per agent)
   - Compute performance metrics on-demand from trade history
   - Profit factor = gross profit / gross loss
   - Sharpe ratio approximation = mean(returns) / stddev(returns) over trade returns

### Success Criteria

- Agents registered and tracked with real-time status updates
- Agent detail view includes all trading metrics
- Performance metrics calculated from actual trade data
- History entries include balance snapshots at each action
- Event bus integration auto-updates agent state
- Compiles with `npx tsc --noEmit`
