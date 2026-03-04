# Prompt 49 — Portfolio Optimizer

## Agent Identity & Rules

```
You are the PORTFOLIO-OPTIMIZER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real portfolio math with real position data
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add portfolio optimizer with modern portfolio theory for memecoins"
```

## Objective

Create `packages/pump-agent-swarm/src/intelligence/portfolio-optimizer.ts` — optimizes allocation across multiple tokens when the swarm operates on several simultaneously. Adapts Modern Portfolio Theory concepts for memecoin bonding curves, including covariance estimation, efficient frontier computation, and risk-return optimization.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/intelligence/portfolio-optimizer.ts`

## Dependencies

- `types.ts` — `BondingCurveState`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/intelligence/portfolio-optimizer.ts`

1. **`PortfolioOptimizer` class**:
   - `constructor(config?: PortfolioOptimizerConfig)`
   - `optimize(holdings: TokenHolding[], budget: number): PortfolioAllocation` — compute optimal allocation
   - `rebalance(current: PortfolioState, target: PortfolioAllocation): RebalanceAction[]` — generate rebalance trades
   - `calculateCorrelation(returns1: number[], returns2: number[]): number` — Pearson correlation
   - `calculateCovariance(returns1: number[], returns2: number[]): number` — covariance
   - `buildCovarianceMatrix(tokenReturns: Map<string, number[]>): number[][]` — full covariance matrix
   - `getEfficientFrontier(tokens: TokenHolding[], points: number): EfficientFrontierPoint[]` — efficient frontier
   - `maxSharpeRatio(tokens: TokenHolding[]): PortfolioAllocation` — maximum Sharpe ratio portfolio
   - `minVariance(tokens: TokenHolding[]): PortfolioAllocation` — minimum variance portfolio
   - `calculatePortfolioMetrics(allocation: PortfolioAllocation): PortfolioMetrics` — return/risk metrics

2. **PortfolioOptimizerConfig**:
   ```typescript
   interface PortfolioOptimizerConfig {
     /** Risk-free rate for Sharpe ratio (annualized, e.g., 0.05 = 5%) */
     riskFreeRate: number;           // default: 0.05
     /** Max allocation to any single token (0-1) */
     maxSingleAllocation: number;    // default: 0.40
     /** Min allocation (below this, don't bother) */
     minAllocation: number;          // default: 0.05
     /** Min number of tokens in portfolio */
     minTokens: number;              // default: 2
     /** Max number of tokens */
     maxTokens: number;              // default: 10
     /** Return calculation window (number of price points) */
     returnWindow: number;           // default: 20
     /** Risk tolerance: 0 = min variance, 1 = max return */
     riskTolerance: number;          // default: 0.5
   }
   ```

3. **TokenHolding**:
   ```typescript
   interface TokenHolding {
     mint: string;
     name: string;
     symbol: string;
     /** Current allocation in SOL */
     currentAllocation: number;
     /** Current value in SOL */
     currentValue: number;
     /** Historical price points (SOL per token, time-ordered) */
     priceHistory: PricePoint[];
     /** Expected return estimate */
     expectedReturn?: number;
     /** Current bonding curve state */
     curveState?: BondingCurveState;
   }

   interface PricePoint {
     timestamp: number;
     price: number;
   }
   ```

4. **PortfolioAllocation**:
   ```typescript
   interface PortfolioAllocation {
     /** Map of mint address to allocation weight (0-1, sum to 1.0) */
     weights: Map<string, number>;
     /** Expected portfolio return */
     expectedReturn: number;
     /** Portfolio standard deviation (risk) */
     risk: number;
     /** Sharpe ratio */
     sharpeRatio: number;
     /** Concentration: Herfindahl index of weights */
     concentration: number;
     /** Optimization method used */
     method: 'max-sharpe' | 'min-variance' | 'risk-parity' | 'equal-weight' | 'custom';
     /** Timestamp */
     computedAt: number;
   }
   ```

5. **RebalanceAction**:
   ```typescript
   interface RebalanceAction {
     mint: string;
     action: 'buy' | 'sell' | 'hold';
     /** Current weight */
     currentWeight: number;
     /** Target weight */
     targetWeight: number;
     /** Delta weight */
     deltaWeight: number;
     /** SOL amount to trade */
     deltaSOL: number;
     /** Priority (larger deltas first) */
     priority: number;
   }
   ```

6. **EfficientFrontierPoint**:
   ```typescript
   interface EfficientFrontierPoint {
     /** Portfolio return at this point */
     return: number;
     /** Portfolio risk (std dev) at this point */
     risk: number;
     /** Allocation weights for this point */
     weights: Map<string, number>;
     /** Sharpe ratio */
     sharpeRatio: number;
   }
   ```

7. **PortfolioMetrics**:
   ```typescript
   interface PortfolioMetrics {
     expectedReturn: number;
     standardDeviation: number;
     sharpeRatio: number;
     sortinoRatio: number;            // Downside deviation only
     maxDrawdownEstimate: number;     // From variance
     diversificationRatio: number;    // Weighted avg individual risk / portfolio risk
     concentrationIndex: number;      // Herfindahl
     effectiveTokens: number;         // 1 / Herfindahl (effective diversification)
   }
   ```

8. **Return calculation**:
   ```typescript
   // Simple returns from price history:
   // r_i = (P_i - P_{i-1}) / P_{i-1}
   //
   // Expected return = mean of returns * scaling factor
   // Annualized (rough): daily return * 365 (or per-period * periods-per-year)
   //
   // For bonding curve tokens, use price derived from reserves:
   // price = virtualSolReserves / virtualTokenReserves
   ```

9. **Optimization algorithm** (simplified mean-variance):
   ```typescript
   // For small number of tokens (< 10), use grid search:
   // 1. Generate weight combinations respecting constraints
   //    (step size = 0.05, all weights >= minAllocation, all <= maxAllocation, sum = 1)
   // 2. For each combination, compute portfolio return and risk:
   //    - Portfolio return = sum(w_i * r_i)
   //    - Portfolio variance = w^T * Σ * w  (w = weights, Σ = covariance matrix)
   //    - Portfolio risk = sqrt(variance)
   // 3. Compute Sharpe ratio = (return - riskFreeRate) / risk
   // 4. Select combination maximizing Sharpe ratio (or minimizing variance, per config)
   //
   // For max-sharpe: pick highest Sharpe ratio
   // For min-variance: pick lowest risk
   // For risk-parity: equalize risk contribution from each token
   // For custom risk tolerance: pick point on efficient frontier matching tolerance
   ```

10. **Rebalance calculation**:
    ```typescript
    // Compare current weights to target weights
    // For each token:
    //   delta = targetWeight - currentWeight
    //   deltaSOL = delta * totalBudget
    //   If deltaSOL > threshold → buy or sell
    //   If deltaSOL < threshold → hold (avoid unnecessary trades for small deltas)
    // Sort actions by absolute delta (largest first for priority)
    // Execute sells before buys (to free up capital)
    ```

### Success Criteria

- Covariance matrix correctly computed from return series
- Efficient frontier generates valid risk-return tradeoff curve
- Max Sharpe portfolio finds optimal risk-adjusted allocation
- Constraints (max/min allocation) are properly enforced
- Rebalance actions correctly compute buy/sell amounts
- Portfolio metrics (Sharpe, Sortino, concentration) are accurate
- Compiles with `npx tsc --noEmit`
