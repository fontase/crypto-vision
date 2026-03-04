# Prompt 05 — Finite State Machine for Swarm Lifecycle

## Agent Identity & Rules

```
You are the STATE-MACHINE agent. Your sole responsibility is building the swarm state machine.

RULES:
- Work on current branch (main)
- Commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- TypeScript strict mode
- Run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add finite state machine for swarm lifecycle management"
```

## Objective

Create `packages/pump-agent-swarm/src/infra/state-machine.ts` — a finite state machine that manages the swarm lifecycle with typed phases, guarded transitions, timeout handling, phase hooks, and audit logging.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/infra/state-machine.ts`

## Dependencies

- Types from `../types.ts`: `SwarmPhase`, `PhaseTransition`, `StateMachineConfig`
- Event bus from `./event-bus.ts` (P04): `SwarmEventBus`

## Deliverables

### Create `packages/pump-agent-swarm/src/infra/state-machine.ts`

1. **`SwarmStateMachine` class**:
   - `constructor(config: StateMachineConfig, eventBus: SwarmEventBus)`
   - `currentPhase: SwarmPhase` — getter for current phase
   - `transition(to: SwarmPhase): Promise<boolean>` — attempt a transition, returns success
   - `canTransition(to: SwarmPhase): boolean` — check if transition is valid
   - `getValidTransitions(): SwarmPhase[]` — list all valid transitions from current phase
   - `getPhaseHistory(): Array<{ phase: SwarmPhase; enteredAt: number; exitedAt?: number; duration?: number }>` — full history
   - `getCurrentPhaseDuration(): number` — ms in current phase
   - `onPhaseEnter(phase: SwarmPhase, handler: () => void | Promise<void>): void`
   - `onPhaseExit(phase: SwarmPhase, handler: () => void | Promise<void>): void`
   - `forceTransition(to: SwarmPhase): void` — skip guards (for emergency)
   - `pause(): void` — transition to 'paused' if not already
   - `resume(): void` — return to pre-pause phase
   - `reset(): void` — back to initial phase

2. **Default transitions** (export as `DEFAULT_SWARM_TRANSITIONS`):
   ```
   idle → initializing → funding → [scanning | creating_narrative]
   scanning → evaluating → [minting | scanning]  (loop back if no good token found)
   creating_narrative → minting
   minting → bundling → distributing → trading
   trading → [market_making | accumulating | graduating | exiting]
   market_making → [trading | graduating | exiting]
   accumulating → [trading | graduating | exiting]
   graduating → exiting
   exiting → reclaiming → completed
   Any phase → paused → (resume to previous)
   Any phase → error → [reclaiming | emergency_exit]
   Any phase → emergency_exit → reclaiming → completed
   ```

3. **Guard functions**: Each transition can have a guard that must return true
   - Guards can be async (e.g., check wallet balances)
   - Guards receive current state context

4. **Phase timeouts**: Configurable per-phase timeouts
   - Default timeouts: minting=60s, bundling=30s, each trading phase=configurable
   - On timeout, call `onTimeout` handler which decides next phase

5. **Event integration**: Every transition emits to event bus
   - `phase:entering` with `{ from, to }`
   - `phase:entered` with `{ phase, duration_in_previous }`
   - `phase:timeout` with `{ phase, timeoutMs }`
   - `phase:error` with `{ phase, error }`

6. **Audit trail**: Keep immutable log of all transitions with timestamps

### Success Criteria

- All valid transitions work, invalid ones throw
- Guards prevent unauthorized transitions
- Timeouts fire correctly
- Pause/resume preserves state
- Force transition bypasses guards
- Event bus receives all phase change events
- Phase history is accurate
- Compiles with `npx tsc --noEmit`
