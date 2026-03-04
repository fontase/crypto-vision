# Prompt 65 — P&L Dashboard

## Agent Identity & Rules

```
You are the PNL-DASHBOARD builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real P&L calculations from real trade data
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add P&L dashboard with time-series tracking and per-agent breakdown"
```

## Objective

Create `packages/pump-agent-swarm/src/dashboard/pnl-dashboard.ts` — real-time profit & loss tracking with time-series data for charting, per-agent breakdowns, and portfolio-level metrics.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/dashboard/pnl-dashboard.ts`

## Dependencies

- `../infra/event-bus` — SwarmEventBus (P04)
- `../types` — TradeResult (P01)
- `../infra/logging` — SwarmLogger (P07)

## Deliverables

### Create `packages/pump-agent-swarm/src/dashboard/pnl-dashboard.ts`

1. **`PnLDashboard` class**:
   - `constructor(eventBus: SwarmEventBus, config?: PnLConfig)`
   - `recordTrade(agentId: string, trade: PnLTrade): void` — ingest a trade for P&L tracking
   - `updatePrice(currentPrice: number): void` — update current token price for unrealized P&L
   - `getAggregatePnL(): PnLTimeSeries` — total portfolio P&L over time
   - `getPerAgentPnL(): Map<string, PnLTimeSeries>` — P&L per agent
   - `getRealized(): number` — total realized P&L in SOL
   - `getUnrealized(): number` — total unrealized P&L in SOL
   - `getCurrentROI(): number` — return on investment as percentage
   - `getSnapshot(): PnLSnapshot` — current state snapshot
   - `getTotalInvested(): number` — total SOL spent buying
   - `getTotalReturned(): number` — total SOL received from sells
   - `startSampling(intervalMs?: number): void` — start periodic P&L sampling
   - `stopSampling(): void` — stop sampling

2. **`PnLConfig` interface**:
   ```typescript
   interface PnLConfig {
     /** Sampling interval for time series (default: 10000ms) */
     samplingIntervalMs: number;
     /** Max data points to retain (default: 8640 — 24h at 10s) */
     maxDataPoints: number;
     /** Initial investment in SOL for ROI calculation */
     initialInvestment: number;
   }
   ```

3. **`PnLTrade` interface**:
   ```typescript
   interface PnLTrade {
     direction: 'buy' | 'sell';
     solAmount: number;
     tokenAmount: number;
     price: number;
     timestamp: number;
     fee: number;
   }
   ```

4. **`PnLTimeSeries` interface**:
   ```typescript
   interface PnLTimeSeries {
     /** Time series data points */
     points: PnLDataPoint[];
     /** Current snapshot */
     current: PnLDataPoint;
     /** Peak P&L */
     peak: number;
     /** Trough P&L */
     trough: number;
     /** Max drawdown from peak */
     maxDrawdown: number;
     /** Max drawdown percentage */
     maxDrawdownPercent: number;
   }

   interface PnLDataPoint {
     timestamp: number;
     /** Realized P&L (SOL from completed sells minus cost basis) */
     realized: number;
     /** Unrealized P&L (current value of held tokens minus cost basis) */
     unrealized: number;
     /** Total P&L (realized + unrealized) */
     total: number;
     /** Cumulative invested */
     invested: number;
     /** Cumulative returned */
     returned: number;
     /** ROI percentage */
     roi: number;
   }
   ```

5. **`PnLSnapshot` interface**:
   ```typescript
   interface PnLSnapshot {
     timestamp: number;
     totalRealized: number;
     totalUnrealized: number;
     totalPnl: number;
     roi: number;
     totalInvested: number;
     totalReturned: number;
     tokensHeld: number;
     currentPrice: number;
     costBasis: number;
     maxDrawdown: number;
     agentBreakdown: Array<{
       agentId: string;
       realized: number;
       unrealized: number;
       total: number;
       tradeCount: number;
     }>;
   }
   ```

6. **Core behavior**:
   - Track cost basis per agent using FIFO method (first tokens bought are first sold)
   - Realized P&L = sell proceeds - cost basis of sold tokens
   - Unrealized P&L = (current price × tokens held) - cost basis of held tokens
   - Subscribe to `trade:executed` events for automatic ingestion
   - Subscribe to `price:updated` events for unrealized P&L updates
   - Sample P&L at configurable intervals for time-series charts
   - Track peak portfolio value for drawdown calculation

### Success Criteria

- P&L calculated correctly using FIFO cost basis
- Time series sampled at configured intervals
- Per-agent P&L breakdown matches sum of individual trades
- ROI calculated relative to initial investment
- Drawdown tracked from peak portfolio value
- Compiles with `npx tsc --noEmit`
