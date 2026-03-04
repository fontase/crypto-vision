# Prompt 43 — Sentiment Analyzer

## Agent Identity & Rules

```
You are the SENTIMENT-ANALYZER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real API calls to Twitter, Pump.fun, Google Trends
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add social sentiment analyzer with real API integrations"
```

## Objective

Create `packages/pump-agent-swarm/src/intelligence/sentiment-analyzer.ts` — analyzes social sentiment around tokens and narratives using real API integrations with Twitter/X, Pump.fun comments, and Google Trends. Combines keyword-based analysis with AI-powered sentiment scoring.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/intelligence/sentiment-analyzer.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging
- Node.js `fetch` for API calls

## Deliverables

### Create `packages/pump-agent-swarm/src/intelligence/sentiment-analyzer.ts`

1. **`SentimentAnalyzer` class**:
   - `constructor(config: SentimentConfig, eventBus: SwarmEventBus)`
   - `analyzeSentiment(query: string): Promise<SentimentReport>` — analyze sentiment for a keyword/phrase
   - `getTokenSentiment(mint: string, name: string, ticker: string): Promise<TokenSentiment>` — sentiment for a specific token
   - `getTrendingNarratives(): Promise<TrendingNarrative[]>` — what narratives are hot right now
   - `scoreSentiment(texts: string[]): SentimentScore` — quick local scoring of text array
   - `batchAnalyze(queries: string[]): Promise<Map<string, SentimentReport>>` — analyze multiple queries
   - `getAISentiment(texts: string[]): Promise<AISentimentResult>` — LLM-powered deep analysis

2. **SentimentConfig**:
   ```typescript
   interface SentimentConfig {
     /** Twitter Bearer Token (API v2) */
     twitterBearerToken?: string;
     /** OpenRouter API key for AI-powered sentiment */
     openRouterApiKey?: string;
     /** Model for AI analysis */
     aiModel: string;               // default: 'google/gemini-2.0-flash-001'
     /** Cache TTL (ms) */
     cacheTtl: number;              // default: 300000 (5 min)
     /** Max requests per minute to avoid rate limits */
     maxRequestsPerMinute: number;  // default: 30
     /** Enable/disable specific sources */
     sources: {
       twitter: boolean;
       pumpfunComments: boolean;
       googleTrends: boolean;
       aiAnalysis: boolean;
     };
   }
   ```

3. **Real API integrations**:

   **Twitter/X** (if bearer token available):
   ```typescript
   // GET https://api.twitter.com/2/tweets/search/recent
   // Headers: Authorization: Bearer ${token}
   // Query params: query=${keyword}+crypto, max_results=100, tweet.fields=created_at,public_metrics
   //
   // Fallback if no API key: use syndication endpoint
   // GET https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}
   ```

   **Pump.fun comments**:
   ```typescript
   // GET https://frontend-api-v3.pump.fun/replies/${mint}?limit=100&offset=0
   // No auth required, returns array of comment objects with text content
   ```

   **Google Trends** (unofficial):
   ```typescript
   // GET https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=-480&geo=US&ns=15
   // Parse response (starts with ")]}'" prefix — strip it before JSON.parse)
   ```

4. **SentimentReport**:
   ```typescript
   interface SentimentReport {
     query: string;
     /** Aggregate sentiment: -1 (very negative) to 1 (very positive) */
     score: number;
     /** Categorized sentiment */
     sentiment: 'very-positive' | 'positive' | 'neutral' | 'negative' | 'very-negative';
     /** How confident in the score (0-1), based on data volume */
     confidence: number;
     /** Volume of mentions/posts found */
     volume: number;
     /** Is this topic trending? */
     trending: boolean;
     /** Source breakdown */
     sources: {
       twitter?: SourceSentiment;
       pumpfun?: SourceSentiment;
       googleTrends?: TrendsData;
     };
     /** Keywords extracted from content */
     keywords: Array<{ word: string; count: number; sentiment: number }>;
     /** Timestamp */
     analyzedAt: number;
   }

   interface SourceSentiment {
     score: number;
     postCount: number;
     positiveCount: number;
     negativeCount: number;
     neutralCount: number;
     samplePosts: Array<{ text: string; sentiment: number; engagement?: number }>;
   }

   interface TrendsData {
     interestScore: number;          // 0-100
     relatedQueries: string[];
     rising: boolean;
   }
   ```

5. **TokenSentiment**:
   ```typescript
   interface TokenSentiment {
     mint: string;
     name: string;
     ticker: string;
     overallSentiment: number;       // -1 to 1
     sentiment: 'very-positive' | 'positive' | 'neutral' | 'negative' | 'very-negative';
     pumpfunComments: {
       count: number;
       sentiment: number;
       recentComments: Array<{ text: string; timestamp: number; sentiment: number }>;
     };
     twitterMentions: {
       count: number;
       sentiment: number;
       engagement: number;           // Total likes + retweets
     };
     communityHealth: number;        // 0-100 based on activity quality
     fudLevel: number;               // 0-100 how much FUD exists
     hypeMeter: number;              // 0-100 how hyped is it
     analyzedAt: number;
   }
   ```

6. **TrendingNarrative**:
   ```typescript
   interface TrendingNarrative {
     narrative: string;              // e.g., "AI agents", "political memes"
     category: string;               // e.g., "tech", "political", "animal"
     momentum: number;               // 0-100 how fast it's growing
     sentiment: number;              // -1 to 1
     volume: number;                 // Number of mentions
     examples: string[];             // Sample token names/tickers using this narrative
     peakEstimate: 'rising' | 'peaking' | 'fading';
   }
   ```

7. **Local keyword-based sentiment scoring** (no API needed):
   ```typescript
   // Built-in keyword lists:
   // Positive: moon, pump, gem, bullish, 100x, based, lfg, alpha, accumulate, undervalued
   // Negative: rug, scam, dump, bearish, dead, sell, rugpull, honeypot, avoid, exit
   // Neutral weight adjustment for crypto-specific context
   //
   // Score = (positive_count * pos_weight - negative_count * neg_weight) / total_words
   // Normalized to -1 to 1 range
   ```

8. **AI-powered sentiment** (via OpenRouter):
   ```typescript
   interface AISentimentResult {
     overallSentiment: number;       // -1 to 1
     categories: Array<{
       category: string;             // hype, fud, genuine-interest, spam, shill
       percentage: number;
     }>;
     summary: string;                 // One-sentence summary
     keyInsights: string[];
   }
   ```
   - Batch texts into a single LLM call (up to 50 texts per call)
   - System prompt: "Analyze crypto social media sentiment. Classify each text and provide overall analysis."
   - Use structured JSON output format

### Success Criteria

- Pump.fun comment API returns real comments and sentiment is computed
- Twitter API integration works with bearer token (graceful degradation without)
- Keyword-based scoring produces reasonable sentiment for crypto texts
- AI sentiment calls real OpenRouter API with proper prompt engineering
- Trending narrative detection identifies current hot topics
- Rate limiting prevents API abuse
- Compiles with `npx tsc --noEmit`
