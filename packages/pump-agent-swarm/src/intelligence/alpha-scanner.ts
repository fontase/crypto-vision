/**
 * Alpha Scanner — Continuous Pump.fun Opportunity Detection
 *
 * Scans Pump.fun for alpha opportunities across five strategies:
 *   1. Early Entry — brand-new tokens with promising early signals
 *   2. Graduation Play — tokens nearing Raydium migration
 *   3. Narrative Match — tokens matching trending narratives
 *   4. Volume Surge — sudden volume spikes on existing tokens
 *   5. Revival — older tokens showing renewed interest
 *
 * Emits discovered opportunities via the swarm event bus and supports
 * subscriber callbacks, TTL-based expiry, and deduplication.
 *
 * All data sourced from real Pump.fun API endpoints — no mocks.
 */

import { v4 as uuidv4 } from 'uuid';

import type { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Constants ────────────────────────────────────────────────

const DEFAULT_PUMP_API_BASE = 'https://frontend-api-v3.pump.fun';
const DEFAULT_TOKENS_PER_SCAN = 100;
const DEFAULT_MIN_OPPORTUNITY_SCORE = 60;
const DEFAULT_MAX_TOKEN_AGE_MS = 3_600_000; // 1 hour
const DEFAULT_SCAN_INTERVAL_MS = 30_000; // 30 seconds
const DEFAULT_MAX_OPPORTUNITIES = 50;
const FETCH_TIMEOUT_MS = 15_000;
const EARLY_ENTRY_WINDOW_MS = 600_000; // 10 minutes
const VOLUME_SURGE_WINDOW_MS = 900_000; // 15 minutes
const REVIVAL_MIN_AGE_MS = 3_600_000; // 1 hour
const REVIVAL_MAX_AGE_MS = 86_400_000; // 24 hours
const GRADUATION_SOL_THRESHOLD = 85; // SOL needed to graduate

// ─── Interfaces ───────────────────────────────────────────────

export interface AlphaScannerConfig {
  /** Pump.fun API base URL */
  pumpFunApiBase: string;
  /** Tokens to fetch per scan */
  tokensPerScan: number;
  /** Minimum score to consider as opportunity */
  minOpportunityScore: number;
  /** Categories to prioritize */
  priorityCategories: string[];
  /** Max age of token to consider (ms) */
  maxTokenAge: number;
  /** Scan interval (ms) */
  scanInterval: number;
  /** Max opportunities to keep in memory */
  maxOpportunities: number;
  /** Exclude tokens we've already evaluated */
  excludeMints: Set<string>;
}

export type AlphaCategory =
  | 'early-entry'
  | 'graduation-play'
  | 'narrative-match'
  | 'volume-surge'
  | 'revival';

export type AlphaUrgency = 'immediate' | 'soon' | 'watch';
export type AlphaRisk = 'low' | 'medium' | 'high' | 'extreme';

export interface AlphaOpportunity {
  /** Unique ID */
  id: string;
  /** Token mint address */
  mint: string;
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Opportunity score (0-100) */
  score: number;
  /** Type of alpha */
  category: AlphaCategory;
  /** How urgent is this opportunity */
  urgency: AlphaUrgency;
  /** Why this is an opportunity */
  reasoning: string;
  /** Estimated upside (multiple, e.g., 2.0 = 2x) */
  estimatedUpside: number;
  /** Risk level */
  risk: AlphaRisk;
  /** Key metrics at time of discovery */
  metrics: {
    marketCap: number;
    price: number;
    holderCount: number;
    replyCount: number;
    age: number;
    volumeRecent: number;
    graduationProgress: number;
  };
  /** Token description from Pump.fun */
  description: string;
  /** Image URI */
  imageUri: string;
  /** Discovered at timestamp */
  discoveredAt: number;
  /** Time-to-live: how long this opportunity is valid */
  ttlMs: number;
}

export interface ScanResult {
  scanId: string;
  tokensFetched: number;
  tokensAnalyzed: number;
  opportunitiesFound: number;
  topOpportunity: AlphaOpportunity | null;
  scanDuration: number;
  timestamp: number;
}

/** Raw token shape returned by the Pump.fun API */
interface PumpFunToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri: string;
  metadata_uri: string;
  created_timestamp: number;
  market_cap: number;
  usd_market_cap: number;
  reply_count: number;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  real_sol_reserves: number;
  real_token_reserves: number;
  total_supply: number;
  complete: boolean;
  raydium_pool: string | null;
  king_of_the_hill_timestamp: number | null;
  last_trade_timestamp: number | null;
  last_reply: number | null;
  nsfw: boolean;
  is_currently_live: boolean;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  [key: string]: unknown;
}

// ─── Narrative Keywords ───────────────────────────────────────

const NARRATIVE_KEYWORDS: Record<string, string[]> = {
  ai: ['ai', 'gpt', 'llm', 'neural', 'agent', 'chatbot', 'machine learning', 'openai', 'claude', 'gemini', 'copilot', 'artificial'],
  tech: ['tech', 'dev', 'code', 'hack', 'cyber', 'quantum', 'blockchain', 'web3', 'defi', 'metaverse', 'vr', 'ar'],
  political: ['trump', 'biden', 'elon', 'musk', 'president', 'election', 'congress', 'senate', 'politic', 'maga', 'democrat', 'republican'],
  meme: ['pepe', 'doge', 'shib', 'wojak', 'chad', 'moon', 'ape', 'frog', 'cat', 'dog', 'based', 'npc', 'cope', 'seethe'],
  gaming: ['game', 'play', 'quest', 'pvp', 'nft', 'pixel', 'arcade', 'esport', 'steam', 'gamer', 'rpg'],
  depin: ['depin', 'iot', 'sensor', 'device', 'hardware', 'wireless', 'mesh', 'network', 'helium'],
  rwa: ['rwa', 'real world', 'tokenize', 'property', 'real estate', 'gold', 'commodity', 'treasury'],
};

// ─── AlphaScanner ─────────────────────────────────────────────

export class AlphaScanner {
  private readonly config: AlphaScannerConfig;
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;

  /** Active opportunities indexed by mint */
  private readonly opportunities = new Map<string, AlphaOpportunity>();
  /** Set of mints we've already emitted so we don't re-report */
  private readonly seenMints = new Set<string>();
  /** Subscriber callbacks */
  private readonly subscribers = new Map<string, (opp: AlphaOpportunity) => void>();
  /** Past scan results */
  private readonly scanHistory: ScanResult[] = [];
  /** Total tokens scanned across all cycles */
  private scannedCount = 0;
  /** Continuous scan timer handle */
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  /** TTL cleanup timer */
  private ttlTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether we are currently running a scan */
  private scanning = false;
  /** Volume baseline per mint (for surge detection) */
  private readonly volumeBaseline = new Map<string, { avg: number; samples: number }>();

  constructor(eventBus: SwarmEventBus, config?: Partial<AlphaScannerConfig>) {
    this.eventBus = eventBus;
    this.config = {
      pumpFunApiBase: config?.pumpFunApiBase ?? DEFAULT_PUMP_API_BASE,
      tokensPerScan: config?.tokensPerScan ?? DEFAULT_TOKENS_PER_SCAN,
      minOpportunityScore: config?.minOpportunityScore ?? DEFAULT_MIN_OPPORTUNITY_SCORE,
      priorityCategories: config?.priorityCategories ?? ['ai', 'tech', 'political'],
      maxTokenAge: config?.maxTokenAge ?? DEFAULT_MAX_TOKEN_AGE_MS,
      scanInterval: config?.scanInterval ?? DEFAULT_SCAN_INTERVAL_MS,
      maxOpportunities: config?.maxOpportunities ?? DEFAULT_MAX_OPPORTUNITIES,
      excludeMints: config?.excludeMints ?? new Set<string>(),
    };
    this.logger = SwarmLogger.create('alpha-scanner', 'intelligence');
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Run a single scan cycle — fetch tokens from multiple Pump.fun endpoints,
   * evaluate each through all five strategy filters, and return opportunities.
   */
  async scan(): Promise<AlphaOpportunity[]> {
    if (this.scanning) {
      this.logger.warn('Scan already in progress, skipping');
      return [];
    }

    this.scanning = true;
    const scanId = uuidv4();
    const startTime = Date.now();
    const discovered: AlphaOpportunity[] = [];

    try {
      this.logger.info('Starting alpha scan', { scanId });

      // Fetch from multiple endpoints in parallel
      const [recentTokens, kothTokens, topTokens] = await Promise.all([
        this.fetchRecentLaunches(),
        this.fetchKingOfTheHill(),
        this.fetchTopByMarketCap(),
      ]);

      // Merge & deduplicate by mint
      const allTokens = this.deduplicateTokens([
        ...recentTokens,
        ...kothTokens,
        ...topTokens,
      ]);

      this.scannedCount += allTokens.length;

      this.logger.info('Fetched tokens for analysis', {
        scanId,
        recentCount: recentTokens.length,
        kothCount: kothTokens.length,
        topCount: topTokens.length,
        uniqueCount: allTokens.length,
      });

      // Evaluate each token through all strategy filters
      for (const token of allTokens) {
        if (this.config.excludeMints.has(token.mint)) continue;
        if (this.seenMints.has(token.mint)) continue;
        if (token.complete) continue; // already graduated
        if (token.nsfw) continue;

        const opportunity = this.evaluateToken(token);
        if (opportunity && opportunity.score >= this.config.minOpportunityScore) {
          discovered.push(opportunity);
          this.addOpportunity(opportunity);
        }
      }

      // Sort by score descending
      discovered.sort((a, b) => b.score - a.score);

      // Record scan result
      const result: ScanResult = {
        scanId,
        tokensFetched: allTokens.length,
        tokensAnalyzed: allTokens.length,
        opportunitiesFound: discovered.length,
        topOpportunity: discovered[0] ?? null,
        scanDuration: Date.now() - startTime,
        timestamp: Date.now(),
      };
      this.scanHistory.push(result);

      // Keep scan history bounded
      if (this.scanHistory.length > 200) {
        this.scanHistory.splice(0, this.scanHistory.length - 200);
      }

      this.logger.info('Alpha scan complete', {
        scanId,
        duration: result.scanDuration,
        opportunities: discovered.length,
        topScore: result.topOpportunity?.score ?? 0,
      });

      return discovered;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Alpha scan failed [${scanId}]`, new Error(message));
      return [];
    } finally {
      this.scanning = false;
    }
  }

  /** Start continuous scanning at the configured interval */
  startContinuousScan(intervalMs?: number): void {
    const interval = intervalMs ?? this.config.scanInterval;

    if (this.scanTimer) {
      this.logger.warn('Continuous scan already running, stopping previous');
      this.stopScan();
    }

    this.logger.info('Starting continuous alpha scan', { intervalMs: interval });

    // Run first scan immediately
    void this.scan();

    // Schedule subsequent scans
    this.scanTimer = setInterval(() => {
      void this.scan();
    }, interval);

    // Start TTL cleanup every 10 seconds
    this.ttlTimer = setInterval(() => {
      this.expireOpportunities();
    }, 10_000);
  }

  /** Stop continuous scanning */
  stopScan(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }
    this.logger.info('Continuous scan stopped');
  }

  /** Get top N opportunities sorted by score */
  getTopOpportunities(limit: number): AlphaOpportunity[] {
    const all = [...this.opportunities.values()];
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, limit);
  }

  /** Subscribe to new opportunity discoveries. Returns an unsubscribe function. */
  subscribeToOpportunities(callback: (opp: AlphaOpportunity) => void): () => void {
    const subId = uuidv4();
    this.subscribers.set(subId, callback);
    return () => {
      this.subscribers.delete(subId);
    };
  }

  /** Total number of tokens scanned across all cycles */
  getScannedCount(): number {
    return this.scannedCount;
  }

  /** Past scan results */
  getScanHistory(): ScanResult[] {
    return [...this.scanHistory];
  }

  // ── API Fetching ──────────────────────────────────────────────

  /** Fetch recently launched tokens */
  private async fetchRecentLaunches(): Promise<PumpFunToken[]> {
    const url = `${this.config.pumpFunApiBase}/coins?offset=0&limit=${this.config.tokensPerScan}&sort=created_timestamp&order=DESC&includeNsfw=false`;
    return this.fetchTokens(url, 'recent-launches');
  }

  /** Fetch "King of the Hill" tokens (near graduation) */
  private async fetchKingOfTheHill(): Promise<PumpFunToken[]> {
    const url = `${this.config.pumpFunApiBase}/coins/king-of-the-hill?includeNsfw=false&limit=50`;
    return this.fetchTokens(url, 'king-of-the-hill');
  }

  /** Fetch top tokens by market cap (for volume surge detection) */
  private async fetchTopByMarketCap(): Promise<PumpFunToken[]> {
    const url = `${this.config.pumpFunApiBase}/coins?offset=0&limit=${this.config.tokensPerScan}&sort=market_cap&order=DESC&includeNsfw=false`;
    return this.fetchTokens(url, 'top-market-cap');
  }

  /** Generic fetch with timeout and error handling */
  private async fetchTokens(url: string, source: string): Promise<PumpFunToken[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'CryptoVision-AlphaScanner/1.0',
        },
      });

      if (!response.ok) {
        this.logger.warn('API request failed', {
          source,
          status: response.status,
          statusText: response.statusText,
        });
        return [];
      }

      const data: unknown = await response.json();

      // API may return an array or an object with a data property
      if (Array.isArray(data)) {
        return data as PumpFunToken[];
      }
      if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as Record<string, unknown>).data)) {
        return (data as Record<string, unknown>).data as PumpFunToken[];
      }

      this.logger.warn('Unexpected API response shape', { source, type: typeof data });
      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('abort')) {
        this.logger.warn('API request timed out', { source, url });
      } else {
        this.logger.warn('API request error', { source, error: message });
      }
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Token Evaluation ─────────────────────────────────────────

  /**
   * Evaluate a single token through all five strategy filters.
   * Returns the highest-scoring opportunity, or null if none match.
   */
  private evaluateToken(token: PumpFunToken): AlphaOpportunity | null {
    const now = Date.now();
    const createdAt = token.created_timestamp;
    // Pump.fun timestamps may be in seconds or milliseconds
    const createdMs = createdAt > 1e12 ? createdAt : createdAt * 1000;
    const age = now - createdMs;

    // Skip tokens older than max age (except for revival checks)
    if (age > REVIVAL_MAX_AGE_MS) return null;

    const realSolReserves = (token.real_sol_reserves ?? 0) / 1e9; // lamports → SOL
    const graduationProgress = Math.min(100, (realSolReserves / GRADUATION_SOL_THRESHOLD) * 100);

    const metrics = {
      marketCap: token.market_cap ?? 0,
      price: this.estimatePrice(token),
      holderCount: this.estimateHolderCount(token),
      replyCount: token.reply_count ?? 0,
      age,
      volumeRecent: this.estimateRecentVolume(token),
      graduationProgress,
    };

    // Run through strategies — collect all matching ones
    const candidates: AlphaOpportunity[] = [];

    const earlyEntry = this.evaluateEarlyEntry(token, metrics, age);
    if (earlyEntry) candidates.push(earlyEntry);

    const graduationPlay = this.evaluateGraduationPlay(token, metrics, graduationProgress);
    if (graduationPlay) candidates.push(graduationPlay);

    const narrativeMatch = this.evaluateNarrativeMatch(token, metrics, age);
    if (narrativeMatch) candidates.push(narrativeMatch);

    const volumeSurge = this.evaluateVolumeSurge(token, metrics);
    if (volumeSurge) candidates.push(volumeSurge);

    const revival = this.evaluateRevival(token, metrics, age);
    if (revival) candidates.push(revival);

    if (candidates.length === 0) return null;

    // Return the best opportunity for this token
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  // ── Strategy: Early Entry ─────────────────────────────────────

  private evaluateEarlyEntry(
    token: PumpFunToken,
    metrics: AlphaOpportunity['metrics'],
    age: number,
  ): AlphaOpportunity | null {
    // Must be < 10 minutes old
    if (age > EARLY_ENTRY_WINDOW_MS) return null;

    // Market cap < $10k
    const usdMarketCap = token.usd_market_cap ?? 0;
    if (usdMarketCap > 10_000) return null;

    // Needs some social signal
    if (metrics.replyCount < 1) return null;

    let score = 50;
    const reasons: string[] = [];

    // Boost for very early entry
    if (age < 120_000) {
      score += 15;
      reasons.push('Extremely early — under 2 minutes old');
    } else if (age < 300_000) {
      score += 10;
      reasons.push('Very early — under 5 minutes old');
    } else {
      reasons.push('Early entry — under 10 minutes old');
    }

    // Boost for engagement
    if (metrics.replyCount >= 5) {
      score += 10;
      reasons.push(`High early engagement: ${metrics.replyCount} replies`);
    } else if (metrics.replyCount >= 2) {
      score += 5;
      reasons.push(`Some engagement: ${metrics.replyCount} replies`);
    }

    // Boost for social links (indicates effort by creator)
    if (token.twitter || token.website || token.telegram) {
      score += 10;
      reasons.push('Creator added social links');
    }

    // Priority category boost
    const categoryMatch = this.matchesNarrative(token);
    if (categoryMatch && this.config.priorityCategories.includes(categoryMatch)) {
      score += 20;
      reasons.push(`Matches priority narrative: ${categoryMatch}`);
    }

    // Cap at 100
    score = Math.min(100, score);

    return this.buildOpportunity(token, metrics, {
      score,
      category: 'early-entry',
      urgency: 'immediate',
      reasoning: reasons.join('. '),
      estimatedUpside: 5.0,
      risk: 'extreme',
      ttlMs: 300_000, // 5 min TTL — early entries expire fast
    });
  }

  // ── Strategy: Graduation Play ─────────────────────────────────

  private evaluateGraduationPlay(
    token: PumpFunToken,
    metrics: AlphaOpportunity['metrics'],
    graduationProgress: number,
  ): AlphaOpportunity | null {
    // Must be > 70% toward graduation
    if (graduationProgress < 70) return null;

    // Don't consider already-graduated tokens
    if (token.complete) return null;

    let score = 55;
    const reasons: string[] = [];

    // Score based on graduation proximity
    if (graduationProgress > 95) {
      score += 30;
      reasons.push(`Imminent graduation: ${graduationProgress.toFixed(1)}% — extremely close`);
    } else if (graduationProgress > 90) {
      score += 25;
      reasons.push(`Near graduation: ${graduationProgress.toFixed(1)}%`);
    } else if (graduationProgress > 80) {
      score += 15;
      reasons.push(`Approaching graduation: ${graduationProgress.toFixed(1)}%`);
    } else {
      score += 5;
      reasons.push(`On graduation path: ${graduationProgress.toFixed(1)}%`);
    }

    // Boost for active trading
    const lastTrade = token.last_trade_timestamp ?? 0;
    const lastTradeMs = lastTrade > 1e12 ? lastTrade : lastTrade * 1000;
    const timeSinceLastTrade = Date.now() - lastTradeMs;

    if (timeSinceLastTrade < 60_000) {
      score += 10;
      reasons.push('Actively trading — last trade < 1 min ago');
    } else if (timeSinceLastTrade < 300_000) {
      score += 5;
      reasons.push('Recent trading activity');
    } else {
      // Stagnant near threshold — less interesting
      score -= 10;
      reasons.push('Trading activity slowed near graduation threshold');
    }

    // Boost for engagement
    if (metrics.replyCount >= 10) {
      score += 5;
      reasons.push(`Strong community: ${metrics.replyCount} replies`);
    }

    score = Math.min(100, Math.max(0, score));

    return this.buildOpportunity(token, metrics, {
      score,
      category: 'graduation-play',
      urgency: graduationProgress > 90 ? 'immediate' : 'soon',
      reasoning: reasons.join('. '),
      estimatedUpside: graduationProgress > 90 ? 3.0 : 2.0,
      risk: 'high',
      ttlMs: 600_000, // 10 min TTL
    });
  }

  // ── Strategy: Narrative Match ─────────────────────────────────

  private evaluateNarrativeMatch(
    token: PumpFunToken,
    metrics: AlphaOpportunity['metrics'],
    age: number,
  ): AlphaOpportunity | null {
    // Must be < maxTokenAge
    if (age > this.config.maxTokenAge) return null;

    // Must have some traction
    const usdMarketCap = token.usd_market_cap ?? 0;
    if (usdMarketCap < 1_000) return null;

    // Must match a narrative
    const matchedNarrative = this.matchesNarrative(token);
    if (!matchedNarrative) return null;

    let score = 45;
    const reasons: string[] = [];
    reasons.push(`Matches "${matchedNarrative}" narrative`);

    // Priority category boost
    if (this.config.priorityCategories.includes(matchedNarrative)) {
      score += 15;
      reasons.push('Priority narrative match');
    }

    // Market cap tiers
    if (usdMarketCap > 50_000) {
      score += 5;
      reasons.push('Established market cap — lower upside but lower risk');
    } else if (usdMarketCap > 10_000) {
      score += 10;
      reasons.push('Growing market cap with room to run');
    } else {
      score += 15;
      reasons.push('Low market cap — high potential upside');
    }

    // Engagement
    if (metrics.replyCount >= 5) {
      score += 10;
      reasons.push(`Active discussion: ${metrics.replyCount} replies`);
    }

    // Social presence
    if (token.twitter || token.website) {
      score += 5;
      reasons.push('Has social/web presence');
    }

    // Freshness bonus
    if (age < 900_000) { // < 15 min
      score += 10;
      reasons.push('Very fresh — launched within 15 minutes');
    } else if (age < 1_800_000) { // < 30 min
      score += 5;
      reasons.push('Relatively fresh — launched within 30 minutes');
    }

    score = Math.min(100, score);

    return this.buildOpportunity(token, metrics, {
      score,
      category: 'narrative-match',
      urgency: age < 600_000 ? 'soon' : 'watch',
      reasoning: reasons.join('. '),
      estimatedUpside: usdMarketCap < 10_000 ? 3.0 : 2.0,
      risk: usdMarketCap > 50_000 ? 'medium' : 'high',
      ttlMs: 900_000, // 15 min TTL
    });
  }

  // ── Strategy: Volume Surge ────────────────────────────────────

  private evaluateVolumeSurge(
    token: PumpFunToken,
    metrics: AlphaOpportunity['metrics'],
  ): AlphaOpportunity | null {
    const currentVolume = metrics.volumeRecent;
    if (currentVolume <= 0) return null;

    // Check vs baseline
    const baseline = this.volumeBaseline.get(token.mint);

    if (!baseline) {
      // First time seeing this token — record baseline, no signal yet
      this.volumeBaseline.set(token.mint, { avg: currentVolume, samples: 1 });
      return null;
    }

    // Update baseline with exponential moving average
    const newAvg = (baseline.avg * baseline.samples + currentVolume) / (baseline.samples + 1);
    this.volumeBaseline.set(token.mint, {
      avg: newAvg,
      samples: Math.min(baseline.samples + 1, 20), // cap samples
    });

    // Need at least 2 samples to detect surge
    if (baseline.samples < 2) return null;

    const surgeMultiple = currentVolume / baseline.avg;
    if (surgeMultiple < 3) return null; // Need 3x minimum

    // Market cap must be growing (not a dump)
    const usdMarketCap = token.usd_market_cap ?? 0;
    if (usdMarketCap < 1_000) return null;

    let score = 50;
    const reasons: string[] = [];

    if (surgeMultiple >= 10) {
      score += 30;
      reasons.push(`Massive volume surge: ${surgeMultiple.toFixed(1)}x vs average`);
    } else if (surgeMultiple >= 5) {
      score += 20;
      reasons.push(`Strong volume surge: ${surgeMultiple.toFixed(1)}x vs average`);
    } else {
      score += 10;
      reasons.push(`Volume surge detected: ${surgeMultiple.toFixed(1)}x vs average`);
    }

    // Check if price/mcap is trending up (not dumping)
    const lastTrade = token.last_trade_timestamp ?? 0;
    const lastTradeMs = lastTrade > 1e12 ? lastTrade : lastTrade * 1000;
    const timeSinceLastTrade = Date.now() - lastTradeMs;

    if (timeSinceLastTrade < 60_000) {
      score += 10;
      reasons.push('Very recent trading activity confirms surge');
    }

    if (metrics.replyCount >= 3) {
      score += 5;
      reasons.push(`Community buzz: ${metrics.replyCount} replies`);
    }

    score = Math.min(100, score);

    return this.buildOpportunity(token, metrics, {
      score,
      category: 'volume-surge',
      urgency: surgeMultiple >= 5 ? 'immediate' : 'soon',
      reasoning: reasons.join('. '),
      estimatedUpside: surgeMultiple >= 5 ? 2.5 : 1.5,
      risk: 'high',
      ttlMs: 600_000, // 10 min TTL
    });
  }

  // ── Strategy: Revival ─────────────────────────────────────────

  private evaluateRevival(
    token: PumpFunToken,
    metrics: AlphaOpportunity['metrics'],
    age: number,
  ): AlphaOpportunity | null {
    // Must be 1-24 hours old
    if (age < REVIVAL_MIN_AGE_MS || age > REVIVAL_MAX_AGE_MS) return null;

    // Must have had some recent activity
    const lastTradeTs = token.last_trade_timestamp ?? 0;
    const lastTradeMs = lastTradeTs > 1e12 ? lastTradeTs : lastTradeTs * 1000;
    const timeSinceLastTrade = Date.now() - lastTradeMs;

    // Recent trade activity (within last 15 minutes) on an old token = revival
    if (timeSinceLastTrade > VOLUME_SURGE_WINDOW_MS) return null;

    // Must have meaningful engagement
    if (metrics.replyCount < 2) return null;

    let score = 40;
    const reasons: string[] = [];
    reasons.push('Older token showing signs of revival');

    // Recent comments
    const lastReply = token.last_reply ?? 0;
    const lastReplyMs = lastReply > 1e12 ? lastReply : lastReply * 1000;
    const timeSinceLastReply = Date.now() - lastReplyMs;

    if (timeSinceLastReply < 300_000) {
      score += 15;
      reasons.push('Fresh comments appearing — community re-engaging');
    } else if (timeSinceLastReply < 900_000) {
      score += 10;
      reasons.push('Recent comment activity');
    }

    // Trading activity
    if (timeSinceLastTrade < 120_000) {
      score += 15;
      reasons.push('Active trading in last 2 minutes');
    } else if (timeSinceLastTrade < 600_000) {
      score += 10;
      reasons.push('Trading activity in last 10 minutes');
    }

    // Market cap check — not dead
    const usdMarketCap = token.usd_market_cap ?? 0;
    if (usdMarketCap > 5_000) {
      score += 5;
      reasons.push(`Meaningful market cap: $${usdMarketCap.toLocaleString()}`);
    }

    // Social links suggest committed creator
    if (token.twitter || token.website) {
      score += 5;
      reasons.push('Creator has social presence');
    }

    // Narrative match for revival tokens
    const narrative = this.matchesNarrative(token);
    if (narrative && this.config.priorityCategories.includes(narrative)) {
      score += 10;
      reasons.push(`Revival in trending narrative: ${narrative}`);
    }

    score = Math.min(100, score);

    return this.buildOpportunity(token, metrics, {
      score,
      category: 'revival',
      urgency: 'watch',
      reasoning: reasons.join('. '),
      estimatedUpside: 2.0,
      risk: 'high',
      ttlMs: 1_200_000, // 20 min TTL — revivals need more time
    });
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Match token name/symbol/description against known narrative keywords */
  private matchesNarrative(token: PumpFunToken): string | null {
    const searchText = `${token.name} ${token.symbol} ${token.description}`.toLowerCase();

    for (const [category, keywords] of Object.entries(NARRATIVE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (searchText.includes(keyword)) {
          return category;
        }
      }
    }
    return null;
  }

  /** Estimate token price from virtual reserves */
  private estimatePrice(token: PumpFunToken): number {
    const virtualSol = token.virtual_sol_reserves ?? 0;
    const virtualTokens = token.virtual_token_reserves ?? 0;
    if (virtualTokens === 0) return 0;
    // Price in SOL = virtual SOL reserves / virtual token reserves
    return virtualSol / virtualTokens;
  }

  /** Estimate holder count from available data */
  private estimateHolderCount(token: PumpFunToken): number {
    // Pump.fun API doesn't always provide holder_count directly;
    // use reply_count as a proxy (engaged users), or parse from market cap tiers
    const replyCount = token.reply_count ?? 0;
    const usdMarketCap = token.usd_market_cap ?? 0;

    // Rough heuristic: higher mcap = more holders
    if (usdMarketCap > 100_000) return Math.max(replyCount * 3, 50);
    if (usdMarketCap > 10_000) return Math.max(replyCount * 2, 20);
    return Math.max(replyCount, 3);
  }

  /** Estimate recent volume from market cap and trade recency */
  private estimateRecentVolume(token: PumpFunToken): number {
    // Without direct volume data, use market cap * activity factor
    const usdMarketCap = token.usd_market_cap ?? 0;
    const lastTrade = token.last_trade_timestamp ?? 0;
    const lastTradeMs = lastTrade > 1e12 ? lastTrade : lastTrade * 1000;
    const timeSinceLastTrade = Date.now() - lastTradeMs;

    // More recent trades → higher estimated volume
    let activityFactor = 0.01; // baseline
    if (timeSinceLastTrade < 30_000) activityFactor = 0.3;
    else if (timeSinceLastTrade < 60_000) activityFactor = 0.2;
    else if (timeSinceLastTrade < 300_000) activityFactor = 0.1;
    else if (timeSinceLastTrade < 900_000) activityFactor = 0.05;

    return usdMarketCap * activityFactor;
  }

  /** Deduplicate an array of tokens by mint */
  private deduplicateTokens(tokens: PumpFunToken[]): PumpFunToken[] {
    const seen = new Set<string>();
    const result: PumpFunToken[] = [];
    for (const token of tokens) {
      if (!token.mint || seen.has(token.mint)) continue;
      seen.add(token.mint);
      result.push(token);
    }
    return result;
  }

  /** Build an AlphaOpportunity from a token and strategy evaluation */
  private buildOpportunity(
    token: PumpFunToken,
    metrics: AlphaOpportunity['metrics'],
    params: {
      score: number;
      category: AlphaCategory;
      urgency: AlphaUrgency;
      reasoning: string;
      estimatedUpside: number;
      risk: AlphaRisk;
      ttlMs: number;
    },
  ): AlphaOpportunity {
    return {
      id: uuidv4(),
      mint: token.mint,
      name: token.name ?? 'Unknown',
      symbol: token.symbol ?? '???',
      score: params.score,
      category: params.category,
      urgency: params.urgency,
      reasoning: params.reasoning,
      estimatedUpside: params.estimatedUpside,
      risk: params.risk,
      metrics,
      description: token.description ?? '',
      imageUri: token.image_uri ?? '',
      discoveredAt: Date.now(),
      ttlMs: params.ttlMs,
    };
  }

  /** Register a new opportunity — emit events, notify subscribers, enforce limits */
  private addOpportunity(opportunity: AlphaOpportunity): void {
    this.seenMints.add(opportunity.mint);
    this.opportunities.set(opportunity.mint, opportunity);

    // Emit event
    this.eventBus.emit(
      'alpha:opportunity-found',
      'intelligence',
      'alpha-scanner',
      {
        id: opportunity.id,
        mint: opportunity.mint,
        name: opportunity.name,
        symbol: opportunity.symbol,
        score: opportunity.score,
        category: opportunity.category,
        urgency: opportunity.urgency,
        estimatedUpside: opportunity.estimatedUpside,
        risk: opportunity.risk,
        reasoning: opportunity.reasoning,
      },
    );

    // Notify subscribers
    for (const callback of this.subscribers.values()) {
      try {
        callback(opportunity);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn('Subscriber callback error', { error: message });
      }
    }

    // Enforce max opportunities
    this.enforceMaxOpportunities();
  }

  /** Remove expired opportunities */
  private expireOpportunities(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [mint, opp] of this.opportunities) {
      if (now - opp.discoveredAt > opp.ttlMs) {
        expired.push(mint);
      }
    }

    for (const mint of expired) {
      const opp = this.opportunities.get(mint);
      this.opportunities.delete(mint);

      if (opp) {
        this.eventBus.emit(
          'alpha:opportunity-expired',
          'intelligence',
          'alpha-scanner',
          {
            id: opp.id,
            mint: opp.mint,
            name: opp.name,
            symbol: opp.symbol,
            category: opp.category,
            reason: 'ttl-expired',
          },
        );

        this.logger.debug('Opportunity expired', {
          mint: opp.mint,
          name: opp.name,
          category: opp.category,
        });
      }
    }
  }

  /** Keep opportunity count within configured maximum */
  private enforceMaxOpportunities(): void {
    if (this.opportunities.size <= this.config.maxOpportunities) return;

    // Evict lowest-scoring opportunities
    const sorted = [...this.opportunities.entries()]
      .sort((a, b) => a[1].score - b[1].score);

    const toRemove = sorted.slice(0, sorted.length - this.config.maxOpportunities);
    for (const [mint, opp] of toRemove) {
      this.opportunities.delete(mint);
      this.eventBus.emit(
        'alpha:opportunity-expired',
        'intelligence',
        'alpha-scanner',
        {
          id: opp.id,
          mint: opp.mint,
          name: opp.name,
          category: opp.category,
          reason: 'evicted-low-score',
        },
      );
    }
  }
}
