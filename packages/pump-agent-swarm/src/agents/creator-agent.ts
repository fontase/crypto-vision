/**
 * Creator Agent — Mints tokens on Pump.fun bonding curves
 *
 * This agent:
 * 1. Creates a new token using createV2Instruction
 * 2. Optionally executes a dev buy atomically with creation
 * 3. Optionally bundles additional wallet buys in the same block
 * 4. Reports the mint address + bonding curve to the swarm coordinator
 * 5. Supports buying into existing bonding curves (dev-buy-only flow)
 * 6. Full narrative → metadata → IPFS → create pipeline
 * 7. VersionedTransaction for larger bundles
 * 8. Dynamic compute budget via simulation
 * 9. Jito bundle submission for same-slot execution
 * 10. Post-creation on-chain verification
 *
 * Uses @pump-fun/pump-sdk for all on-chain operations.
 */

import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_SDK, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { EventEmitter } from 'eventemitter3';
import { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';
import { SwarmErrorHandler } from '../infra/error-handler.js';
import { MetricsCollector, type Counter, type Histogram } from '../infra/metrics.js';
import { JitoClient } from '../bundle/jito-client.js';
import { NarrativeAgent } from './narrative-agent.js';
import type {
  AgentWallet,
  TokenConfig,
  TokenNarrative,
  BundleBuyConfig,
  JitoBundleConfig,
  MintResult,
  BondingCurveState,
} from '../types.js';

// ─── Constants ────────────────────────────────────────────────

/** Default compute unit buffer multiplier (1.2 = 20% overhead) */
const COMPUTE_UNIT_BUFFER = 1.2;

/** Max compute units cap (1.4M, Solana hard limit) */
const MAX_COMPUTE_UNITS = 1_400_000;

/** Default compute unit fallback when simulation fails */
const DEFAULT_COMPUTE_UNITS = 250_000;

/** Max verification attempts for post-creation checks */
const VERIFICATION_MAX_RETRIES = 3;

/** Delay between verification retries (ms) */
const VERIFICATION_RETRY_DELAY_MS = 2_000;

/** Graduation threshold — curve graduates at ~85 SOL */
const GRADUATION_THRESHOLD_LAMPORTS = 85 * LAMPORTS_PER_SOL;

/** Total pump.fun token supply */
const TOTAL_SUPPLY = 1_000_000_000;

// ─── Events ───────────────────────────────────────────────────

interface CreatorAgentEvents {
  'mint:started': (config: TokenConfig) => void;
  'mint:success': (result: MintResult) => void;
  'mint:failed': (error: Error) => void;
  'bundle:started': (walletCount: number) => void;
  'bundle:success': (signatures: string[]) => void;
  'curve:state': (state: BondingCurveState) => void;
}

// ─── Creator Agent ────────────────────────────────────────────

export class CreatorAgent extends EventEmitter<CreatorAgentEvents> {
  private readonly connection: Connection;
  private readonly wallet: AgentWallet;
  private onlineSdk: OnlinePumpSdk | null = null;

  // ─── Infrastructure ───────────────────────────────────────
  private readonly logger: SwarmLogger;
  private readonly bus: SwarmEventBus;
  private readonly errorHandler: SwarmErrorHandler;
  private readonly metrics: MetricsCollector;

  // ─── Metrics Handles ──────────────────────────────────────
  private readonly createCounter: Counter;
  private readonly createFailCounter: Counter;
  private readonly bundleBuyCounter: Counter;
  private readonly bundleBuyFailCounter: Counter;
  private readonly buyExistingCounter: Counter;
  private readonly createLatency: Histogram;

  constructor(
    rpcUrl: string,
    wallet: AgentWallet,
    bus?: SwarmEventBus,
    errorHandler?: SwarmErrorHandler,
  ) {
    super();
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.wallet = wallet;

    // Infrastructure
    this.logger = SwarmLogger.create('creator', 'agent');
    this.bus = bus ?? SwarmEventBus.getInstance();
    this.errorHandler = errorHandler ?? new SwarmErrorHandler(this.bus);
    this.metrics = MetricsCollector.getInstance();

    // Pre-register metrics
    this.createCounter = this.metrics.counter('creator.tokens.created', { agent: 'creator' });
    this.createFailCounter = this.metrics.counter('creator.tokens.failed', { agent: 'creator' });
    this.bundleBuyCounter = this.metrics.counter('creator.bundles.executed', { agent: 'creator' });
    this.bundleBuyFailCounter = this.metrics.counter('creator.bundles.failed', { agent: 'creator' });
    this.buyExistingCounter = this.metrics.counter('creator.buy_existing.executed', { agent: 'creator' });
    this.createLatency = this.metrics.histogram('creator.create_latency_ms');
  }

  private getOnlineSdk(): OnlinePumpSdk {
    if (!this.onlineSdk) {
      this.onlineSdk = new OnlinePumpSdk(this.connection);
    }
    return this.onlineSdk;
  }

  // ═══════════════════════════════════════════════════════════
  // EXISTING METHOD — createToken (preserved, enhanced with infra)
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a new token on Pump.fun with an atomic dev buy.
   *
   * The transaction includes:
   * 1. Compute budget instruction (dynamic, via simulation)
   * 2. createV2Instruction (token creation)
   * 3. buyInstruction (dev buy, if devBuyLamports > 0)
   *
   * @param token - Token metadata (name, symbol, URI)
   * @param bundle - Dev buy config (SOL amount, slippage)
   * @returns MintResult with transaction details
   */
  async createToken(
    token: TokenConfig,
    bundle: BundleBuyConfig,
  ): Promise<MintResult> {
    this.emit('mint:started', token);
    this.bus.emit('creator:mint:started', 'lifecycle', 'creator', {
      name: token.name,
      symbol: token.symbol,
    });

    const startMs = Date.now();
    const mintKeypair = Keypair.generate();
    const creatorPubkey = this.wallet.keypair.publicKey;

    try {
      // Build create instructions — use createV2AndBuyInstructions for atomic dev buy
      let createIxs: TransactionInstruction[];
      if (bundle.devBuyLamports.gtn(0)) {
        const global = await this.errorHandler.withCircuitBreaker('rpc', () =>
          this.getOnlineSdk().fetchGlobal(),
        );
        createIxs = await PUMP_SDK.createV2AndBuyInstructions({
          global,
          creator: creatorPubkey,
          user: creatorPubkey,
          mint: mintKeypair.publicKey,
          name: token.name,
          symbol: token.symbol,
          uri: token.metadataUri,
          amount: new BN(0),
          solAmount: bundle.devBuyLamports,
          mayhemMode: false,
        });
      } else {
        const createIx = await PUMP_SDK.createV2Instruction({
          creator: creatorPubkey,
          user: creatorPubkey,
          mint: mintKeypair.publicKey,
          name: token.name,
          symbol: token.symbol,
          uri: token.metadataUri,
          mayhemMode: false,
        });
        createIxs = [createIx];
      }

      // Dynamic compute budget
      const computeIxs = await this.buildDynamicComputeBudget(createIxs, creatorPubkey);

      // Build transaction
      const { blockhash } = await this.errorHandler.withCircuitBreaker('rpc', () =>
        this.connection.getLatestBlockhash('confirmed'),
      );

      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: creatorPubkey,
      });

      tx.add(...computeIxs, ...createIxs);

      // Sign and send with retry
      const signature = await this.errorHandler.withRetry(
        () => sendAndConfirmTransaction(
          this.connection,
          tx,
          [this.wallet.keypair, mintKeypair],
          {
            commitment: 'confirmed',
            maxRetries: 3,
          },
        ),
        { maxRetries: 2, initialDelayMs: 1_000, maxDelayMs: 5_000, backoffMultiplier: 2, jitter: true },
      );

      // Derive the bonding curve PDA (standalone function from pda module)
      const bondingCurvePdaKey = bondingCurvePda(mintKeypair.publicKey);

      const result: MintResult = {
        mint: mintKeypair.publicKey.toBase58(),
        mintKeypair,
        signature,
        bondingCurve: bondingCurvePdaKey.toBase58(),
        creatorTokenAccount: '', // Resolved below
        devBuySol: bundle.devBuyLamports.gtn(0) ? bundle.devBuyLamports : undefined,
        createdAt: Date.now(),
      };

      // Resolve creator's token account
      const { getAssociatedTokenAddress: getAta } = await import('@solana/spl-token');
      const ata = await getAta(mintKeypair.publicKey, creatorPubkey);
      result.creatorTokenAccount = ata.toBase58();

      // Check token balance to determine dev buy tokens received
      if (bundle.devBuyLamports.gtn(0)) {
        try {
          const tokenBalance = await this.connection.getTokenAccountBalance(ata);
          result.devBuyTokens = new BN(tokenBalance.value.amount);
        } catch {
          // Token account may not exist yet if dev buy was 0
        }
      }

      // Track metrics
      this.createCounter.inc();
      this.createLatency.observe(Date.now() - startMs);

      this.logger.info('Token created successfully', {
        mint: result.mint,
        signature: result.signature,
        bondingCurve: result.bondingCurve,
        durationMs: Date.now() - startMs,
      });

      this.emit('mint:success', result);
      this.bus.emit('creator:mint:success', 'lifecycle', 'creator', {
        mint: result.mint,
        signature: result.signature,
        bondingCurve: result.bondingCurve,
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.createFailCounter.inc();
      this.logger.error('Token creation failed', err, {
        name: token.name,
        symbol: token.symbol,
      });
      this.emit('mint:failed', err);
      this.bus.emit('creator:mint:failed', 'error', 'creator', {
        error: err.message,
        name: token.name,
      });
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // EXISTING METHOD — executeBundleBuys (preserved, enhanced)
  // ═══════════════════════════════════════════════════════════

  /**
   * Execute bundled buys from multiple wallets after token creation.
   *
   * Each wallet sends its own buy transaction. For true atomic bundling
   * (same slot), use {@link executeBundleBuysJito}.
   *
   * @param mint - Token mint address (from createToken result)
   * @param bundle - Bundle config with wallet allocations
   * @returns Array of transaction signatures
   */
  async executeBundleBuys(
    mint: string,
    bundle: BundleBuyConfig,
  ): Promise<string[]> {
    if (bundle.bundleWallets.length === 0) return [];

    this.emit('bundle:started', bundle.bundleWallets.length);
    this.bus.emit('creator:bundle:started', 'bundle', 'creator', {
      walletCount: bundle.bundleWallets.length,
      mint,
    });

    const signatures: string[] = [];
    const mintPubkey = new PublicKey(mint);

    // Fetch global state once (shared across all buys)
    const global = await this.errorHandler.withCircuitBreaker('rpc', () =>
      this.getOnlineSdk().fetchGlobal(),
    );

    for (const { wallet, amountLamports } of bundle.bundleWallets) {
      try {
        // Fetch buy state (bonding curve + user ATA) for this buyer
        const buyState = await this.errorHandler.withCircuitBreaker('rpc', () =>
          this.getOnlineSdk().fetchBuyState(
            mintPubkey,
            wallet.keypair.publicKey,
            TOKEN_PROGRAM_ID,
          ),
        );

        const buyIxs = await PUMP_SDK.buyInstructions({
          global,
          bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
          bondingCurve: buyState.bondingCurve,
          associatedUserAccountInfo: buyState.associatedUserAccountInfo,
          mint: mintPubkey,
          user: wallet.keypair.publicKey,
          amount: new BN(0),
          solAmount: amountLamports,
          slippage: bundle.slippageBps / 100,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

        const computeIxs = await this.buildDynamicComputeBudget(
          buyIxs,
          wallet.keypair.publicKey,
        );

        const { blockhash } = await this.errorHandler.withCircuitBreaker('rpc', () =>
          this.connection.getLatestBlockhash('confirmed'),
        );

        const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.keypair.publicKey });
        tx.add(...computeIxs, ...buyIxs);

        const sig = await this.errorHandler.withRetry(
          () => sendAndConfirmTransaction(
            this.connection,
            tx,
            [wallet.keypair],
            { commitment: 'confirmed', maxRetries: 3 },
          ),
          { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 5_000, backoffMultiplier: 2, jitter: true },
        );

        signatures.push(sig);
        this.bundleBuyCounter.inc();
        this.logger.info('Bundle buy succeeded', { wallet: wallet.label, sig });
      } catch (error) {
        this.bundleBuyFailCounter.inc();
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Bundle buy failed for ${wallet.label}`, err);
        this.bus.emit('creator:bundle:buy:failed', 'error', 'creator', {
          wallet: wallet.label,
          error: err.message,
        });
        // Continue with other wallets
      }
    }

    this.emit('bundle:success', signatures);
    this.bus.emit('creator:bundle:success', 'bundle', 'creator', {
      mint,
      signatureCount: signatures.length,
    });

    return signatures;
  }

  // ═══════════════════════════════════════════════════════════
  // EXISTING METHOD — getBondingCurveState (preserved)
  // ═══════════════════════════════════════════════════════════

  /**
   * Fetch the current bonding curve state for a token.
   */
  async getBondingCurveState(mint: string): Promise<BondingCurveState> {
    const mintPubkey = new PublicKey(mint);
    const bondingCurvePdaKey = bondingCurvePda(mintPubkey);

    const accountInfo = await this.errorHandler.withCircuitBreaker('rpc', () =>
      this.connection.getAccountInfo(bondingCurvePdaKey),
    );
    if (!accountInfo) {
      throw new Error(`Bonding curve not found for mint ${mint}`);
    }

    // Decode the bonding curve account — pass full AccountInfo, not raw buffer
    const curveData = PUMP_SDK.decodeBondingCurve(accountInfo);

    const virtualSolReserves = new BN(curveData.virtualSolReserves.toString());
    const virtualTokenReserves = new BN(curveData.virtualTokenReserves.toString());
    const realSolReserves = new BN(curveData.realSolReserves.toString());
    const realTokenReserves = new BN(curveData.realTokenReserves.toString());

    // Calculate derived values
    // Price = virtualSolReserves / virtualTokenReserves
    const priceSol = virtualSolReserves.toNumber() / virtualTokenReserves.toNumber();
    // Market cap = price × total supply (1B tokens)
    const marketCapSol = priceSol * TOTAL_SUPPLY;
    // Graduation: the curve graduates when realSolReserves reaches ~85 SOL
    const graduationProgress = Math.min(
      100,
      (realSolReserves.toNumber() / GRADUATION_THRESHOLD_LAMPORTS) * 100,
    );

    const state: BondingCurveState = {
      mint,
      virtualSolReserves,
      virtualTokenReserves,
      realSolReserves,
      realTokenReserves,
      complete: curveData.complete ?? false,
      currentPriceSol: priceSol,
      marketCapSol,
      graduationProgress,
    };

    this.emit('curve:state', state);
    return state;
  }

  /**
   * Get the connection instance (for sharing with other agents).
   */
  getConnection(): Connection {
    return this.connection;
  }

  // ═══════════════════════════════════════════════════════════
  // NEW METHOD — buyExistingToken
  // ═══════════════════════════════════════════════════════════

  /**
   * Buy tokens on an existing bonding curve (no creation).
   *
   * Used for the "buy dev supply on existing tech coin" flow — the
   * swarm identifies a promising token and buys in without creating.
   *
   * Returns a MintResult-compatible object for downstream compatibility.
   *
   * @param mint - Token mint address (base58)
   * @param solAmount - SOL to spend on the buy (lamports, as BN)
   * @param slippageBps - Max slippage in basis points (e.g. 500 = 5%)
   * @returns MintResult with transaction details
   */
  async buyExistingToken(
    mint: string,
    solAmount: BN,
    slippageBps: number,
  ): Promise<MintResult> {
    this.logger.info('Buying existing token', { mint, solAmount: solAmount.toString(), slippageBps });
    this.bus.emit('creator:buy_existing:started', 'trading', 'creator', { mint });

    const mintPubkey = new PublicKey(mint);
    const buyerPubkey = this.wallet.keypair.publicKey;
    const startMs = Date.now();

    try {
      // Fetch global + buy state with circuit breaker protection
      const global = await this.errorHandler.withCircuitBreaker('rpc', () =>
        this.getOnlineSdk().fetchGlobal(),
      );
      const buyState = await this.errorHandler.withCircuitBreaker('rpc', () =>
        this.getOnlineSdk().fetchBuyState(mintPubkey, buyerPubkey, TOKEN_PROGRAM_ID),
      );

      const buyIxs = await PUMP_SDK.buyInstructions({
        global,
        bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
        bondingCurve: buyState.bondingCurve,
        associatedUserAccountInfo: buyState.associatedUserAccountInfo,
        mint: mintPubkey,
        user: buyerPubkey,
        amount: new BN(0),
        solAmount,
        slippage: slippageBps / 100,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      // Dynamic compute budget
      const computeIxs = await this.buildDynamicComputeBudget(buyIxs, buyerPubkey);

      const { blockhash } = await this.errorHandler.withCircuitBreaker('rpc', () =>
        this.connection.getLatestBlockhash('confirmed'),
      );

      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: buyerPubkey,
      });
      tx.add(...computeIxs, ...buyIxs);

      // Submit with retry
      const signature = await this.errorHandler.withRetry(
        () => sendAndConfirmTransaction(
          this.connection,
          tx,
          [this.wallet.keypair],
          { commitment: 'confirmed', maxRetries: 3 },
        ),
        { maxRetries: 3, initialDelayMs: 1_000, maxDelayMs: 10_000, backoffMultiplier: 2, jitter: true },
      );

      // Resolve ATA and balance
      const { getAssociatedTokenAddress: getAta } = await import('@solana/spl-token');
      const ata = await getAta(mintPubkey, buyerPubkey);
      let devBuyTokens: BN | undefined;
      try {
        const tokenBalance = await this.connection.getTokenAccountBalance(ata);
        devBuyTokens = new BN(tokenBalance.value.amount);
      } catch {
        // Token account might not have been created yet
      }

      const bondingCurvePdaKey = bondingCurvePda(mintPubkey);

      const result: MintResult = {
        mint,
        mintKeypair: Keypair.generate(), // Placeholder — existing token, no mint key needed
        signature,
        bondingCurve: bondingCurvePdaKey.toBase58(),
        creatorTokenAccount: ata.toBase58(),
        devBuyTokens,
        devBuySol: solAmount,
        createdAt: Date.now(),
      };

      this.buyExistingCounter.inc();
      this.createLatency.observe(Date.now() - startMs);

      this.logger.info('Buy existing token succeeded', {
        mint,
        signature,
        tokensReceived: devBuyTokens?.toString(),
        durationMs: Date.now() - startMs,
      });

      this.emit('mint:success', result);
      this.bus.emit('creator:buy_existing:success', 'trading', 'creator', {
        mint,
        signature,
        tokensReceived: devBuyTokens?.toString(),
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.createFailCounter.inc();
      this.logger.error('Buy existing token failed', err, { mint });
      this.bus.emit('creator:buy_existing:failed', 'error', 'creator', {
        mint,
        error: err.message,
      });
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NEW METHOD — createTokenWithMetadata
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a token from a narrative: upload metadata to IPFS, then create on-chain.
   *
   * Full pipeline: narrative → metadata → IPFS → createToken → dev buy.
   *
   * @param narrative - TokenNarrative from the narrative agent
   * @param bundle - Dev buy and bundle configuration
   * @param narrativeAgent - Optional NarrativeAgent instance for IPFS uploads
   * @returns MintResult with transaction details
   */
  async createTokenWithMetadata(
    narrative: TokenNarrative,
    bundle: BundleBuyConfig,
    narrativeAgent?: NarrativeAgent,
  ): Promise<MintResult> {
    this.logger.info('Creating token with metadata pipeline', {
      name: narrative.name,
      symbol: narrative.symbol,
    });
    this.bus.emit('creator:metadata_pipeline:started', 'lifecycle', 'creator', {
      name: narrative.name,
      symbol: narrative.symbol,
    });

    // If metadata URI is already set (previously uploaded), skip upload
    let metadataUri = narrative.metadataUri;

    if (!metadataUri && narrativeAgent) {
      // Generate Pump.fun-compatible metadata from the narrative
      const metadata = await narrativeAgent.generateMetadata(narrative);

      // If image hasn't been generated yet, the metadata.image will be empty.
      // The narrative agent's uploadMetadata handles this gracefully.
      metadataUri = await narrativeAgent.uploadMetadata(metadata);

      this.logger.info('Metadata uploaded to IPFS', { metadataUri, name: narrative.name });
      this.bus.emit('creator:metadata:uploaded', 'lifecycle', 'creator', {
        metadataUri,
        name: narrative.name,
      });
    }

    if (!metadataUri) {
      throw new Error(
        `No metadata URI available for "${narrative.name}". ` +
        'Provide a NarrativeAgent for IPFS upload, or set narrative.metadataUri.',
      );
    }

    // Build TokenConfig from the narrative
    const tokenConfig: TokenConfig = {
      name: narrative.name,
      symbol: narrative.symbol,
      metadataUri,
    };

    // Create the token using the standard createToken flow
    const result = await this.createToken(tokenConfig, bundle);

    this.logger.info('Token created from narrative', {
      mint: result.mint,
      name: narrative.name,
      symbol: narrative.symbol,
    });
    this.bus.emit('creator:metadata_pipeline:success', 'lifecycle', 'creator', {
      mint: result.mint,
      name: narrative.name,
      metadataUri,
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // NEW METHOD — estimateComputeUnits
  // ═══════════════════════════════════════════════════════════

  /**
   * Estimate the compute units needed for a set of instructions
   * by simulating the transaction on-chain.
   *
   * Returns the simulated CU usage × {@link COMPUTE_UNIT_BUFFER} (20% buffer),
   * capped at {@link MAX_COMPUTE_UNITS}.
   *
   * Falls back to {@link DEFAULT_COMPUTE_UNITS} if simulation fails.
   *
   * @param instructions - Transaction instructions to estimate
   * @param feePayer - Fee payer for simulation
   * @returns Estimated compute units with buffer
   */
  async estimateComputeUnits(
    instructions: TransactionInstruction[],
    feePayer: PublicKey,
  ): Promise<number> {
    try {
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

      // Build a simulation-only transaction with a high CU limit
      const simIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }),
        ...instructions,
      ];

      const messageV0 = new TransactionMessage({
        payerKey: feePayer,
        recentBlockhash: blockhash,
        instructions: simIxs,
      }).compileToV0Message();

      const simTx = new VersionedTransaction(messageV0);

      const simulation = await this.connection.simulateTransaction(simTx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (simulation.value.err) {
        this.logger.warn('Compute simulation failed, using default', {
          error: JSON.stringify(simulation.value.err),
        });
        return DEFAULT_COMPUTE_UNITS;
      }

      const unitsConsumed = simulation.value.unitsConsumed ?? DEFAULT_COMPUTE_UNITS;
      const estimated = Math.min(
        Math.ceil(unitsConsumed * COMPUTE_UNIT_BUFFER),
        MAX_COMPUTE_UNITS,
      );

      this.logger.debug('Compute units estimated', {
        simulated: unitsConsumed,
        withBuffer: estimated,
      });

      return estimated;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn('Compute estimation failed, using default', {
        error: err.message,
      });
      return DEFAULT_COMPUTE_UNITS;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NEW METHOD — executeBundleBuysJito
  // ═══════════════════════════════════════════════════════════

  /**
   * Execute bundle buys via Jito block engine for same-slot execution.
   *
   * All transactions are submitted as a single Jito bundle, ensuring
   * atomic multi-wallet purchasing. Each transaction includes a Jito
   * tip instruction for validator incentivization.
   *
   * @param mint - Token mint address
   * @param bundle - Bundle config with wallet allocations
   * @param jitoConfig - Jito block engine configuration
   * @returns Array of transaction signatures
   */
  async executeBundleBuysJito(
    mint: string,
    bundle: BundleBuyConfig,
    jitoConfig: JitoBundleConfig,
  ): Promise<string[]> {
    if (bundle.bundleWallets.length === 0) return [];

    this.logger.info('Executing Jito bundle buys', {
      mint,
      walletCount: bundle.bundleWallets.length,
      tipLamports: jitoConfig.tipLamports,
    });
    this.bus.emit('creator:jito_bundle:started', 'bundle', 'creator', {
      mint,
      walletCount: bundle.bundleWallets.length,
    });

    const jitoClient = new JitoClient(jitoConfig);
    const mintPubkey = new PublicKey(mint);

    // Fetch shared state
    const global = await this.errorHandler.withCircuitBreaker('rpc', () =>
      this.getOnlineSdk().fetchGlobal(),
    );

    const transactions: VersionedTransaction[] = [];

    for (const { wallet, amountLamports } of bundle.bundleWallets) {
      try {
        const buyState = await this.errorHandler.withCircuitBreaker('rpc', () =>
          this.getOnlineSdk().fetchBuyState(
            mintPubkey,
            wallet.keypair.publicKey,
            TOKEN_PROGRAM_ID,
          ),
        );

        const buyIxs = await PUMP_SDK.buyInstructions({
          global,
          bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
          bondingCurve: buyState.bondingCurve,
          associatedUserAccountInfo: buyState.associatedUserAccountInfo,
          mint: mintPubkey,
          user: wallet.keypair.publicKey,
          amount: new BN(0),
          solAmount: amountLamports,
          slippage: bundle.slippageBps / 100,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

        // Build compute budget + buy + tip instructions
        const computeIxs = await this.buildDynamicComputeBudget(
          buyIxs,
          wallet.keypair.publicKey,
        );

        // Add Jito tip instruction
        const tipAccounts = await jitoClient.getTipAccounts();
        const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
        const tipIx = SystemProgram.transfer({
          fromPubkey: wallet.keypair.publicKey,
          toPubkey: tipAccount,
          lamports: jitoConfig.tipLamports,
        });

        const allIxs = [...computeIxs, ...buyIxs, tipIx];

        // Build as VersionedTransaction for Jito
        const { blockhash } = await this.errorHandler.withCircuitBreaker('rpc', () =>
          this.connection.getLatestBlockhash('confirmed'),
        );

        const messageV0 = new TransactionMessage({
          payerKey: wallet.keypair.publicKey,
          recentBlockhash: blockhash,
          instructions: allIxs,
        }).compileToV0Message();

        const vTx = new VersionedTransaction(messageV0);
        vTx.sign([wallet.keypair]);

        transactions.push(vTx);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Failed to build Jito tx for ${wallet.label}`, err);
        // Skip this wallet but continue building the bundle
      }
    }

    if (transactions.length === 0) {
      this.logger.warn('No transactions built for Jito bundle');
      return [];
    }

    // Submit the entire bundle via Jito
    try {
      const bundleResult = await this.errorHandler.withRetry(
        () => jitoClient.sendBundle(transactions),
        { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 5_000, backoffMultiplier: 2, jitter: true },
      );

      if (bundleResult.status === 'failed') {
        throw new Error(`Jito bundle failed: ${bundleResult.error ?? 'unknown'}`);
      }

      // Wait for confirmation
      const confirmation = await jitoClient.waitForBundleConfirmation(
        bundleResult.bundleId,
      );

      if (confirmation.status === 'landed') {
        this.logger.info('Jito bundle confirmed', {
          bundleId: bundleResult.bundleId,
          slot: confirmation.slot,
          txCount: bundleResult.signatures.length,
        });
        this.bundleBuyCounter.inc(transactions.length);
        this.bus.emit('creator:jito_bundle:success', 'bundle', 'creator', {
          bundleId: bundleResult.bundleId,
          slot: confirmation.slot,
          signatures: bundleResult.signatures,
        });
        return bundleResult.signatures;
      }

      this.logger.warn('Jito bundle did not land', {
        bundleId: bundleResult.bundleId,
        status: confirmation.status,
        error: confirmation.error,
      });
      this.bundleBuyFailCounter.inc();
      return bundleResult.signatures;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.bundleBuyFailCounter.inc();
      this.logger.error('Jito bundle submission failed', err);
      this.bus.emit('creator:jito_bundle:failed', 'error', 'creator', {
        error: err.message,
      });
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NEW METHOD — executeBundleBuysVersioned
  // ═══════════════════════════════════════════════════════════

  /**
   * Execute bundle buys using VersionedTransactions with optional
   * address lookup tables for larger instruction sets.
   *
   * VersionedTransactions use `TransactionMessage.compile()` which
   * supports address lookup tables, allowing more instructions per
   * transaction (up to the 1232-byte limit).
   *
   * @param mint - Token mint address
   * @param bundle - Bundle config with wallet allocations
   * @param lookupTables - Optional address lookup tables for compression
   * @returns Array of transaction signatures
   */
  async executeBundleBuysVersioned(
    mint: string,
    bundle: BundleBuyConfig,
    lookupTables?: AddressLookupTableAccount[],
  ): Promise<string[]> {
    if (bundle.bundleWallets.length === 0) return [];

    this.logger.info('Executing versioned bundle buys', {
      mint,
      walletCount: bundle.bundleWallets.length,
      hasLookupTables: !!lookupTables?.length,
    });
    this.emit('bundle:started', bundle.bundleWallets.length);

    const signatures: string[] = [];
    const mintPubkey = new PublicKey(mint);

    const global = await this.errorHandler.withCircuitBreaker('rpc', () =>
      this.getOnlineSdk().fetchGlobal(),
    );

    for (const { wallet, amountLamports } of bundle.bundleWallets) {
      try {
        const buyState = await this.errorHandler.withCircuitBreaker('rpc', () =>
          this.getOnlineSdk().fetchBuyState(
            mintPubkey,
            wallet.keypair.publicKey,
            TOKEN_PROGRAM_ID,
          ),
        );

        const buyIxs = await PUMP_SDK.buyInstructions({
          global,
          bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
          bondingCurve: buyState.bondingCurve,
          associatedUserAccountInfo: buyState.associatedUserAccountInfo,
          mint: mintPubkey,
          user: wallet.keypair.publicKey,
          amount: new BN(0),
          solAmount: amountLamports,
          slippage: bundle.slippageBps / 100,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

        const computeIxs = await this.buildDynamicComputeBudget(
          buyIxs,
          wallet.keypair.publicKey,
        );

        const { blockhash } = await this.errorHandler.withCircuitBreaker('rpc', () =>
          this.connection.getLatestBlockhash('confirmed'),
        );

        // Compile to V0 message with optional lookup tables
        const messageV0 = new TransactionMessage({
          payerKey: wallet.keypair.publicKey,
          recentBlockhash: blockhash,
          instructions: [...computeIxs, ...buyIxs],
        }).compileToV0Message(lookupTables);

        const vTx = new VersionedTransaction(messageV0);
        vTx.sign([wallet.keypair]);

        const sig = await this.errorHandler.withRetry(
          () => this.connection.sendTransaction(vTx, { maxRetries: 3 }),
          { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 5_000, backoffMultiplier: 2, jitter: true },
        );

        // Confirm the transaction
        await this.connection.confirmTransaction(sig, 'confirmed');

        signatures.push(sig);
        this.bundleBuyCounter.inc();
        this.logger.info('Versioned bundle buy succeeded', {
          wallet: wallet.label,
          sig,
        });
      } catch (error) {
        this.bundleBuyFailCounter.inc();
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Versioned bundle buy failed for ${wallet.label}`, err);
        // Continue with other wallets
      }
    }

    this.emit('bundle:success', signatures);
    return signatures;
  }

  // ═══════════════════════════════════════════════════════════
  // NEW METHOD — verifyCreation
  // ═══════════════════════════════════════════════════════════

  /**
   * Post-creation verification: confirm the mint, bonding curve PDA,
   * and creator's token account exist on-chain.
   *
   * Retries up to {@link VERIFICATION_MAX_RETRIES} times with
   * {@link VERIFICATION_RETRY_DELAY_MS} delays to account for
   * network propagation.
   *
   * @param result - The MintResult from createToken or createTokenWithMetadata
   * @returns true if all verifications pass
   * @throws Error if verification fails after all retries
   */
  async verifyCreation(result: MintResult): Promise<boolean> {
    this.logger.info('Verifying token creation', { mint: result.mint });

    for (let attempt = 1; attempt <= VERIFICATION_MAX_RETRIES; attempt++) {
      try {
        // 1. Verify mint account exists
        const mintPubkey = new PublicKey(result.mint);
        const mintAccountInfo = await this.connection.getAccountInfo(mintPubkey);
        if (!mintAccountInfo) {
          throw new Error(`Mint account not found: ${result.mint}`);
        }

        // 2. Verify bonding curve PDA exists
        const bondingCurvePubkey = new PublicKey(result.bondingCurve);
        const curveAccountInfo = await this.connection.getAccountInfo(bondingCurvePubkey);
        if (!curveAccountInfo) {
          throw new Error(`Bonding curve PDA not found: ${result.bondingCurve}`);
        }

        // 3. Verify creator's token account has tokens (if dev buy was made)
        if (result.devBuySol && result.creatorTokenAccount) {
          const ataPubkey = new PublicKey(result.creatorTokenAccount);
          const ataAccountInfo = await this.connection.getAccountInfo(ataPubkey);
          if (!ataAccountInfo) {
            throw new Error(`Creator token account not found: ${result.creatorTokenAccount}`);
          }

          // Check balance is positive
          const tokenBalance = await this.connection.getTokenAccountBalance(ataPubkey);
          const amount = new BN(tokenBalance.value.amount);
          if (amount.lten(0)) {
            throw new Error(`Creator token account has zero balance`);
          }
        }

        this.logger.info('Token creation verified', {
          mint: result.mint,
          attempt,
        });
        this.bus.emit('creator:verification:success', 'lifecycle', 'creator', {
          mint: result.mint,
          attempt,
        });

        return true;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Verification attempt ${attempt}/${VERIFICATION_MAX_RETRIES} failed`, {
          mint: result.mint,
          error: err.message,
        });

        if (attempt >= VERIFICATION_MAX_RETRIES) {
          this.logger.error('Token creation verification failed', err, {
            mint: result.mint,
          });
          this.bus.emit('creator:verification:failed', 'error', 'creator', {
            mint: result.mint,
            error: err.message,
          });
          throw new Error(
            `Token creation verification failed after ${VERIFICATION_MAX_RETRIES} attempts: ${err.message}`,
          );
        }

        // Wait before retrying
        await this.sleep(VERIFICATION_RETRY_DELAY_MS);
      }
    }

    // Unreachable, but TypeScript needs it
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Build dynamic compute budget instructions by simulating the
   * transaction and reading recent priority fees.
   *
   * @param instructions - The instructions to estimate CU for
   * @param feePayer - Fee payer public key
   * @returns Array of ComputeBudget instructions
   */
  private async buildDynamicComputeBudget(
    instructions: TransactionInstruction[],
    feePayer: PublicKey,
  ): Promise<TransactionInstruction[]> {
    // Estimate compute units via simulation
    const estimatedCu = await this.estimateComputeUnits(instructions, feePayer);

    // Get dynamic priority fee from recent fees
    let priorityFee = 100_000; // Default: 100k microlamports
    try {
      const recentFees = await this.connection.getRecentPrioritizationFees();
      if (recentFees.length > 0) {
        // Use the median priority fee with a small buffer
        const sortedFees = recentFees
          .map((f) => f.prioritizationFee)
          .filter((f) => f > 0)
          .sort((a, b) => a - b);

        if (sortedFees.length > 0) {
          const medianIdx = Math.floor(sortedFees.length / 2);
          const medianFee = sortedFees[medianIdx];
          // Use 1.2x median to improve landing probability
          priorityFee = Math.ceil(medianFee * 1.2);
        }
      }
    } catch {
      // Use default priority fee if RPC call fails
    }

    return [
      ComputeBudgetProgram.setComputeUnitLimit({ units: estimatedCu }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    ];
  }

  /**
   * Sleep for the specified duration (non-blocking).
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
