# Prompt 04 — Event Bus with Replay and Filtering

## Agent Identity & Rules

```
You are the EVENT-BUS agent. Your sole responsibility is building the swarm event bus.

RULES:
- Work on current branch (main)
- Commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- TypeScript strict mode — no `any`, no `@ts-ignore`
- Run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add event bus with replay, filtering, and persistence"
```

## Objective

Create `packages/pump-agent-swarm/src/infra/event-bus.ts` — a high-performance event bus that enables decoupled communication between all agents in the swarm. Supports wildcards, replay, filtering, persistence, and async handlers.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/infra/event-bus.ts`

## Dependencies

- Types from `../types.ts`: `SwarmEvent`, `SwarmEventCategory`, `EventSubscription`
- `uuid` for event IDs

## Deliverables

### Create `packages/pump-agent-swarm/src/infra/event-bus.ts`

1. **`SwarmEventBus` class**:
   - Singleton pattern with `SwarmEventBus.getInstance()`
   - `emit(type: string, category: SwarmEventCategory, source: string, payload: Record<string, unknown>, correlationId?: string): SwarmEvent` — publishes an event, returns the created event
   - `subscribe(pattern: string, handler: (event: SwarmEvent) => void | Promise<void>, options?: { replay?: boolean; filter?: (e: SwarmEvent) => boolean }): string` — returns subscription ID
   - `unsubscribe(subscriptionId: string): void`
   - `unsubscribeAll(source?: string): void` — remove all subscriptions, optionally filtered by source
   - `getHistory(options?: { type?: string; category?: SwarmEventCategory; source?: string; since?: number; limit?: number }): SwarmEvent[]` — query event history
   - `clear(): void` — clear all history and subscriptions
   - `getStats(): { totalEvents: number; totalSubscriptions: number; eventsByCategory: Record<SwarmEventCategory, number> }`
   - `waitFor(pattern: string, timeoutMs?: number): Promise<SwarmEvent>` — returns a promise that resolves when the next matching event fires (or rejects on timeout)
   - `pipe(targetBus: SwarmEventBus, filter?: (e: SwarmEvent) => boolean): void` — forward events to another bus

2. **Pattern matching**:
   - Exact match: `'trade:executed'`
   - Wildcard suffix: `'trade:*'` matches `trade:executed`, `trade:failed`, etc.
   - Wildcard prefix: `'*:failed'` matches `trade:failed`, `bundle:failed`, etc.
   - Category filter: `'@trading'` matches all events in the trading category
   - All events: `'*'`

3. **Replay support**:
   - Keep circular buffer of last 10,000 events
   - When subscribing with `replay: true`, deliver historical matches before live events
   - Events stored in memory with configurable max size

4. **Async handler support**:
   - Handlers can be sync or async
   - Async handlers are awaited but don't block other handlers
   - Failed handlers emit `'bus:handler-error'` event (don't crash the bus)

5. **Correlation tracking**:
   - Every event can have a `correlationId`
   - `getCorrelation(id: string): SwarmEvent[]` — get all events with a correlation ID
   - Useful for tracing a trade from submission through execution

6. **Performance**:
   - Use `Map` for O(1) subscription lookup
   - Batch event delivery for high-throughput scenarios
   - Debounce option for noisy events

### Success Criteria

- Wildcard pattern matching works for all patterns
- Replay delivers historical events on subscribe
- Async handlers don't block event delivery
- Correlation tracking groups related events
- Circular buffer prevents memory leaks
- `waitFor` resolves correctly or times out
- Compiles with `npx tsc --noEmit`
