# Prompt 67 — Event Timeline

## Agent Identity & Rules

```
You are the EVENT-TIMELINE builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real events from the event bus, real filtering and querying
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add event timeline with circular buffer and real-time streaming"
```

## Objective

Create `packages/pump-agent-swarm/src/dashboard/event-timeline.ts` — a chronological event stream that captures all swarm events, provides filtering, and supports real-time subscriptions for the dashboard.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/dashboard/event-timeline.ts`

## Dependencies

- `../infra/event-bus` — SwarmEventBus (P04)
- `../infra/logging` — SwarmLogger (P07)

## Deliverables

### Create `packages/pump-agent-swarm/src/dashboard/event-timeline.ts`

1. **`EventTimeline` class**:
   - `constructor(eventBus: SwarmEventBus, config?: TimelineConfig)`
   - `getEvents(filter?: EventFilter): TimelineEvent[]` — filtered event list
   - `getRecentEvents(limit: number): TimelineEvent[]` — latest N events
   - `getEventsByCategory(category: EventCategory): TimelineEvent[]`
   - `getEventsByAgent(agentId: string): TimelineEvent[]`
   - `getEventCount(): number` — total events stored
   - `getEventCountByCategory(): Map<EventCategory, number>` — count per category
   - `subscribe(callback: (event: TimelineEvent) => void): () => void` — subscribe to new events
   - `clear(): void` — clear all stored events

2. **`TimelineConfig` interface**:
   ```typescript
   interface TimelineConfig {
     /** Maximum events to retain in circular buffer (default: 10000) */
     maxEvents: number;
     /** Event categories to capture (default: all) */
     captureCategories: EventCategory[];
     /** Minimum severity to capture (default: 'info') */
     minimumSeverity: EventSeverity;
   }
   ```

3. **`TimelineEvent` interface**:
   ```typescript
   interface TimelineEvent {
     /** Unique event ID */
     id: string;
     /** Millisecond timestamp */
     timestamp: number;
     /** Event category */
     category: EventCategory;
     /** Event severity */
     severity: EventSeverity;
     /** Short title for display */
     title: string;
     /** Detailed description */
     description: string;
     /** Source agent ID (if applicable) */
     agentId?: string;
     /** Source agent type (if applicable) */
     agentType?: string;
     /** On-chain transaction signature (if applicable) */
     signature?: string;
     /** Additional structured data */
     metadata: Record<string, unknown>;
   }
   ```

4. **`EventCategory` and `EventSeverity` types**:
   ```typescript
   type EventCategory = 'trade' | 'agent' | 'phase' | 'risk' | 'system' | 'bundle' | 'intelligence' | 'config';
   type EventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';
   ```

5. **`EventFilter` interface**:
   ```typescript
   interface EventFilter {
     /** Filter by categories */
     categories?: EventCategory[];
     /** Filter by minimum severity */
     minSeverity?: EventSeverity;
     /** Filter by agent ID */
     agentId?: string;
     /** Filter by time range */
     from?: number;
     to?: number;
     /** Filter by text search in title/description */
     search?: string;
     /** Maximum results */
     limit?: number;
     /** Offset for pagination */
     offset?: number;
   }
   ```

6. **Core behavior**:
   - Circular buffer implementation: when `maxEvents` reached, oldest events evicted
   - Subscribe to ALL events on SwarmEventBus using wildcard or individual subscriptions
   - Transform raw SwarmEvent → TimelineEvent with human-readable title and description
   - Event transformation rules:
     - `trade:executed` → category: 'trade', title: "Agent X bought/sold N tokens for Y SOL"
     - `agent:started` → category: 'agent', title: "Agent X (type) started"
     - `phase:changed` → category: 'phase', title: "Phase changed from X to Y"
     - `risk:alert` → category: 'risk', severity: 'warning', title: "Risk alert: ..."
     - `health:degraded` → category: 'system', severity: 'warning'
     - `signal:generated` → category: 'intelligence', title: "Signal: buy/sell"
   - Severity ordering: debug < info < warning < error < critical
   - Filter by severity returns events at or above the specified level
   - Text search is case-insensitive substring match on title + description

### Success Criteria

- All SwarmEventBus events captured and transformed into timeline entries
- Circular buffer correctly evicts oldest events
- Filtering by category, severity, agent, time range all work
- Real-time subscription delivers new events immediately
- Text search finds matching events
- Compiles with `npx tsc --noEmit`
