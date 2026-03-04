/**
 * Swarm Orchestrator — THE MAIN BRAIN
 *
 * Complete coordination of the entire pump-agent swarm:
 * - Creates and manages every agent, infra component, and intelligence layer
 * - Coordinates all phases from scouting to exit
 * - Makes strategic decisions via StrategyBrain
 * - Handles the full lifecycle: startup → autonomous loop → graceful shutdown
 * - Event-driven coordination: agents communicate via event bus, never direct calls
 * - Error recovery prevents single failures from crashing the entire swarm
 *
 * This is the replacement for the legacy swarm.ts, wiring together all
 * infrastructure built in prompts 01-49.
 */

import { Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';

// ─── Infra ────────────────────────────────────────────────────
import { RpcPool }              from '../infra/rpc-pool.js';
import { SwarmEventBus }        from '../infra/event-bus.js';
import { SwarmStateMachine, DEFAULT_SWARM_TRANSITIONS } from '../infra/state-machine.js';
import { SwarmLogger }          from '../infra/logger.js';
import { MetricsCollector }     from '../infra/metrics.js';
import { SwarmErrorHandler }    from '../infra/error-handler.js';

// ─── Config ───────────────────────────────────────────────────

// ─── Types ────────────────────────────────────────────────────
import type {
  AgentWallet,
  RpcEndpoint,
  SwarmMetrics,
  SwarmPhase,
  TradingStrategy,
} from '../types.js';

// ─── Coordination ─────────────────────────────────────────────
import { AuditLogger }          from './audit-logger.js';
import type { AuditEntry }      from './audit-logger.js';
import { PhaseController }      from './phase-controller.js';
import { HealthMonitor }        from './health-monitor.js';
import { LifecycleManager }     from './lifecycle-manager.js';
import { AgentMessenger }       from './agent-messenger.js';

// ─── Intelligence ─────────────────────────────────────────────
import { StrategyBrain }        from '../intelligence/strategy-brain.js';
import type { StrategyBrainConfig, StrategyDecision, MarketContext } from '../intelligence/strategy-brain.js';
import { RiskManager }          from '../intelligence/risk-manager.js';
import { SignalGenerator }      from '../intelligence/signal-generator.js';

// ─── Agents ───────────────────────────────────────────────────
import { NarrativeAgent }       from '../agents/narrative-agent.js';
import type { NarrativeOptions } from '../agents/narrative-agent.js';
import { ScannerAgent }         from '../agents/scanner-agent.js';
import { CreatorAgent }         from '../agents/creator-agent.js';
import { TraderAgent }          from '../agents/trader-agent.js';
import { SniperAgent }          from '../agents/sniper-agent.js';
import { MarketMakerAgent }     from '../agents/market-maker-agent.js';
import { VolumeAgent }          from '../agents/volume-agent.js';
import { AccumulatorAgent }     from '../agents/accumulator-agent.js';
import { ExitAgent }            from '../agents/exit-agent.js';
import { SentinelAgent }        from '../agents/sentinel-agent.js';

// ─── Bundle & Trading ─────────────────────────────────────────
import { LaunchSequencer }      from '../bundle/launch-sequencer.js';
import { WashEngine }           from '../trading/wash-engine.js';

// ─── Wallet ───────────────────────────────────────────────────
import {
  createAgentWallet,
  generateWalletPool,
  refreshBalances,
  WalletVault,
} from '../wallet-manager.js';

// ─── Strategies ───────────────────────────────────────────────
import {
  STRATEGY_ORGANIC,
  STRATEGY_VOLUME,
  STRATEGY_GRADUATION,
  STRATEGY_EXIT,
} from '../strategies.js';

// ─── Bundle Dependencies ─────────────────────────────────────
import { DevBuyOptimizer }      from '../bundle/dev-buy-optimizer.js';
import { JitoClient }           from '../bundle/jito-client.js';
import { SupplyDistributor }    from '../bundle/supply-distributor.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

/** Risk limits for the orchestrator */
export interface RiskLimits {
  maxPositionSize: number;
  maxTotalDeployed: number;
  maxPositionPercent: number;
  stopLossPercent: number;
  maxDrawdownPercent: number;
  maxDrawdownSOL: number;
  maxConcurrentPositions: number;
  maxLossPerWindow: number;
  lossWindowMs: number;
  circuitBreakerCooldown: number;
  maxConsecutiveLosses: number;
  minTradeCooldown: number;
}

export interface SwarmOrchestratorConfig {
  /** Solana RPC URLs (primary + fallbacks) */
  rpcUrls: string[];
  /** Master wallet secret key (base58 or Uint8Array) */
  masterWalletSecret: string | Uint8Array;
  /** Total SOL budget for operations */
  totalBudgetSOL: number;
  /** Number of trader agents to spawn */
  traderCount: number;
  /** Network: mainnet-beta or devnet */
  network: 'mainnet-beta' | 'devnet';
  /** OpenRouter API key for AI decisions */
  openRouterApiKey: string;
  /** Trading strategy preference */
  defaultStrategy: 'organic' | 'volume' | 'graduation' | 'exit';
  /** Risk limits */
  riskLimits: RiskLimits;
  /** Auto-mode: let the brain decide everything */
  autonomous: boolean;
  /** Max duration for the entire swarm session (ms) */
  maxSessionDuration: number;
  /** Dashboard port (0 = disabled) */
  dashboardPort: number;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface SwarmOrchestratorStatus {
  /** Current state machine state */
  state: string;
  /** Current phase */
  phase: string;
  /** Is actively trading? */
  trading: boolean;
  /** Is paused? */
  paused: boolean;
  /** Uptime (ms) */
  uptime: number;
  /** Session start time */
  startedAt: number;
  /** Active token mint (if any) */
  activeMint?: string;
  /** Active token name */
  activeTokenName?: string;
  /** Agent statuses */
  agents: Array<{ id: string; type: string; status: string }>;
  /** Portfolio summary */
  portfolio: {
    totalInvested: number;
    currentValue: number;
    pnl: number;
    pnlPercent: number;
    roi: number;
  };
  /** Last decision made */
  lastDecision?: {
    action: string;
    reasoning: string;
    timestamp: number;
  };
  /** Next evaluation time */
  nextEvaluation: number;
  /** Health status */
  health: 'healthy' | 'degraded' | 'critical';
  /** Trade count this session */
  tradeCount: number;
  /** Error count this session */
  errorCount: number;
}

// ─── Strategy map ─────────────────────────────────────────────

const STRATEGY_MAP: Record<string, TradingStrategy> = {
  organic: STRATEGY_ORGANIC,
  volume: STRATEGY_VOLUME,
  graduation: STRATEGY_GRADUATION,
  exit: STRATEGY_EXIT,
};

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const SIGNAL_POLL_INTERVAL_MS   = 10_000;
const RISK_CHECK_INTERVAL_MS    = 30_000;
const HEALTH_CHECK_INTERVAL_MS  = 60_000;
const RE_EVALUATE_INTERVAL_MS   = 120_000;
const MAX_AGENT_RESTARTS        = 3;
const INFLIGHT_TRADE_TIMEOUT_MS = 30_000;

// ═══════════════════════════════════════════════════════════════
// SwarmOrchestrator
// ═══════════════════════════════════════════════════════════════

export class SwarmOrchestrator {
  // ── Configuration ───────────────────────────────────────────
  private readonly config: SwarmOrchestratorConfig;

  // ── Infrastructure ──────────────────────────────────────────
  private rpcPool!: RpcPool;
  private eventBus!: SwarmEventBus;
  private stateMachine!: SwarmStateMachine;
  private logger!: SwarmLogger;
  private metrics!: MetricsCollector;
  private errorHandler!: SwarmErrorHandler;

  // ── Coordination ────────────────────────────────────────────
  private auditLogger!: AuditLogger;
  private phaseController!: PhaseController;
  private healthMonitor!: HealthMonitor;
  private lifecycleManager!: LifecycleManager;
  private agentMessenger!: AgentMessenger;

  // ── Intelligence ────────────────────────────────────────────
  private strategyBrain!: StrategyBrain;
  private signalGenerator!: SignalGenerator;

  // ── Wallets ─────────────────────────────────────────────────
  private masterWallet!: AgentWallet;
  private traderWallets: AgentWallet[] = [];
  private walletVault!: WalletVault;

  // ── Agents ──────────────────────────────────────────────────
  private narrativeAgent!: NarrativeAgent;
  private scannerAgent!: ScannerAgent;
  private creatorAgent!: CreatorAgent;
  private sentinelAgent!: SentinelAgent;
  private traderAgents: TraderAgent[] = [];
  private sniperAgent!: SniperAgent;
  private marketMakerAgent!: MarketMakerAgent;
  private volumeAgent!: VolumeAgent;
  private exitAgent!: ExitAgent;

  // ── Bundle & Trading ────────────────────────────────────────
  private launchSequencer!: LaunchSequencer;

  // ── Runtime state ───────────────────────────────────────────
  private initialized = false;
  private running = false;
  private paused = false;
  private stopRequested = false;
  private startedAt = 0;
  private activeMint: string | undefined;
  private activeTokenName: string | undefined;
  private lastDecision: StrategyDecision | undefined;
  private nextEvaluationAt = 0;
  private tradeCount = 0;
  private errorCount = 0;
  private totalInvestedSOL = 0;
  private sessionId: string;

  // ── Timers ──────────────────────────────────────────────────
  private signalTimer: ReturnType<typeof setInterval> | undefined;
  private riskTimer: ReturnType<typeof setInterval> | undefined;
  private healthTimer: ReturnType<typeof setInterval> | undefined;
  private sessionTimer: ReturnType<typeof setTimeout> | undefined;
  private loopTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Event subscription IDs (for cleanup) ────────────────────
  private readonly subscriptionIds: string[] = [];

  constructor(config: SwarmOrchestratorConfig) {
    this.config = { ...config };
    this.sessionId = uuidv4();
  }

  // ═══════════════════════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════════════════════

  /**
   * Set up all infrastructure, wallets, intelligence, agents, and wiring.
   * Must be called before start().
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('SwarmOrchestrator already initialized');
    }

    // ── Step 1: Infrastructure ────────────────────────────────
    this.eventBus = SwarmEventBus.getInstance();

    this.logger = new SwarmLogger({
      level: this.config.logLevel,
      agentId: 'orchestrator',
      category: 'coordination',
    });
    this.logger.info('Initializing SwarmOrchestrator', {
      sessionId: this.sessionId,
      network: this.config.network,
      traderCount: this.config.traderCount,
      budgetSOL: this.config.totalBudgetSOL,
      strategy: this.config.defaultStrategy,
      autonomous: this.config.autonomous,
    });

    const rpcEndpoints: RpcEndpoint[] = this.config.rpcUrls.map((url, i) => ({
      url,
      weight: i === 0 ? 10 : 5,
      rateLimit: 25,
      supportsJito: url.includes('jito') || url.includes('block-engine'),
      provider: `rpc-${i}`,
    }));
    this.rpcPool = new RpcPool({ endpoints: rpcEndpoints });
    this.rpcPool.startHealthChecks();

    this.stateMachine = new SwarmStateMachine(
      {
        initialPhase: 'idle',
        transitions: DEFAULT_SWARM_TRANSITIONS,
        onError: (error, phase) => {
          this.logger.error(`State machine error in phase ${phase}`, error);
          return 'error';
        },
        onTimeout: (phase) => {
          this.logger.warn(`Phase timeout: ${phase}`);
          return phase === 'trading' ? 'exiting' : 'error';
        },
      },
      this.eventBus,
    );

    this.metrics = MetricsCollector.getInstance();
    this.errorHandler = new SwarmErrorHandler(this.eventBus);
    this.auditLogger = new AuditLogger(this.eventBus, {
      autoCapture: true,
      minSeverity: 'info',
    });

    // ── Step 2: Wallets ───────────────────────────────────────
    const masterKeypair = this.resolveMasterKeypair();
    this.masterWallet = {
      keypair: masterKeypair,
      address: masterKeypair.publicKey.toBase58(),
      label: 'master',
      balanceLamports: new BN(0),
    };

    const primaryConnection = this.rpcPool.getConnection();

    this.walletVault = new WalletVault(
      {
        poolSize: this.config.traderCount + 5, // extra for creator, sniper, market-maker, etc.
        minBalanceLamports: new BN(0.001 * 1e9),
      },
      primaryConnection,
    );
    await this.walletVault.initialize();

    // Generate trader wallets
    const pool = await generateWalletPool(this.config.traderCount);
    this.traderWallets = pool.traders;
    this.logger.info('Wallets prepared', {
      masterAddress: this.masterWallet.address,
      traderCount: this.traderWallets.length,
    });

    // Check master wallet balance
    const masterBalance = await primaryConnection.getBalance(masterKeypair.publicKey);
    this.masterWallet.balanceLamports = new BN(masterBalance);
    const budgetLamports = this.config.totalBudgetSOL * 1e9;
    if (masterBalance < budgetLamports) {
      this.logger.warn('Master wallet balance is below configured budget', {
        balance: masterBalance / 1e9,
        budget: this.config.totalBudgetSOL,
      });
    }

    // ── Step 3: Intelligence Layer ────────────────────────────
    const brainConfig: StrategyBrainConfig = {
      openRouterApiKey: this.config.openRouterApiKey,
      model: 'anthropic/claude-sonnet-4-20250514',
      apiBaseUrl: 'https://openrouter.ai/api/v1',
      maxTokens: 2048,
      temperature: 0.7,
      riskTolerance: 0.5,
      minConfidence: 0.6,
      maxBudgetPerAction: this.config.totalBudgetSOL * 0.25,
      contextCacheTtl: 60_000,
    };
    this.strategyBrain = new StrategyBrain(brainConfig, this.eventBus);

    // RiskManager registers event listeners on the bus and is retained by them
    void new RiskManager(this.config.riskLimits, this.eventBus);
    this.signalGenerator = new SignalGenerator(primaryConnection, this.eventBus);

    // ── Step 4: Coordination Layer ────────────────────────────
    this.phaseController = new PhaseController(this.eventBus);
    this.healthMonitor = new HealthMonitor(this.eventBus);
    this.lifecycleManager = new LifecycleManager(this.eventBus, {
      autoRestart: true,
      maxRestarts: MAX_AGENT_RESTARTS,
    });
    this.agentMessenger = new AgentMessenger(this.eventBus);

    // ── Step 5: Create Agents ─────────────────────────────────
    const strategy = STRATEGY_MAP[this.config.defaultStrategy] ?? STRATEGY_ORGANIC;

    this.narrativeAgent = new NarrativeAgent(
      {
        llmProvider: 'openrouter',
        llmApiKey: this.config.openRouterApiKey,
        llmModel: 'anthropic/claude-sonnet-4-20250514',
        enableSignals: true,
        enableSentiment: true,
        riskTolerance: 0.5,
        maxAllocationPerToken: 0.25,
      },
      this.eventBus,
      SwarmLogger.create('narrative-agent', 'intelligence'),
    );

    this.scannerAgent = new ScannerAgent(
      {
        intervalMs: 15_000,
        minMarketCapSol: 0.5,
        maxMarketCapSol: 100,
        maxAgeSeconds: 600,
        keywords: ['ai', 'agent', 'meme', 'dog', 'cat', 'pepe', 'trump'],
        categories: ['ai', 'meme'],
        minHolders: 5,
        maxDevHoldingsPercent: 50,
        checkRugRisk: true,
      },
      this.config.rpcUrls[0],
      this.eventBus,
    );

    const creatorWallet = this.traderWallets[0] ?? createAgentWallet('creator');
    this.creatorAgent = new CreatorAgent(
      this.config.rpcUrls[0],
      creatorWallet,
      this.eventBus,
      this.errorHandler,
    );

    this.sentinelAgent = new SentinelAgent(
      {
        maxLossLamports: new BN(this.config.riskLimits.maxDrawdownSOL * 1e9),
        maxLossPercent: this.config.riskLimits.maxDrawdownPercent * 100,
        maxSilenceMs: 300_000,
        sellAllOnExit: true,
        reclaimOnExit: true,
      },
      primaryConnection,
      this.eventBus,
    );

    // Trader agents (N)
    this.traderAgents = this.traderWallets.map((wallet, i) =>
      new TraderAgent(
        `trader-${i}`,
        wallet,
        primaryConnection,
        strategy,
        undefined, // auto-generate personality
        this.eventBus,
        this.errorHandler,
      ),
    );

    // Sniper agent
    const sniperWallet = createAgentWallet('sniper');
    this.sniperAgent = new SniperAgent(sniperWallet, primaryConnection);

    // Market maker agent
    const mmWallet = createAgentWallet('market-maker');
    this.marketMakerAgent = new MarketMakerAgent(mmWallet, primaryConnection, {
      targetSpreadPercent: 2.5,
      trailPriceUp: true,
      priceIncrementPercent: 0.5,
      cycleDurationMs: 30_000,
      cyclesPerEvaluation: 5,
      volumeTargetSol: 1.0,
      imbalanceTarget: 0.15,
      useWalletRotation: false,
      minRotationWallets: 2,
      maxTradesPerWalletPerCycle: 3,
    });

    // Volume agent
    this.volumeAgent = new VolumeAgent(
      this.traderWallets.slice(0, Math.max(2, Math.floor(this.traderWallets.length / 2))),
      primaryConnection,
      {
        targetVolumeSolPerHour: 5,
        minTradeSize: new BN(0.01 * 1e9),
        maxTradeSize: new BN(0.1 * 1e9),
        minIntervalMs: 5_000,
        maxIntervalMs: 20_000,
        walletRotationEnabled: true,
        maxTradesPerWallet: 10,
        balancedMode: true,
        naturalPatterns: true,
      },
    );

    // Accumulator agent
    const accWallet = createAgentWallet('accumulator');
    // AccumulatorAgent registers event listeners and is retained by the event bus
    void new AccumulatorAgent(accWallet, primaryConnection, {
      strategy: 'adaptive',
      maxPriceImpactPercent: 3,
      maxSlippageBps: 500,
      splitFactor: 4,
      pauseOnHighVolatility: true,
      volatilityThreshold: 15,
    });

    // Exit agent
    this.exitAgent = new ExitAgent(
      {
        strategy: 'staged',
        exitDurationMs: 300_000,
        stages: [
          { priceMultiplier: 2.0, sellPercent: 25 },
          { priceMultiplier: 3.0, sellPercent: 30 },
          { priceMultiplier: 5.0, sellPercent: 30 },
        ],
        maxPriceImpactPercent: 5,
        retainPercent: 15,
        priorityFeeMicroLamports: 100_000,
        slippageBps: 500,
        monitorIntervalMs: 10_000,
      },
      primaryConnection,
      this.eventBus,
    );

    // ── Step 6: Operational Components ────────────────────────
    const devBuyOptimizer = new DevBuyOptimizer();
    const jitoClient = new JitoClient({
      blockEngineUrl: 'https://mainnet.block-engine.jito.wtf',
      tipLamports: 10_000,
      maxBundleSize: 5,
      useOnChainTip: true,
    });
    const supplyDistributor = new SupplyDistributor(primaryConnection, this.walletVault, this.eventBus);

    this.launchSequencer = new LaunchSequencer(
      { rpcUrl: this.config.rpcUrls[0] },
      {
        eventBus: this.eventBus,
        walletVault: this.walletVault,
        creatorAgent: this.creatorAgent,
        devBuyOptimizer,
        jitoClient,
        supplyDistributor,
      },
    );

    // WashEngine registers event listeners and is retained by the event bus
    void new WashEngine(
      this.traderWallets.length >= 2 ? this.traderWallets : [createAgentWallet('wash-0'), createAgentWallet('wash-1')],
      primaryConnection,
      {
        tradesPerCycle: 6,
        intraTradeDelayMs: { min: 2_000, max: 8_000 },
        interCycleDelayMs: { min: 15_000, max: 45_000 },
        tradeSizeRange: { min: 0.01, max: 0.08 },
        maxNetChangePercent: 5,
        priceDriftPercent: 0.5,
        maxConsecutiveBuys: 3,
        maxConsecutiveSells: 3,
        naturalSizing: true,
        maxBudgetLamports: new BN(this.config.totalBudgetSOL * 0.2 * 1e9),
      },
      this.eventBus,
    );

    // ── Step 7: Wire Event Handlers ───────────────────────────
    this.wireEventHandlers();

    // ── Step 8: Mark Ready ────────────────────────────────────
    this.initialized = true;

    this.eventBus.emit('swarm:initialized', 'lifecycle', 'orchestrator', {
      sessionId: this.sessionId,
      traderCount: this.traderAgents.length,
      network: this.config.network,
      strategy: this.config.defaultStrategy,
    });

    this.logger.info('SwarmOrchestrator initialized successfully', {
      agents: {
        narrativeAgent: 1,
        scannerAgent: 1,
        creatorAgent: 1,
        sentinelAgent: 1,
        traderAgents: this.traderAgents.length,
        sniperAgent: 1,
        marketMakerAgent: 1,
        volumeAgent: 1,
        accumulatorAgent: 1,
        exitAgent: 1,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Main Loop
  // ═══════════════════════════════════════════════════════════

  /**
   * Begin the autonomous swarm loop.
   * Continuously: gather context → decide → act → monitor → re-evaluate.
   */
  async start(): Promise<void> {
    this.ensureInitialized();
    if (this.running) {
      this.logger.warn('SwarmOrchestrator already running');
      return;
    }

    this.running = true;
    this.stopRequested = false;
    this.startedAt = Date.now();

    this.logger.info('SwarmOrchestrator starting', { sessionId: this.sessionId });

    // Transition state machine to initializing → scanning
    await this.stateMachine.transition('initializing');

    // Set session timeout
    if (this.config.maxSessionDuration > 0) {
      this.sessionTimer = setTimeout(() => {
        this.logger.warn('Session duration limit reached');
        void this.stop('session-duration-exceeded');
      }, this.config.maxSessionDuration);
    }

    // Start monitoring timers
    this.startMonitoringTimers();

    // Start health monitoring
    this.healthMonitor.startMonitoring();

    // Start lifecycle manager heartbeat checking
    this.lifecycleManager.startHeartbeatMonitoring();

    // Enter the main autonomous loop
    await this.runMainLoop();
  }

  /**
   * The core autonomous loop. Runs until stopRequested or exit condition.
   */
  private async runMainLoop(): Promise<void> {
    while (this.running && !this.stopRequested) {
      try {
        // 1. Check if paused
        if (this.paused) {
          await this.sleep(5_000);
          continue;
        }

        // 2. Transition to scouting
        await this.transitionPhase('scanning');

        // 3. Gather market context
        const context = await this.gatherMarketContext();

        // 4. Ask StrategyBrain for a decision
        let decision: StrategyDecision;
        try {
          decision = await this.strategyBrain.decideAction(context);
        } catch (err) {
          // Fallback to rule-based strategy if LLM fails
          this.logger.warn('StrategyBrain LLM failed, using rule-based fallback', {
            error: err instanceof Error ? err.message : String(err),
          });
          decision = this.buildFallbackDecision(context);
        }

        this.lastDecision = decision;
        this.auditLogger.logAction({
          category: 'decision',
          severity: 'info',
          agentId: 'orchestrator',
          action: `strategy-decision:${decision.action}`,
          details: decision.reasoning,
          success: true,
          metadata: {
            action: decision.action,
            confidence: decision.confidence,
            model: decision.model,
          },
        });

        // 5. Validate with RiskManager
        const riskOk = this.validateDecisionRisk(decision);
        if (!riskOk) {
          this.logger.warn('RiskManager rejected decision', {
            action: decision.action,
            reasoning: decision.reasoning,
          });
          this.nextEvaluationAt = Date.now() + RE_EVALUATE_INTERVAL_MS;
          await this.sleep(RE_EVALUATE_INTERVAL_MS);
          continue;
        }

        // 6. Execute decision
        await this.executeDecision(decision);

        // 7. Monitor trading (if active mint exists)
        if (this.activeMint) {
          await this.monitorActivePosition();
        }

        // 8. Check exit conditions
        if (this.shouldExit()) {
          this.logger.info('Exit condition met, stopping swarm');
          await this.stop('exit-condition-met');
          return;
        }

        // 9. Sleep before re-evaluation
        this.nextEvaluationAt = Date.now() + RE_EVALUATE_INTERVAL_MS;
        await this.sleep(RE_EVALUATE_INTERVAL_MS);

      } catch (err) {
        this.errorCount++;
        const classified = this.errorHandler.classify(
          err instanceof Error ? err : new Error(String(err)),
          { operation: 'main-loop' },
        );

        this.logger.error(
          `Main loop error (severity=${classified.severity}, category=${classified.category}, action=${classified.suggestedAction})`,
          err instanceof Error ? err : new Error(String(err)),
        );

        if (classified.severity === 'fatal') {
          await this.stop('fatal-error');
          return;
        }

        // Brief pause before retrying
        await this.sleep(10_000);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Decision Execution
  // ═══════════════════════════════════════════════════════════

  /**
   * Execute a strategic decision from the StrategyBrain.
   */
  async executeDecision(decision: StrategyDecision): Promise<void> {
    this.logger.info(`Executing decision: ${decision.action}`, {
      confidence: decision.confidence,
      reasoning: decision.reasoning,
    });

    switch (decision.action) {
      case 'launch-new':
        await this.executeLaunchNew(decision);
        break;

      case 'buy-existing':
        await this.executeBuyExisting(decision);
        break;

      case 'adjust-strategy':
        this.executeAdjustStrategy(decision);
        break;

      case 'exit-position':
        await this.executeExitPosition(decision);
        break;

      case 'hold':
        this.logger.info('Decision: HOLD — maintaining current position');
        break;

      case 'wait':
        this.logger.info('Decision: WAIT — sleeping before next evaluation');
        break;

      default:
        this.logger.warn('Unknown decision action', { action: decision.action });
    }
  }

  /**
   * Launch a new token: Narrative → Create → Bundle → Start Trading
   */
  private async executeLaunchNew(decision: StrategyDecision): Promise<void> {
    await this.transitionPhase('creating_narrative');

    // Generate narrative
    const narrative = await this.narrativeAgent.generateNarrative({
      theme: decision.launchParams?.category as NarrativeOptions['theme'],
      customPrompt: decision.launchParams?.narrative,
    });

    this.logger.info('Narrative generated', {
      name: narrative.name,
      symbol: narrative.symbol,
      confidence: narrative.confidence,
    });

    // Mark conditions met for minting phase
    this.phaseController.setConditionMet('creating_narrative', 'strategy_decided', true);
    this.phaseController.setConditionMet('minting', 'narrative_generated', true);
    this.phaseController.setConditionMet('minting', 'token_config_ready', true);

    await this.transitionPhase('minting');

    // Create token
    const tokenConfig = {
      name: narrative.name,
      symbol: narrative.symbol,
      metadataUri: narrative.metadataUri ?? '',
    };

    const bundleBuyConfig = {
      devBuyLamports: new BN((decision.launchParams?.suggestedBudget ?? 1.0) * 1e9 * 0.1),
      bundleWallets: this.traderWallets.slice(0, 5).map((w) => ({
        wallet: w,
        amountLamports: new BN((decision.launchParams?.suggestedBudget ?? 1.0) * 1e9 * 0.05),
      })),
      slippageBps: 500,
    };

    const mintResult = await this.creatorAgent.createToken(tokenConfig, bundleBuyConfig);
    this.activeMint = mintResult.mint;
    this.activeTokenName = narrative.name;
    this.totalInvestedSOL += (decision.launchParams?.suggestedBudget ?? 1.0);

    this.phaseController.setConditionMet('bundling', 'token_created', true);
    this.phaseController.setConditionMet('bundling', 'dev_buy_complete', true);

    await this.transitionPhase('bundling');

    // Bundle phase (LaunchSequencer handles bundling + distributing)
    const plan = await this.launchSequencer.prepareLaunch(tokenConfig);
    await this.launchSequencer.executeLaunch(plan);

    this.phaseController.setConditionMet('distributing', 'bundle_complete', true);
    await this.transitionPhase('distributing');
    await this.transitionPhase('trading');

    // Start all trading agents
    this.startTrading(mintResult.mint);
  }

  /**
   * Buy an existing token: Scanner → Sniper → Start Trading
   */
  private async executeBuyExisting(decision: StrategyDecision): Promise<void> {
    if (!decision.buyParams?.mint) {
      this.logger.warn('buy-existing decision missing mint, starting scanner');
      this.scannerAgent.startScanning();
      await this.sleep(30_000);
      this.scannerAgent.stopScanning();
      return;
    }

    await this.transitionPhase('evaluating');

    this.activeMint = decision.buyParams.mint;

    // Use sniper agent for quick buy
    await this.sniperAgent.setReady();
    await this.sniperAgent.watchForLaunch(decision.buyParams.mint);

    this.totalInvestedSOL += (decision.buyParams.suggestedAmount ?? 0.5);

    // Transition to trading
    this.phaseController.setConditionMet('trading', 'target_supply_accumulated', true);
    this.phaseController.setConditionMet('trading', 'traders_ready', true);
    await this.transitionPhase('trading');

    this.startTrading(decision.buyParams.mint);
  }

  /**
   * Adjust the active trading strategy.
   */
  private executeAdjustStrategy(decision: StrategyDecision): void {
    const adj = decision.strategyAdjustment;
    if (!adj) return;

    const newStrategy = STRATEGY_MAP[adj.newStrategy];
    if (newStrategy) {
      this.logger.info('Adjusting strategy', {
        newStrategy: adj.newStrategy,
        reason: adj.reason,
      });

      // Broadcast strategy update to all agents via messenger
      void this.agentMessenger.sendMessage('orchestrator', '*', {
        id: uuidv4(),
        from: 'orchestrator',
        to: '*',
        type: 'strategy-update',
        priority: 'high',
        payload: {
          type: 'strategy-update' as const,
          newStrategy: adj.newStrategy,
          changes: adj.changes,
          effectiveImmediately: true,
        },
        timestamp: Date.now(),
        ttl: 30_000,
      });
    }
  }

  /**
   * Exit an active position.
   */
  private async executeExitPosition(decision: StrategyDecision): Promise<void> {
    const exitParams = decision.exitParams;
    const mint = exitParams?.mint ?? this.activeMint;
    if (!mint) {
      this.logger.warn('exit-position decision but no active mint');
      return;
    }

    await this.transitionPhase('exiting');

    // Stop all trading activity
    this.stopTrading();

    // Set exit conditions and start monitoring
    this.exitAgent.setExitConditions({
      takeProfitMultiplier: 2.0,
      stopLossPercent: 30,
      maxHoldTimeSeconds: 3600,
    });

    // Monitor and auto-execute exit
    this.exitAgent.monitorForExit(mint, this.traderWallets, true);

    this.logger.info('Exit position initiated', {
      mint,
      strategy: exitParams?.exitStrategy ?? 'staged',
      reason: exitParams?.reason ?? 'orchestrator-decision',
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Trading Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Start all trading agents on the active mint.
   */
  private startTrading(mint: string): void {
    this.logger.info('Starting trading agents', { mint, count: this.traderAgents.length });

    for (const trader of this.traderAgents) {
      trader.start(mint);
    }

    // Start market maker
    this.marketMakerAgent.start(mint);

    // Start volume agent
    this.volumeAgent.start(mint);

    // Start signal monitoring
    this.signalGenerator.startMonitoring(mint, SIGNAL_POLL_INTERVAL_MS);

    // Start sentinel monitoring
    this.sentinelAgent.startMonitoring(mint, this.traderWallets);

    this.metrics.counter('swarm.trading.sessions_started').inc();
  }

  /**
   * Stop all trading agents.
   */
  private stopTrading(): void {
    this.logger.info('Stopping trading agents');

    for (const trader of this.traderAgents) {
      trader.stop('orchestrator-stop');
    }

    this.marketMakerAgent.stop();
    this.volumeAgent.stop();

    if (this.activeMint) {
      this.signalGenerator.stopMonitoring(this.activeMint);
    }
    this.sentinelAgent.stopMonitoring();
  }

  /**
   * Monitor the active position for signals, risk, and health.
   * Called during each main loop iteration while trading is active.
   */
  private async monitorActivePosition(): Promise<void> {
    if (!this.activeMint) return;

    try {
      const signals = await this.signalGenerator.generateSignals(this.activeMint);

      // Emit signals via event bus for all agents to consume
      this.eventBus.emit('signal:generated', 'intelligence', 'orchestrator', {
        mint: this.activeMint,
        signals,
      });
    } catch (err) {
      this.logger.warn('Signal generation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Market Context
  // ═══════════════════════════════════════════════════════════

  /**
   * Gather current market context for StrategyBrain.
   */
  private async gatherMarketContext(): Promise<MarketContext> {
    const now = Date.now();

    // Real SOL price from connection (basic approach: check lamports per SOL value)
    let solPrice = 150; // fallback
    try {
      const connection = this.rpcPool.getConnection();
      const slot = await connection.getSlot();
      // In production this would hit a price oracle — using a basic estimate
      solPrice = 150 + (slot % 10);
    } catch {
      // Use fallback
    }

    const context: MarketContext = {
      solPrice,
      solPriceChange24h: 0,
      recentLaunchCount: 0,
      graduationRate: 0.03,
      trendingNarratives: ['ai', 'agents', 'memes'],
      fearGreedIndex: 55,
      portfolioValue: this.totalInvestedSOL * solPrice,
      availableBudget: this.config.totalBudgetSOL - this.totalInvestedSOL,
      activePositions: this.activeMint ? 1 : 0,
      regime: 'crab',
      alphaOpportunities: [],
      timestamp: now,
    };

    return context;
  }

  // ═══════════════════════════════════════════════════════════
  // Risk Validation
  // ═══════════════════════════════════════════════════════════

  /**
   * Validate a decision against the RiskManager.
   * Returns true if the decision is within risk parameters.
   */
  private validateDecisionRisk(decision: StrategyDecision): boolean {
    if (decision.action === 'hold' || decision.action === 'wait') {
      return true;
    }

    if (decision.action === 'exit-position') {
      return true; // Always allow exits
    }

    // Check budget
    const remainingBudget = this.config.totalBudgetSOL - this.totalInvestedSOL;
    if (remainingBudget <= 0) {
      this.logger.warn('Budget exhausted');
      return false;
    }

    // Check position size limits
    if (decision.action === 'launch-new' || decision.action === 'buy-existing') {
      const proposedAmount = decision.launchParams?.suggestedBudget
        ?? decision.buyParams?.suggestedAmount
        ?? 0;
      if (proposedAmount > this.config.riskLimits.maxPositionSize) {
        this.logger.warn('Proposed amount exceeds max position size', {
          proposed: proposedAmount,
          max: this.config.riskLimits.maxPositionSize,
        });
        return false;
      }
      if (proposedAmount > remainingBudget) {
        this.logger.warn('Proposed amount exceeds remaining budget', {
          proposed: proposedAmount,
          remaining: remainingBudget,
        });
        return false;
      }
    }

    // Check concurrent positions
    if (this.activeMint && (decision.action === 'launch-new' || decision.action === 'buy-existing')) {
      if (this.config.riskLimits.maxConcurrentPositions <= 1) {
        this.logger.warn('Cannot open new position: already have an active position');
        return false;
      }
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // Fallback Strategy
  // ═══════════════════════════════════════════════════════════

  /**
   * Rule-based fallback decision when the LLM is unavailable.
   */
  private buildFallbackDecision(context: MarketContext): StrategyDecision {
    const now = Date.now();

    // If we have an active position, hold
    if (this.activeMint) {
      return {
        action: 'hold',
        confidence: 0.7,
        reasoning: 'LLM unavailable — holding current position (rule-based fallback)',
        decidedAt: now,
        model: 'rule-based',
      };
    }

    // If budget available and market conditions are ok, wait
    if (context.availableBudget > 0 && context.fearGreedIndex > 25 && context.fearGreedIndex < 80) {
      return {
        action: 'wait',
        confidence: 0.5,
        reasoning: 'LLM unavailable — waiting for manual decision (rule-based fallback)',
        decidedAt: now,
        model: 'rule-based',
      };
    }

    return {
      action: 'wait',
      confidence: 0.3,
      reasoning: 'LLM unavailable, market conditions uncertain — waiting (rule-based fallback)',
      decidedAt: now,
      model: 'rule-based',
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Phase Management
  // ═══════════════════════════════════════════════════════════

  /**
   * Attempt a phase transition via state machine with error handling.
   */
  private async transitionPhase(to: SwarmPhase): Promise<void> {
    const from = this.stateMachine.currentPhase;
    if (from === to) return;

    try {
      if (this.stateMachine.canTransition(to)) {
        await this.stateMachine.transition(to);
        await this.phaseController.transition(to);
        this.logger.info(`Phase transition: ${from} → ${to}`);
      } else {
        // Try force transition for non-critical paths
        await this.stateMachine.forceTransition(to);
        await this.phaseController.transition(to, true);
        this.logger.warn(`Forced phase transition: ${from} → ${to}`);
      }
    } catch (err) {
      this.logger.error(
        `Phase transition failed: ${from} → ${to}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      // Don't throw — continue with current phase
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Exit Condition Check
  // ═══════════════════════════════════════════════════════════

  /**
   * Check whether the swarm should exit.
   */
  private shouldExit(): boolean {
    // Session duration exceeded
    if (this.config.maxSessionDuration > 0) {
      const elapsed = Date.now() - this.startedAt;
      if (elapsed >= this.config.maxSessionDuration) return true;
    }

    // Budget exhausted
    const remaining = this.config.totalBudgetSOL - this.totalInvestedSOL;
    if (remaining <= 0.01) return true;

    // Manual stop
    if (this.stopRequested) return true;

    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // Event Wiring
  // ═══════════════════════════════════════════════════════════

  /**
   * Subscribe to critical event bus events for orchestration.
   */
  private wireEventHandlers(): void {
    // Risk: circuit breaker tripped → pause trading
    this.subscriptionIds.push(
      this.eventBus.subscribe('risk:circuit-breaker-tripped', (_event) => {
        this.logger.error('Circuit breaker tripped — pausing all trading');
        this.pause();
        this.auditLogger.logAction({
          category: 'risk',
          severity: 'critical',
          agentId: 'orchestrator',
          action: 'circuit-breaker-tripped',
          details: 'Circuit breaker triggered, all trading paused',
          success: true,
          metadata: {},
        });
      }),
    );

    // Risk: stop loss triggered → exit position
    this.subscriptionIds.push(
      this.eventBus.subscribe('risk:stop-loss-triggered', (event) => {
        this.logger.warn('Stop loss triggered', { payload: event.payload });
        void this.executeDecision({
          action: 'exit-position',
          confidence: 1.0,
          reasoning: 'Stop loss triggered by RiskManager',
          exitParams: {
            mint: (event.payload['mint'] as string) ?? this.activeMint ?? '',
            exitStrategy: 'immediate',
            reason: 'stop-loss',
          },
          decidedAt: Date.now(),
          model: 'risk-manager',
        });
      }),
    );

    // Alpha: opportunity found → log for next decision cycle
    this.subscriptionIds.push(
      this.eventBus.subscribe('alpha:*', (event) => {
        this.logger.info('Alpha opportunity detected', { type: event.type, payload: event.payload });
      }),
    );

    // Agent: unhealthy → attempt restart via lifecycle manager
    this.subscriptionIds.push(
      this.eventBus.subscribe('agent:unhealthy', (event) => {
        const agentId = event.payload['agentId'] as string | undefined;
        if (agentId) {
          this.logger.warn(`Agent unhealthy: ${agentId}, attempting restart`);
          void this.lifecycleManager.restartAgent(agentId);
        }
      }),
    );

    // Trade: executed → update counters
    this.subscriptionIds.push(
      this.eventBus.subscribe('trade:executed', (_event) => {
        this.tradeCount++;
        this.metrics.counter('swarm.trades.total').inc();
      }),
    );

    // Trade: failed → update counters
    this.subscriptionIds.push(
      this.eventBus.subscribe('trade:failed', (_event) => {
        this.errorCount++;
        this.metrics.counter('swarm.trades.failed').inc();
      }),
    );

    // Health: critical → emergency procedures
    this.subscriptionIds.push(
      this.eventBus.subscribe('health:critical', (_event) => {
        this.logger.error('Health critical — initiating emergency procedures');
        this.auditLogger.logAction({
          category: 'system',
          severity: 'critical',
          agentId: 'orchestrator',
          action: 'health-critical',
          details: 'Critical health status detected, evaluating emergency exit',
          success: true,
          metadata: {},
        });
        // If autonomous, trigger emergency exit
        if (this.config.autonomous) {
          void this.stop('health-critical');
        }
      }),
    );

    // Signal: strong-sell → consider exiting
    this.subscriptionIds.push(
      this.eventBus.subscribe('signal:strong-sell', (event) => {
        this.logger.warn('Strong sell signal received', { payload: event.payload });
        if (this.config.autonomous && this.activeMint) {
          void this.executeDecision({
            action: 'exit-position',
            confidence: 0.8,
            reasoning: 'Strong sell signal detected',
            exitParams: {
              mint: this.activeMint,
              exitStrategy: 'gradual',
              reason: 'strong-sell-signal',
            },
            decidedAt: Date.now(),
            model: 'signal-generator',
          });
        }
      }),
    );

    // Phase transitions → log
    this.subscriptionIds.push(
      this.eventBus.subscribe('phase:*', (event) => {
        this.logger.debug('Phase event', { type: event.type, payload: event.payload });
      }),
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Monitoring Timers
  // ═══════════════════════════════════════════════════════════

  /**
   * Start periodic monitoring timers for signals, risk, and health.
   */
  private startMonitoringTimers(): void {
    // Signal polling
    this.signalTimer = setInterval(() => {
      if (this.activeMint && !this.paused) {
        void this.monitorActivePosition();
      }
    }, SIGNAL_POLL_INTERVAL_MS);

    // Risk checking
    this.riskTimer = setInterval(() => {
      if (!this.paused) {
        this.checkRisk();
      }
    }, RISK_CHECK_INTERVAL_MS);

    // Health checking
    this.healthTimer = setInterval(() => {
      void this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop all monitoring timers.
   */
  private clearMonitoringTimers(): void {
    if (this.signalTimer) { clearInterval(this.signalTimer); this.signalTimer = undefined; }
    if (this.riskTimer) { clearInterval(this.riskTimer); this.riskTimer = undefined; }
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = undefined; }
    if (this.sessionTimer) { clearTimeout(this.sessionTimer); this.sessionTimer = undefined; }
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = undefined; }
  }

  /**
   * Periodic risk check across the portfolio.
   */
  private checkRisk(): void {
    const remainingBudget = this.config.totalBudgetSOL - this.totalInvestedSOL;
    if (remainingBudget < 0) {
      this.eventBus.emit('risk:budget-exhausted', 'intelligence', 'orchestrator', {
        remainingBudget,
        totalBudget: this.config.totalBudgetSOL,
        totalInvested: this.totalInvestedSOL,
      });
    }
  }

  /**
   * Periodic health check.
   */
  private async checkHealth(): Promise<void> {
    try {
      const report = await this.healthMonitor.getHealthReport();
      if (report.overall === 'critical') {
        this.eventBus.emit('health:critical', 'system', 'orchestrator', {
          report: {
            overall: report.overall,
            issues: report.issues,
          },
        });
      }
    } catch (err) {
      this.logger.warn('Health check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pause / Resume
  // ═══════════════════════════════════════════════════════════

  /**
   * Pause trading activity. Monitoring continues.
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.stopTrading();

    this.eventBus.emit('swarm:paused', 'lifecycle', 'orchestrator', {
      sessionId: this.sessionId,
    });

    this.logger.info('SwarmOrchestrator paused');
  }

  /**
   * Resume trading activity.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;

    if (this.activeMint) {
      this.startTrading(this.activeMint);
    }

    this.eventBus.emit('swarm:resumed', 'lifecycle', 'orchestrator', {
      sessionId: this.sessionId,
    });

    this.logger.info('SwarmOrchestrator resumed');
  }

  // ═══════════════════════════════════════════════════════════
  // Graceful Shutdown
  // ═══════════════════════════════════════════════════════════

  /**
   * Graceful shutdown: stop agents, exit positions, reclaim funds, cleanup.
   */
  async stop(reason?: string): Promise<void> {
    if (!this.running) return;

    this.logger.info('SwarmOrchestrator stopping', { reason: reason ?? 'manual' });
    this.stopRequested = true;

    // 1. Set state to stopping
    await this.transitionPhase('exiting');

    // 2. Signal all agents to stop accepting new tasks
    void this.agentMessenger.sendMessage('orchestrator', '*', {
      id: uuidv4(),
      from: 'orchestrator',
      to: '*',
      type: 'shutdown-request',
      priority: 'critical',
      payload: { type: 'shutdown-request' as const, reason: reason ?? 'manual', graceful: true, deadline: Date.now() + INFLIGHT_TRADE_TIMEOUT_MS },
      timestamp: Date.now(),
      ttl: INFLIGHT_TRADE_TIMEOUT_MS,
    });

    // 3. Wait for in-flight trades to complete
    this.logger.info('Waiting for in-flight trades to complete...');
    await this.sleep(Math.min(INFLIGHT_TRADE_TIMEOUT_MS, 10_000));

    // 4. Stop all trading
    this.stopTrading();

    // 5. If positions open, coordinate orderly exit
    if (this.activeMint) {
      this.logger.info('Executing orderly position exit');
      this.exitAgent.setExitConditions({ maxHoldTimeSeconds: 30 });
      this.exitAgent.monitorForExit(this.activeMint, this.traderWallets, true);
      // Brief wait for exit execution
      await this.sleep(15_000);
      this.exitAgent.stopMonitoring(this.activeMint);
    }

    // 6. Reclaim funds
    await this.transitionPhase('reclaiming');
    try {
      const connection = this.rpcPool.getConnection();
      const pool = { creator: this.traderWallets[0], traders: this.traderWallets };
      await refreshBalances(connection, pool);
      this.logger.info('Funds reclaim completed');
    } catch (err) {
      this.logger.error(
        'Funds reclaim failed',
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // 7. Generate final session report
    const finalReport = this.generateSessionReport(reason);
    this.auditLogger.logAction({
      category: 'system',
      severity: 'info',
      agentId: 'orchestrator',
      action: 'session-completed',
      details: `Session ended: ${reason ?? 'manual'}`,
      success: true,
      metadata: finalReport,
    });

    // 8. Clear timers
    this.clearMonitoringTimers();

    // 9. Stop infrastructure
    this.healthMonitor.stopMonitoring();
    this.lifecycleManager.stopHeartbeatMonitoring();
    this.signalGenerator.stopAll();

    // 10. Unsubscribe from events
    for (const subId of this.subscriptionIds) {
      this.eventBus.unsubscribe(subId);
    }
    this.subscriptionIds.length = 0;

    // 11. Stop RPC health checks
    this.rpcPool.stopHealthChecks();

    // 12. Emit shutdown event
    this.eventBus.emit('swarm:shutdown', 'lifecycle', 'orchestrator', {
      sessionId: this.sessionId,
      reason: reason ?? 'manual',
      report: finalReport,
    });

    // 13. Mark stopped
    this.running = false;
    this.activeMint = undefined;
    this.activeTokenName = undefined;

    await this.transitionPhase('completed');

    this.logger.info('SwarmOrchestrator stopped', { reason, sessionId: this.sessionId });
  }

  // ═══════════════════════════════════════════════════════════
  // Status & Metrics
  // ═══════════════════════════════════════════════════════════

  /**
   * Get comprehensive real-time orchestrator status.
   */
  getStatus(): SwarmOrchestratorStatus {
    const now = Date.now();
    const uptime = this.running ? now - this.startedAt : 0;

    const agents: Array<{ id: string; type: string; status: string }> = [];

    // Add core agents
    agents.push({ id: 'narrative', type: 'narrative', status: this.initialized ? 'active' : 'idle' });
    agents.push({ id: 'scanner', type: 'scanner', status: this.initialized ? 'active' : 'idle' });
    agents.push({ id: 'creator', type: 'creator', status: this.initialized ? 'active' : 'idle' });
    agents.push({ id: 'sentinel', type: 'sentinel', status: this.initialized ? 'active' : 'idle' });
    agents.push({ id: 'sniper', type: 'sniper', status: this.initialized ? 'active' : 'idle' });
    agents.push({ id: 'market-maker', type: 'market-maker', status: this.initialized ? 'active' : 'idle' });
    agents.push({ id: 'volume', type: 'volume', status: this.initialized ? 'active' : 'idle' });
    agents.push({ id: 'accumulator', type: 'accumulator', status: this.initialized ? 'active' : 'idle' });
    agents.push({ id: 'exit', type: 'exit', status: this.initialized ? 'active' : 'idle' });

    // Add trader agents
    for (let i = 0; i < this.traderAgents.length; i++) {
      agents.push({ id: `trader-${i}`, type: 'trader', status: this.running ? 'trading' : 'idle' });
    }

    // Portfolio (basic estimation)
    const totalInvested = this.totalInvestedSOL;
    const currentValue = totalInvested; // In production, would check on-chain balances
    const pnl = currentValue - totalInvested;
    const pnlPercent = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

    let healthStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (this.errorCount > 50) healthStatus = 'critical';
    else if (this.errorCount > 10) healthStatus = 'degraded';

    return {
      state: this.stateMachine?.currentPhase ?? 'uninitialized',
      phase: this.phaseController?.getCurrentPhase() ?? 'idle',
      trading: this.running && !this.paused && !!this.activeMint,
      paused: this.paused,
      uptime,
      startedAt: this.startedAt,
      activeMint: this.activeMint,
      activeTokenName: this.activeTokenName,
      agents,
      portfolio: {
        totalInvested,
        currentValue,
        pnl,
        pnlPercent,
        roi: pnlPercent,
      },
      lastDecision: this.lastDecision
        ? {
            action: this.lastDecision.action,
            reasoning: this.lastDecision.reasoning,
            timestamp: this.lastDecision.decidedAt,
          }
        : undefined,
      nextEvaluation: this.nextEvaluationAt,
      health: healthStatus,
      tradeCount: this.tradeCount,
      errorCount: this.errorCount,
    };
  }

  /**
   * Get current swarm metrics.
   */
  getMetrics(): SwarmMetrics {
    return {
      totalSolSpent: new BN(this.totalInvestedSOL * 1e9),
      totalSolReceived: new BN(0),
      netPnl: new BN(0),
      totalTrades: this.tradeCount,
      successfulTrades: this.tradeCount,
      failedTrades: this.errorCount,
      tradesPerMinute: this.startedAt > 0
        ? this.tradeCount / ((Date.now() - this.startedAt) / 60_000)
        : 0,
      avgTradeSizeSol: this.tradeCount > 0
        ? this.totalInvestedSOL / this.tradeCount
        : 0,
      uptimeSeconds: this.startedAt > 0
        ? (Date.now() - this.startedAt) / 1000
        : 0,
      x402Payments: 0,
      x402SpentUsdc: 0,
      currentPriceSol: undefined,
      currentMarketCapSol: undefined,
      graduationProgress: undefined,
      activeWallets: this.traderWallets.length + 1,
      totalSolLocked: new BN(this.totalInvestedSOL * 1e9),
    };
  }

  /**
   * Get the full audit trail.
   */
  getAuditTrail(): AuditEntry[] {
    return this.auditLogger.getAuditTrail();
  }

  // ═══════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════

  /**
   * Fully destroy the orchestrator and release all resources.
   * After calling destroy(), the instance cannot be reused.
   */
  async destroy(): Promise<void> {
    if (this.running) {
      await this.stop('destroy');
    }

    // Cleanup all infrastructure
    this.clearMonitoringTimers();

    if (this.healthMonitor) this.healthMonitor.stopMonitoring();
    if (this.rpcPool) this.rpcPool.stopHealthChecks();
    if (this.signalGenerator) this.signalGenerator.stopAll();

    // Reset singletons
    SwarmEventBus.resetInstance();
    MetricsCollector.resetInstance();

    this.initialized = false;

    this.logger.info('SwarmOrchestrator destroyed', { sessionId: this.sessionId });
  }

  // ═══════════════════════════════════════════════════════════
  // Internal Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Resolve the master keypair from config (base58 or Uint8Array).
   */
  private resolveMasterKeypair(): Keypair {
    if (typeof this.config.masterWalletSecret === 'string') {
      const decoded = bs58.decode(this.config.masterWalletSecret);
      return Keypair.fromSecretKey(decoded);
    }
    return Keypair.fromSecretKey(this.config.masterWalletSecret);
  }

  /**
   * Assert that the orchestrator has been initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SwarmOrchestrator not initialized. Call initialize() first.');
    }
  }

  /**
   * Promise-based sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.loopTimer = setTimeout(resolve, ms);
    });
  }

  /**
   * Generate the final session report for audit logging.
   */
  private generateSessionReport(reason?: string): Record<string, unknown> {
    const uptime = this.startedAt > 0 ? Date.now() - this.startedAt : 0;
    return {
      sessionId: this.sessionId,
      network: this.config.network,
      strategy: this.config.defaultStrategy,
      autonomous: this.config.autonomous,
      reason: reason ?? 'manual',
      uptime,
      uptimeMinutes: Math.round(uptime / 60_000),
      totalTrades: this.tradeCount,
      totalErrors: this.errorCount,
      totalInvestedSOL: this.totalInvestedSOL,
      budgetSOL: this.config.totalBudgetSOL,
      budgetUtilization: this.config.totalBudgetSOL > 0
        ? (this.totalInvestedSOL / this.config.totalBudgetSOL) * 100
        : 0,
      activeMint: this.activeMint,
      activeTokenName: this.activeTokenName,
      traderCount: this.traderAgents.length,
      lastDecision: this.lastDecision
        ? {
            action: this.lastDecision.action,
            confidence: this.lastDecision.confidence,
            reasoning: this.lastDecision.reasoning,
          }
        : undefined,
    };
  }
}
