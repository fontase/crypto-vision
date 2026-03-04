# Prompt 40 — Strategy Brain

## Agent Identity & Rules

```
You are the STRATEGY-BRAIN builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real OpenRouter API calls, real on-chain data
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add AI strategy brain for autonomous decision-making"
```

## Objective

Create `packages/pump-agent-swarm/src/intelligence/strategy-brain.ts` — the AI decision engine that is the brain of the entire swarm. It decides whether to create a new token vs buy an existing one, which trading strategy to use, and when to switch phases. Uses LLM calls for complex strategic reasoning and on-chain data for tactical decisions.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/intelligence/strategy-brain.ts`

## Dependencies

- `types.ts` — `BondingCurveState`, `TradingStrategy`, `SwarmConfig`
- `strategies.ts` — preset strategies (ORGANIC, VOLUME, GRADUATION, EXIT)
- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging
- `@solana/web3.js` — `Connection` for on-chain data

## Deliverables

### Create `packages/pump-agent-swarm/src/intelligence/strategy-brain.ts`

1. **`StrategyBrain` class**:
   - `constructor(config: StrategyBrainConfig, eventBus: SwarmEventBus)`
   - `decideAction(context: MarketContext): Promise<StrategyDecision>` — main decision: what should the swarm do next?
   - `evaluateToken(mint: string, connection: Connection): Promise<TokenAssessment>` — deep evaluation of a specific token
   - `shouldLaunch(narrative: string, marketContext: MarketContext): Promise<LaunchDecision>` — should we create a new token with this narrative?
   - `shouldBuyExisting(mint: string, marketContext: MarketContext): Promise<BuyDecision>` — should we buy into this existing token?
   - `selectStrategy(phase: string, metrics: SwarmMetrics): TradingStrategy` — pick the right trading strategy for current conditions
   - `adjustStrategy(currentStrategy: TradingStrategy, performance: PerformanceMetrics): TradingStrategy` — fine-tune strategy based on results
   - `getDecisionHistory(): StrategyDecision[]` — past decisions for learning

2. **StrategyBrainConfig**:
   ```typescript
   interface StrategyBrainConfig {
     /** OpenRouter API key */
     openRouterApiKey: string;
     /** Model to use for strategic reasoning */
     model: string; // default: 'google/gemini-2.0-flash-001'
     /** OpenRouter API base URL */
     apiBaseUrl: string; // 'https://openrouter.ai/api/v1'
     /** Max tokens for LLM response */
     maxTokens: number;
     /** Temperature for creativity vs consistency */
     temperature: number;
     /** Risk tolerance: 0-1 (0 = ultra conservative, 1 = degen) */
     riskTolerance: number;
     /** Minimum confidence score to act (0-1) */
     minConfidence: number;
     /** Maximum SOL budget per decision */
     maxBudgetPerAction: number;
     /** Cache TTL for market context (ms) */
     contextCacheTtl: number;
   }
   ```

3. **MarketContext** — gathered from real APIs before each decision:
   ```typescript
   interface MarketContext {
     /** SOL price in USD */
     solPrice: number;
     /** SOL 24h price change percent */
     solPriceChange24h: number;
     /** Pump.fun new launches in last hour */
     recentLaunchCount: number;
     /** Pump.fun graduation rate in last 24h */
     graduationRate: number;
     /** Trending narrative categories */
     trendingNarratives: string[];
     /** Fear & Greed index (0-100) */
     fearGreedIndex: number;
     /** Current swarm portfolio value in SOL */
     portfolioValue: number;
     /** Available SOL budget */
     availableBudget: number;
     /** Active positions count */
     activePositions: number;
     /** Current market regime */
     regime: 'bull' | 'bear' | 'crab' | 'euphoria' | 'capitulation';
     /** Top alpha opportunities detected */
     alphaOpportunities: Array<{ mint: string; name: string; score: number }>;
     /** Timestamp */
     timestamp: number;
   }
   ```

4. **StrategyDecision** — the brain's output:
   ```typescript
   interface StrategyDecision {
     /** What action to take */
     action: 'launch-new' | 'buy-existing' | 'adjust-strategy' | 'exit-position' | 'hold' | 'wait';
     /** Confidence 0-1 */
     confidence: number;
     /** Human-readable reasoning */
     reasoning: string;
     /** If launch-new: narrative details */
     launchParams?: {
       narrative: string;
       category: string;
       suggestedBudget: number;
       suggestedStrategy: string;
     };
     /** If buy-existing: target token */
     buyParams?: {
       mint: string;
       suggestedAmount: number;
       urgency: 'immediate' | 'soon' | 'watch';
     };
     /** If adjust-strategy: new parameters */
     strategyAdjustment?: {
       newStrategy: string;
       changes: Record<string, unknown>;
       reason: string;
     };
     /** If exit-position: which to exit */
     exitParams?: {
       mint: string;
       exitStrategy: 'gradual' | 'immediate' | 'trailing-stop';
       reason: string;
     };
     /** Timestamp of decision */
     decidedAt: number;
     /** Model used */
     model: string;
   }
   ```

5. **TokenAssessment**:
   ```typescript
   interface TokenAssessment {
     mint: string;
     overallScore: number;           // 0-100
     scores: {
       bondingCurveHealth: number;   // 0-100
       volumeQuality: number;       // 0-100
       holderDistribution: number;  // 0-100
       narrativeStrength: number;   // 0-100
       rugRisk: number;             // 0-100 (higher = SAFER)
       momentumScore: number;       // 0-100
     };
     recommendation: 'strong-buy' | 'buy' | 'hold' | 'avoid' | 'strong-avoid';
     reasoning: string;
     assessedAt: number;
   }
   ```

6. **LaunchDecision & BuyDecision**:
   ```typescript
   interface LaunchDecision {
     shouldLaunch: boolean;
     confidence: number;
     reasoning: string;
     suggestedTiming: 'now' | 'wait-1h' | 'wait-4h' | 'wait-24h' | 'dont';
     riskAssessment: string;
     estimatedSuccessProbability: number;
   }

   interface BuyDecision {
     shouldBuy: boolean;
     confidence: number;
     reasoning: string;
     suggestedAmount: number;        // SOL
     suggestedEntry: 'market' | 'limit' | 'dca';
     riskAssessment: string;
     targetExit: number;             // Target price multiple (e.g., 2.0 = 2x)
     stopLoss: number;               // Stop-loss price multiple (e.g., 0.7 = -30%)
   }
   ```

7. **SwarmMetrics & PerformanceMetrics**:
   ```typescript
   interface SwarmMetrics {
     totalTrades: number;
     totalVolume: number;
     activeTradersCount: number;
     averageTradeSize: number;
     buyToSellRatio: number;
     currentPhase: string;
     phaseElapsedMs: number;
     walletCount: number;
   }

   interface PerformanceMetrics {
     realizedPnL: number;
     unrealizedPnL: number;
     totalPnL: number;
     roi: number;                    // Percentage
     maxDrawdown: number;            // Percentage from peak
     winRate: number;                // % of profitable trades
     sharpeRatio: number;
     avgTradeProfit: number;
     bestTrade: number;
     worstTrade: number;
     tradingDuration: number;        // ms
   }
   ```

8. **OpenRouter LLM integration** — real API calls:
   ```typescript
   // POST https://openrouter.ai/api/v1/chat/completions
   // Headers:
   //   Authorization: Bearer ${OPENROUTER_API_KEY}
   //   Content-Type: application/json
   //   HTTP-Referer: https://crypto-vision.dev
   //   X-Title: CryptoVision Swarm
   //
   // Body:
   // {
   //   model: 'google/gemini-2.0-flash-001',
   //   messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: contextJson }],
   //   response_format: { type: 'json_object' },
   //   temperature: 0.3,
   //   max_tokens: 2000
   // }
   ```
   - System prompt should be a detailed crypto-native strategist persona
   - User prompt should contain the full MarketContext as structured JSON
   - Parse response as JSON matching StrategyDecision schema
   - Implement retry with exponential backoff on API failures
   - Cache decisions for 30 seconds to avoid redundant LLM calls

9. **Strategy selection logic** (non-LLM, fast path):
   - If portfolio is losing > 20%, switch to EXIT strategy
   - If momentum is strongly positive, use GRADUATION strategy
   - If volume is low, use VOLUME strategy to generate activity
   - If just launched, use ORGANIC for natural-looking early activity
   - Override LLM suggestion if risk limits would be violated

### Success Criteria

- Real OpenRouter API calls with structured JSON responses
- Decision quality reflects market context (don't suggest launching in a bear market)
- Strategy adjustments respond to performance metrics
- LLM failures gracefully fallback to rule-based decisions
- Decision history is maintained for analysis
- Compiles with `npx tsc --noEmit`
