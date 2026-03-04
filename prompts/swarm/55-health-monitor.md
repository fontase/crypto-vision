# Prompt 55 — Health Monitor

## Agent Identity & Rules

```
You are the HEALTH-MONITOR builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real health checks against real infrastructure
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add swarm health monitor with component-level health checks"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/health-monitor.ts` — aggregates health information from all swarm components: agents, RPC pool, wallets, event bus, and external dependencies. Provides a dashboard-ready health report.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/health-monitor.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/health-monitor.ts`

1. **`HealthMonitor` class**:
   - `constructor(eventBus: SwarmEventBus, config?: HealthMonitorConfig)`
   - `getHealthReport(): Promise<HealthReport>` — comprehensive health check
   - `isHealthy(): boolean` — quick boolean check
   - `startMonitoring(intervalMs: number): void` — periodic health checks
   - `stopMonitoring(): void`
   - `registerHealthCheck(name: string, check: HealthCheckFn): void` — add custom check
   - `onHealthChange(callback: (report: HealthReport) => void): () => void`
   - `getHistory(): HealthReport[]` — historical reports

2. **HealthMonitorConfig**:
   ```typescript
   interface HealthMonitorConfig {
     /** Default monitoring interval (ms) */
     defaultInterval: number;        // default: 30000
     /** Max history entries to keep */
     maxHistory: number;             // default: 100
     /** Thresholds for degraded/critical */
     thresholds: {
       /** Min healthy agents ratio (0-1) */
       minHealthyAgents: number;     // default: 0.7
       /** Max event bus lag (ms) */
       maxEventBusLag: number;       // default: 5000
       /** Min wallet balance (SOL) to consider "funded" */
       minWalletBalance: number;     // default: 0.001
       /** Max consecutive health check failures */
       maxConsecutiveFailures: number; // default: 3
     };
   }
   ```

3. **HealthReport**:
   ```typescript
   interface HealthReport {
     overall: HealthStatus;
     uptime: number;
     timestamp: number;
     components: {
       agents: ComponentHealth;
       rpc: ComponentHealth;
       wallets: ComponentHealth;
       eventBus: ComponentHealth;
       external: ComponentHealth;
     };
     issues: HealthIssue[];
     metrics: {
       agentCount: { total: number; healthy: number; degraded: number; dead: number };
       memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
       eventBusBacklog: number;
       lastTradeAge: number;          // ms since last trade
       errorRate: number;             // errors per minute
     };
   }

   type HealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';

   interface ComponentHealth {
     status: HealthStatus;
     message: string;
     lastCheck: number;
     details: Record<string, unknown>;
   }

   interface HealthIssue {
     component: string;
     severity: 'warning' | 'critical';
     message: string;
     since: number;
     suggestion: string;
   }
   ```

4. **HealthCheckFn**:
   ```typescript
   type HealthCheckFn = () => Promise<ComponentHealth>;
   ```

5. **Built-in health checks**:
   - **Agents**: query LifecycleManager for agent statuses, compute healthy ratio
   - **RPC**: check if connection.getSlot() responds within 5s
   - **Wallets**: check master wallet balance, verify trader wallets exist
   - **Event bus**: measure time from emit to delivery (inject test event)
   - **Memory**: check process.memoryUsage() against thresholds
   - **External**: verify Pump.fun API reachable (HEAD request)

6. **Status determination**:
   ```typescript
   // Overall status logic:
   // If ANY component is 'critical' → overall = 'critical'
   // If >1 component is 'degraded' → overall = 'degraded'
   // If 1 component is 'degraded' → overall = 'degraded'
   // Otherwise → 'healthy'
   ```

7. **Event emissions**:
   ```typescript
   // 'health:report' — every monitoring cycle
   // 'health:degraded' — when status changes to degraded
   // 'health:critical' — when status changes to critical
   // 'health:recovered' — when status returns to healthy
   ```

### Success Criteria

- Health report accurately reflects component states
- Custom health checks can be registered dynamically
- Monitoring fires at configured interval
- Status transitions emit appropriate events
- History is maintained for trend analysis
- Memory metrics use real `process.memoryUsage()`
- Compiles with `npx tsc --noEmit`
