# Prompt 41 — Signal Generator

## Agent Identity & Rules

```
You are the SIGNAL-GENERATOR builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real on-chain data from Solana RPC
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add on-chain signal generator for bonding curve trading signals"
```

## Objective

Create `packages/pump-agent-swarm/src/intelligence/signal-generator.ts` — generates buy/sell signals from real-time bonding curve data. Computes momentum, volume acceleration, price velocity, holder flow, whale detection, and RSI-like indicators adapted for Pump.fun bonding curves.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/intelligence/signal-generator.ts`

## Dependencies

- `@solana/web3.js` — `Connection`, `PublicKey`, `AccountInfo`
- `@pump-fun/pump-sdk` — bonding curve decoding
- `types.ts` — `BondingCurveState`
- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging
- `bn.js` — big number math

## Deliverables

### Create `packages/pump-agent-swarm/src/intelligence/signal-generator.ts`

1. **`SignalGenerator` class**:
   - `constructor(connection: Connection, eventBus: SwarmEventBus, config?: SignalConfig)`
   - `generateSignals(mint: string): Promise<TradingSignals>` — compute all signals for a token
   - `startMonitoring(mint: string, intervalMs: number): void` — continuous signal monitoring
   - `stopMonitoring(mint: string): void` — stop monitoring a token
   - `getSignalHistory(mint: string): SignalSnapshot[]` — historical signals
   - `getLatestSignals(mint: string): TradingSignals | undefined` — cached latest
   - `computeMomentum(snapshots: CurveSnapshot[]): MomentumSignal` — rate of change in reserves
   - `computeVolumeAcceleration(snapshots: CurveSnapshot[]): VolumeSignal` — volume trend
   - `computePriceVelocity(snapshots: CurveSnapshot[]): PriceVelocitySignal` — price movement speed
   - `computeRSI(snapshots: CurveSnapshot[], period: number): number` — RSI-like indicator
   - `detectWhaleActivity(mint: string): Promise<WhaleSignal>` — large wallet movements

2. **SignalConfig**:
   ```typescript
   interface SignalConfig {
     /** Number of snapshots to keep for analysis */
     historyLength: number;         // default: 100
     /** Snapshot interval when monitoring (ms) */
     snapshotInterval: number;      // default: 5000 (5s)
     /** RSI period (number of snapshots) */
     rsiPeriod: number;             // default: 14
     /** Momentum lookback period (snapshots) */
     momentumPeriod: number;        // default: 10
     /** Whale threshold: min SOL for a single trade to be "whale" */
     whaleThresholdSOL: number;     // default: 5
     /** Signal strength thresholds */
     thresholds: {
       strongBuy: number;           // default: 80
       buy: number;                 // default: 60
       sell: number;                // default: 40
       strongSell: number;          // default: 20
     };
   }
   ```

3. **CurveSnapshot** — a point-in-time reading of the bonding curve:
   ```typescript
   interface CurveSnapshot {
     timestamp: number;
     slot: number;
     virtualSolReserves: bigint;
     virtualTokenReserves: bigint;
     realSolReserves: bigint;
     realTokenReserves: bigint;
     price: number;                  // SOL per token
     totalSupplyHeld: bigint;        // tokens purchased from curve
   }
   ```
   - Read via `connection.getAccountInfo(bondingCurveAddress)` and decode using pump-sdk
   - Take snapshots at configured interval during monitoring

4. **TradingSignals** — aggregate output:
   ```typescript
   interface TradingSignals {
     /** Overall signal direction */
     overall: 'strong-buy' | 'buy' | 'neutral' | 'sell' | 'strong-sell';
     /** Numeric score: 0 = strong sell, 50 = neutral, 100 = strong buy */
     score: number;
     /** Confidence in signal quality (0-1), based on data freshness and consistency */
     confidence: number;
     /** Individual indicators */
     indicators: {
       momentum: MomentumSignal;
       volumeAcceleration: VolumeSignal;
       priceVelocity: PriceVelocitySignal;
       rsi: RSISignal;
       whaleActivity: WhaleSignal;
       graduationProximity: GraduationSignal;
     };
     /** Timestamp of signal generation */
     generatedAt: number;
     /** Number of snapshots used for computation */
     dataPoints: number;
     /** Mint address */
     mint: string;
   }
   ```

5. **Individual signal types**:
   ```typescript
   interface MomentumSignal {
     /** Rate of change in SOL reserves (positive = buying pressure) */
     value: number;
     /** Normalized direction: -1 to 1 */
     direction: number;
     /** Signal: buy/sell/neutral */
     signal: 'buy' | 'sell' | 'neutral';
     /** How many periods the momentum has been sustained */
     sustainedPeriods: number;
   }

   interface VolumeSignal {
     /** Is volume increasing or decreasing? */
     acceleration: number;          // positive = increasing
     /** Current period volume in SOL */
     currentVolume: number;
     /** Previous period volume in SOL */
     previousVolume: number;
     /** Signal */
     signal: 'buy' | 'sell' | 'neutral';
   }

   interface PriceVelocitySignal {
     /** Price change per snapshot period */
     velocity: number;
     /** Is velocity increasing (acceleration) or decreasing (deceleration)? */
     accelerating: boolean;
     /** Percent change over lookback period */
     percentChange: number;
     signal: 'buy' | 'sell' | 'neutral';
   }

   interface RSISignal {
     /** RSI value: 0-100 */
     value: number;
     /** Interpretation */
     condition: 'overbought' | 'neutral' | 'oversold';
     /** Signal (oversold = buy opportunity, overbought = sell opportunity) */
     signal: 'buy' | 'sell' | 'neutral';
   }

   interface WhaleSignal {
     /** Has whale activity been detected? */
     detected: boolean;
     /** Direction of whale activity */
     direction: 'buying' | 'selling' | 'mixed' | 'none';
     /** Estimated SOL volume from whale transactions */
     estimatedVolume: number;
     signal: 'buy' | 'sell' | 'neutral';
   }

   interface GraduationSignal {
     /** How close to graduation threshold (0-100%) */
     proximityPercent: number;
     /** Estimated time to graduation at current rate (ms), -1 if moving away */
     estimatedTimeMs: number;
     /** Is graduation imminent? */
     imminent: boolean;
     signal: 'buy' | 'sell' | 'neutral';
   }
   ```

6. **RSI calculation** (adapted for bonding curves):
   - Instead of close prices, use change in `virtualSolReserves` between snapshots
   - Positive change = "up period" (buying), negative = "down period" (selling)
   - RSI = 100 - (100 / (1 + RS)), where RS = avg gains / avg losses over N periods
   - RSI > 70 = overbought, RSI < 30 = oversold
   - Use exponential moving average for smoothing

7. **Whale detection**:
   - Fetch recent transactions on the bonding curve account
   - Use `connection.getSignaturesForAddress(bondingCurveAddress, { limit: 20 })`
   - Parse transaction data to identify buys/sells above whale threshold
   - Whale buying = bullish signal, whale selling = bearish signal

8. **Signal aggregation**:
   - Each indicator contributes a weighted score (configurable weights)
   - Default weights: momentum 25%, volume 20%, price velocity 15%, RSI 20%, whale 10%, graduation 10%
   - Aggregate score determines overall signal rating
   - Low confidence if: few data points, conflicting signals, stale data

### Success Criteria

- Reads real bonding curve data from Solana RPC
- RSI calculation produces valid 0-100 values
- Momentum correctly detects buying vs selling pressure
- Whale detection identifies large transactions
- Signal aggregation weights produce meaningful overall signals
- Continuous monitoring with configurable interval works
- Compiles with `npx tsc --noEmit`
