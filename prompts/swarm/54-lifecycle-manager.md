# Prompt 54 — Lifecycle Manager

## Agent Identity & Rules

```
You are the LIFECYCLE-MANAGER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real agent lifecycle with heartbeat monitoring
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add agent lifecycle manager with heartbeat monitoring and auto-restart"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/lifecycle-manager.ts` — manages agent spawning, heartbeat monitoring, failure detection, and automatic restart with backoff.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/lifecycle-manager.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/lifecycle-manager.ts`

1. **`LifecycleManager` class**:
   - `constructor(eventBus: SwarmEventBus, config?: LifecycleConfig)`
   - `spawnAgent(type: string, config: Record<string, unknown>): Promise<AgentInstance>`
   - `killAgent(agentId: string, graceful?: boolean): Promise<void>`
   - `restartAgent(agentId: string): Promise<AgentInstance>`
   - `getAgentStatus(agentId: string): AgentStatus`
   - `getAllAgents(): AgentInstance[]`
   - `getHealthyAgents(): AgentInstance[]`
   - `getUnhealthyAgents(): AgentInstance[]`
   - `startHeartbeatMonitoring(): void`
   - `stopHeartbeatMonitoring(): void`
   - `registerAgentFactory(type: string, factory: AgentFactory): void`
   - `handleHeartbeat(agentId: string): void`
   - `destroy(): Promise<void>`

2. **LifecycleConfig**:
   ```typescript
   interface LifecycleConfig {
     /** Expected heartbeat interval (ms) */
     heartbeatInterval: number;      // default: 5000
     /** Mark unhealthy after this many missed heartbeats */
     unhealthyThreshold: number;     // default: 3
     /** Mark dead after this many missed heartbeats */
     deadThreshold: number;          // default: 6
     /** Auto-restart dead agents? */
     autoRestart: boolean;           // default: true
     /** Max restart attempts before giving up */
     maxRestarts: number;            // default: 3
     /** Restart backoff base (ms) — doubles each attempt */
     restartBackoffBase: number;     // default: 1000
     /** Max restart backoff (ms) */
     maxRestartBackoff: number;      // default: 30000
     /** Graceful shutdown timeout (ms) */
     gracefulShutdownTimeout: number; // default: 10000
   }
   ```

3. **AgentInstance**:
   ```typescript
   interface AgentInstance {
     id: string;
     type: string;
     status: AgentHealthStatus;
     config: Record<string, unknown>;
     startedAt: number;
     lastHeartbeat: number;
     missedHeartbeats: number;
     restartCount: number;
     lastRestartAt?: number;
     uptime: number;
     errorCount: number;
     lastError?: string;
     /** Reference to the actual agent object */
     ref: unknown;
   }

   type AgentHealthStatus = 'starting' | 'healthy' | 'degraded' | 'unresponsive' | 'dead' | 'stopping' | 'stopped';
   ```

4. **AgentFactory** (for creating agent instances):
   ```typescript
   type AgentFactory = (config: Record<string, unknown>) => Promise<{
     instance: unknown;
     start: () => Promise<void>;
     stop: () => Promise<void>;
   }>;
   ```
   - Register a factory per agent type (e.g., 'trader', 'market-maker', 'sentinel')
   - Factory returns the agent instance plus start/stop functions
   - LifecycleManager calls factory to create, then `start()` to run

5. **Heartbeat monitoring loop**:
   ```typescript
   // Runs every heartbeatInterval:
   // For each registered agent:
   //   1. Check time since last heartbeat
   //   2. If > heartbeatInterval → increment missedHeartbeats
   //   3. If missedHeartbeats >= unhealthyThreshold → status = 'degraded'
   //   4. If missedHeartbeats >= deadThreshold → status = 'dead'
   //   5. If dead & autoRestart & restartCount < maxRestarts → restart
   //   6. Emit status change events
   //
   // Agents call handleHeartbeat(id) to reset their counter
   // Heartbeats should be emitted via event bus: 'agent:heartbeat'
   ```

6. **Restart with backoff**:
   ```typescript
   // Backoff = min(restartBackoffBase * 2^restartCount, maxRestartBackoff)
   // Wait(backoff) → kill agent → create new via factory → start → register
   // If restart succeeds → reset missedHeartbeats, keep restartCount
   // If restart fails → increment restartCount, try again if under limit
   // If over maxRestarts → mark as 'dead', emit 'agent:permanently-dead'
   ```

7. **Graceful shutdown**:
   ```typescript
   // killAgent(id, graceful=true):
   // 1. Set status to 'stopping'
   // 2. Call agent's stop() function
   // 3. Wait up to gracefulShutdownTimeout for stop to complete
   // 4. If timeout, force-kill (set status to 'stopped')
   // 5. Remove from active agent list
   ```

8. **Events emitted**:
   ```typescript
   // 'agent:spawned' — new agent created and started
   // 'agent:healthy' — agent heartbeat received, status healthy
   // 'agent:degraded' — missed heartbeats, may be in trouble
   // 'agent:unresponsive' — not responding, restart pending
   // 'agent:dead' — no heartbeat, exceeded threshold
   // 'agent:restarting' — restart attempt in progress
   // 'agent:restarted' — successful restart
   // 'agent:permanently-dead' — exceeded max restarts, giving up
   // 'agent:stopped' — cleanly stopped
   ```

### Success Criteria

- Agent spawning via factory pattern works for any agent type
- Heartbeat monitoring correctly tracks healthy/degraded/dead transitions
- Auto-restart with exponential backoff works within configured limits
- Graceful shutdown attempts clean stop before force-kill
- Status transitions are accurate and event-driven
- `destroy()` cleanly stops all agents and monitoring
- Compiles with `npx tsc --noEmit`
