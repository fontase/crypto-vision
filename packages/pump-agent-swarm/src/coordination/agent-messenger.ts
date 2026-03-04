/**
 * Agent Messenger — Typed Agent-to-Agent Communication
 *
 * Features:
 * - JSON-RPC-style structured messages with typed payloads
 * - Priority queue delivery (critical > high > normal > low)
 * - Broadcast to all subscribed agents
 * - Per-agent message history with circular buffer
 * - TTL-based message expiration
 * - Delivery tracking and operational stats
 *
 * Inspired by the A2A protocol from `packages/agent-runtime/`.
 */

import { v4 as uuidv4 } from 'uuid';

import { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Constants ────────────────────────────────────────────────

const MAX_PENDING_PER_AGENT = 100;
const MAX_HISTORY_PER_AGENT = 1_000;
const EXPIRY_SWEEP_INTERVAL_MS = 10_000;
const MESSENGER_EVENT_TYPE = 'messenger:message';
const MESSENGER_EVENT_CATEGORY = 'coordination' as const;

// ─── Priority Ordering ───────────────────────────────────────

const PRIORITY_ORDER: Record<AgentMessagePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ─── Message Types ────────────────────────────────────────────

export type AgentMessageType =
  | 'trade-signal'
  | 'strategy-update'
  | 'risk-alert'
  | 'status-report'
  | 'task-assignment'
  | 'task-complete'
  | 'acknowledgement'
  | 'position-update'
  | 'phase-change'
  | 'health-check'
  | 'shutdown-request';

export type AgentMessagePriority = 'critical' | 'high' | 'normal' | 'low';

export interface AgentMessage {
  /** Unique message ID */
  id: string;
  /** Sender agent ID */
  from: string;
  /** Recipient agent ID (or '*' for broadcast) */
  to: string;
  /** Message type determines payload schema */
  type: AgentMessageType;
  /** Priority level */
  priority: AgentMessagePriority;
  /** Typed payload */
  payload: MessagePayload;
  /** Timestamp */
  timestamp: number;
  /** Optional: ID of message this is responding to */
  inReplyTo?: string;
  /** TTL in ms (message expires after this) */
  ttl: number;
}

// ─── Payload Types ────────────────────────────────────────────

export interface TradeSignalPayload {
  type: 'trade-signal';
  mint: string;
  signal: 'buy' | 'sell' | 'hold';
  strength: number; // 0-100
  reasoning: string;
  suggestedAmount?: number;
}

export interface StrategyUpdatePayload {
  type: 'strategy-update';
  newStrategy: string;
  changes: Record<string, unknown>;
  effectiveImmediately: boolean;
}

export interface RiskAlertPayload {
  type: 'risk-alert';
  level: 'warning' | 'critical' | 'emergency';
  riskType: string;
  message: string;
  action: 'pause' | 'exit' | 'reduce' | 'monitor';
  affectedMint?: string;
}

export interface StatusReportPayload {
  type: 'status-report';
  agentType: string;
  status: 'healthy' | 'degraded' | 'error';
  metrics: Record<string, number>;
  details: string;
}

export interface TaskAssignmentPayload {
  type: 'task-assignment';
  taskId: string;
  taskType: string;
  parameters: Record<string, unknown>;
  deadline?: number;
}

export interface TaskCompletePayload {
  type: 'task-complete';
  taskId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface AcknowledgementPayload {
  type: 'acknowledgement';
  messageId: string;
  accepted: boolean;
  reason?: string;
}

export interface PositionUpdatePayload {
  type: 'position-update';
  mint: string;
  tokens: string; // bigint as string
  solValue: number;
  pnl: number;
  action: 'opened' | 'increased' | 'decreased' | 'closed';
}

export interface PhaseChangePayload {
  type: 'phase-change';
  from: string;
  to: string;
  reason: string;
}

export interface HealthCheckPayload {
  type: 'health-check';
  requestId: string;
}

export interface ShutdownRequestPayload {
  type: 'shutdown-request';
  reason: string;
  graceful: boolean;
  deadline: number;
}

export type MessagePayload =
  | TradeSignalPayload
  | StrategyUpdatePayload
  | RiskAlertPayload
  | StatusReportPayload
  | TaskAssignmentPayload
  | TaskCompletePayload
  | AcknowledgementPayload
  | PositionUpdatePayload
  | PhaseChangePayload
  | HealthCheckPayload
  | ShutdownRequestPayload;

// ─── Response & Handler Types ─────────────────────────────────

export interface MessageResponse {
  messageId: string;
  delivered: boolean;
  acknowledgedBy?: string;
  error?: string;
  deliveredAt?: number;
}

export type MessageHandler = (message: AgentMessage) => Promise<void> | void;

// ─── Stats ────────────────────────────────────────────────────

export interface MessengerStats {
  totalMessagesSent: number;
  totalMessagesDelivered: number;
  totalMessagesFailed: number;
  totalBroadcasts: number;
  messagesByType: Record<string, number>;
  messagesByPriority: Record<string, number>;
  activeSubscriptions: number;
  pendingMessages: number;
  avgDeliveryTime: number;
}

// ─── Circular Buffer ──────────────────────────────────────────

/**
 * Fixed-capacity ring buffer for message history.
 * O(1) push, O(n) iteration — no array shifts or GC pressure.
 */
class MessageCircularBuffer {
  private readonly buffer: Array<AgentMessage | undefined>;
  private head = 0;
  private _size = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array<AgentMessage | undefined>(capacity);
  }

  get size(): number {
    return this._size;
  }

  push(item: AgentMessage): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) {
      this._size++;
    }
  }

  /** Return items newest → oldest (most recent first) */
  toArray(limit?: number): AgentMessage[] {
    if (this._size === 0) return [];
    const result: AgentMessage[] = [];
    const count = limit !== undefined ? Math.min(limit, this._size) : this._size;
    for (let i = 0; i < count; i++) {
      // Walk backwards from head
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      result.push(this.buffer[idx] as AgentMessage);
    }
    return result;
  }
}

// ─── Priority Queue ───────────────────────────────────────────

/**
 * Min-heap priority queue for pending messages.
 * Orders by priority level (critical=0 < low=3), then by timestamp (FIFO within same priority).
 */
class MessagePriorityQueue {
  private readonly heap: AgentMessage[] = [];

  get length(): number {
    return this.heap.length;
  }

  enqueue(message: AgentMessage): void {
    this.heap.push(message);
    this.bubbleUp(this.heap.length - 1);
  }

  dequeue(): AgentMessage | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): AgentMessage | undefined {
    return this.heap[0];
  }

  /** Remove expired messages and return how many were removed */
  removeExpired(now: number): number {
    const before = this.heap.length;
    const kept: AgentMessage[] = [];
    for (const msg of this.heap) {
      if (msg.timestamp + msg.ttl > now) {
        kept.push(msg);
      }
    }
    if (kept.length !== before) {
      this.heap.length = 0;
      for (const msg of kept) {
        this.heap.push(msg);
      }
      // Rebuild heap
      for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
        this.sinkDown(i);
      }
    }
    return before - kept.length;
  }

  toArray(): AgentMessage[] {
    // Return sorted copy
    return [...this.heap].sort((a, b) => {
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return pDiff !== 0 ? pDiff : a.timestamp - b.timestamp;
    });
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.compare(idx, parent) < 0) {
        this.swap(idx, parent);
        idx = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(idx: number): void {
    const length = this.heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < length && this.compare(left, smallest) < 0) {
        smallest = left;
      }
      if (right < length && this.compare(right, smallest) < 0) {
        smallest = right;
      }
      if (smallest !== idx) {
        this.swap(idx, smallest);
        idx = smallest;
      } else {
        break;
      }
    }
  }

  private compare(i: number, j: number): number {
    const a = this.heap[i];
    const b = this.heap[j];
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return pDiff !== 0 ? pDiff : a.timestamp - b.timestamp;
  }

  private swap(i: number, j: number): void {
    const tmp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = tmp;
  }
}

// ─── Agent Messenger ──────────────────────────────────────────

export class AgentMessenger {
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;

  /** agentId → handler */
  private readonly handlers = new Map<string, MessageHandler>();
  /** agentId → pending message queue */
  private readonly pendingQueues = new Map<string, MessagePriorityQueue>();
  /** agentId → sent message history */
  private readonly sentHistory = new Map<string, MessageCircularBuffer>();
  /** agentId → received message history */
  private readonly receivedHistory = new Map<string, MessageCircularBuffer>();

  /** Delivery timing tracking for avg calculation */
  private readonly deliveryTimes: number[] = [];
  private deliveryTimesHead = 0;
  private readonly maxDeliveryTimeSamples = 1_000;

  /** Stats counters */
  private totalMessagesSent = 0;
  private totalMessagesDelivered = 0;
  private totalMessagesFailed = 0;
  private totalBroadcasts = 0;
  private readonly messagesByType = new Map<string, number>();
  private readonly messagesByPriority = new Map<string, number>();

  /** Expiry sweep timer */
  private expirySweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(eventBus: SwarmEventBus) {
    this.eventBus = eventBus;
    this.logger = SwarmLogger.create('agent-messenger', 'coordination');

    // Start periodic expiry sweep
    this.expirySweepTimer = setInterval(() => {
      this.sweepExpiredMessages();
    }, EXPIRY_SWEEP_INTERVAL_MS);

    // Prevent timer from keeping process alive
    if (this.expirySweepTimer.unref) {
      this.expirySweepTimer.unref();
    }

    this.logger.info('Agent messenger initialized');
  }

  // ── Send Message ────────────────────────────────────────────

  /**
   * Send a typed message to a specific agent.
   * If the recipient has a registered handler, the message is delivered immediately.
   * Otherwise, it queues in the recipient's pending queue (up to MAX_PENDING_PER_AGENT).
   */
  async sendMessage(
    from: string,
    to: string,
    message: AgentMessage,
  ): Promise<MessageResponse> {
    const now = Date.now();

    // Ensure message fields are consistent
    const outgoing: AgentMessage = {
      ...message,
      id: message.id || uuidv4(),
      from,
      to,
      timestamp: message.timestamp || now,
    };

    // Check TTL — if already expired, reject
    if (outgoing.timestamp + outgoing.ttl <= now) {
      this.totalMessagesFailed++;
      this.logger.warn('Message already expired before send', {
        messageId: outgoing.id,
        from,
        to,
        type: outgoing.type,
      });
      return {
        messageId: outgoing.id,
        delivered: false,
        error: 'Message expired before delivery',
      };
    }

    // Track stats
    this.totalMessagesSent++;
    this.incrementMapCounter(this.messagesByType, outgoing.type);
    this.incrementMapCounter(this.messagesByPriority, outgoing.priority);

    // Record in sender's history
    this.getSentHistory(from).push(outgoing);

    // Emit on event bus for observability
    this.eventBus.emit(
      MESSENGER_EVENT_TYPE,
      MESSENGER_EVENT_CATEGORY,
      from,
      {
        messageId: outgoing.id,
        from,
        to,
        type: outgoing.type,
        priority: outgoing.priority,
      },
    );

    // Attempt delivery
    const handler = this.handlers.get(to);
    if (handler) {
      return this.deliverToHandler(outgoing, handler);
    }

    // No handler — queue the message
    return this.enqueueMessage(outgoing);
  }

  // ── Broadcast ───────────────────────────────────────────────

  /**
   * Broadcast a message to all subscribed agents.
   * The message is delivered to every agent with a registered handler (except the sender).
   */
  async broadcast(from: string, message: AgentMessage): Promise<void> {
    const now = Date.now();
    this.totalBroadcasts++;

    const broadcastMsg: AgentMessage = {
      ...message,
      id: message.id || uuidv4(),
      from,
      to: '*',
      timestamp: message.timestamp || now,
    };

    // Track stats
    this.totalMessagesSent++;
    this.incrementMapCounter(this.messagesByType, broadcastMsg.type);
    this.incrementMapCounter(this.messagesByPriority, broadcastMsg.priority);

    // Record in sender's history
    this.getSentHistory(from).push(broadcastMsg);

    // Emit on event bus
    this.eventBus.emit(
      `${MESSENGER_EVENT_TYPE}:broadcast`,
      MESSENGER_EVENT_CATEGORY,
      from,
      {
        messageId: broadcastMsg.id,
        from,
        type: broadcastMsg.type,
        priority: broadcastMsg.priority,
        recipientCount: this.handlers.size,
      },
    );

    // Deliver to all handlers (except sender)
    const deliveries: Promise<void>[] = [];
    for (const [agentId, handler] of this.handlers) {
      if (agentId === from) continue;

      const agentMsg: AgentMessage = { ...broadcastMsg, to: agentId };
      deliveries.push(
        this.deliverToHandler(agentMsg, handler).then(() => undefined),
      );
    }

    await Promise.allSettled(deliveries);
  }

  // ── Subscribe ───────────────────────────────────────────────

  /**
   * Register a message handler for an agent.
   * Returns an unsubscribe function.
   * On subscribe, any pending messages for the agent are delivered in priority order.
   */
  subscribe(agentId: string, handler: MessageHandler): () => void {
    if (this.handlers.has(agentId)) {
      this.logger.warn('Replacing existing handler for agent', { agentId });
    }

    this.handlers.set(agentId, handler);
    this.logger.info('Agent subscribed to messenger', { agentId });

    // Drain pending queue
    this.drainPendingQueue(agentId, handler);

    return () => {
      this.handlers.delete(agentId);
      this.logger.info('Agent unsubscribed from messenger', { agentId });
    };
  }

  // ── Query Methods ───────────────────────────────────────────

  /**
   * Get message history for an agent (sent + received, newest first).
   */
  getMessageHistory(agentId: string, limit?: number): AgentMessage[] {
    const sent = this.getSentHistory(agentId).toArray();
    const received = this.getReceivedHistory(agentId).toArray();

    // Merge and sort by timestamp descending (newest first)
    const merged = [...sent, ...received].sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    return limit !== undefined ? merged.slice(0, limit) : merged;
  }

  /**
   * Get undelivered messages for an agent, sorted by priority then FIFO.
   */
  getPendingMessages(agentId: string): AgentMessage[] {
    const queue = this.pendingQueues.get(agentId);
    if (!queue) return [];
    return queue.toArray();
  }

  /**
   * Get comprehensive messenger statistics.
   */
  getStats(): MessengerStats {
    let totalPending = 0;
    for (const queue of this.pendingQueues.values()) {
      totalPending += queue.length;
    }

    return {
      totalMessagesSent: this.totalMessagesSent,
      totalMessagesDelivered: this.totalMessagesDelivered,
      totalMessagesFailed: this.totalMessagesFailed,
      totalBroadcasts: this.totalBroadcasts,
      messagesByType: Object.fromEntries(this.messagesByType),
      messagesByPriority: Object.fromEntries(this.messagesByPriority),
      activeSubscriptions: this.handlers.size,
      pendingMessages: totalPending,
      avgDeliveryTime: this.computeAvgDeliveryTime(),
    };
  }

  // ── Cleanup ─────────────────────────────────────────────────

  /**
   * Stop the expiry sweep timer and clean up resources.
   */
  destroy(): void {
    if (this.expirySweepTimer !== undefined) {
      clearInterval(this.expirySweepTimer);
      this.expirySweepTimer = undefined;
    }
    this.handlers.clear();
    this.pendingQueues.clear();
    this.sentHistory.clear();
    this.receivedHistory.clear();
    this.deliveryTimes.length = 0;
    this.logger.info('Agent messenger destroyed');
  }

  // ── Private: Delivery ───────────────────────────────────────

  private async deliverToHandler(
    message: AgentMessage,
    handler: MessageHandler,
  ): Promise<MessageResponse> {
    const deliveryStart = Date.now();

    // Check TTL before delivery
    if (message.timestamp + message.ttl <= deliveryStart) {
      this.totalMessagesFailed++;
      this.logger.debug('Message expired before delivery', {
        messageId: message.id,
        from: message.from,
        to: message.to,
      });
      return {
        messageId: message.id,
        delivered: false,
        error: 'Message expired before delivery',
      };
    }

    try {
      await handler(message);

      const deliveredAt = Date.now();
      const deliveryTime = deliveredAt - deliveryStart;

      this.totalMessagesDelivered++;
      this.recordDeliveryTime(deliveryTime);

      // Record in recipient's history
      this.getReceivedHistory(message.to).push(message);

      this.logger.debug('Message delivered', {
        messageId: message.id,
        from: message.from,
        to: message.to,
        type: message.type,
        deliveryTimeMs: deliveryTime,
      });

      return {
        messageId: message.id,
        delivered: true,
        acknowledgedBy: message.to,
        deliveredAt,
      };
    } catch (err) {
      this.totalMessagesFailed++;

      const errorMessage =
        err instanceof Error ? err.message : String(err);

      this.logger.error(
        `Message delivery failed (id=${message.id}, from=${message.from}, to=${message.to})`,
        err instanceof Error ? err : new Error(errorMessage),
      );

      return {
        messageId: message.id,
        delivered: false,
        error: `Handler error: ${errorMessage}`,
      };
    }
  }

  private enqueueMessage(message: AgentMessage): MessageResponse {
    let queue = this.pendingQueues.get(message.to);
    if (!queue) {
      queue = new MessagePriorityQueue();
      this.pendingQueues.set(message.to, queue);
    }

    // Enforce max pending limit — drop lowest priority message if full
    if (queue.length >= MAX_PENDING_PER_AGENT) {
      this.totalMessagesFailed++;
      this.logger.warn('Pending queue full, message dropped', {
        messageId: message.id,
        to: message.to,
        queueSize: queue.length,
      });
      return {
        messageId: message.id,
        delivered: false,
        error: `Pending queue full for agent ${message.to} (max ${MAX_PENDING_PER_AGENT})`,
      };
    }

    queue.enqueue(message);

    this.logger.debug('Message queued (no handler)', {
      messageId: message.id,
      to: message.to,
      queueSize: queue.length,
    });

    return {
      messageId: message.id,
      delivered: false,
      error: 'No handler registered — message queued',
    };
  }

  /**
   * Drain pending messages for an agent in priority order.
   */
  private drainPendingQueue(agentId: string, handler: MessageHandler): void {
    const queue = this.pendingQueues.get(agentId);
    if (!queue || queue.length === 0) return;

    const now = Date.now();
    let delivered = 0;
    let expired = 0;

    // Dequeue and deliver in priority order
    let msg = queue.dequeue();
    while (msg !== undefined) {
      if (msg.timestamp + msg.ttl <= now) {
        expired++;
      } else {
        // Fire-and-forget delivery — errors are caught in deliverToHandler
        void this.deliverToHandler(msg, handler);
        delivered++;
      }
      msg = queue.dequeue();
    }

    // Clean up empty queue
    this.pendingQueues.delete(agentId);

    if (delivered > 0 || expired > 0) {
      this.logger.info('Drained pending queue on subscribe', {
        agentId,
        delivered,
        expired,
      });
    }
  }

  // ── Private: Expiry Sweep ───────────────────────────────────

  private sweepExpiredMessages(): void {
    const now = Date.now();
    let totalRemoved = 0;

    for (const [agentId, queue] of this.pendingQueues) {
      const removed = queue.removeExpired(now);
      totalRemoved += removed;

      // Clean up empty queues
      if (queue.length === 0) {
        this.pendingQueues.delete(agentId);
      }
    }

    if (totalRemoved > 0) {
      this.totalMessagesFailed += totalRemoved;
      this.logger.debug('Expired messages swept', { totalRemoved });
    }
  }

  // ── Private: History Buffers ────────────────────────────────

  private getSentHistory(agentId: string): MessageCircularBuffer {
    let buf = this.sentHistory.get(agentId);
    if (!buf) {
      buf = new MessageCircularBuffer(MAX_HISTORY_PER_AGENT);
      this.sentHistory.set(agentId, buf);
    }
    return buf;
  }

  private getReceivedHistory(agentId: string): MessageCircularBuffer {
    let buf = this.receivedHistory.get(agentId);
    if (!buf) {
      buf = new MessageCircularBuffer(MAX_HISTORY_PER_AGENT);
      this.receivedHistory.set(agentId, buf);
    }
    return buf;
  }

  // ── Private: Delivery Time Tracking ─────────────────────────

  private recordDeliveryTime(ms: number): void {
    if (this.deliveryTimes.length < this.maxDeliveryTimeSamples) {
      this.deliveryTimes.push(ms);
    } else {
      this.deliveryTimes[this.deliveryTimesHead] = ms;
      this.deliveryTimesHead =
        (this.deliveryTimesHead + 1) % this.maxDeliveryTimeSamples;
    }
  }

  private computeAvgDeliveryTime(): number {
    if (this.deliveryTimes.length === 0) return 0;
    let sum = 0;
    for (const t of this.deliveryTimes) {
      sum += t;
    }
    return sum / this.deliveryTimes.length;
  }

  // ── Private: Helpers ────────────────────────────────────────

  private incrementMapCounter(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }
}
