# Prompt 51 — Agent Messenger

## Agent Identity & Rules

```
You are the AGENT-MESSENGER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real message passing with typed protocols
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add A2A agent messenger for typed inter-agent communication"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/agent-messenger.ts` — agent-to-agent messaging system using JSON-RPC-style structured messages. Enables typed communication between agents with priority queues, message history, and broadcast capabilities. Inspired by the A2A protocol from `packages/agent-runtime/`.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/agent-messenger.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus` (used as transport)
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/agent-messenger.ts`

1. **`AgentMessenger` class**:
   - `constructor(eventBus: SwarmEventBus)`
   - `sendMessage(from: string, to: string, message: AgentMessage): Promise<MessageResponse>` — send to specific agent
   - `broadcast(from: string, message: AgentMessage): Promise<void>` — send to all agents
   - `subscribe(agentId: string, handler: MessageHandler): () => void` — register message handler
   - `getMessageHistory(agentId: string, limit?: number): AgentMessage[]` — past messages for an agent
   - `getPendingMessages(agentId: string): AgentMessage[]` — undelivered messages
   - `getStats(): MessengerStats` — messaging statistics

2. **AgentMessage**:
   ```typescript
   interface AgentMessage {
     /** Unique message ID */
     id: string;
     /** Sender agent ID */
     from: string;
     /** Recipient agent ID (or '*' for broadcast) */
     to: string;
     /** Message type determines payload schema */
     type: AgentMessageType;
     /** Priority level */
     priority: 'critical' | 'high' | 'normal' | 'low';
     /** Typed payload */
     payload: MessagePayload;
     /** Timestamp */
     timestamp: number;
     /** Optional: ID of message this is responding to */
     inReplyTo?: string;
     /** TTL in ms (message expires after this) */
     ttl: number;
   }

   type AgentMessageType =
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
   ```

3. **Message payloads** (typed per message type):
   ```typescript
   type MessagePayload =
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

   interface TradeSignalPayload {
     type: 'trade-signal';
     mint: string;
     signal: 'buy' | 'sell' | 'hold';
     strength: number;              // 0-100
     reasoning: string;
     suggestedAmount?: number;
   }

   interface StrategyUpdatePayload {
     type: 'strategy-update';
     newStrategy: string;
     changes: Record<string, unknown>;
     effectiveImmediately: boolean;
   }

   interface RiskAlertPayload {
     type: 'risk-alert';
     level: 'warning' | 'critical' | 'emergency';
     riskType: string;
     message: string;
     action: 'pause' | 'exit' | 'reduce' | 'monitor';
     affectedMint?: string;
   }

   interface StatusReportPayload {
     type: 'status-report';
     agentType: string;
     status: 'healthy' | 'degraded' | 'error';
     metrics: Record<string, number>;
     details: string;
   }

   interface TaskAssignmentPayload {
     type: 'task-assignment';
     taskId: string;
     taskType: string;
     parameters: Record<string, unknown>;
     deadline?: number;
   }

   interface TaskCompletePayload {
     type: 'task-complete';
     taskId: string;
     success: boolean;
     result?: Record<string, unknown>;
     error?: string;
   }

   interface AcknowledgementPayload {
     type: 'acknowledgement';
     messageId: string;
     accepted: boolean;
     reason?: string;
   }

   interface PositionUpdatePayload {
     type: 'position-update';
     mint: string;
     tokens: string;                // bigint as string
     solValue: number;
     pnl: number;
     action: 'opened' | 'increased' | 'decreased' | 'closed';
   }

   interface PhaseChangePayload {
     type: 'phase-change';
     from: string;
     to: string;
     reason: string;
   }

   interface HealthCheckPayload {
     type: 'health-check';
     requestId: string;
   }

   interface ShutdownRequestPayload {
     type: 'shutdown-request';
     reason: string;
     graceful: boolean;
     deadline: number;
   }
   ```

4. **MessageResponse**:
   ```typescript
   interface MessageResponse {
     messageId: string;
     delivered: boolean;
     acknowledgedBy?: string;
     error?: string;
     deliveredAt?: number;
   }
   ```

5. **MessageHandler**:
   ```typescript
   type MessageHandler = (message: AgentMessage) => Promise<void> | void;
   ```

6. **Priority queue**:
   - Messages are delivered in priority order: critical > high > normal > low
   - Within same priority: FIFO
   - Critical messages bypass any rate limiting
   - If recipient is not subscribed, messages queue up (up to 100 per agent)
   - Expired messages (past TTL) are automatically discarded

7. **Message history**:
   - Keep last 1000 messages per agent in circular buffer
   - Separate sent and received histories
   - Include delivery status tracking

8. **MessengerStats**:
   ```typescript
   interface MessengerStats {
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
   ```

### Success Criteria

- Typed message payloads prevent invalid message construction
- Priority queue delivers critical messages first
- Broadcast reaches all subscribed agents
- Message history is queryable per agent
- TTL-based expiration works correctly
- Stats tracking provides useful operational metrics
- Compiles with `npx tsc --noEmit`
