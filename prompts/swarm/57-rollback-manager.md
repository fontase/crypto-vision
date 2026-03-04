# Prompt 57 — Rollback Manager

## Agent Identity & Rules

```
You are the ROLLBACK-MANAGER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real state snapshots of actual swarm state
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add state rollback manager with snapshot and restore"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/rollback-manager.ts` — takes snapshots of swarm internal state before risky operations and can restore on failure. On-chain state (transactions) cannot be rolled back, but the orchestrator's decision-making state can be restored so it makes correct decisions going forward.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/rollback-manager.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/rollback-manager.ts`

1. **`RollbackManager` class**:
   - `constructor(eventBus: SwarmEventBus, config?: RollbackConfig)`
   - `createSnapshot(label: string, state: SwarmState): string` — take snapshot, return ID
   - `rollback(snapshotId: string): SwarmState` — restore and return state
   - `getSnapshots(): SnapshotInfo[]` — list all snapshots
   - `getSnapshot(id: string): Snapshot | undefined` — get specific snapshot
   - `deleteSnapshot(id: string): void` — delete a snapshot
   - `autoSnapshot(label: string, state: SwarmState): string` — same as createSnapshot but respects auto-limit
   - `pruneOldSnapshots(keepCount: number): number` — remove oldest, return count deleted
   - `getLatestSnapshot(): Snapshot | undefined`
   - `diffSnapshots(id1: string, id2: string): SnapshotDiff` — compare two snapshots

2. **RollbackConfig**:
   ```typescript
   interface RollbackConfig {
     /** Max snapshots to keep */
     maxSnapshots: number;           // default: 20
     /** Auto-prune when limit reached */
     autoPrune: boolean;             // default: true
     /** Whether to deep-clone state (vs shallow copy) */
     deepClone: boolean;             // default: true
   }
   ```

3. **SwarmState** (what gets snapshotted):
   ```typescript
   interface SwarmState {
     /** Current phase */
     phase: string;
     /** Strategy parameters */
     strategy: Record<string, unknown>;
     /** Position data */
     positions: Array<{
       mint: string;
       tokens: string;               // bigint as string for serialization
       solInvested: number;
       entryPrice: number;
     }>;
     /** Wallet balances (cached, not live) */
     walletBalances: Map<string, number>;
     /** Agent statuses */
     agentStatuses: Map<string, string>;
     /** Risk metrics */
     riskMetrics: Record<string, number>;
     /** Configuration snapshot */
     config: Record<string, unknown>;
     /** Active mint (if any) */
     activeMint?: string;
     /** Trade count so far */
     tradeCount: number;
     /** P&L at snapshot time */
     pnl: { realized: number; unrealized: number };
     /** Custom data (agents can add their own state) */
     customData: Record<string, unknown>;
   }
   ```

4. **Snapshot**:
   ```typescript
   interface Snapshot {
     id: string;
     label: string;
     state: SwarmState;
     createdAt: number;
     /** Size estimate in bytes */
     sizeBytes: number;
   }

   interface SnapshotInfo {
     id: string;
     label: string;
     createdAt: number;
     sizeBytes: number;
   }
   ```

5. **SnapshotDiff**:
   ```typescript
   interface SnapshotDiff {
     snapshot1: string;
     snapshot2: string;
     changes: Array<{
       path: string;                  // e.g., 'phase', 'positions[0].tokens'
       oldValue: unknown;
       newValue: unknown;
     }>;
     positionsAdded: number;
     positionsRemoved: number;
     phaseChanged: boolean;
     pnlDelta: { realized: number; unrealized: number };
   }
   ```

6. **Deep clone implementation**:
   - Use `structuredClone()` for deep cloning (available in Node.js 17+)
   - Handle BigInt serialization (convert to string before, restore after)
   - Handle Map serialization (convert to array of entries)
   - Size estimation: `JSON.stringify(state).length * 2` (rough bytes estimate)

7. **Auto-snapshot triggers** — the orchestrator should call `autoSnapshot` before:
   - Every phase transition
   - Before token launch
   - Before major strategy changes
   - Before exit procedures

8. **Events emitted**:
   ```typescript
   // 'rollback:snapshot-created' — { id, label }
   // 'rollback:restored' — { id, label, phase }
   // 'rollback:snapshot-deleted' — { id }
   // 'rollback:pruned' — { count }
   ```

### Success Criteria

- Deep clone produces independent copies (modifying one doesn't affect other)
- BigInt and Map serialization/deserialization works correctly
- Rollback restores exact state from snapshot
- Diff calculation identifies meaningful changes between snapshots
- Auto-pruning respects max limit
- Size estimation is reasonable
- Compiles with `npx tsc --noEmit`
