# Prompt 46 — Market Regime Classifier

## Agent Identity & Rules

```
You are the MARKET-REGIME builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real market data APIs
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add market regime classifier with multi-source data"
```

## Objective

Create `packages/pump-agent-swarm/src/intelligence/market-regime.ts` — classifies current market conditions into regimes (bull, bear, crab, euphoria, capitulation) using data from multiple real sources. Maps each regime to strategy adjustments.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/intelligence/market-regime.ts`

## Dependencies

- `types.ts` — `TradingStrategy`
- `strategies.ts` — preset strategies
- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/intelligence/market-regime.ts`

1. **`MarketRegime` class**:
   - `constructor(eventBus: SwarmEventBus, config?: RegimeConfig)`
   - `classifyRegime(): Promise<RegimeClassification>` — current market regime
   - `getRegimeHistory(): RegimeEntry[]` — historical regime changes
   - `adjustStrategyForRegime(strategy: TradingStrategy, regime: RegimeClassification): TradingStrategy` — modify strategy for regime
   - `startMonitoring(intervalMs: number): void` — continuous monitoring
   - `stopMonitoring(): void`
   - `getDataSources(): Promise<RegimeDataSources>` — raw data from all sources

2. **RegimeConfig**:
   ```typescript
   interface RegimeConfig {
     /** Cache TTL for API data (ms) */
     cacheTtl: number;               // default: 300000 (5 min)
     /** Weights for each data source */
     weights: {
       solPrice: number;             // default: 0.25
       pumpFunActivity: number;      // default: 0.25
       fearGreed: number;            // default: 0.20
       defiTvl: number;              // default: 0.15
       memeIndex: number;            // default: 0.15
     };
   }
   ```

3. **Real API endpoints**:
   ```typescript
   // SOL price (Jupiter):
   // GET https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112
   // Returns: { data: { "So111...": { price: "123.45" } } }

   // Fear & Greed Index:
   // GET https://api.alternative.me/fng/?limit=7
   // Returns: { data: [{ value: "75", value_classification: "Greed", timestamp: "..." }] }

   // DeFi TVL (Solana):
   // GET https://api.llama.fi/v2/historicalChainTvl/Solana
   // Returns: [{ date: 1234567890, tvl: 12345678.90 }]

   // Pump.fun activity:
   // GET https://frontend-api-v3.pump.fun/coins?sort=created_timestamp&order=desc&limit=50
   // Count launches per time period, check graduation rates
   ```

4. **RegimeClassification**:
   ```typescript
   interface RegimeClassification {
     /** Current regime */
     regime: 'bull' | 'bear' | 'crab' | 'euphoria' | 'capitulation';
     /** Confidence in classification (0-1) */
     confidence: number;
     /** Numeric sentiment score: -100 (extreme fear) to 100 (extreme greed) */
     sentimentScore: number;
     /** Contributing factors */
     factors: RegimeFactor[];
     /** Strategy recommendations for this regime */
     strategyAdjustments: StrategyAdjustment[];
     /** Is the regime changing? */
     transitioning: boolean;
     /** If transitioning, what's the likely next regime? */
     likelyNextRegime?: string;
     /** Data freshness */
     dataAge: number;                // ms since oldest data point
     classifiedAt: number;
   }

   interface RegimeFactor {
     source: string;
     value: number;
     normalizedScore: number;        // -1 to 1 (bearish to bullish)
     weight: number;
     description: string;
   }
   ```

5. **RegimeEntry** (historical):
   ```typescript
   interface RegimeEntry {
     regime: string;
     startedAt: number;
     endedAt?: number;
     duration: number;
     sentimentScore: number;
     factors: RegimeFactor[];
   }
   ```

6. **Regime classification logic**:
   ```typescript
   // Aggregate weighted score from all sources:
   // score > 60  → euphoria
   // score > 30  → bull
   // score > -10 → crab
   // score > -40 → bear
   // score <= -40 → capitulation
   //
   // Each source normalizes to -1 to 1:
   // SOL price: 24h change > 10% → 1, > 5% → 0.5, -5% to 5% → 0, < -5% → -0.5, < -10% → -1
   // Fear & Greed: (value - 50) / 50
   // DeFi TVL: 7d change normalized
   // Pump.fun: launches/hr vs 7d average, normalized
   // Meme index: graduation rate vs historical average
   ```

7. **Strategy adjustments per regime**:
   ```typescript
   interface StrategyAdjustment {
     parameter: string;
     currentValue: number | string;
     adjustedValue: number | string;
     reason: string;
   }

   // Regime → Strategy mapping:
   // euphoria: aggressive buys, fast trades, high volume, GRADUATION strategy
   // bull: moderate buys, balanced trades, ORGANIC strategy
   // crab: reduce activity, smaller positions, ORGANIC with wider intervals
   // bear: defensive, prefer exits, EXIT strategy for existing positions
   // capitulation: halt new launches, exit all positions, preserve capital
   ```

8. **RegimeDataSources** (raw data for transparency):
   ```typescript
   interface RegimeDataSources {
     solPrice: { price: number; change24h: number; change7d: number };
     fearGreed: { value: number; classification: string };
     defiTvl: { current: number; change7d: number };
     pumpFunActivity: { launchesPerHour: number; graduationRate: number; avgMarketCap: number };
     memeIndex: { score: number; trend: 'up' | 'down' | 'flat' };
     fetchedAt: number;
   }
   ```

### Success Criteria

- Fetches real data from all 4 API sources
- Regime classification responds meaningfully to different market conditions
- Strategy adjustment produces different parameters per regime
- Regime history tracks transitions with timestamps
- Monitoring mode emits events on regime changes
- API failures gracefully handled (stale data used with lower confidence)
- Compiles with `npx tsc --noEmit`
