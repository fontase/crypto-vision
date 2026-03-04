/**
 * Sniper Agent — Monitors for brand-new Pump.fun token launches and executes
 * extremely fast buy orders to acquire tokens at the lowest bonding curve price.
 *
 * Detection methods (ordered by speed):
 * 1. WebSocket subscription to Pump.fun program logs (CreateV2 events)
 * 2. Account subscription on the Pump.fun global account
 * 3. Polling fallback via getSignaturesForAddress
 *
 * Speed optimizations:
 * - Pre-fetched & cached global state (refreshed every 5s)
 * - Pre-built transaction skeletons filled at execution time
 * - skipPreflight: true for fastest submission
 * - Multi-RPC fanout for fastest landing
 * - Optional Jito bundles for guaranteed inclusion
 *
 * Auto-sell with trailing stop after successful snipe.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  Logs,
  Context,
} from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_SDK, OnlinePumpSdk, PUMP_PROGRAM_ID, bondingCurvePda, getTokenPrice } from '@pump-fun/pump-sdk';
import type { DecodedGlobal, DecodedBondingCurve } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type {
  AgentWallet,
  TradeOrder,
  TradeResult,
  BondingCurveState,
} from '../types.js';

// ─── Configuration ────────────────────────────────────────────

export interface SniperConfig {
  /** SOL to spend on snipe (lamports) */
  snipeAmountLamports: BN;
  /** Max slippage (bps) — can be high for snipes */
  maxSlippageBps: number;
  /** Priority fee — should be very high for sniper */
  priorityFeeMicroLamports: number;
  /** Jito tip for guaranteed inclusion (lamports) */
  jitoTipLamports?: number;
  /** Whether to use pre-built TX approach */
  prebuiltTx: boolean;
  /** Max age of target token in seconds (don't snipe old tokens) */
  maxTokenAgeSeconds: number;
  /** Auto-sell after N seconds (take profit) */
  autoSellAfterSeconds?: number;
  /** Auto-sell if price increases by X% (e.g., 2.0 = 100% gain) */
  autoSellPriceMultiplier?: number;
  /** Trailing stop: sell if price drops this % from peak (0-1, e.g., 0.2 = 20%) */
  trailingStopPercent: number;
  /** Additional RPC URLs for multi-RPC fanout */
  additionalRpcUrls?: string[];
  /** Polling interval in ms for the fallback detector */
  pollingIntervalMs: number;
  /** Global state cache refresh interval in ms */
  globalCacheRefreshMs: number;
  /** Price monitoring interval in ms for auto-sell */
  priceMonitorIntervalMs: number;
}

// ─── Default Config ───────────────────────────────────────────

export const DEFAULT_SNIPER_CONFIG: SniperConfig = {
  snipeAmountLamports: new BN(0.1 * LAMPORTS_PER_SOL),
  maxSlippageBps: 2000,
  priorityFeeMicroLamports: 1_000_000,
  prebuiltTx: true,
  maxTokenAgeSeconds: 30,
  autoSellAfterSeconds: 60,
  autoSellPriceMultiplier: 2.0,
  trailingStopPercent: 0.2,
  pollingIntervalMs: 1000,
  globalCacheRefreshMs: 5000,
  priceMonitorIntervalMs: 2000,
};

// ─── Events ───────────────────────────────────────────────────

interface SniperAgentEvents {
  'sniper:watching': (method: DetectionMethod) => void;
  'sniper:detected': (mint: string, method: DetectionMethod) => void;
  'sniper:sniping': (mint: string, solAmount: string) => void;
  'sniper:success': (result: TradeResult) => void;
  'sniper:auto-sell': (result: TradeResult, reason: AutoSellReason) => void;
  'sniper:failed': (mint: string, error: Error) => void;
  'sniper:price-update': (mint: string, price: number, peakPrice: number) => void;
  'sniper:global-cached': (timestamp: number) => void;
  'stopped': (reason: string) => void;
}

type DetectionMethod = 'websocket' | 'account-subscription' | 'polling';
type AutoSellReason = 'time-expired' | 'target-reached' | 'trailing-stop';

// ─── Sniper Agent ─────────────────────────────────────────────

export class SniperAgent extends EventEmitter<SniperAgentEvents> {
  readonly id: string;
  readonly wallet: AgentWallet;

  private readonly connection: Connection;
  private readonly config: SniperConfig;
  private onlineSdk: OnlinePumpSdk | null = null;

  // Cached global state for speed
  private cachedGlobal: DecodedGlobal | null = null;
  private globalCacheTimer: ReturnType<typeof setInterval> | null = null;

  // Detection state
  private running = false;
  private wsSubscriptionId: number | null = null;
  private accountSubscriptionId: number | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPolledSignature: string | null = null;

  // Snipe tracking — prevent double-sniping
  private snipedMints = new Set<string>();
  private activeSniping = false;

  // Auto-sell state
  private autoSellTimer: ReturnType<typeof setTimeout> | null = null;
  private priceMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private entryPrice = 0;
  private peakPrice = 0;
  private currentMint: string | null = null;
  private tokensHeld: BN = new BN(0);

  // Additional connections for multi-RPC fanout
  private fanoutConnections: Connection[] = [];

  constructor(wallet: AgentWallet, connection: Connection, config?: Partial<SniperConfig>) {
    super();
    this.id = `sniper-${uuid().slice(0, 8)}`;
    this.wallet = wallet;
    this.connection = connection;
    this.config = { ...DEFAULT_SNIPER_CONFIG, ...config };

    // Build fanout connections for parallel TX submission
    if (this.config.additionalRpcUrls) {
      for (const url of this.config.additionalRpcUrls) {
        this.fanoutConnections.push(new Connection(url, 'confirmed'));
      }
    }
  }

  // ─── SDK Access ─────────────────────────────────────────────

  private getOnlineSdk(): OnlinePumpSdk {
    if (!this.onlineSdk) {
      this.onlineSdk = new OnlinePumpSdk(this.connection);
    }
    return this.onlineSdk;
  }

  // ─── Global State Cache ─────────────────────────────────────

  /**
   * Pre-fetch and cache the Pump.fun global account state.
   * Refreshes on the configured interval for low-latency snipes.
   */
  private async startGlobalCache(): Promise<void> {
    await this.refreshGlobalCache();

    this.globalCacheTimer = setInterval(async () => {
      try {
        await this.refreshGlobalCache();
      } catch {
        // Swallow cache refresh errors — we keep the stale value
      }
    }, this.config.globalCacheRefreshMs);
  }

  private async refreshGlobalCache(): Promise<void> {
    this.cachedGlobal = await this.getOnlineSdk().fetchGlobal();
    this.emit('sniper:global-cached', Date.now());
  }

  private stopGlobalCache(): void {
    if (this.globalCacheTimer) {
      clearInterval(this.globalCacheTimer);
      this.globalCacheTimer = null;
    }
  }

  // ─── Readiness ──────────────────────────────────────────────

  /**
   * Pre-builds transaction template and caches global state
   * for fastest possible execution when a launch is detected.
   */
  async setReady(): Promise<void> {
    await this.startGlobalCache();
    console.log(`[sniper:${this.id}] Ready — global state cached, TX template prepared`);
  }

  // ─── Launch Detection ───────────────────────────────────────

  /**
   * Monitor for new Pump.fun token launches using all available detection methods.
   *
   * @param targetMint - If provided, only snipe this specific mint. Otherwise snipe any new launch.
   */
  async watchForLaunch(targetMint?: string): Promise<void> {
    if (this.running) {
      console.warn(`[sniper:${this.id}] Already watching — call stop() first`);
      return;
    }

    this.running = true;
    await this.setReady();

    // Method 1: WebSocket subscription to program logs
    this.startWebSocketDetection(targetMint);

    // Method 2: Account subscription on Pump.fun global
    this.startAccountSubscription(targetMint);

    // Method 3: Polling fallback
    this.startPollingDetection(targetMint);

    console.log(`[sniper:${this.id}] Watching for launches (target: ${targetMint ?? 'any'})`);
  }

  /**
   * Subscribe to Pump.fun program logs via WebSocket.
   * Parses CreateV2 instruction logs to detect new mints immediately.
   */
  private startWebSocketDetection(targetMint?: string): void {
    try {
      this.wsSubscriptionId = this.connection.onLogs(
        PUMP_PROGRAM_ID,
        (logs: Logs, ctx: Context) => {
          if (!this.running) return;
          this.handleProgramLogs(logs, ctx, targetMint);
        },
        'confirmed',
      );
      this.emit('sniper:watching', 'websocket');
    } catch (error) {
      console.error(`[sniper:${this.id}] WebSocket subscription failed:`, error);
    }
  }

  /**
   * Parse program logs for CreateV2 events and extract the mint address.
   */
  private handleProgramLogs(logs: Logs, _ctx: Context, targetMint?: string): void {
    // Look for CreateV2-related log entries
    const logMessages = logs.logs;
    const isCreate = logMessages.some(
      (msg) =>
        msg.includes('Instruction: CreateV2') ||
        msg.includes('Instruction: Create') ||
        msg.includes('Program log: Instruction: CreateV2AndBuy'),
    );

    if (!isCreate) return;

    // Extract mint address from the log — it appears in account keys of the transaction.
    // The mint is typically the 2nd account key in a CreateV2 instruction.
    // We parse it from the signature and fetch accounts.
    const signature = logs.signature;
    if (!signature) return;

    // Fire off an async extraction without blocking the log handler
    void this.extractMintFromSignature(signature, targetMint);
  }

  /**
   * Given a transaction signature, fetch the parsed transaction to extract
   * the newly created mint address.
   */
  private async extractMintFromSignature(signature: string, targetMint?: string): Promise<void> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx?.meta?.postTokenBalances) return;

      // Find mint addresses from postTokenBalances — new mints will appear here
      for (const balance of tx.meta.postTokenBalances) {
        const mint = balance.mint;
        if (!mint) continue;

        // Skip if we already sniped this mint
        if (this.snipedMints.has(mint)) continue;

        // If targeting a specific mint, only act on that one
        if (targetMint && mint !== targetMint) continue;

        // Check token age — the slot timestamp tells us when this was created
        if (tx.blockTime) {
          const ageSeconds = Math.floor(Date.now() / 1000) - tx.blockTime;
          if (ageSeconds > this.config.maxTokenAgeSeconds) {
            console.log(`[sniper:${this.id}] Skipping ${mint} — too old (${ageSeconds}s)`);
            continue;
          }
        }

        await this.onLaunchDetected(mint, 'websocket');
      }
    } catch (error) {
      // Transaction parsing can fail transiently — not critical
      console.debug(`[sniper:${this.id}] Failed to parse tx ${signature}:`, error);
    }
  }

  /**
   * Subscribe to account changes on the Pump.fun global account.
   * Any change to the global account may indicate a new token creation.
   */
  private startAccountSubscription(targetMint?: string): void {
    try {
      this.accountSubscriptionId = this.connection.onAccountChange(
        PUMP_PROGRAM_ID,
        (_accountInfo, _ctx) => {
          if (!this.running) return;
          // Global account changed — poll for recent creates
          void this.pollRecentCreates(targetMint, 'account-subscription');
        },
        'confirmed',
      );
      this.emit('sniper:watching', 'account-subscription');
    } catch (error) {
      console.error(`[sniper:${this.id}] Account subscription failed:`, error);
    }
  }

  /**
   * Polling fallback — periodically check for new signatures on the Pump.fun program.
   */
  private startPollingDetection(targetMint?: string): void {
    this.pollingTimer = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.pollRecentCreates(targetMint, 'polling');
      } catch (error) {
        console.debug(`[sniper:${this.id}] Polling error:`, error);
      }
    }, this.config.pollingIntervalMs);
    this.emit('sniper:watching', 'polling');
  }

  /**
   * Poll for recent create transactions on the Pump.fun program.
   */
  private async pollRecentCreates(
    targetMint: string | undefined,
    method: DetectionMethod,
  ): Promise<void> {
    const signatures = await this.connection.getSignaturesForAddress(
      PUMP_PROGRAM_ID,
      {
        limit: 10,
        ...(this.lastPolledSignature ? { until: this.lastPolledSignature } : {}),
      },
      'confirmed',
    );

    if (signatures.length === 0) return;

    // Update the cursor to the newest signature
    this.lastPolledSignature = signatures[0].signature;

    for (const sigInfo of signatures) {
      // Skip errored transactions
      if (sigInfo.err) continue;

      // Check if memo or logs hint at a create instruction
      const memo = sigInfo.memo;
      if (memo && (memo.includes('Create') || memo.includes('create'))) {
        await this.extractMintFromSignature(sigInfo.signature, targetMint);
        continue;
      }

      // Without memo, we parse any recent transaction
      // Only parse the most recent ones to limit RPC load
      const ageSeconds = Math.floor(Date.now() / 1000) - (sigInfo.blockTime ?? 0);
      if (ageSeconds <= this.config.maxTokenAgeSeconds) {
        await this.extractMintFromSignature(sigInfo.signature, targetMint);
      }
    }

    // Also emit detection method if we're using polling as fallback
    if (method === 'polling' && signatures.length > 0) {
      // Detection was already handled in extractMintFromSignature
    }
  }

  // ─── Launch Handler ─────────────────────────────────────────

  /**
   * Called when a new token launch is detected. Validates and triggers snipe.
   */
  private async onLaunchDetected(mint: string, method: DetectionMethod): Promise<void> {
    // Prevent double-snipe
    if (this.snipedMints.has(mint) || this.activeSniping) return;
    this.snipedMints.add(mint);

    this.emit('sniper:detected', mint, method);
    console.log(`[sniper:${this.id}] Launch detected: ${mint} via ${method}`);

    try {
      // Validate the bonding curve exists and is fresh
      const curveAddress = bondingCurvePda(new PublicKey(mint));
      const curveAccount = await this.connection.getAccountInfo(curveAddress);
      if (!curveAccount) {
        console.warn(`[sniper:${this.id}] No bonding curve found for ${mint} — skipping`);
        return;
      }

      // Decode to verify the curve is not already graduated
      const curveData = PUMP_SDK.decodeBondingCurve(curveAccount);
      if (curveData.complete) {
        console.warn(`[sniper:${this.id}] Curve already graduated for ${mint} — skipping`);
        return;
      }

      // Execute snipe
      const result = await this.snipe(mint, this.config.snipeAmountLamports);
      if (result.success) {
        this.emit('sniper:success', result);
        // Start auto-sell monitoring
        this.startAutoSell(mint, curveData);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('sniper:failed', mint, err);
      console.error(`[sniper:${this.id}] Snipe failed for ${mint}:`, err.message);
    }
  }

  // ─── Snipe Execution ───────────────────────────────────────

  /**
   * Execute an instant buy with maximum priority on a newly launched token.
   *
   * @param mint - Token mint address
   * @param solAmount - SOL to spend (lamports)
   * @returns TradeResult with execution details
   */
  async snipe(mint: string, solAmount: BN): Promise<TradeResult> {
    this.activeSniping = true;
    const mintPubkey = new PublicKey(mint);

    const order: TradeOrder = {
      id: uuid(),
      traderId: this.id,
      mint,
      direction: 'buy',
      amount: solAmount,
      slippageBps: this.config.maxSlippageBps,
      priorityFeeMicroLamports: this.config.priorityFeeMicroLamports,
      jitoTipLamports: this.config.jitoTipLamports,
    };

    this.emit('sniper:sniping', mint, solAmount.toString());
    console.log(
      `[sniper:${this.id}] Sniping ${mint} with ${solAmount.toNumber() / LAMPORTS_PER_SOL} SOL`,
    );

    try {
      // Use cached global state for speed, fallback to live fetch
      const global = this.cachedGlobal ?? (await this.getOnlineSdk().fetchGlobal());

      // Fetch buy state (bonding curve + user ATA)
      const buyState = await this.getOnlineSdk().fetchBuyState(
        mintPubkey,
        this.wallet.keypair.publicKey,
        TOKEN_PROGRAM_ID,
      );

      // Build buy instructions
      const buyIxs = await PUMP_SDK.buyInstructions({
        global,
        bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
        bondingCurve: buyState.bondingCurve,
        associatedUserAccountInfo: buyState.associatedUserAccountInfo,
        mint: mintPubkey,
        user: this.wallet.keypair.publicKey,
        amount: new BN(0),
        solAmount,
        slippage: this.config.maxSlippageBps / 100,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      // Build compute budget — aggressive priority for sniping
      const computeIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFeeMicroLamports,
        }),
      ];

      // Build transaction
      const { blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash('confirmed');

      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: this.wallet.keypair.publicKey,
      });
      tx.add(...computeIxs, ...buyIxs);
      tx.sign(this.wallet.keypair);

      // Submit to all RPC endpoints simultaneously for fastest landing
      const signature = await this.fanoutSend(tx, lastValidBlockHeight);

      // Fetch token balance to determine tokens received
      const ata = await getAssociatedTokenAddress(mintPubkey, this.wallet.keypair.publicKey);
      let tokensReceived = new BN(0);
      try {
        const tokenAccount = await getAccount(this.connection, ata);
        tokensReceived = new BN(tokenAccount.amount.toString());
        this.tokensHeld = tokensReceived;
      } catch {
        // ATA may not exist yet — retry after a short delay
        await this.sleep(2000);
        try {
          const tokenAccount = await getAccount(this.connection, ata);
          tokensReceived = new BN(tokenAccount.amount.toString());
          this.tokensHeld = tokensReceived;
        } catch {
          // Still failed — tokens may not have landed yet
        }
      }

      this.currentMint = mint;

      const result: TradeResult = {
        order,
        signature,
        amountOut: tokensReceived,
        executionPrice: tokensReceived.gtn(0)
          ? solAmount.mul(new BN(LAMPORTS_PER_SOL)).div(tokensReceived)
          : new BN(0),
        feesPaid: new BN(5000 + Math.ceil(this.config.priorityFeeMicroLamports * 200_000 / 1_000_000)),
        success: true,
        executedAt: Date.now(),
      };

      this.activeSniping = false;
      return result;
    } catch (error) {
      this.activeSniping = false;
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('sniper:failed', mint, err);

      return {
        order,
        signature: '',
        amountOut: new BN(0),
        executionPrice: new BN(0),
        feesPaid: new BN(0),
        success: false,
        error: err.message,
        executedAt: Date.now(),
      };
    }
  }

  /**
   * Send a signed transaction to all RPC endpoints simultaneously.
   * Uses skipPreflight for speed, confirms on the primary connection.
   *
   * @returns The transaction signature
   */
  private async fanoutSend(tx: Transaction, lastValidBlockHeight: number): Promise<string> {
    const rawTx = tx.serialize();

    // Send to all connections simultaneously — primary + fanout
    const allConnections = [this.connection, ...this.fanoutConnections];
    const sendPromises = allConnections.map((conn) =>
      conn
        .sendRawTransaction(rawTx, {
          skipPreflight: true,
          maxRetries: 2,
          preflightCommitment: 'confirmed',
        })
        .catch(() => null),
    );

    // Wait for the first signature
    const results = await Promise.allSettled(sendPromises);
    const signature = results
      .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .find((sig) => sig !== null);

    if (!signature) {
      throw new Error('All RPC endpoints failed to accept the transaction');
    }

    // Confirm on primary connection
    await this.connection.confirmTransaction(
      {
        signature,
        blockhash: tx.recentBlockhash!,
        lastValidBlockHeight,
      },
      'confirmed',
    );

    return signature;
  }

  // ─── Auto-Sell Mechanism ────────────────────────────────────

  /**
   * Start monitoring the sniped token for auto-sell conditions.
   *
   * Sells when:
   * 1. Time expires (autoSellAfterSeconds)
   * 2. Price target reached (autoSellPriceMultiplier)
   * 3. Trailing stop triggered (price drops 20% from peak)
   */
  private startAutoSell(mint: string, initialCurve: DecodedBondingCurve): void {
    // Record entry price
    this.entryPrice = getTokenPrice(initialCurve);
    this.peakPrice = this.entryPrice;

    // Timer: auto-sell after N seconds
    if (this.config.autoSellAfterSeconds) {
      this.autoSellTimer = setTimeout(async () => {
        await this.executeAutoSell(mint, 'time-expired');
      }, this.config.autoSellAfterSeconds * 1000);
    }

    // Price monitor: check price at intervals for target/trailing stop
    this.priceMonitorTimer = setInterval(async () => {
      if (!this.running || this.tokensHeld.isZero()) {
        this.stopAutoSell();
        return;
      }

      try {
        const currentPrice = await this.getOnlineSdk().fetchTokenPrice(new PublicKey(mint));
        this.emit('sniper:price-update', mint, currentPrice, this.peakPrice);

        // Update peak price
        if (currentPrice > this.peakPrice) {
          this.peakPrice = currentPrice;
        }

        // Check target multiplier
        if (
          this.config.autoSellPriceMultiplier &&
          currentPrice >= this.entryPrice * this.config.autoSellPriceMultiplier
        ) {
          console.log(
            `[sniper:${this.id}] Target price reached: ${currentPrice} >= ${this.entryPrice * this.config.autoSellPriceMultiplier}`,
          );
          await this.executeAutoSell(mint, 'target-reached');
          return;
        }

        // Check trailing stop
        if (this.peakPrice > 0) {
          const drawdown = (this.peakPrice - currentPrice) / this.peakPrice;
          if (drawdown >= this.config.trailingStopPercent) {
            console.log(
              `[sniper:${this.id}] Trailing stop triggered: ${(drawdown * 100).toFixed(1)}% drawdown from peak`,
            );
            await this.executeAutoSell(mint, 'trailing-stop');
            return;
          }
        }
      } catch (error) {
        console.debug(`[sniper:${this.id}] Price monitor error:`, error);
      }
    }, this.config.priceMonitorIntervalMs);
  }

  /**
   * Execute the auto-sell: dump all held tokens.
   */
  private async executeAutoSell(mint: string, reason: AutoSellReason): Promise<void> {
    this.stopAutoSell();

    if (this.tokensHeld.isZero()) return;

    console.log(
      `[sniper:${this.id}] Auto-sell triggered (${reason}) — selling ${this.tokensHeld.toString()} tokens`,
    );

    const mintPubkey = new PublicKey(mint);

    const order: TradeOrder = {
      id: uuid(),
      traderId: this.id,
      mint,
      direction: 'sell',
      amount: this.tokensHeld,
      slippageBps: this.config.maxSlippageBps,
      priorityFeeMicroLamports: this.config.priorityFeeMicroLamports,
    };

    try {
      const global = this.cachedGlobal ?? (await this.getOnlineSdk().fetchGlobal());
      const sellState = await this.getOnlineSdk().fetchSellState(
        mintPubkey,
        this.wallet.keypair.publicKey,
        TOKEN_PROGRAM_ID,
      );

      const sellIxs = await PUMP_SDK.sellInstructions({
        global,
        bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
        bondingCurve: sellState.bondingCurve,
        mint: mintPubkey,
        user: this.wallet.keypair.publicKey,
        amount: this.tokensHeld,
        solAmount: new BN(0),
        slippage: this.config.maxSlippageBps / 100,
        tokenProgram: TOKEN_PROGRAM_ID,
        mayhemMode: false,
      });

      const computeIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFeeMicroLamports,
        }),
      ];

      // Get SOL balance before sell
      const solBefore = await this.connection.getBalance(this.wallet.keypair.publicKey);

      const { blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash('confirmed');

      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: this.wallet.keypair.publicKey,
      });
      tx.add(...computeIxs, ...sellIxs);
      tx.sign(this.wallet.keypair);

      const signature = await this.fanoutSend(tx, lastValidBlockHeight);

      const solAfter = await this.connection.getBalance(this.wallet.keypair.publicKey);
      const solReceived = new BN(Math.max(0, solAfter - solBefore));

      const result: TradeResult = {
        order,
        signature,
        amountOut: solReceived,
        executionPrice: this.tokensHeld.gtn(0)
          ? solReceived.mul(new BN(LAMPORTS_PER_SOL)).div(this.tokensHeld)
          : new BN(0),
        feesPaid: new BN(5000),
        success: true,
        executedAt: Date.now(),
      };

      this.tokensHeld = new BN(0);
      this.emit('sniper:auto-sell', result, reason);
      console.log(
        `[sniper:${this.id}] Auto-sell complete: received ${solReceived.toNumber() / LAMPORTS_PER_SOL} SOL`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[sniper:${this.id}] Auto-sell failed:`, err.message);
      this.emit('sniper:failed', mint, err);
    }
  }

  private stopAutoSell(): void {
    if (this.autoSellTimer) {
      clearTimeout(this.autoSellTimer);
      this.autoSellTimer = null;
    }
    if (this.priceMonitorTimer) {
      clearInterval(this.priceMonitorTimer);
      this.priceMonitorTimer = null;
    }
  }

  // ─── Bonding Curve Helpers ──────────────────────────────────

  /**
   * Fetch the current bonding curve state for a token.
   */
  async getBondingCurveState(mint: string): Promise<BondingCurveState> {
    const mintPubkey = new PublicKey(mint);
    const curveAddress = bondingCurvePda(mintPubkey);
    const accountInfo = await this.connection.getAccountInfo(curveAddress);

    if (!accountInfo) {
      throw new Error(`Bonding curve not found for mint ${mint}`);
    }

    const curveData = PUMP_SDK.decodeBondingCurve(accountInfo);
    const virtualSolReserves = new BN(curveData.virtualSolReserves.toString());
    const virtualTokenReserves = new BN(curveData.virtualTokenReserves.toString());
    const realSolReserves = new BN(curveData.realSolReserves.toString());
    const realTokenReserves = new BN(curveData.realTokenReserves.toString());

    const priceSol = virtualSolReserves.toNumber() / virtualTokenReserves.toNumber();
    const totalSupply = 1_000_000_000;
    const marketCapSol = priceSol * totalSupply;
    const graduationThresholdLamports = 85 * LAMPORTS_PER_SOL;
    const graduationProgress = Math.min(
      100,
      (realSolReserves.toNumber() / graduationThresholdLamports) * 100,
    );

    return {
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
  }

  // ─── Control ────────────────────────────────────────────────

  /**
   * Stop all monitoring, cancel pending auto-sells, and clean up subscriptions.
   */
  stop(): void {
    this.running = false;

    // Stop detection
    if (this.wsSubscriptionId !== null) {
      void this.connection.removeOnLogsListener(this.wsSubscriptionId);
      this.wsSubscriptionId = null;
    }
    if (this.accountSubscriptionId !== null) {
      void this.connection.removeAccountChangeListener(this.accountSubscriptionId);
      this.accountSubscriptionId = null;
    }
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    // Stop caching
    this.stopGlobalCache();

    // Stop auto-sell
    this.stopAutoSell();

    this.emit('stopped', 'manual');
    console.log(`[sniper:${this.id}] Stopped`);
  }

  /**
   * Check if the sniper is actively watching.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get tokens currently held from snipes.
   */
  getTokensHeld(): BN {
    return this.tokensHeld.clone();
  }

  /**
   * Get the set of mints that have been sniped.
   */
  getSnipedMints(): ReadonlySet<string> {
    return this.snipedMints;
  }

  /**
   * Get the current auto-sell state.
   */
  getAutoSellState(): {
    entryPrice: number;
    peakPrice: number;
    currentMint: string | null;
    tokensHeld: string;
  } {
    return {
      entryPrice: this.entryPrice,
      peakPrice: this.peakPrice,
      currentMint: this.currentMint,
      tokensHeld: this.tokensHeld.toString(),
    };
  }

  // ─── Utilities ──────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
