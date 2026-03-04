# Prompt 68 — Alert Manager

## Agent Identity & Rules

```
You are the ALERT-MANAGER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real alerts from real events, real threshold monitoring
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add alert manager with auto-generated alerts and threshold monitoring"
```

## Objective

Create `packages/pump-agent-swarm/src/dashboard/alert-manager.ts` — manages alerts for the dashboard, auto-generating alerts from risk events, health degradation, P&L thresholds, agent failures, and unusual trading patterns. Supports acknowledgement and configurable thresholds.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/dashboard/alert-manager.ts`

## Dependencies

- `../infra/event-bus` — SwarmEventBus (P04)
- `../infra/logging` — SwarmLogger (P07)

## Deliverables

### Create `packages/pump-agent-swarm/src/dashboard/alert-manager.ts`

1. **`AlertManager` class**:
   - `constructor(eventBus: SwarmEventBus, config?: AlertConfig)`
   - `createAlert(alert: CreateAlertInput): string` — manually create an alert, returns ID
   - `acknowledgeAlert(id: string): void` — mark alert as acknowledged
   - `resolveAlert(id: string): void` — mark alert as resolved
   - `getActiveAlerts(): Alert[]` — unresolved alerts
   - `getAlertHistory(limit?: number): Alert[]` — all alerts including resolved
   - `getAlertsByLevel(level: AlertLevel): Alert[]` — filter by level
   - `configureThreshold(name: string, config: ThresholdConfig): void` — set up a threshold monitor
   - `removeThreshold(name: string): void`
   - `getThresholds(): Map<string, ThresholdConfig>`
   - `onAlert(callback: (alert: Alert) => void): () => void` — subscribe to new alerts
   - `startMonitoring(): void` — begin threshold monitoring
   - `stopMonitoring(): void`

2. **`Alert` interface**:
   ```typescript
   interface Alert {
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
   ```

3. **`AlertLevel` type**:
   ```typescript
   type AlertLevel = 'info' | 'warning' | 'critical';
   ```

4. **`AlertConfig` interface**:
   ```typescript
   interface AlertConfig {
     /** Maximum alerts to retain (default: 1000) */
     maxAlerts: number;
     /** Auto-resolve info alerts after ms (default: 300000 — 5 min) */
     autoResolveInfoMs: number;
     /** Enable auto-generated alerts from events (default: true) */
     autoGenerate: boolean;
     /** Dedup window — don't create duplicate alerts within ms (default: 60000) */
     dedupWindowMs: number;
   }
   ```

5. **`ThresholdConfig` interface**:
   ```typescript
   interface ThresholdConfig {
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
   ```

6. **`CreateAlertInput` interface**:
   ```typescript
   interface CreateAlertInput {
     level: AlertLevel;
     title: string;
     message: string;
     category: Alert['category'];
     agentId?: string;
     metadata?: Record<string, unknown>;
     autoResolveCondition?: string;
   }
   ```

7. **Auto-generated alert rules** (subscribe to event bus):
   - `risk:circuit-breaker` → critical alert: "Circuit breaker triggered — all trading halted"
   - `risk:stop-loss` → warning alert: "Stop-loss triggered for agent {id}"
   - `health:degraded` → warning alert: "Swarm health degraded: {reason}"
   - `health:critical` → critical alert: "Swarm health critical: {reason}"
   - `agent:error` → warning alert: "Agent {id} encountered error: {message}"
   - `agent:unresponsive` → critical alert: "Agent {id} unresponsive — no heartbeat for {duration}s"
   - `trade:failed` → info alert: "Trade failed for agent {id}: {reason}"
   - Deduplication: don't create the same alert (same title + category) within `dedupWindowMs`

### Success Criteria

- Alerts auto-generated from event bus events
- Threshold monitoring creates alerts when conditions breached
- Alert lifecycle (active → acknowledged → resolved) works correctly
- Deduplication prevents alert spam
- Auto-resolve cleans up stale info alerts
- Compiles with `npx tsc --noEmit`
