# Prompt 42 — Risk Manager

## Agent Identity & Rules

```
You are the RISK-MANAGER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real risk calculations with real position data
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add portfolio risk manager with stop-loss and circuit breaker"
```

## Objective

Create `packages/pump-agent-swarm/src/intelligence/risk-manager.ts` — prevents the swarm from taking excessive risk. Enforces position limits, stop-losses, max drawdown, and implements a circuit breaker that halts trading when losses exceed thresholds.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/intelligence/risk-manager.ts`

## Dependencies

- `types.ts` — `TradeOrder`, `TradeResult`
- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/intelligence/risk-manager.ts`

1. **`RiskManager` class**:
   - `constructor(config: RiskLimits, eventBus: SwarmEventBus)`
   - `assessRisk(proposedAction: ProposedTradeAction): RiskAssessment` — approve/reject/modify a trade
   - `enforceStopLoss(positions: Position[]): StopLossAction[]` — check positions against stop-loss
   - `calculatePositionSize(budget: number, riskPercent: number, conviction: number): number` — Kelly-inspired sizing
   - `getPortfolioRisk(): PortfolioRiskReport` — aggregate risk report
   - `updatePosition(mint: string, trade: TradeResult): void` — track position changes
   - `checkCircuitBreaker(): CircuitBreakerStatus` — should we halt trading?
   - `tripCircuitBreaker(reason: string): void` — manually trip circuit breaker
   - `resetCircuitBreaker(): void` — re-enable trading after review
   - `getDrawdown(): DrawdownInfo` — current drawdown from peak
   - `getRiskMetrics(): RiskMetrics` — current risk metrics snapshot

2. **RiskLimits** (configurable thresholds):
   ```typescript
   interface RiskLimits {
     /** Max SOL in any single position */
     maxPositionSize: number;
     /** Max total SOL deployed across all positions */
     maxTotalDeployed: number;
     /** Max % of budget in any single token */
     maxPositionPercent: number;
     /** Stop-loss: exit if position drops below this % of entry (e.g., 0.7 = -30%) */
     stopLossPercent: number;
     /** Max drawdown from peak before circuit breaker trips (e.g., 0.25 = -25%) */
     maxDrawdownPercent: number;
     /** Max drawdown in absolute SOL terms */
     maxDrawdownSOL: number;
     /** Max number of simultaneous token positions */
     maxConcurrentPositions: number;
     /** Max loss in a single time window before pause */
     maxLossPerWindow: number;
     /** Time window for maxLossPerWindow (ms) */
     lossWindowMs: number;
     /** Circuit breaker cooldown period (ms) */
     circuitBreakerCooldown: number;
     /** Max consecutive losing trades before pause */
     maxConsecutiveLosses: number;
     /** Minimum time between trades per wallet (ms) */
     minTradeCooldown: number;
   }
   ```

3. **ProposedTradeAction & RiskAssessment**:
   ```typescript
   interface ProposedTradeAction {
     type: 'buy' | 'sell';
     mint: string;
     amountSOL: number;
     walletId: string;
     agentId: string;
     reason: string;
   }

   interface RiskAssessment {
     approved: boolean;
     action: 'approve' | 'reject' | 'modify';
     /** If modified, the adjusted parameters */
     modifiedAction?: Partial<ProposedTradeAction>;
     reasoning: string;
     riskScore: number;              // 0-100 (higher = riskier)
     violations: RiskViolation[];
     checkedAt: number;
   }

   interface RiskViolation {
     rule: string;
     current: number;
     limit: number;
     severity: 'warning' | 'critical';
     message: string;
   }
   ```

4. **Position tracking**:
   ```typescript
   interface Position {
     mint: string;
     entryPrice: number;             // Average entry price in SOL per token
     currentPrice: number;           // Current price
     tokenAmount: bigint;
     solInvested: number;
     currentValue: number;
     unrealizedPnL: number;
     unrealizedPnLPercent: number;
     highWaterMark: number;          // Highest value reached
     drawdownFromPeak: number;       // Current drawdown from high water mark
     entryTimestamp: number;
     lastUpdate: number;
     tradeCount: number;
   }
   ```

5. **Portfolio risk report**:
   ```typescript
   interface PortfolioRiskReport {
     totalDeployed: number;           // Total SOL in positions
     totalValue: number;              // Current market value
     totalPnL: number;
     totalPnLPercent: number;
     positions: Position[];
     positionCount: number;
     largestPosition: { mint: string; percent: number };
     drawdown: DrawdownInfo;
     circuitBreaker: CircuitBreakerStatus;
     riskScore: number;              // Aggregate portfolio risk 0-100
     warnings: string[];
     timestamp: number;
   }

   interface DrawdownInfo {
     peakValue: number;
     currentValue: number;
     drawdownSOL: number;
     drawdownPercent: number;
     peakTimestamp: number;
     duration: number;               // How long in drawdown (ms)
   }

   interface CircuitBreakerStatus {
     tripped: boolean;
     reason?: string;
     trippedAt?: number;
     cooldownRemaining?: number;
     autoResetAt?: number;
   }
   ```

6. **Kelly criterion position sizing**:
   ```typescript
   // Kelly fraction: f* = (bp - q) / b
   // where b = odds ratio, p = probability of win, q = probability of loss (1-p)
   //
   // Adapted for crypto:
   // - conviction (0-1) maps to estimated win probability
   // - riskPercent determines the fraction of Kelly to use (half-Kelly common)
   // - Final position: min(kelly_size, maxPositionSize, remainingBudget)
   //
   // Half-Kelly is used by default for smoother equity curve
   ```

7. **Circuit breaker logic**:
   - Monitors total portfolio drawdown in real-time
   - When drawdown > `maxDrawdownPercent` → trip circuit breaker
   - When loss in window > `maxLossPerWindow` → trip circuit breaker
   - When consecutive losses > `maxConsecutiveLosses` → trip circuit breaker
   - Once tripped: emit `risk:circuit-breaker-tripped` event, reject ALL new trades
   - Auto-reset after `circuitBreakerCooldown` period OR manual reset
   - Trades in progress continue (only NEW trades blocked)

8. **Stop-loss enforcement**:
   ```typescript
   interface StopLossAction {
     mint: string;
     currentPrice: number;
     entryPrice: number;
     lossPercent: number;
     action: 'exit-immediately' | 'trailing-stop-triggered' | 'hold';
     urgency: 'critical' | 'warning';
   }
   ```
   - Check all positions against stop-loss on every update
   - Emit `risk:stop-loss-triggered` event for each triggered position
   - Support trailing stop-loss (stop moves up with price, never down)

### Success Criteria

- Risk assessment correctly identifies limit violations
- Position sizing follows Kelly criterion with proper bounds
- Circuit breaker trips and resets correctly based on drawdown
- Stop-loss detection works with both fixed and trailing stops
- Portfolio risk report accurately aggregates all positions
- Risk events are emitted via event bus
- Compiles with `npx tsc --noEmit`
