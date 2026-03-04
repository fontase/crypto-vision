# Prompt 53 — Task Delegator

## Agent Identity & Rules

```
You are the TASK-DELEGATOR builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real task queue with dependency resolution
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add task delegator with priority queue and dependency tracking"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/task-delegator.ts` — manages task delegation to agents with a priority queue, dependency tracking, agent capacity management, and completion callbacks.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/task-delegator.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/task-delegator.ts`

1. **`TaskDelegator` class**:
   - `constructor(eventBus: SwarmEventBus)`
   - `createTask(task: Omit<SwarmTask, 'id' | 'status' | 'createdAt'>): string` — create and queue task
   - `assignTask(taskId: string, agentId: string): void` — assign to specific agent
   - `autoAssign(taskId: string): string | null` — find best available agent
   - `startTask(taskId: string): void` — mark as in-progress
   - `completeTask(taskId: string, result: TaskResult): void` — mark completed
   - `failTask(taskId: string, error: string): void` — mark failed
   - `cancelTask(taskId: string, reason: string): void` — cancel
   - `retryTask(taskId: string): void` — retry a failed task
   - `getTasks(filter?: TaskFilter): SwarmTask[]` — query tasks
   - `getTask(taskId: string): SwarmTask | undefined` — single task
   - `getAgentTasks(agentId: string): SwarmTask[]` — tasks for an agent
   - `getQueueDepth(): number` — pending tasks count
   - `registerAgent(agentId: string, capabilities: AgentCapabilities): void`
   - `unregisterAgent(agentId: string): void`

2. **SwarmTask**:
   ```typescript
   interface SwarmTask {
     id: string;
     type: SwarmTaskType;
     title: string;
     description: string;
     priority: 'critical' | 'high' | 'normal' | 'low';
     status: 'created' | 'queued' | 'assigned' | 'in-progress' | 'completed' | 'failed' | 'cancelled';
     assignedTo?: string;
     parameters: Record<string, unknown>;
     dependencies: string[];         // Task IDs that must complete first
     result?: TaskResult;
     error?: string;
     createdAt: number;
     assignedAt?: number;
     startedAt?: number;
     completedAt?: number;
     deadline?: number;
     maxRetries: number;
     retryCount: number;
     tags: string[];
   }

   type SwarmTaskType =
     | 'launch-token'
     | 'buy-supply'
     | 'start-trading'
     | 'stop-trading'
     | 'monitor-curve'
     | 'generate-narrative'
     | 'scan-opportunities'
     | 'execute-exit'
     | 'fund-wallets'
     | 'reclaim-funds'
     | 'evaluate-token'
     | 'generate-signals'
     | 'custom';
   ```

3. **TaskResult**:
   ```typescript
   interface TaskResult {
     success: boolean;
     data?: Record<string, unknown>;
     metrics?: {
       duration: number;
       retries: number;
       resourcesUsed?: Record<string, number>;
     };
     nextActions?: string[];          // Suggested follow-up task types
   }
   ```

4. **TaskFilter**:
   ```typescript
   interface TaskFilter {
     status?: SwarmTask['status'][];
     type?: SwarmTaskType[];
     assignedTo?: string;
     priority?: SwarmTask['priority'][];
     createdAfter?: number;
     createdBefore?: number;
     tags?: string[];
   }
   ```

5. **AgentCapabilities**:
   ```typescript
   interface AgentCapabilities {
     agentId: string;
     agentType: string;
     supportedTaskTypes: SwarmTaskType[];
     maxConcurrentTasks: number;
     currentLoad: number;            // Current active tasks
     available: boolean;
   }
   ```

6. **Dependency resolution**:
   - Tasks can list dependencies (other task IDs)
   - A task cannot start until ALL dependencies are in 'completed' status
   - If a dependency fails, dependent tasks are automatically cancelled
   - Circular dependency detection on task creation (throw error)
   - Emit warning if dependency chain is longer than 5 levels

7. **Auto-assignment logic**:
   - Find agents whose `supportedTaskTypes` includes the task type
   - Among eligible agents, prefer: lowest `currentLoad`, then highest priority match
   - If no agent is available (all at capacity), task stays in 'queued' status
   - When an agent completes a task, check queue for pending tasks to auto-assign
   - Emit `task:waiting-for-agent` if no capacity available

8. **Events emitted**:
   ```typescript
   // 'task:created' — new task added
   // 'task:assigned' — task assigned to agent
   // 'task:started' — task execution began
   // 'task:completed' — task finished successfully
   // 'task:failed' — task failed with error
   // 'task:cancelled' — task cancelled
   // 'task:deadline-exceeded' — task past deadline
   ```

### Success Criteria

- Priority queue orders tasks correctly
- Dependency resolution prevents premature execution
- Circular dependency detection works
- Auto-assignment respects agent capabilities and capacity
- Task lifecycle (create → assign → start → complete/fail) works correctly
- Events are emitted at each state transition
- Failed task retry maintains retry count
- Compiles with `npx tsc --noEmit`
