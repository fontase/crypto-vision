# Prompt 58 — Audit Logger

## Agent Identity & Rules

```
You are the AUDIT-LOGGER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real audit entries from real events
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add immutable audit logger for full session traceability"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/audit-logger.ts` — an immutable, append-only audit trail that records every significant action taken by the swarm. Automatically subscribes to the event bus to capture trades, decisions, phase changes, errors, and more.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/audit-logger.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/audit-logger.ts`

1. **`AuditLogger` class**:
   - `constructor(eventBus: SwarmEventBus, config?: AuditConfig)`
   - `logAction(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'sequence'>): void` — log any action
   - `logTrade(trade: TradeAuditData): void` — convenience for trade logging
   - `logDecision(decision: DecisionAuditData): void` — convenience for strategy decisions
   - `logPhaseChange(from: string, to: string, reason: string): void`
   - `logError(error: Error | string, context: Record<string, unknown>): void`
   - `logWalletActivity(wallet: string, activity: string, amount?: number, signature?: string): void`
   - `getAuditTrail(filter?: AuditFilter): AuditEntry[]`
   - `getTradeAudit(): TradeAuditSummary`
   - `exportAuditLog(format: 'json' | 'csv'): string`
   - `getEntryCount(): number`
   - `startAutoCapture(): void` — subscribe to event bus events
   - `stopAutoCapture(): void`

2. **AuditConfig**:
   ```typescript
   interface AuditConfig {
     /** Max entries to keep (FIFO eviction) */
     maxEntries: number;             // default: 50000
     /** Auto-subscribe to event bus on construction */
     autoCapture: boolean;           // default: true
     /** Minimum severity to capture */
     minSeverity: 'debug' | 'info' | 'warning' | 'error';
     /** Include raw event data in entries */
     includeRawData: boolean;        // default: false
   }
   ```

3. **AuditEntry**:
   ```typescript
   interface AuditEntry {
     /** Auto-generated unique ID */
     id: string;
     /** Monotonically increasing sequence number */
     sequence: number;
     /** Timestamp */
     timestamp: number;
     /** Category of action */
     category: 'trade' | 'decision' | 'phase' | 'wallet' | 'risk' | 'agent' | 'system' | 'error';
     /** Severity level */
     severity: 'debug' | 'info' | 'warning' | 'error' | 'critical';
     /** Agent that performed the action (or 'system') */
     agentId: string;
     /** What happened */
     action: string;
     /** Detailed description */
     details: string;
     /** Relevant token mint address */
     mint?: string;
     /** On-chain transaction signature */
     signature?: string;
     /** Success or failure */
     success: boolean;
     /** Structured metadata */
     metadata: Record<string, unknown>;
   }
   ```

4. **Trade-specific audit data**:
   ```typescript
   interface TradeAuditData {
     agentId: string;
     mint: string;
     type: 'buy' | 'sell';
     amountSOL: number;
     amountTokens: string;           // bigint as string
     price: number;
     signature: string;
     slippage: number;
     fee: number;
     success: boolean;
     error?: string;
   }

   interface TradeAuditSummary {
     totalTrades: number;
     successfulTrades: number;
     failedTrades: number;
     totalBuys: number;
     totalSells: number;
     totalVolumeSOL: number;
     totalFees: number;
     uniqueTokens: number;
     uniqueAgents: number;
     firstTrade: number;             // timestamp
     lastTrade: number;
     avgTradeSize: number;
     tradesPerAgent: Record<string, number>;
   }
   ```

5. **Decision-specific audit data**:
   ```typescript
   interface DecisionAuditData {
     agentId: string;
     decisionType: string;
     action: string;
     confidence: number;
     reasoning: string;
     parameters: Record<string, unknown>;
   }
   ```

6. **AuditFilter**:
   ```typescript
   interface AuditFilter {
     category?: AuditEntry['category'][];
     severity?: AuditEntry['severity'][];
     agentId?: string;
     mint?: string;
     startTime?: number;
     endTime?: number;
     success?: boolean;
     limit?: number;
     offset?: number;
     search?: string;                // Text search in action/details
   }
   ```

7. **Auto-capture** — event bus subscriptions:
   ```typescript
   // Subscribe to these events and auto-create audit entries:
   // 'trade:executed' → category: 'trade'
   // 'trade:failed' → category: 'trade', success: false
   // 'decision:made' → category: 'decision'
   // 'phase:transition' → category: 'phase'
   // 'risk:*' → category: 'risk'
   // 'agent:*' → category: 'agent' (spawned, died, restarted)
   // 'wallet:*' → category: 'wallet'
   // 'error:*' → category: 'error'
   ```

8. **Export formats**:
   - JSON: array of AuditEntry objects, pretty-printed
   - CSV: flatten metadata into columns, one row per entry
   - Headers: id, sequence, timestamp, category, severity, agentId, action, details, mint, signature, success

9. **Append-only guarantee**:
   - Entries can only be added, never modified or deleted (except FIFO eviction at maxEntries)
   - Sequence numbers are monotonically increasing (never reset)
   - This ensures audit integrity for post-mortem analysis

### Success Criteria

- Auto-capture subscribes to all relevant event bus events
- Trade audit summary accurately counts and aggregates
- Filter queries return correct subsets
- Export produces valid JSON and CSV
- Sequence numbers are strictly monotonically increasing
- FIFO eviction correctly removes oldest entries
- Compiles with `npx tsc --noEmit`
