# Prompt 56 — Phase Controller

## Agent Identity & Rules

```
You are the PHASE-CONTROLLER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real state transitions with precondition checking
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add phase controller for multi-agent-aware phase transitions"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/phase-controller.ts` — controls transitions between swarm operational phases. Each phase has entry conditions, exit conditions, and a maximum duration. Transitions only fire when all preconditions are met.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/phase-controller.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/phase-controller.ts`

1. **`PhaseController` class**:
   - `constructor(eventBus: SwarmEventBus, config?: PhaseControllerConfig)`
   - `getCurrentPhase(): SwarmPhase`
   - `canTransition(to: SwarmPhase): PhaseTransitionCheck`
   - `transition(to: SwarmPhase, force?: boolean): Promise<void>`
   - `getPhaseRequirements(phase: SwarmPhase): PhaseRequirements`
   - `getPhaseHistory(): PhaseHistoryEntry[]`
   - `getPhaseDuration(): number` — ms in current phase
   - `onPhaseChange(callback: (from: SwarmPhase, to: SwarmPhase) => void): () => void`
   - `setConditionMet(phase: SwarmPhase, condition: string, met: boolean): void`
   - `checkTimeouts(): void` — check if current phase has exceeded max duration

2. **SwarmPhase**:
   ```typescript
   type SwarmPhase =
     | 'idle'
     | 'scouting'
     | 'preparing'
     | 'launching'
     | 'accumulating'
     | 'trading'
     | 'monitoring'
     | 'exiting'
     | 'cleanup'
     | 'stopped'
     | 'error';
   ```

3. **PhaseControllerConfig**:
   ```typescript
   interface PhaseControllerConfig {
     /** Starting phase */
     initialPhase: SwarmPhase;
     /** Phase timeouts (ms) — force transition after duration */
     timeouts: Partial<Record<SwarmPhase, number>>;
     /** Phase to transition to on timeout */
     timeoutTransitions: Partial<Record<SwarmPhase, SwarmPhase>>;
   }
   ```

4. **PhaseRequirements** — preconditions for entering each phase:
   ```typescript
   interface PhaseRequirements {
     phase: SwarmPhase;
     conditions: PhaseCondition[];
     allMet: boolean;
     unmetConditions: PhaseCondition[];
   }

   interface PhaseCondition {
     name: string;
     description: string;
     met: boolean;
     critical: boolean;              // If critical and unmet, cannot transition
   }
   ```

5. **Defined phase transitions and their conditions**:
   ```typescript
   // idle → scouting: always allowed
   // scouting → preparing: at least one opportunity found OR strategy decided
   // preparing → launching: narrative generated, wallets funded, token config ready
   // launching → accumulating: token created successfully, dev buy complete
   // accumulating → trading: target supply accumulated, traders ready
   // trading → monitoring: initial trading period complete, positions established
   // monitoring → exiting: exit signal (target P&L, stop-loss, manual, timeout)
   // exiting → cleanup: all positions closed
   // cleanup → stopped: funds reclaimed, report generated
   // ANY → error: on critical failure
   // error → cleanup: when error is acknowledged
   // ANY → stopped: on manual stop (force=true)
   ```

6. **PhaseTransitionCheck**:
   ```typescript
   interface PhaseTransitionCheck {
     allowed: boolean;
     from: SwarmPhase;
     to: SwarmPhase;
     requirements: PhaseRequirements;
     blockers: string[];              // Human-readable reasons why transition is blocked
   }
   ```

7. **PhaseHistoryEntry**:
   ```typescript
   interface PhaseHistoryEntry {
     phase: SwarmPhase;
     enteredAt: number;
     exitedAt?: number;
     duration: number;
     exitReason: 'transition' | 'timeout' | 'force' | 'error';
     nextPhase?: SwarmPhase;
   }
   ```

8. **Phase timeout handling**:
   - Each phase has an optional max duration
   - `checkTimeouts()` should be called periodically (every 10s)
   - When timeout hit, transition to `timeoutTransitions[currentPhase]` or `error`
   - Log warning at 80% and 90% of timeout
   - Emit `phase:timeout-warning` at 80%, `phase:timeout` at 100%

9. **Event emissions**:
   ```typescript
   // 'phase:transition' — { from, to, reason }
   // 'phase:entered' — { phase, requirements }
   // 'phase:timeout-warning' — { phase, remaining }
   // 'phase:timeout' — { phase, duration }
   // 'phase:condition-met' — { phase, condition }
   ```

### Success Criteria

- Phase transitions respect preconditions
- `canTransition` accurately reports what's blocking
- Force transitions bypass preconditions (for manual override and errors)
- Phase history maintains complete timeline
- Timeout checks fire at correct thresholds
- Condition tracking works (set externally, checked internally)
- Compiles with `npx tsc --noEmit`
