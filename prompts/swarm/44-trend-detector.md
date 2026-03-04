# Prompt 44 — Trend Detector

## Agent Identity & Rules

```
You are the TREND-DETECTOR builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real Pump.fun API data
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add market trend detector for optimal launch timing"
```

## Objective

Create `packages/pump-agent-swarm/src/intelligence/trend-detector.ts` — identifies market trends and optimal launch timing by monitoring Pump.fun launch patterns, graduation rates, volume distribution, and category popularity.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/intelligence/trend-detector.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging
- Node.js `fetch` for API calls

## Deliverables

### Create `packages/pump-agent-swarm/src/intelligence/trend-detector.ts`

1. **`TrendDetector` class**:
   - `constructor(eventBus: SwarmEventBus, config?: TrendConfig)`
   - `detectTrends(): Promise<MarketTrends>` — comprehensive trend analysis
   - `isGoodTimeToLaunch(): Promise<LaunchTimingAssessment>` — should we launch now?
   - `getTrendingCategories(): Promise<CategoryTrend[]>` — what categories are hot
   - `getMarketActivity(): Promise<ActivityMetrics>` — overall Pump.fun activity levels
   - `startTracking(intervalMs: number): void` — continuous trend tracking
   - `stopTracking(): void`
   - `getHistoricalTrends(): MarketTrends[]` — trend history

2. **TrendConfig**:
   ```typescript
   interface TrendConfig {
     /** Pump.fun API base URL */
     pumpFunApiBase: string;         // 'https://frontend-api-v3.pump.fun'
     /** How many recent coins to analyze */
     recentCoinsLimit: number;       // default: 200
     /** Cache TTL (ms) */
     cacheTtl: number;               // default: 300000 (5 min)
     /** Categories to track */
     trackedCategories: string[];    // ['ai', 'animal', 'political', 'tech', 'culture', 'defi']
   }
   ```

3. **Real Pump.fun API calls**:
   ```typescript
   // Recent launches:
   // GET https://frontend-api-v3.pump.fun/coins?sort=created_timestamp&order=desc&limit=50&offset=0
   //
   // Top by market cap:
   // GET https://frontend-api-v3.pump.fun/coins?sort=market_cap&order=desc&limit=50
   //
   // Token details:
   // GET https://frontend-api-v3.pump.fun/coins/{mint}
   //
   // King of the Hill (about to graduate):
   // GET https://frontend-api-v3.pump.fun/coins/king-of-the-hill?includeNsfw=false
   //
   // Response shape: { mint, name, symbol, description, image_uri, market_cap,
   //   reply_count, created_timestamp, raydium_pool, complete, ... }
   ```

4. **MarketTrends**:
   ```typescript
   interface MarketTrends {
     /** Overall market activity level */
     activityLevel: 'dead' | 'low' | 'moderate' | 'high' | 'frenzy';
     /** Launches per hour (rolling) */
     launchesPerHour: number;
     /** Graduation rate: % of tokens that graduate in last 24h */
     graduationRate: number;
     /** Average market cap of recent launches */
     avgMarketCap: number;
     /** Category breakdown */
     categories: CategoryTrend[];
     /** Trending tokens (fastest growing) */
     trendingTokens: Array<{ mint: string; name: string; symbol: string; marketCap: number; growth: number }>;
     /** Tokens close to graduation */
     nearGraduation: Array<{ mint: string; name: string; progress: number }>;
     /** Optimal launch window assessment */
     launchTiming: LaunchTimingAssessment;
     /** Time-of-day activity pattern (24 hours, UTC) */
     hourlyActivity: number[];
     /** Analyzed at */
     timestamp: number;
   }
   ```

5. **CategoryTrend**:
   ```typescript
   interface CategoryTrend {
     /** Category name */
     category: string;
     /** Number of launches in this category (recent) */
     launchCount: number;
     /** Percentage of total launches */
     launchShare: number;
     /** Average market cap in this category */
     avgMarketCap: number;
     /** Is this category trending up or down? */
     momentum: 'rising' | 'stable' | 'falling';
     /** Graduation rate for this category */
     graduationRate: number;
     /** Example tokens */
     examples: Array<{ name: string; symbol: string; marketCap: number }>;
     /** Score: 0-100 overall hotness */
     score: number;
   }
   ```

6. **LaunchTimingAssessment**:
   ```typescript
   interface LaunchTimingAssessment {
     /** Overall score: 0-100 (higher = better time to launch) */
     score: number;
     /** Should we launch now? */
     recommendation: 'launch-now' | 'wait' | 'avoid';
     /** Factors contributing to recommendation */
     factors: Array<{
       factor: string;
       score: number;
       weight: number;
       reasoning: string;
     }>;
     /** Estimated best launch window (UTC hours) */
     bestHours: number[];
     /** How long until next good window (ms), 0 if now is good */
     nextWindowMs: number;
     /** Warnings */
     warnings: string[];
   }
   ```

7. **Category classification logic**:
   - Classify tokens by name/description keywords:
     - AI/tech: "ai", "gpt", "agent", "bot", "neural", "quantum", "cyber"
     - Animal: "dog", "cat", "pepe", "frog", "shiba", "inu", "bear", "bull"
     - Political: "trump", "biden", "elon", "musk", "president", "vote"
     - Culture: "meme", "based", "chad", "wojak", "npc", "sigma"
     - DeFi: "swap", "yield", "stake", "pool", "vault", "protocol"
   - Use case-insensitive matching on name + symbol + description

8. **Launch timing factors**:
   - **Activity level**: moderate is best (too low = no audience, too high = competition)
   - **Time of day**: US market hours (14:00-02:00 UTC) see highest activity
   - **Graduation rate**: higher rate = more engaged traders = better
   - **Category saturation**: avoid launching in an already saturated category
   - **Overall crypto sentiment**: bull > crab > bear for launches

### Success Criteria

- Real Pump.fun API calls return valid data
- Category classification correctly buckets tokens
- Graduation rate calculation is accurate
- Launch timing factors produce meaningful scores
- Trend history is maintained across invocations
- Caching prevents excessive API calls
- Compiles with `npx tsc --noEmit`
