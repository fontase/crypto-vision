/**
 * Task Delegator — Priority queue task delegation with dependency resolution
 *
 * Features:
 * - Priority-ordered task queue (critical > high > normal > low)
 * - Dependency tracking — tasks block until all dependencies complete
 * - Circular dependency detection on task creation
 * - Agent capacity management and auto-assignment
 * - Full task lifecycle: create → assign → start → complete/fail/cancel
 * - Retry support with configurable max retries
 * - Deadline tracking with exceeded warnings
 * - Event emission at every state transition
 */

import { v4 as uuidv4 } from 'uuid';

import { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Types ────────────────────────────────────────────────────

export type SwarmTaskType =
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

export type TaskStatus =
  | 'created'
  | 'queued'
  | 'assigned'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export interface SwarmTask {
  id: string;
  type: SwarmTaskType;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo?: string;
  parameters: Record<string, unknown>;
  /** Task IDs that must complete first */
  dependencies: string[];
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

export interface TaskResult {
  success: boolean;
  data?: Record<string, unknown>;
  metrics?: {
    duration: number;
    retries: number;
    resourcesUsed?: Record<string, number>;
  };
  /** Suggested follow-up task types */
  nextActions?: string[];
}

export interface TaskFilter {
  status?: TaskStatus[];
  type?: SwarmTaskType[];
  assignedTo?: string;
  priority?: TaskPriority[];
  createdAfter?: number;
  createdBefore?: number;
  tags?: string[];
}

export interface AgentCapabilities {
  agentId: string;
  agentType: string;
  supportedTaskTypes: SwarmTaskType[];
  maxConcurrentTasks: number;
  /** Current active tasks count */
  currentLoad: number;
  available: boolean;
}

// ─── Constants ────────────────────────────────────────────────

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const MAX_DEPENDENCY_DEPTH = 5;

// ─── TaskDelegator ────────────────────────────────────────────

/**
 * Manages task delegation with priority-based scheduling, dependency
 * resolution, agent capacity tracking, and lifecycle events.
 *
 * ```typescript
 * const delegator = new TaskDelegator(eventBus);
 * delegator.registerAgent('trader-0', {
 *   agentId: 'trader-0',
 *   agentType: 'trader',
 *   supportedTaskTypes: ['start-trading', 'stop-trading'],
 *   maxConcurrentTasks: 3,
 *   currentLoad: 0,
 *   available: true,
 * });
 * const taskId = delegator.createTask({
 *   type: 'start-trading',
 *   title: 'Begin trading SOL/USDC',
 *   description: 'Start automated trading on the SOL/USDC pair',
 *   priority: 'high',
 *   parameters: { pair: 'SOL/USDC' },
 *   dependencies: [],
 *   maxRetries: 3,
 *   tags: ['trading'],
 * });
 * delegator.autoAssign(taskId);
 * ```
 */
export class TaskDelegator {
  private readonly tasks = new Map<string, SwarmTask>();
  private readonly agents = new Map<string, AgentCapabilities>();
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;
  private deadlineTimer: ReturnType<typeof setInterval> | undefined;

  constructor(eventBus: SwarmEventBus) {
    this.eventBus = eventBus;
    this.logger = SwarmLogger.create('task-delegator', 'coordination');
    this.startDeadlineMonitor();
  }

  // ── Task Creation ─────────────────────────────────────────

  /**
   * Create and queue a new task.
   * Validates dependencies exist and detects circular chains.
   * Returns the generated task ID.
   */
  createTask(
    task: Omit<SwarmTask, 'id' | 'status' | 'createdAt'>,
  ): string {
    const id = uuidv4();
    const now = Date.now();

    // Validate dependencies exist
    for (const depId of task.dependencies) {
      if (!this.tasks.has(depId)) {
        throw new Error(
          `Dependency task '${depId}' does not exist — cannot create task '${task.title}'`,
        );
      }
    }

    // Build temporary task for cycle detection
    const newTask: SwarmTask = {
      ...task,
      id,
      status: 'created',
      createdAt: now,
      retryCount: task.retryCount ?? 0,
      maxRetries: task.maxRetries ?? 0,
      tags: task.tags ?? [],
      dependencies: task.dependencies ?? [],
      parameters: task.parameters ?? {},
    };

    // Detect circular dependencies before inserting
    this.detectCircularDependencies(newTask);

    // Check dependency depth and warn if too deep
    const depth = this.measureDependencyDepth(newTask, 0);
    if (depth > MAX_DEPENDENCY_DEPTH) {
      this.logger.warn(
        `Dependency chain for task '${newTask.title}' is ${depth} levels deep (threshold: ${MAX_DEPENDENCY_DEPTH})`,
        { taskId: id, depth },
      );
    }

    // Determine initial status based on dependency readiness
    newTask.status = this.areDependenciesMet(newTask) ? 'queued' : 'created';

    this.tasks.set(id, newTask);

    this.logger.info(`Task created: ${newTask.title}`, {
      taskId: id,
      type: newTask.type,
      priority: newTask.priority,
      status: newTask.status,
      dependencies: newTask.dependencies.length,
    });

    this.eventBus.emit(
      'task:created',
      'coordination',
      'task-delegator',
      { taskId: id, task: this.serializeTask(newTask) },
    );

    return id;
  }

  // ── Assignment ────────────────────────────────────────────

  /** Assign a task to a specific agent. */
  assignTask(taskId: string, agentId: string): void {
    const task = this.requireTask(taskId);
    const agent = this.requireAgent(agentId);

    if (task.status !== 'queued') {
      throw new Error(
        `Cannot assign task '${taskId}' — current status is '${task.status}', expected 'queued'`,
      );
    }

    if (!this.areDependenciesMet(task)) {
      throw new Error(
        `Cannot assign task '${taskId}' — unresolved dependencies: ${this.unresolvedDependencies(task).join(', ')}`,
      );
    }

    if (!agent.supportedTaskTypes.includes(task.type)) {
      throw new Error(
        `Agent '${agentId}' does not support task type '${task.type}'`,
      );
    }

    if (agent.currentLoad >= agent.maxConcurrentTasks) {
      throw new Error(
        `Agent '${agentId}' is at capacity (${agent.currentLoad}/${agent.maxConcurrentTasks})`,
      );
    }

    task.status = 'assigned';
    task.assignedTo = agentId;
    task.assignedAt = Date.now();
    agent.currentLoad++;

    this.logger.info(`Task assigned: ${task.title} → ${agentId}`, {
      taskId,
      agentId,
    });

    this.eventBus.emit(
      'task:assigned',
      'coordination',
      'task-delegator',
      { taskId, agentId, task: this.serializeTask(task) },
    );
  }

  /**
   * Find the best available agent for a task and assign it.
   * Returns the agent ID if assigned, or null if no capacity is available.
   */
  autoAssign(taskId: string): string | null {
    const task = this.requireTask(taskId);

    if (task.status !== 'queued') {
      throw new Error(
        `Cannot auto-assign task '${taskId}' — current status is '${task.status}', expected 'queued'`,
      );
    }

    if (!this.areDependenciesMet(task)) {
      throw new Error(
        `Cannot auto-assign task '${taskId}' — unresolved dependencies`,
      );
    }

    const candidate = this.findBestAgent(task);

    if (!candidate) {
      this.logger.warn(`No available agent for task '${task.title}'`, {
        taskId,
        type: task.type,
      });

      this.eventBus.emit(
        'task:waiting-for-agent',
        'coordination',
        'task-delegator',
        { taskId, type: task.type, priority: task.priority },
      );

      return null;
    }

    this.assignTask(taskId, candidate.agentId);
    return candidate.agentId;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /** Mark a task as in-progress. */
  startTask(taskId: string): void {
    const task = this.requireTask(taskId);

    if (task.status !== 'assigned') {
      throw new Error(
        `Cannot start task '${taskId}' — current status is '${task.status}', expected 'assigned'`,
      );
    }

    task.status = 'in-progress';
    task.startedAt = Date.now();

    this.logger.info(`Task started: ${task.title}`, { taskId });

    this.eventBus.emit(
      'task:started',
      'coordination',
      'task-delegator',
      { taskId, agentId: task.assignedTo, task: this.serializeTask(task) },
    );
  }

  /** Mark a task as completed with a result. */
  completeTask(taskId: string, result: TaskResult): void {
    const task = this.requireTask(taskId);

    if (task.status !== 'in-progress') {
      throw new Error(
        `Cannot complete task '${taskId}' — current status is '${task.status}', expected 'in-progress'`,
      );
    }

    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;

    // Release agent capacity
    if (task.assignedTo) {
      this.releaseAgentCapacity(task.assignedTo);
    }

    this.logger.info(`Task completed: ${task.title}`, {
      taskId,
      success: result.success,
      duration: task.startedAt
        ? task.completedAt - task.startedAt
        : undefined,
    });

    this.eventBus.emit(
      'task:completed',
      'coordination',
      'task-delegator',
      { taskId, result, task: this.serializeTask(task) },
    );

    // Unblock dependents and try auto-assignment on freed capacity
    this.promoteBlockedTasks();
    this.drainQueue();
  }

  /** Mark a task as failed with an error message. */
  failTask(taskId: string, error: string): void {
    const task = this.requireTask(taskId);

    if (task.status !== 'in-progress' && task.status !== 'assigned') {
      throw new Error(
        `Cannot fail task '${taskId}' — current status is '${task.status}', expected 'in-progress' or 'assigned'`,
      );
    }

    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;

    // Release agent capacity
    if (task.assignedTo) {
      this.releaseAgentCapacity(task.assignedTo);
    }

    this.logger.error(`Task failed: ${task.title} — ${error}`, { taskId });

    this.eventBus.emit(
      'task:failed',
      'coordination',
      'task-delegator',
      { taskId, error, task: this.serializeTask(task) },
    );

    // Cancel all tasks that depend on this failed task
    this.cascadeCancelDependents(taskId, `Dependency '${taskId}' failed: ${error}`);

    // Try to fill the freed slot
    this.drainQueue();
  }

  /** Cancel a task with a reason. */
  cancelTask(taskId: string, reason: string): void {
    const task = this.requireTask(taskId);

    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new Error(
        `Cannot cancel task '${taskId}' — already in terminal status '${task.status}'`,
      );
    }

    const wasActive =
      task.status === 'assigned' || task.status === 'in-progress';

    task.status = 'cancelled';
    task.completedAt = Date.now();
    task.error = reason;

    // Release agent capacity if it was assigned/active
    if (wasActive && task.assignedTo) {
      this.releaseAgentCapacity(task.assignedTo);
    }

    this.logger.warn(`Task cancelled: ${task.title} — ${reason}`, { taskId });

    this.eventBus.emit(
      'task:cancelled',
      'coordination',
      'task-delegator',
      { taskId, reason, task: this.serializeTask(task) },
    );

    // Cancel dependents
    this.cascadeCancelDependents(taskId, `Dependency '${taskId}' cancelled: ${reason}`);

    if (wasActive) {
      this.drainQueue();
    }
  }

  /** Retry a failed task, resetting it to queued status. */
  retryTask(taskId: string): void {
    const task = this.requireTask(taskId);

    if (task.status !== 'failed') {
      throw new Error(
        `Cannot retry task '${taskId}' — current status is '${task.status}', expected 'failed'`,
      );
    }

    if (task.retryCount >= task.maxRetries) {
      throw new Error(
        `Task '${taskId}' has exhausted all retries (${task.retryCount}/${task.maxRetries})`,
      );
    }

    task.retryCount++;
    task.status = 'queued';
    task.error = undefined;
    task.result = undefined;
    task.assignedTo = undefined;
    task.assignedAt = undefined;
    task.startedAt = undefined;
    task.completedAt = undefined;

    this.logger.info(
      `Task retrying: ${task.title} (attempt ${task.retryCount}/${task.maxRetries})`,
      { taskId },
    );

    this.drainQueue();
  }

  // ── Queries ───────────────────────────────────────────────

  /** Query tasks with optional filters. */
  getTasks(filter?: TaskFilter): SwarmTask[] {
    let results = Array.from(this.tasks.values());

    if (!filter) return results;

    if (filter.status?.length) {
      results = results.filter((t) => filter.status!.includes(t.status));
    }
    if (filter.type?.length) {
      results = results.filter((t) => filter.type!.includes(t.type));
    }
    if (filter.assignedTo !== undefined) {
      results = results.filter((t) => t.assignedTo === filter.assignedTo);
    }
    if (filter.priority?.length) {
      results = results.filter((t) => filter.priority!.includes(t.priority));
    }
    if (filter.createdAfter !== undefined) {
      results = results.filter((t) => t.createdAt >= filter.createdAfter!);
    }
    if (filter.createdBefore !== undefined) {
      results = results.filter((t) => t.createdAt <= filter.createdBefore!);
    }
    if (filter.tags?.length) {
      const tagSet = new Set(filter.tags);
      results = results.filter((t) =>
        t.tags.some((tag) => tagSet.has(tag)),
      );
    }

    return results;
  }

  /** Get a single task by ID. */
  getTask(taskId: string): SwarmTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Get all tasks assigned to a specific agent. */
  getAgentTasks(agentId: string): SwarmTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.assignedTo === agentId,
    );
  }

  /** Get the number of queued (pending) tasks. */
  getQueueDepth(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'queued') count++;
    }
    return count;
  }

  // ── Agent Management ──────────────────────────────────────

  /** Register an agent with its capabilities. */
  registerAgent(agentId: string, capabilities: AgentCapabilities): void {
    this.agents.set(agentId, { ...capabilities, agentId });

    this.logger.info(`Agent registered: ${agentId}`, {
      agentType: capabilities.agentType,
      supportedTaskTypes: capabilities.supportedTaskTypes,
      maxConcurrentTasks: capabilities.maxConcurrentTasks,
    });

    // New agent may be able to pick up queued work
    this.drainQueue();
  }

  /** Unregister an agent, reassigning its in-flight tasks to the queue. */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Requeue any tasks assigned/in-progress for this agent
    for (const task of this.tasks.values()) {
      if (
        task.assignedTo === agentId &&
        (task.status === 'assigned' || task.status === 'in-progress')
      ) {
        task.status = 'queued';
        task.assignedTo = undefined;
        task.assignedAt = undefined;
        task.startedAt = undefined;

        this.logger.warn(
          `Task '${task.title}' requeued — agent '${agentId}' unregistered`,
          { taskId: task.id },
        );
      }
    }

    this.agents.delete(agentId);

    this.logger.info(`Agent unregistered: ${agentId}`);

    // Try to reassign requeued tasks
    this.drainQueue();
  }

  // ── Cleanup ───────────────────────────────────────────────

  /** Stop the deadline monitor and release resources. */
  destroy(): void {
    if (this.deadlineTimer) {
      clearInterval(this.deadlineTimer);
      this.deadlineTimer = undefined;
    }
  }

  // ── Private: Dependency Resolution ────────────────────────

  /** Check if all dependencies of a task are completed. */
  private areDependenciesMet(task: SwarmTask): boolean {
    if (task.dependencies.length === 0) return true;
    return task.dependencies.every((depId) => {
      const dep = this.tasks.get(depId);
      return dep?.status === 'completed';
    });
  }

  /** Return IDs of unresolved dependencies. */
  private unresolvedDependencies(task: SwarmTask): string[] {
    return task.dependencies.filter((depId) => {
      const dep = this.tasks.get(depId);
      return dep?.status !== 'completed';
    });
  }

  /**
   * Detect circular dependencies using DFS.
   * Throws if adding this task creates a cycle.
   */
  private detectCircularDependencies(task: SwarmTask): void {
    const visited = new Set<string>();
    const stack = new Set<string>();

    // Temporarily add the task to the map for traversal
    this.tasks.set(task.id, task);

    try {
      const hasCycle = this.dfsDetectCycle(task.id, visited, stack);
      if (hasCycle) {
        throw new Error(
          `Circular dependency detected involving task '${task.id}' (${task.title})`,
        );
      }
    } finally {
      // Remove temporary entry — the caller will insert it for real
      this.tasks.delete(task.id);
    }
  }

  /** DFS cycle detection on the dependency graph. */
  private dfsDetectCycle(
    taskId: string,
    visited: Set<string>,
    stack: Set<string>,
  ): boolean {
    if (stack.has(taskId)) return true;
    if (visited.has(taskId)) return false;

    visited.add(taskId);
    stack.add(taskId);

    const task = this.tasks.get(taskId);
    if (task) {
      for (const depId of task.dependencies) {
        if (this.dfsDetectCycle(depId, visited, stack)) {
          return true;
        }
      }
    }

    stack.delete(taskId);
    return false;
  }

  /** Measure the maximum depth of a task's dependency chain. */
  private measureDependencyDepth(
    task: SwarmTask,
    currentDepth: number,
  ): number {
    if (task.dependencies.length === 0) return currentDepth;

    let maxDepth = currentDepth;
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (dep) {
        const d = this.measureDependencyDepth(dep, currentDepth + 1);
        if (d > maxDepth) maxDepth = d;
      }
    }
    return maxDepth;
  }

  /**
   * After a task completes, promote any blocked ('created') tasks
   * whose dependencies are now fully met to 'queued'.
   */
  private promoteBlockedTasks(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'created' && this.areDependenciesMet(task)) {
        task.status = 'queued';
        this.logger.info(
          `Task promoted to queued: ${task.title} — all dependencies met`,
          { taskId: task.id },
        );
      }
    }
  }

  /**
   * Cancel all tasks that depend (directly or transitively) on a failed/cancelled task.
   */
  private cascadeCancelDependents(
    failedTaskId: string,
    reason: string,
  ): void {
    for (const task of this.tasks.values()) {
      if (
        task.dependencies.includes(failedTaskId) &&
        task.status !== 'completed' &&
        task.status !== 'cancelled' &&
        task.status !== 'failed'
      ) {
        task.status = 'cancelled';
        task.completedAt = Date.now();
        task.error = reason;

        if (task.assignedTo) {
          this.releaseAgentCapacity(task.assignedTo);
        }

        this.logger.warn(
          `Task cascade-cancelled: ${task.title} — ${reason}`,
          { taskId: task.id },
        );

        this.eventBus.emit(
          'task:cancelled',
          'coordination',
          'task-delegator',
          { taskId: task.id, reason, task: this.serializeTask(task) },
        );

        // Recurse into transitive dependents
        this.cascadeCancelDependents(task.id, reason);
      }
    }
  }

  // ── Private: Auto-Assignment ──────────────────────────────

  /**
   * Find the best available agent for a given task:
   * 1. Must support the task type
   * 2. Must be available and under capacity
   * 3. Prefer lowest currentLoad (most idle)
   */
  private findBestAgent(task: SwarmTask): AgentCapabilities | null {
    let best: AgentCapabilities | null = null;

    for (const agent of this.agents.values()) {
      if (!agent.available) continue;
      if (agent.currentLoad >= agent.maxConcurrentTasks) continue;
      if (!agent.supportedTaskTypes.includes(task.type)) continue;

      if (
        !best ||
        agent.currentLoad < best.currentLoad ||
        (agent.currentLoad === best.currentLoad &&
          agent.maxConcurrentTasks > best.maxConcurrentTasks)
      ) {
        best = agent;
      }
    }

    return best;
  }

  /**
   * Drain the queue by attempting to auto-assign queued tasks
   * in priority order to available agents.
   */
  private drainQueue(): void {
    const queued = this.getTasks({ status: ['queued'] }).sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
    );

    for (const task of queued) {
      if (!this.areDependenciesMet(task)) continue;

      const agent = this.findBestAgent(task);
      if (!agent) continue;

      // Use direct assignment to avoid the status re-check in autoAssign
      task.status = 'assigned';
      task.assignedTo = agent.agentId;
      task.assignedAt = Date.now();
      agent.currentLoad++;

      this.logger.info(
        `Task auto-assigned via drain: ${task.title} → ${agent.agentId}`,
        { taskId: task.id },
      );

      this.eventBus.emit(
        'task:assigned',
        'coordination',
        'task-delegator',
        {
          taskId: task.id,
          agentId: agent.agentId,
          task: this.serializeTask(task),
        },
      );
    }
  }

  /** Decrement the load counter for an agent. */
  private releaseAgentCapacity(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent && agent.currentLoad > 0) {
      agent.currentLoad--;
    }
  }

  // ── Private: Deadline Monitor ─────────────────────────────

  /**
   * Periodically check for tasks that have exceeded their deadlines.
   * Emits 'task:deadline-exceeded' events for overdue tasks.
   */
  private startDeadlineMonitor(): void {
    const CHECK_INTERVAL_MS = 10_000;

    this.deadlineTimer = setInterval(() => {
      const now = Date.now();

      for (const task of this.tasks.values()) {
        if (
          task.deadline &&
          task.deadline < now &&
          task.status !== 'completed' &&
          task.status !== 'failed' &&
          task.status !== 'cancelled'
        ) {
          this.logger.warn(
            `Task deadline exceeded: ${task.title} (deadline was ${new Date(task.deadline).toISOString()})`,
            { taskId: task.id, deadline: task.deadline },
          );

          this.eventBus.emit(
            'task:deadline-exceeded',
            'coordination',
            'task-delegator',
            { taskId: task.id, deadline: task.deadline, task: this.serializeTask(task) },
          );
        }
      }
    }, CHECK_INTERVAL_MS);

    // Allow the Node process to exit even if the timer is running
    if (this.deadlineTimer && typeof this.deadlineTimer === 'object' && 'unref' in this.deadlineTimer) {
      this.deadlineTimer.unref();
    }
  }

  // ── Private: Helpers ──────────────────────────────────────

  /** Retrieve a task or throw if it doesn't exist. */
  private requireTask(taskId: string): SwarmTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }
    return task;
  }

  /** Retrieve an agent or throw if it doesn't exist. */
  private requireAgent(agentId: string): AgentCapabilities {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent '${agentId}' is not registered`);
    }
    return agent;
  }

  /** Create a plain-object copy of a task suitable for event payloads. */
  private serializeTask(task: SwarmTask): Record<string, unknown> {
    return {
      id: task.id,
      type: task.type,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      assignedTo: task.assignedTo,
      parameters: task.parameters,
      dependencies: task.dependencies,
      error: task.error,
      createdAt: task.createdAt,
      assignedAt: task.assignedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      deadline: task.deadline,
      maxRetries: task.maxRetries,
      retryCount: task.retryCount,
      tags: task.tags,
    };
  }
}
