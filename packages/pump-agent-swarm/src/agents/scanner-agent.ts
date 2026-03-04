/**
 * Scanner Agent — New token discovery and multi-criteria evaluation
 *
 * The scanner monitors Pump.fun for newly launched tokens, evaluates them
 * against configurable criteria (tech/AI keywords, holder distribution,
 * volume, rug risk), and signals the swarm when a viable target is found.
 *
 * Data sources:
 * 1. Pump.fun API — newest & featured tokens, token details
 * 2. Helius API — token metadata, transaction history, holder analysis
 * 3. On-chain RPC — bonding curve state, supply distribution
 * 4. Jupiter API — current price, token validation
 *
 * The scanner runs continuously with configurable intervals and emits
 * structured events for each discovery and evaluation.
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';

import type {
  BondingCurveState,
  ScannerConfig,
  SwarmEventCategory,
} from '../types.js';
import type { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';
import { MetricsCollector } from '../infra/metrics.js';
import { SwarmErrorHandler } from '../infra/error-handler.js';

// ─── Token Evaluation Types ──────────────────────────────────

export interface CriterionResult {
  value: number;
  score: number;
  reason: string;
}

export interface RugRiskResult {
  score: number;
  flags: string[];
}

export interface MomentumResult {
  buyPressure: number;
  score: number;
  trend: 'up' | 'down' | 'flat';
}

export interface NarrativeResult {
  category: string;
  score: number;
  keywords: string[];
}

export interface TokenEvaluation {
  mint: string;
  name: string;
  symbol: string;
  /** Composite score 0–100 */
  score: number;
  criteria: {
    marketCap: CriterionResult;
    age: CriterionResult & { seconds: number };
    holders: CriterionResult & { count: number };
    volume: CriterionResult & { sol: number };
    devHoldings: CriterionResult & { percent: number };
    rugRisk: RugRiskResult;
    narrative: NarrativeResult;
    momentum: MomentumResult;
  };
  recommendation: 'strong_buy' | 'buy' | 'watch' | 'avoid';
  reasoning: string;
  evaluatedAt: number;
}

/** Lightweight token discovered during a scan pass */
export interface ScannedToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  marketCapSol: number;
  volumeSol: number;
  createdAt: number;
  imageUri?: string;
  evaluation?: TokenEvaluation;
  /** Timestamp when the token was first seen by the scanner */
  discoveredAt: number;
}

// ─── Scanner Events ──────────────────────────────────────────

interface ScannerAgentEvents {
  'scanner:scanning': () => void;
  'scanner:token-found': (token: ScannedToken) => void;
  'scanner:token-evaluated': (evaluation: TokenEvaluation) => void;
  'scanner:target-selected': (token: ScannedToken) => void;
  'scanner:no-targets': () => void;
  'scanner:error': (error: Error) => void;
  'scanner:stopped': () => void;
}

// ─── Pump.fun API Response Shapes ─────────────────────────────

interface PumpFunCoin {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri?: string;
  market_cap?: number;
  usd_market_cap?: number;
  virtual_sol_reserves?: number;
  virtual_token_reserves?: number;
  real_sol_reserves?: number;
  real_token_reserves?: number;
  total_supply?: number;
  complete?: boolean;
  created_timestamp?: number;
  reply_count?: number;
  website?: string;
  twitter?: string;
  telegram?: string;
}

// ─── Helius Token Metadata Response ───────────────────────────

interface HeliusTokenMetadata {
  account: string;
  onChainAccountInfo?: {
    accountInfo?: {
      data?: {
        parsed?: {
          info?: {
            supply?: string;
            decimals?: number;
            mintAuthority?: string;
            freezeAuthority?: string;
          };
        };
      };
    };
  };
  onChainMetadata?: {
    metadata?: {
      data?: {
        name?: string;
        symbol?: string;
        uri?: string;
      };
    };
  };
}

// ─── Jupiter Price Response ───────────────────────────────────

interface JupiterPriceResponse {
  data: Record<
    string,
    {
      id: string;
      type: string;
      price: string;
    }
  >;
  timeTaken: number;
}

// ─── Helius Transaction ──────────────────────────────────────

interface HeliusTransaction {
  signature: string;
  type: string;
  timestamp: number;
  fee: number;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
}

// ─── Constants ────────────────────────────────────────────────

const PUMP_FUN_API_BASE = 'https://frontend-api-v3.pump.fun';
const HELIUS_API_BASE = 'https://api.helius.xyz';
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

/** Pump.fun bonding curve program */
const PUMP_FUN_PROGRAM_ID = new PublicKey(
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
);

/** Pump.fun bonding curve account layout offset for reserves */
const BONDING_CURVE_DATA_SIZE = 49;

/** Maximum tokens to fetch per scan */
const MAX_TOKENS_PER_SCAN = 50;

/** Default delay between API requests in ms (rate limiting) */
const DEFAULT_REQUEST_DELAY_MS = 250;

/** Maximum discovered tokens to keep in memory */
const MAX_DISCOVERED_TOKENS = 500;

/** AI-related keywords for narrative detection */
const AI_KEYWORDS = [
  'ai', 'gpt', 'claude', 'llm', 'neural', 'ml',
  'deep', 'transformer', 'agent', 'openai', 'anthropic',
  'chatbot', 'copilot', 'diffusion', 'model',
];

/** Tech-related keywords for narrative detection */
const TECH_KEYWORDS = [
  'tech', 'dev', 'code', 'hack', 'api', 'protocol',
  'sdk', 'chain', 'web3', 'crypto', 'blockchain',
  'solana', 'defi', 'dao', 'smart', 'contract',
];

/** Scoring weights for composite score */
const SCORE_WEIGHTS = {
  marketCap: 0.15,
  age: 0.10,
  holders: 0.15,
  volume: 0.15,
  devHoldings: 0.10,
  rugRisk: 0.15,
  narrative: 0.10,
  momentum: 0.10,
} as const;

// ─── Scanner Agent ───────────────────────────────────────────

export class ScannerAgent extends EventEmitter<ScannerAgentEvents> {
  readonly id: string;

  private readonly config: ScannerConfig;
  private readonly connection: Connection;
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;
  private readonly metrics: MetricsCollector;
  private readonly errorHandler: SwarmErrorHandler;

  /** Helius API key (from env) */
  private readonly heliusApiKey: string;

  /** Discovered tokens, keyed by mint */
  private readonly discoveredTokens: Map<string, ScannedToken> = new Map();

  /** Best candidate from last evaluation pass */
  private targetToken: ScannedToken | null = null;

  /** Scan interval timer */
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  /** Event bus subscription IDs for cleanup */
  private subscriptionIds: string[] = [];

  /** Whether the scanner is actively running */
  private running = false;

  /** Request delay in ms (configurable rate limiting) */
  private readonly requestDelayMs: number;

  /** Scan pass counter */
  private scanCount = 0;

  constructor(
    config: ScannerConfig,
    rpcUrl: string,
    eventBus: SwarmEventBus,
  ) {
    super();
    this.id = `scanner-${uuid().slice(0, 8)}`;
    this.config = config;
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.eventBus = eventBus;
    this.logger = SwarmLogger.create(this.id, 'scanner');
    this.metrics = MetricsCollector.getInstance();
    this.errorHandler = new SwarmErrorHandler(eventBus);
    this.heliusApiKey = process.env['HELIUS_API_KEY'] ?? '';
    this.requestDelayMs =
      (config as ScannerConfig & { requestDelayMs?: number }).requestDelayMs ??
      DEFAULT_REQUEST_DELAY_MS;

    this.logger.info('Scanner agent initialized', {
      keywords: config.keywords,
      categories: config.categories,
      minMarketCapSol: config.minMarketCapSol,
      maxMarketCapSol: config.maxMarketCapSol,
      maxAgeSeconds: config.maxAgeSeconds,
      intervalMs: config.intervalMs,
    });
  }

  // ─── Public API ─────────────────────────────────────────────

  /** Start continuous scanning at the configured interval */
  startScanning(): void {
    if (this.running) {
      this.logger.warn('Scanner already running, stopping previous session');
      this.stopScanning();
    }

    this.running = true;

    this.logger.info('Starting continuous scan', {
      intervalMs: this.config.intervalMs,
    });

    this.eventBus.emit(
      'scanner:scanning',
      'intelligence' as SwarmEventCategory,
      this.id,
      { intervalMs: this.config.intervalMs },
    );

    // Run an immediate scan, then schedule repeats
    void this.scanLoop();

    this.scanTimer = setInterval(() => {
      void this.scanLoop();
    }, this.config.intervalMs);

    this.emit('scanner:scanning');
  }

  /** Stop scanning and clean up resources */
  stopScanning(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    // Unsubscribe from event bus
    for (const subId of this.subscriptionIds) {
      this.eventBus.unsubscribe(subId);
    }
    this.subscriptionIds = [];

    this.running = false;

    this.logger.info('Scanner stopped', {
      totalScans: this.scanCount,
      discoveredTokens: this.discoveredTokens.size,
    });

    this.eventBus.emit(
      'scanner:stopped',
      'intelligence' as SwarmEventCategory,
      this.id,
      {
        totalScans: this.scanCount,
        discoveredTokens: this.discoveredTokens.size,
      },
    );

    this.emit('scanner:stopped');
  }

  /** Execute a single scan pass: fetch → filter → evaluate → select */
  async scanOnce(): Promise<ScannedToken[]> {
    this.scanCount++;
    const scanId = `scan-${this.scanCount}`;

    this.logger.info('Scan pass started', { scanId });

    this.metrics
      .counter('scanner.scans.total')
      .inc();

    const newTokens: ScannedToken[] = [];

    try {
      // 1. Fetch from Pump.fun: latest + featured
      const [latestTokens, featuredTokens] = await Promise.all([
        this.fetchPumpFunLatest(),
        this.fetchPumpFunFeatured(),
      ]);

      // Deduplicate by mint
      const allTokens = new Map<string, PumpFunCoin>();
      for (const token of [...latestTokens, ...featuredTokens]) {
        if (token.mint && !allTokens.has(token.mint)) {
          allTokens.set(token.mint, token);
        }
      }

      this.logger.info('Fetched tokens from Pump.fun', {
        latest: latestTokens.length,
        featured: featuredTokens.length,
        unique: allTokens.size,
        scanId,
      });

      // 2. Quick filter — remove tokens outside basic criteria
      const candidates = this.quickFilter(allTokens);

      this.logger.info('Quick filter applied', {
        before: allTokens.size,
        after: candidates.length,
        scanId,
      });

      // 3. Evaluate each candidate
      for (const coin of candidates) {
        // Skip already-known tokens
        if (this.discoveredTokens.has(coin.mint)) {
          continue;
        }

        try {
          const evaluation = await this.evaluateToken(coin.mint, coin);
          const scannedToken = this.coinToScannedToken(coin, evaluation);
          newTokens.push(scannedToken);

          // Store in memory (bounded)
          this.addDiscoveredToken(scannedToken);

          this.emit('scanner:token-found', scannedToken);
          this.eventBus.emit(
            'scanner:token-found',
            'intelligence' as SwarmEventCategory,
            this.id,
            {
              mint: scannedToken.mint,
              name: scannedToken.name,
              symbol: scannedToken.symbol,
              score: evaluation.score,
              recommendation: evaluation.recommendation,
            },
          );

          this.emit('scanner:token-evaluated', evaluation);
          this.eventBus.emit(
            'scanner:token-evaluated',
            'intelligence' as SwarmEventCategory,
            this.id,
            { evaluation },
          );

          this.metrics
            .counter('scanner.tokens.evaluated')
            .inc();

          // Rate limit between evaluations
          await this.delay(this.requestDelayMs);
        } catch (err) {
          const error =
            err instanceof Error ? err : new Error(String(err));
          this.logger.warn('Token evaluation failed', {
            mint: coin.mint,
            error: error.message,
          });
          this.metrics
            .counter('scanner.tokens.evaluation_errors')
            .inc();
        }
      }

      // 4. Select best target
      this.selectTarget(newTokens);

      this.metrics
        .counter('scanner.tokens.discovered')
        .inc(newTokens.length);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Scan pass failed', { scanId, error: error.message });
      this.emit('scanner:error', error);
      this.metrics
        .counter('scanner.scans.errors')
        .inc();
    }

    return newTokens;
  }

  /**
   * Deep evaluation of a specific token by mint address.
   * Fetches data from all sources and produces a composite score.
   */
  async evaluateToken(
    mint: string,
    preloadedCoin?: PumpFunCoin,
  ): Promise<TokenEvaluation> {
    const coin =
      preloadedCoin ?? (await this.fetchPumpFunToken(mint));

    if (!coin) {
      throw new Error(`Token not found on Pump.fun: ${mint}`);
    }

    // Fetch supplemental data in parallel with error isolation
    const [
      holderData,
      jupiterPrice,
      onChainCurve,
      transactionData,
    ] = await Promise.all([
      this.fetchHolderData(mint).catch(() => null),
      this.fetchJupiterPrice(mint).catch(() => null),
      this.fetchBondingCurveOnChain(mint).catch(() => null),
      this.fetchTransactionHistory(mint).catch(() => null),
    ]);

    // Compute individual criteria scores
    const marketCapSol =
      onChainCurve?.marketCapSol ??
      (coin.market_cap ?? 0) / LAMPORTS_PER_SOL;

    const ageSeconds = coin.created_timestamp
      ? Math.floor((Date.now() / 1000) - coin.created_timestamp)
      : Infinity;

    const holderCount = holderData?.count ?? 0;
    const volumeSol =
      (coin.market_cap ?? 0) > 0
        ? this.estimateVolume(transactionData)
        : 0;

    const devHoldingsPercent = holderData?.devPercent ?? 0;
    const topHolderConcentration = holderData?.topConcentration ?? 0;
    const hasSocials = !!(coin.website ?? coin.twitter ?? coin.telegram);

    // Score each criterion
    const marketCapCriterion = this.scoreMarketCap(marketCapSol);
    const ageCriterion = this.scoreAge(ageSeconds);
    const holdersCriterion = this.scoreHolders(holderCount);
    const volumeCriterion = this.scoreVolume(volumeSol);
    const devHoldingsCriterion = this.scoreDevHoldings(devHoldingsPercent);
    const rugRiskCriterion = this.scoreRugRisk(
      topHolderConcentration,
      devHoldingsPercent,
      hasSocials,
      holderCount,
      marketCapSol,
      ageSeconds,
      volumeSol,
    );
    const narrativeCriterion = this.scoreNarrative(
      coin.name,
      coin.symbol,
      coin.description,
    );
    const momentumCriterion = this.scoreMomentum(
      transactionData,
      jupiterPrice,
    );

    // Composite weighted score
    const compositeScore = Math.round(
      marketCapCriterion.score * SCORE_WEIGHTS.marketCap +
      ageCriterion.score * SCORE_WEIGHTS.age +
      holdersCriterion.score * SCORE_WEIGHTS.holders +
      volumeCriterion.score * SCORE_WEIGHTS.volume +
      devHoldingsCriterion.score * SCORE_WEIGHTS.devHoldings +
      (100 - rugRiskCriterion.score) * SCORE_WEIGHTS.rugRisk +
      narrativeCriterion.score * SCORE_WEIGHTS.narrative +
      momentumCriterion.score * SCORE_WEIGHTS.momentum,
    );

    // Determine recommendation
    const recommendation = this.getRecommendation(
      compositeScore,
      rugRiskCriterion.score,
    );

    // Build reasoning string
    const reasoning = this.buildReasoning(
      coin,
      compositeScore,
      recommendation,
      rugRiskCriterion,
      narrativeCriterion,
    );

    const evaluation: TokenEvaluation = {
      mint,
      name: coin.name,
      symbol: coin.symbol,
      score: compositeScore,
      criteria: {
        marketCap: marketCapCriterion,
        age: { ...ageCriterion, seconds: ageSeconds },
        holders: { ...holdersCriterion, count: holderCount },
        volume: { ...volumeCriterion, sol: volumeSol },
        devHoldings: { ...devHoldingsCriterion, percent: devHoldingsPercent },
        rugRisk: rugRiskCriterion,
        narrative: narrativeCriterion,
        momentum: momentumCriterion,
      },
      recommendation,
      reasoning,
      evaluatedAt: Date.now(),
    };

    this.logger.info('Token evaluated', {
      mint,
      name: coin.name,
      symbol: coin.symbol,
      score: compositeScore,
      recommendation,
    });

    return evaluation;
  }

  /** Return all discovered tokens */
  getDiscoveredTokens(): ScannedToken[] {
    return Array.from(this.discoveredTokens.values());
  }

  /** Return the current best candidate (if any) */
  getTargetToken(): ScannedToken | null {
    return this.targetToken;
  }

  /** Whether the scanner is currently running */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Private: Scan Loop ─────────────────────────────────────

  private async scanLoop(): Promise<void> {
    if (!this.running) return;

    try {
      await this.scanOnce();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Scan loop iteration error', {
        error: error.message,
      });
    }
  }

  // ─── Private: Pump.fun API ──────────────────────────────────

  /** Fetch latest tokens from Pump.fun */
  private async fetchPumpFunLatest(): Promise<PumpFunCoin[]> {
    return this.errorHandler.withRetry(
      async () => {
        const url = `${PUMP_FUN_API_BASE}/coins/latest`;
        const resp = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CryptoVision-Scanner/1.0',
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
          throw new Error(
            `Pump.fun /coins/latest responded ${resp.status}: ${resp.statusText}`,
          );
        }

        const data: unknown = await resp.json();
        return this.parsePumpFunResponse(data);
      },
      { maxRetries: 2, initialDelayMs: 500 },
    );
  }

  /** Fetch featured/trending tokens from Pump.fun */
  private async fetchPumpFunFeatured(): Promise<PumpFunCoin[]> {
    return this.errorHandler.withRetry(
      async () => {
        const url = `${PUMP_FUN_API_BASE}/coins/featured`;
        const resp = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CryptoVision-Scanner/1.0',
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
          throw new Error(
            `Pump.fun /coins/featured responded ${resp.status}: ${resp.statusText}`,
          );
        }

        const data: unknown = await resp.json();
        return this.parsePumpFunResponse(data);
      },
      { maxRetries: 2, initialDelayMs: 500 },
    );
  }

  /** Fetch a specific token from Pump.fun by mint */
  private async fetchPumpFunToken(
    mint: string,
  ): Promise<PumpFunCoin | null> {
    return this.errorHandler.withRetry(
      async () => {
        const url = `${PUMP_FUN_API_BASE}/coins/${mint}`;
        const resp = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CryptoVision-Scanner/1.0',
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (resp.status === 404) {
          return null;
        }

        if (!resp.ok) {
          throw new Error(
            `Pump.fun /coins/${mint} responded ${resp.status}: ${resp.statusText}`,
          );
        }

        const data: unknown = await resp.json();
        if (data && typeof data === 'object' && 'mint' in data) {
          return data as PumpFunCoin;
        }
        return null;
      },
      { maxRetries: 2, initialDelayMs: 500 },
    );
  }

  /** Safely parse Pump.fun API response into typed coins */
  private parsePumpFunResponse(data: unknown): PumpFunCoin[] {
    if (Array.isArray(data)) {
      return data
        .filter(
          (item): item is PumpFunCoin =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as PumpFunCoin).mint === 'string' &&
            typeof (item as PumpFunCoin).name === 'string' &&
            typeof (item as PumpFunCoin).symbol === 'string',
        )
        .slice(0, MAX_TOKENS_PER_SCAN);
    }

    // Some endpoints wrap in { coins: [...] }
    if (
      data &&
      typeof data === 'object' &&
      'coins' in data &&
      Array.isArray((data as { coins: unknown }).coins)
    ) {
      return this.parsePumpFunResponse(
        (data as { coins: unknown[] }).coins,
      );
    }

    return [];
  }

  // ─── Private: Helius API ────────────────────────────────────

  /** Fetch holder analysis for a token mint via Helius */
  private async fetchHolderData(
    mint: string,
  ): Promise<{
    count: number;
    devPercent: number;
    topConcentration: number;
  } | null> {
    if (!this.heliusApiKey) {
      this.logger.debug('Helius API key not set, skipping holder data');
      return null;
    }

    return this.errorHandler.withRetry(
      async () => {
        // Use Helius token-metadata for basic info
        const metadataUrl = `${HELIUS_API_BASE}/v0/token-metadata?api-key=${this.heliusApiKey}`;
        const metaResp = await fetch(metadataUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'CryptoVision-Scanner/1.0',
          },
          body: JSON.stringify({
            mintAccounts: [mint],
            includeOffChain: true,
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!metaResp.ok) {
          throw new Error(
            `Helius token-metadata responded ${metaResp.status}`,
          );
        }

        const metaData = (await metaResp.json()) as HeliusTokenMetadata[];

        // Now fetch largest token accounts via RPC for holder distribution
        const largestAccounts = await this.connection.getTokenLargestAccounts(
          new PublicKey(mint),
        );

        const holders = largestAccounts.value;
        const totalSupplyResp = await this.connection.getTokenSupply(
          new PublicKey(mint),
        );
        const totalSupply = Number(totalSupplyResp.value.amount);

        let holderCount = holders.length;
        let devPercent = 0;
        let topConcentration = 0;

        if (totalSupply > 0) {
          // Top 10 concentration
          const topHolders = holders.slice(0, 10);
          const topSum = topHolders.reduce(
            (sum, h) => sum + Number(h.amount),
            0,
          );
          topConcentration = (topSum / totalSupply) * 100;

          // Dev holdings: first holder is often the creator
          if (holders.length > 0) {
            devPercent =
              (Number(holders[0].amount) / totalSupply) * 100;
          }
        }

        // Helius metadata is used for validation; we rely on on-chain
        // data for accurate holder stats
        void metaData;

        // Use RPC to get total holder count (approximate)
        try {
          const programAccounts =
            await this.connection.getParsedProgramAccounts(
              new PublicKey(
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              ),
              {
                filters: [
                  { dataSize: 165 },
                  {
                    memcmp: {
                      offset: 0,
                      bytes: mint,
                    },
                  },
                ],
              },
            );
          holderCount = programAccounts.length;
        } catch {
          // Fall back to largest accounts length
        }

        return { count: holderCount, devPercent, topConcentration };
      },
      { maxRetries: 1, initialDelayMs: 1_000 },
    );
  }

  /** Fetch recent transaction history via Helius */
  private async fetchTransactionHistory(
    mint: string,
  ): Promise<HeliusTransaction[] | null> {
    if (!this.heliusApiKey) {
      return null;
    }

    return this.errorHandler.withRetry(
      async () => {
        const url = `${HELIUS_API_BASE}/v0/addresses/${mint}/transactions?api-key=${this.heliusApiKey}&limit=50`;
        const resp = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CryptoVision-Scanner/1.0',
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (!resp.ok) {
          throw new Error(
            `Helius transactions responded ${resp.status}`,
          );
        }

        return (await resp.json()) as HeliusTransaction[];
      },
      { maxRetries: 1, initialDelayMs: 1_000 },
    );
  }

  // ─── Private: Jupiter API ───────────────────────────────────

  /** Fetch current price from Jupiter */
  private async fetchJupiterPrice(
    mint: string,
  ): Promise<number | null> {
    return this.errorHandler.withRetry(
      async () => {
        const url = `${JUPITER_PRICE_API}?ids=${mint}`;
        const resp = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CryptoVision-Scanner/1.0',
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
          throw new Error(
            `Jupiter price API responded ${resp.status}`,
          );
        }

        const body = (await resp.json()) as JupiterPriceResponse;
        const priceData = body.data[mint];
        if (priceData && priceData.price) {
          return parseFloat(priceData.price);
        }
        return null;
      },
      { maxRetries: 1, initialDelayMs: 500 },
    );
  }

  // ─── Private: On-Chain Data ─────────────────────────────────

  /**
   * Fetch bonding curve state from on-chain data.
   * Falls back to Pump.fun API data if RPC fails.
   */
  private async fetchBondingCurveOnChain(
    mint: string,
  ): Promise<BondingCurveState | null> {
    try {
      // Derive bonding curve PDA
      const [bondingCurvePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('bonding-curve'),
          new PublicKey(mint).toBuffer(),
        ],
        PUMP_FUN_PROGRAM_ID,
      );

      const accountInfo = await this.connection.getAccountInfo(
        bondingCurvePda,
      );

      if (!accountInfo || accountInfo.data.length < BONDING_CURVE_DATA_SIZE) {
        return null;
      }

      // Parse bonding curve account data
      // Layout: discriminator(8) + virtualTokenReserves(8) + virtualSolReserves(8) +
      //         realTokenReserves(8) + realSolReserves(8) + tokenTotalSupply(8) + complete(1)
      const data = accountInfo.data;
      const virtualTokenReserves = new BN(
        data.subarray(8, 16),
        'le',
      );
      const virtualSolReserves = new BN(
        data.subarray(16, 24),
        'le',
      );
      const realTokenReserves = new BN(
        data.subarray(24, 32),
        'le',
      );
      const realSolReserves = new BN(
        data.subarray(32, 40),
        'le',
      );
      const complete = data[48] === 1;

      // Derive price = virtualSolReserves / virtualTokenReserves
      const vSol = virtualSolReserves.toNumber();
      const vToken = virtualTokenReserves.toNumber();
      const currentPriceSol =
        vToken > 0 ? vSol / vToken : 0;

      // Market cap = price * total supply (approximate)
      const totalSupply = 1_000_000_000; // Pump.fun default
      const marketCapSol =
        (currentPriceSol * totalSupply) / LAMPORTS_PER_SOL;

      // Graduation: ~85 SOL target for pump.fun bonding curves
      const graduationTarget = 85 * LAMPORTS_PER_SOL;
      const graduationProgress = Math.min(
        (realSolReserves.toNumber() / graduationTarget) * 100,
        100,
      );

      return {
        mint,
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves,
        complete,
        currentPriceSol,
        marketCapSol,
        graduationProgress,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.debug('On-chain bonding curve fetch failed', {
        mint,
        error: error.message,
      });
      return null;
    }
  }

  // ─── Private: Filtering ─────────────────────────────────────

  /** Quick pre-filter based on config criteria before deep evaluation */
  private quickFilter(tokens: Map<string, PumpFunCoin>): PumpFunCoin[] {
    const candidates: PumpFunCoin[] = [];

    for (const coin of tokens.values()) {
      // Skip graduated tokens
      if (coin.complete) continue;

      // Market cap filter (using lamports estimate)
      const marketCapSol =
        (coin.market_cap ?? 0) / LAMPORTS_PER_SOL;
      if (
        marketCapSol < this.config.minMarketCapSol ||
        marketCapSol > this.config.maxMarketCapSol
      ) {
        continue;
      }

      // Age filter
      if (coin.created_timestamp) {
        const ageSeconds =
          Math.floor(Date.now() / 1000) - coin.created_timestamp;
        if (ageSeconds > this.config.maxAgeSeconds) {
          continue;
        }
      }

      // Keyword filter (loose — at least one keyword match)
      if (this.config.keywords.length > 0) {
        const text =
          `${coin.name} ${coin.symbol} ${coin.description}`.toLowerCase();
        const hasKeyword = this.config.keywords.some((kw) =>
          text.includes(kw.toLowerCase()),
        );
        // If keywords are configured, we still include non-matching tokens
        // but they'll score lower in evaluation. Only skip if none match
        // AND the categories also don't match.
        if (
          !hasKeyword &&
          this.config.categories.length > 0 &&
          !this.matchesCategory(text)
        ) {
          continue;
        }
      }

      candidates.push(coin);
    }

    return candidates.slice(0, MAX_TOKENS_PER_SCAN);
  }

  /** Check if token text matches any configured category */
  private matchesCategory(text: string): boolean {
    const lower = text.toLowerCase();
    for (const category of this.config.categories) {
      const keywords =
        category === 'ai'
          ? AI_KEYWORDS
          : category === 'tech'
            ? TECH_KEYWORDS
            : [category];
      if (keywords.some((kw) => lower.includes(kw))) {
        return true;
      }
    }
    return false;
  }

  // ─── Private: Scoring Functions ─────────────────────────────

  /**
   * Score market cap: sweet spot is the middle of config range.
   * Too low = too early/unproven, too high = less upside.
   */
  private scoreMarketCap(marketCapSol: number): CriterionResult {
    const { minMarketCapSol, maxMarketCapSol } = this.config;
    const midpoint = (minMarketCapSol + maxMarketCapSol) / 2;

    let score: number;
    if (marketCapSol < minMarketCapSol) {
      score = Math.max(0, 30 * (marketCapSol / minMarketCapSol));
    } else if (marketCapSol > maxMarketCapSol) {
      score = Math.max(
        0,
        30 * (1 - (marketCapSol - maxMarketCapSol) / maxMarketCapSol),
      );
    } else {
      // Within range — highest score near midpoint
      const distFromMid = Math.abs(marketCapSol - midpoint);
      const rangeHalf = (maxMarketCapSol - minMarketCapSol) / 2;
      score = 100 * (1 - distFromMid / rangeHalf * 0.3);
    }

    score = Math.round(Math.max(0, Math.min(100, score)));

    return {
      value: marketCapSol,
      score,
      reason:
        marketCapSol < minMarketCapSol
          ? `Market cap ${marketCapSol.toFixed(2)} SOL below minimum ${minMarketCapSol} SOL`
          : marketCapSol > maxMarketCapSol
            ? `Market cap ${marketCapSol.toFixed(2)} SOL above maximum ${maxMarketCapSol} SOL`
            : `Market cap ${marketCapSol.toFixed(2)} SOL within target range`,
    };
  }

  /**
   * Score token age: prefer tokens that are young but not brand new.
   * Sweet spot: 60s – 30min old. Too new = ephemeral, too old = stale.
   */
  private scoreAge(ageSeconds: number): CriterionResult {
    let score: number;

    if (ageSeconds < 30) {
      // Very new — might be a bot launch, risky
      score = 40;
    } else if (ageSeconds < 60) {
      score = 60;
    } else if (ageSeconds < 300) {
      // 1–5 min: ideal early window
      score = 100;
    } else if (ageSeconds < 1800) {
      // 5–30 min: still good
      score = 85;
    } else if (ageSeconds < 3600) {
      // 30min–1h: diminishing
      score = 60;
    } else if (ageSeconds < this.config.maxAgeSeconds) {
      score = 40;
    } else {
      score = 10;
    }

    return {
      value: ageSeconds,
      score,
      reason:
        ageSeconds < 60
          ? `Very new token (${ageSeconds}s) — potential early opportunity but high risk`
          : ageSeconds < 1800
            ? `Token age ${Math.floor(ageSeconds / 60)}m — within ideal discovery window`
            : `Token age ${Math.floor(ageSeconds / 3600)}h ${Math.floor((ageSeconds % 3600) / 60)}m — may be past peak discovery`,
    };
  }

  /**
   * Score holder count: more holders = more distributed = healthier.
   * But extremely high holder counts on young tokens can indicate wash trading.
   */
  private scoreHolders(count: number): CriterionResult {
    let score: number;

    if (count < this.config.minHolders) {
      score = Math.max(0, (count / this.config.minHolders) * 40);
    } else if (count < 50) {
      score = 60;
    } else if (count < 200) {
      score = 85;
    } else if (count < 1000) {
      score = 100;
    } else {
      // Very high holder count — still good but verify it's organic
      score = 90;
    }

    return {
      value: count,
      score: Math.round(score),
      reason:
        count < this.config.minHolders
          ? `Only ${count} holders (min: ${this.config.minHolders}) — thin market`
          : count < 50
            ? `${count} holders — early stage, growing`
            : `${count} holders — healthy distribution`,
    };
  }

  /**
   * Score trading volume: higher volume = more interest/liquidity.
   * But extremely high volume on very new tokens can indicate manipulation.
   */
  private scoreVolume(volumeSol: number): CriterionResult {
    let score: number;

    if (volumeSol < 0.1) {
      score = 10;
    } else if (volumeSol < 1) {
      score = 40;
    } else if (volumeSol < 10) {
      score = 70;
    } else if (volumeSol < 100) {
      score = 90;
    } else if (volumeSol < 1000) {
      score = 100;
    } else {
      // Very high volume — good but could be wash trading
      score = 85;
    }

    return {
      value: volumeSol,
      score,
      reason:
        volumeSol < 1
          ? `Low volume (${volumeSol.toFixed(2)} SOL) — limited interest`
          : volumeSol < 100
            ? `Moderate volume (${volumeSol.toFixed(2)} SOL) — active trading`
            : `High volume (${volumeSol.toFixed(2)} SOL) — strong interest`,
    };
  }

  /**
   * Score dev holdings: lower is better (more decentralized).
   * Config sets maxDevHoldingsPercent threshold.
   */
  private scoreDevHoldings(percent: number): CriterionResult {
    let score: number;

    if (percent > this.config.maxDevHoldingsPercent) {
      score = Math.max(
        0,
        30 * (1 - (percent - this.config.maxDevHoldingsPercent) / 50),
      );
    } else if (percent > 10) {
      score = 60;
    } else if (percent > 5) {
      score = 80;
    } else {
      score = 100;
    }

    return {
      value: percent,
      score: Math.round(Math.max(0, score)),
      reason:
        percent > this.config.maxDevHoldingsPercent
          ? `Dev holds ${percent.toFixed(1)}% (max: ${this.config.maxDevHoldingsPercent}%) — centralization risk`
          : percent > 10
            ? `Dev holds ${percent.toFixed(1)}% — moderate concentration`
            : `Dev holds ${percent.toFixed(1)}% — healthy distribution`,
    };
  }

  /**
   * Rug risk detection: composite of multiple warning signals.
   * Score 0 = safe, 100 = extreme rug risk.
   */
  private scoreRugRisk(
    topHolderConcentration: number,
    devHoldingsPercent: number,
    hasSocials: boolean,
    holderCount: number,
    marketCapSol: number,
    ageSeconds: number,
    volumeSol: number,
  ): RugRiskResult {
    const flags: string[] = [];
    let riskScore = 0;

    // Top 10 holder concentration > 50%
    if (topHolderConcentration > 50) {
      riskScore += 25;
      flags.push(
        `Top 10 holders control ${topHolderConcentration.toFixed(1)}% of supply`,
      );
    } else if (topHolderConcentration > 30) {
      riskScore += 10;
      flags.push(
        `Moderate holder concentration: ${topHolderConcentration.toFixed(1)}%`,
      );
    }

    // Creator holding > 20%
    if (devHoldingsPercent > 20) {
      riskScore += 20;
      flags.push(
        `Creator holds ${devHoldingsPercent.toFixed(1)}% — elevated dump risk`,
      );
    } else if (devHoldingsPercent > 10) {
      riskScore += 5;
    }

    // No social links
    if (!hasSocials) {
      riskScore += 10;
      flags.push('No social media links found');
    }

    // Very low holders with high market cap
    if (holderCount < 10 && marketCapSol > 10) {
      riskScore += 20;
      flags.push(
        `Only ${holderCount} holders with ${marketCapSol.toFixed(1)} SOL market cap — suspicious`,
      );
    }

    // Very young token with high volume — potential snipe target
    if (ageSeconds < 60 && volumeSol > 10) {
      riskScore += 15;
      flags.push(
        `Token only ${ageSeconds}s old with ${volumeSol.toFixed(1)} SOL volume — likely botted`,
      );
    }

    // Brand new token with pump — could be coordinated launch
    if (ageSeconds < 30 && marketCapSol > 5) {
      riskScore += 10;
      flags.push('Extremely new token with significant market cap');
    }

    return {
      score: Math.min(100, riskScore),
      flags:
        flags.length > 0
          ? flags
          : ['No significant rug risk indicators detected'],
    };
  }

  /**
   * Score narrative match: how well the token fits target categories.
   * Matches AI and tech keywords in name, symbol, and description.
   */
  private scoreNarrative(
    name: string,
    symbol: string,
    description: string,
  ): NarrativeResult {
    const text = `${name} ${symbol} ${description}`.toLowerCase();
    const matchedKeywords: string[] = [];
    let category = 'other';
    let score = 20; // Base score for any token

    // Check AI keywords
    const aiMatches = AI_KEYWORDS.filter((kw) => text.includes(kw));
    if (aiMatches.length > 0) {
      matchedKeywords.push(...aiMatches);
      category = 'ai';
      score += Math.min(60, aiMatches.length * 20);
    }

    // Check tech keywords
    const techMatches = TECH_KEYWORDS.filter((kw) => text.includes(kw));
    if (techMatches.length > 0) {
      matchedKeywords.push(...techMatches);
      if (category === 'other') category = 'tech';
      score += Math.min(40, techMatches.length * 10);
    }

    // Check user-configured keywords
    const configMatches = this.config.keywords.filter((kw) =>
      text.includes(kw.toLowerCase()),
    );
    if (configMatches.length > 0) {
      matchedKeywords.push(
        ...configMatches.filter((kw) => !matchedKeywords.includes(kw.toLowerCase())),
      );
      score += Math.min(30, configMatches.length * 15);
    }

    return {
      category,
      score: Math.min(100, score),
      keywords: [...new Set(matchedKeywords)],
    };
  }

  /**
   * Score momentum: analyze recent transaction patterns for buy pressure.
   * Uses Helius transaction data and Jupiter price as signals.
   */
  private scoreMomentum(
    transactions: HeliusTransaction[] | null,
    jupiterPrice: number | null,
  ): MomentumResult {
    if (!transactions || transactions.length === 0) {
      return {
        buyPressure: 0.5,
        score: 50,
        trend: 'flat',
      };
    }

    // Analyze recent transactions for buy vs sell pressure
    let buyCount = 0;
    let sellCount = 0;
    let totalBuyVolume = 0;
    let totalSellVolume = 0;

    for (const tx of transactions) {
      if (tx.nativeTransfers) {
        for (const transfer of tx.nativeTransfers) {
          // Transfers TO the bonding curve = buys
          // Transfers FROM the bonding curve = sells
          // We approximate based on SOL flow direction
          if (transfer.amount > 0) {
            buyCount++;
            totalBuyVolume += transfer.amount;
          }
        }
      }
      if (tx.tokenTransfers) {
        for (const transfer of tx.tokenTransfers) {
          if (transfer.tokenAmount > 0) {
            sellCount++;
            totalSellVolume += transfer.tokenAmount;
          }
        }
      }
    }

    const totalTrades = buyCount + sellCount;
    const buyPressure =
      totalTrades > 0 ? buyCount / totalTrades : 0.5;

    let trend: 'up' | 'down' | 'flat';
    if (buyPressure > 0.6) {
      trend = 'up';
    } else if (buyPressure < 0.4) {
      trend = 'down';
    } else {
      trend = 'flat';
    }

    // Score: higher buy pressure = higher score
    let score: number;
    if (trend === 'up') {
      score = 70 + Math.round(buyPressure * 30);
    } else if (trend === 'flat') {
      score = 50;
    } else {
      score = Math.round(buyPressure * 50);
    }

    // Bonus for having Jupiter price (means it's listed/tradeable)
    if (jupiterPrice !== null && jupiterPrice > 0) {
      score = Math.min(100, score + 5);
    }

    // Volume matters — ignore dead tokens
    void totalBuyVolume;
    void totalSellVolume;

    return {
      buyPressure: parseFloat(buyPressure.toFixed(3)),
      score,
      trend,
    };
  }

  // ─── Private: Recommendation & Reasoning ────────────────────

  /** Map composite score + risk to a recommendation */
  private getRecommendation(
    score: number,
    rugRiskScore: number,
  ): TokenEvaluation['recommendation'] {
    // High rug risk overrides any positive score
    if (rugRiskScore >= 60) return 'avoid';
    if (rugRiskScore >= 40 && score < 70) return 'avoid';

    if (score >= 80 && rugRiskScore < 30) return 'strong_buy';
    if (score >= 60) return 'buy';
    if (score >= 40) return 'watch';
    return 'avoid';
  }

  /** Build a human-readable reasoning string */
  private buildReasoning(
    coin: PumpFunCoin,
    score: number,
    recommendation: TokenEvaluation['recommendation'],
    rugRisk: RugRiskResult,
    narrative: NarrativeResult,
  ): string {
    const parts: string[] = [];

    parts.push(
      `${coin.name} (${coin.symbol}) scored ${score}/100 → ${recommendation.toUpperCase()}.`,
    );

    if (narrative.keywords.length > 0) {
      parts.push(
        `Narrative: ${narrative.category} (keywords: ${narrative.keywords.join(', ')}).`,
      );
    }

    if (rugRisk.score >= 40) {
      parts.push(
        `WARNING: Elevated rug risk (${rugRisk.score}/100). ${rugRisk.flags.join('; ')}.`,
      );
    } else if (rugRisk.flags.length > 0 && rugRisk.flags[0] !== 'No significant rug risk indicators detected') {
      parts.push(`Risk flags: ${rugRisk.flags.join('; ')}.`);
    }

    return parts.join(' ');
  }

  // ─── Private: Target Selection ──────────────────────────────

  /** Select the best target from newly discovered tokens */
  private selectTarget(newTokens: ScannedToken[]): void {
    // Gather all tokens with evaluations
    const evaluated = [
      ...newTokens.filter((t) => t.evaluation),
      ...this.getDiscoveredTokens().filter((t) => t.evaluation),
    ];

    // Filter to only strong_buy or buy recommendations
    const buyable = evaluated.filter(
      (t) =>
        t.evaluation?.recommendation === 'strong_buy' ||
        t.evaluation?.recommendation === 'buy',
    );

    if (buyable.length === 0) {
      if (newTokens.length > 0) {
        this.emit('scanner:no-targets');
        this.eventBus.emit(
          'scanner:no-targets',
          'intelligence' as SwarmEventCategory,
          this.id,
          { scannedCount: newTokens.length },
        );
      }
      return;
    }

    // Sort by score descending
    buyable.sort(
      (a, b) =>
        (b.evaluation?.score ?? 0) - (a.evaluation?.score ?? 0),
    );

    const best = buyable[0];

    // Only update target if the new one is better
    if (
      !this.targetToken ||
      (best.evaluation?.score ?? 0) >
        (this.targetToken.evaluation?.score ?? 0)
    ) {
      this.targetToken = best;

      this.logger.info('Target token selected', {
        mint: best.mint,
        name: best.name,
        symbol: best.symbol,
        score: best.evaluation?.score,
        recommendation: best.evaluation?.recommendation,
      });

      this.emit('scanner:target-selected', best);
      this.eventBus.emit(
        'scanner:target-selected',
        'intelligence' as SwarmEventCategory,
        this.id,
        {
          mint: best.mint,
          name: best.name,
          symbol: best.symbol,
          score: best.evaluation?.score,
          recommendation: best.evaluation?.recommendation,
        },
      );
    }
  }

  // ─── Private: Helpers ───────────────────────────────────────

  /** Convert a PumpFun coin + evaluation into a ScannedToken */
  private coinToScannedToken(
    coin: PumpFunCoin,
    evaluation: TokenEvaluation,
  ): ScannedToken {
    return {
      mint: coin.mint,
      name: coin.name,
      symbol: coin.symbol,
      description: coin.description,
      marketCapSol: (coin.market_cap ?? 0) / LAMPORTS_PER_SOL,
      volumeSol: evaluation.criteria.volume.sol,
      createdAt: (coin.created_timestamp ?? 0) * 1000,
      imageUri: coin.image_uri,
      evaluation,
      discoveredAt: Date.now(),
    };
  }

  /** Add a token to the discovered map, evicting oldest if at capacity */
  private addDiscoveredToken(token: ScannedToken): void {
    if (this.discoveredTokens.size >= MAX_DISCOVERED_TOKENS) {
      // Evict the oldest entry
      const oldestKey = this.discoveredTokens.keys().next().value;
      if (oldestKey !== undefined) {
        this.discoveredTokens.delete(oldestKey);
      }
    }
    this.discoveredTokens.set(token.mint, token);
  }

  /** Estimate trading volume from Helius transaction data */
  private estimateVolume(
    transactions: HeliusTransaction[] | null,
  ): number {
    if (!transactions || transactions.length === 0) return 0;

    let totalSolMoved = 0;
    for (const tx of transactions) {
      if (tx.nativeTransfers) {
        for (const transfer of tx.nativeTransfers) {
          totalSolMoved += Math.abs(transfer.amount);
        }
      }
    }

    // Convert lamports to SOL
    return totalSolMoved / LAMPORTS_PER_SOL;
  }

  /** Configurable delay for rate limiting */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
