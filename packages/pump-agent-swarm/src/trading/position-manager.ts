/**
 * Position Manager — Cross-Agent Aggregate Position Tracking
 *
 * Tracks the aggregate token position across ALL agent wallets, calculates
 * total supply percentage owned, manages position limits, and coordinates
 * rebalancing between wallets via SPL token transfers.
 *
 * Features:
 * - Aggregate position across all wallets (total tokens, cost basis, PnL)
 * - Supply percentage calculation against on-chain mint supply
 * - Configurable position limits with over-limit event emission
 * - Wallet rebalancing suggestions to prevent single-wallet concentration
 * - SPL token transfers for executing rebalance operations
 * - Auto-refresh with configurable interval
 * - Full integration with SwarmEventBus for coordination
 *
 * @example
 * ```typescript
 * import { Connection } from '@solana/web3.js';
 * import { SwarmEventBus } from '../infra/event-bus.js';
 * import { PositionManager } from './position-manager.js';
 *
 * const connection = new Connection('https://api.mainnet-beta.solana.com');
 * const eventBus = SwarmEventBus.getInstance();
 * const manager = new PositionManager(connection, eventBus);
 *
 * manager.trackToken('So11...mint');
 * await manager.refreshPositions();
 * const pos = manager.getAggregatePosition('So11...mint');
 * console.log(`Supply %: ${pos.supplyPercent}`);
 * ```
 */

import {
  type Connection,
  PublicKey,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import BN from 'bn.js';

import { SwarmEventBus } from '../infra/event-bus.js';
import type { SwarmEventCategory } from '../types.js';

// ─── Constants ────────────────────────────────────────────────

/** Wallet holding >25% of swarm position triggers rebalance suggestion */
const MAX_WALLET_CONCENTRATION_PERCENT = 25;

/** Wallets holding <5% are candidates to receive tokens in rebalance */
const MIN_WALLET_THRESHOLD_PERCENT = 5;

/** Default auto-refresh interval (30 seconds) */
const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

/** Source identifier for event bus emissions */
const EVENT_SOURCE = 'position-manager';

// ─── Types ────────────────────────────────────────────────────

/** Per-wallet position within the swarm */
export interface WalletPosition {
  /** Base58-encoded wallet public key */
  walletAddress: string;
  /** Agent identifier that controls this wallet */
  agentId: string;
  /** Token balance held by this wallet */
  tokens: BN;
  /** Total SOL cost to acquire tokens in this wallet (lamports) */
  costBasis: BN;
  /** This wallet's share of the swarm's total token position (0-100) */
  percentOfSwarmPosition: number;
  /** This wallet's share of the total on-chain token supply (0-100) */
  percentOfSupply: number;
}

/** Aggregate position across all swarm wallets for a single token */
export interface AggregatePosition {
  /** Token mint address (base58) */
  mint: string;
  /** Sum of tokens across all wallets */
  totalTokens: BN;
  /** Total SOL spent acquiring tokens across all wallets */
  totalCostBasis: BN;
  /** Per-token average cost (totalCostBasis / totalTokens) */
  avgCostBasis: BN;
  /** Current spot price (SOL per token, in lamports) */
  currentPrice: BN;
  /** Current value of entire position (totalTokens * currentPrice) */
  currentValue: BN;
  /** Unrealized profit/loss (currentValue - totalCostBasis) */
  unrealizedPnl: BN;
  /** Unrealized P&L as a percentage */
  unrealizedPnlPercent: number;
  /** Percentage of total on-chain supply controlled by swarm (0-100) */
  supplyPercent: number;
  /** Number of wallets holding this token */
  walletCount: number;
  /** Individual wallet breakdowns */
  walletPositions: WalletPosition[];
  /** Timestamp of last refresh */
  updatedAt: number;
}

/** Suggested token transfer between wallets to reduce concentration */
export interface RebalanceSuggestion {
  /** Source wallet address (over-concentrated) */
  from: string;
  /** Destination wallet address (under-weighted) */
  to: string;
  /** Number of tokens to transfer */
  tokenAmount: BN;
  /** Human-readable reason for this rebalance */
  reason: string;
}

/** Internal tracking state per wallet per token */
interface WalletTrackingEntry {
  walletAddress: string;
  agentId: string;
  tokens: BN;
  costBasis: BN;
}

/** Internal tracking state per token */
interface TokenTrackingState {
  mint: string;
  wallets: Map<string, WalletTrackingEntry>;
  currentPrice: BN;
  totalSupply: BN;
  maxPositionPercent: number;
  updatedAt: number;
}

// ─── PositionManager ──────────────────────────────────────────

export class PositionManager {
  private readonly connection: Connection;
  private readonly eventBus: SwarmEventBus;
  private readonly trackedTokens = new Map<string, TokenTrackingState>();
  private autoRefreshTimer: ReturnType<typeof setInterval> | undefined;
  private refreshing = false;

  constructor(connection: Connection, eventBus: SwarmEventBus) {
    this.connection = connection;
    this.eventBus = eventBus;
    this.subscribeToTradeEvents();
  }

  // ── Token Tracking ────────────────────────────────────────

  /**
   * Start tracking a token across swarm wallets.
   * Call `refreshPositions()` afterward to populate balances.
   */
  trackToken(mint: string): void {
    if (this.trackedTokens.has(mint)) return;

    this.trackedTokens.set(mint, {
      mint,
      wallets: new Map(),
      currentPrice: new BN(0),
      totalSupply: new BN(0),
      maxPositionPercent: 100, // no limit until explicitly set
      updatedAt: 0,
    });

    this.eventBus.emit(
      'position:tracking-started',
      'trading' as SwarmEventCategory,
      EVENT_SOURCE,
      { mint },
    );
  }

  /**
   * Register a wallet for position tracking on a given token.
   * Must call `trackToken(mint)` first.
   */
  registerWallet(
    mint: string,
    walletAddress: string,
    agentId: string,
  ): void {
    const state = this.trackedTokens.get(mint);
    if (!state) {
      throw new Error(
        `Token ${mint} is not being tracked. Call trackToken() first.`,
      );
    }

    if (!state.wallets.has(walletAddress)) {
      state.wallets.set(walletAddress, {
        walletAddress,
        agentId,
        tokens: new BN(0),
        costBasis: new BN(0),
      });
    }
  }

  /**
   * Record a cost basis entry when a trade is executed.
   * This keeps the aggregate cost basis accurate.
   */
  recordTrade(
    mint: string,
    walletAddress: string,
    direction: 'buy' | 'sell',
    tokens: BN,
    solAmount: BN,
  ): void {
    const state = this.trackedTokens.get(mint);
    if (!state) return;

    const entry = state.wallets.get(walletAddress);
    if (!entry) return;

    if (direction === 'buy') {
      entry.costBasis = entry.costBasis.add(solAmount);
    } else {
      // Proportionally reduce cost basis on sell
      if (!entry.tokens.isZero()) {
        const fraction = BN.min(tokens, entry.tokens);
        const costReduction = entry.costBasis
          .mul(fraction)
          .div(entry.tokens);
        entry.costBasis = entry.costBasis.sub(costReduction);
      }
    }
  }

  // ── Position Queries ──────────────────────────────────────

  /**
   * Refresh all wallet token balances and supply data from on-chain.
   * Fetches SPL token account balances and mint supply concurrently.
   */
  async refreshPositions(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      const mints = [...this.trackedTokens.keys()];

      await Promise.all(
        mints.map((mint) => this.refreshTokenPositions(mint)),
      );

      this.eventBus.emit(
        'position:refreshed',
        'trading' as SwarmEventCategory,
        EVENT_SOURCE,
        {
          tokenCount: mints.length,
          timestamp: Date.now(),
        },
      );
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Get the aggregate position for a tracked token.
   * Returns zero-initialized position if token has no data yet.
   */
  getAggregatePosition(mint: string): AggregatePosition {
    const state = this.trackedTokens.get(mint);
    if (!state) {
      return this.emptyAggregatePosition(mint);
    }

    const walletPositions: WalletPosition[] = [];
    let totalTokens = new BN(0);
    let totalCostBasis = new BN(0);

    for (const entry of state.wallets.values()) {
      totalTokens = totalTokens.add(entry.tokens);
      totalCostBasis = totalCostBasis.add(entry.costBasis);
    }

    const supplyPercent = state.totalSupply.isZero()
      ? 0
      : totalTokens
          .mul(new BN(10_000))
          .div(state.totalSupply)
          .toNumber() / 100;

    for (const entry of state.wallets.values()) {
      if (entry.tokens.isZero()) continue;

      const percentOfSwarm = totalTokens.isZero()
        ? 0
        : entry.tokens
            .mul(new BN(10_000))
            .div(totalTokens)
            .toNumber() / 100;

      const percentOfSupply = state.totalSupply.isZero()
        ? 0
        : entry.tokens
            .mul(new BN(10_000))
            .div(state.totalSupply)
            .toNumber() / 100;

      walletPositions.push({
        walletAddress: entry.walletAddress,
        agentId: entry.agentId,
        tokens: entry.tokens,
        costBasis: entry.costBasis,
        percentOfSwarmPosition: percentOfSwarm,
        percentOfSupply,
      });
    }

    const currentValue = totalTokens.mul(state.currentPrice);
    const unrealizedPnl = currentValue.sub(totalCostBasis);
    const unrealizedPnlPercent = totalCostBasis.isZero()
      ? 0
      : unrealizedPnl
          .mul(new BN(10_000))
          .div(totalCostBasis)
          .toNumber() / 100;

    const avgCostBasis = totalTokens.isZero()
      ? new BN(0)
      : totalCostBasis.div(totalTokens);

    return {
      mint,
      totalTokens,
      totalCostBasis,
      avgCostBasis,
      currentPrice: state.currentPrice,
      currentValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      supplyPercent,
      walletCount: walletPositions.length,
      walletPositions,
      updatedAt: state.updatedAt,
    };
  }

  /**
   * Get position details for a specific wallet on a tracked token.
   */
  getWalletPosition(
    mint: string,
    walletAddress: string,
  ): WalletPosition {
    const state = this.trackedTokens.get(mint);
    if (!state) {
      return this.emptyWalletPosition(walletAddress);
    }

    const entry = state.wallets.get(walletAddress);
    if (!entry) {
      return this.emptyWalletPosition(walletAddress);
    }

    const aggregate = this.getAggregatePosition(mint);
    const found = aggregate.walletPositions.find(
      (wp) => wp.walletAddress === walletAddress,
    );

    return found ?? this.emptyWalletPosition(walletAddress);
  }

  /**
   * Calculate the percentage of total token supply controlled by the swarm.
   * Fetches the latest on-chain supply if state is stale.
   */
  async getSupplyPercentage(mint: string): Promise<number> {
    const state = this.trackedTokens.get(mint);
    if (!state) return 0;

    // Refresh supply if data is older than 10 seconds
    const staleThresholdMs = 10_000;
    if (Date.now() - state.updatedAt > staleThresholdMs) {
      await this.refreshTokenPositions(mint);
    }

    return this.getAggregatePosition(mint).supplyPercent;
  }

  // ── Position Limits ───────────────────────────────────────

  /**
   * Set maximum allowable supply percentage for a token.
   * If the swarm exceeds this, further buys should be halted.
   */
  setPositionLimit(mint: string, maxPercent: number): void {
    const state = this.trackedTokens.get(mint);
    if (!state) {
      throw new Error(
        `Token ${mint} is not being tracked. Call trackToken() first.`,
      );
    }

    if (maxPercent < 0 || maxPercent > 100) {
      throw new Error(
        `maxPercent must be between 0 and 100, got ${maxPercent}`,
      );
    }

    state.maxPositionPercent = maxPercent;

    this.eventBus.emit(
      'position:limit-set',
      'trading' as SwarmEventCategory,
      EVENT_SOURCE,
      { mint, maxPercent },
    );
  }

  /**
   * Check if the aggregate position exceeds the configured limit.
   * If over limit, emits `position:over-limit` event.
   */
  isOverLimit(mint: string): boolean {
    const state = this.trackedTokens.get(mint);
    if (!state) return false;

    const position = this.getAggregatePosition(mint);
    const overLimit = position.supplyPercent > state.maxPositionPercent;

    if (overLimit) {
      this.eventBus.emit(
        'position:over-limit',
        'trading' as SwarmEventCategory,
        EVENT_SOURCE,
        {
          mint,
          currentPercent: position.supplyPercent,
          limit: state.maxPositionPercent,
        },
      );
    }

    return overLimit;
  }

  // ── Rebalancing ───────────────────────────────────────────

  /**
   * Generate rebalance suggestions for a token to prevent wallet concentration.
   *
   * If a wallet holds >25% of the swarm's total position, suggests distributing
   * excess tokens to wallets holding <5%.
   */
  suggestRebalance(mint: string): RebalanceSuggestion[] {
    const position = this.getAggregatePosition(mint);
    if (position.totalTokens.isZero() || position.walletCount <= 1) {
      return [];
    }

    const suggestions: RebalanceSuggestion[] = [];

    // Find over-concentrated wallets (>25% of swarm position)
    const overConcentrated = position.walletPositions.filter(
      (wp) => wp.percentOfSwarmPosition > MAX_WALLET_CONCENTRATION_PERCENT,
    );

    // Find under-weighted wallets (<5% of swarm position)
    const underWeighted = position.walletPositions.filter(
      (wp) => wp.percentOfSwarmPosition < MIN_WALLET_THRESHOLD_PERCENT,
    );

    // Also consider wallets with zero balance as potential recipients
    const state = this.trackedTokens.get(mint);
    if (!state) return suggestions;

    const zeroWallets: string[] = [];
    for (const entry of state.wallets.values()) {
      if (entry.tokens.isZero()) {
        zeroWallets.push(entry.walletAddress);
      }
    }

    // Target: each wallet should hold roughly 1/N of the total
    const totalWallets = position.walletCount + zeroWallets.length;
    const targetPerWallet = totalWallets > 0
      ? position.totalTokens.div(new BN(totalWallets))
      : new BN(0);

    for (const source of overConcentrated) {
      // How many tokens over the target
      const excess = source.tokens.sub(targetPerWallet);
      if (excess.lte(new BN(0))) continue;

      // Distribute excess among under-weighted and zero-balance wallets
      const recipients = [
        ...underWeighted.map((wp) => wp.walletAddress),
        ...zeroWallets,
      ];

      if (recipients.length === 0) continue;

      const perRecipient = excess.div(new BN(recipients.length));
      if (perRecipient.isZero()) continue;

      for (const recipient of recipients) {
        if (recipient === source.walletAddress) continue;

        suggestions.push({
          from: source.walletAddress,
          to: recipient,
          tokenAmount: perRecipient,
          reason:
            `Wallet ${source.walletAddress.slice(0, 8)}… holds ` +
            `${source.percentOfSwarmPosition.toFixed(1)}% of swarm position ` +
            `(>${MAX_WALLET_CONCENTRATION_PERCENT}%); distributing to ` +
            `${recipient.slice(0, 8)}… to reduce concentration`,
        });
      }
    }

    if (suggestions.length > 0) {
      this.eventBus.emit(
        'position:rebalance-suggested',
        'trading' as SwarmEventCategory,
        EVENT_SOURCE,
        {
          mint,
          suggestionCount: suggestions.length,
          suggestions: suggestions.map((s) => ({
            from: s.from,
            to: s.to,
            amount: s.tokenAmount.toString(),
            reason: s.reason,
          })),
        },
      );
    }

    return suggestions;
  }

  /**
   * Execute a rebalance by performing an SPL token transfer between wallets.
   *
   * Requires that the source wallet's keypair is accessible via the
   * wallet tracking entries. The source wallet must have sufficient tokens.
   *
   * @returns Transaction signature
   */
  async executeRebalance(
    suggestion: RebalanceSuggestion,
  ): Promise<string> {
    const mintAddress = this.findMintForWallet(suggestion.from);
    if (!mintAddress) {
      throw new Error(
        `Cannot determine mint for wallet ${suggestion.from}. ` +
        `Ensure the wallet is registered with a tracked token.`,
      );
    }

    const mintPubkey = new PublicKey(mintAddress);
    const fromPubkey = new PublicKey(suggestion.from);
    const toPubkey = new PublicKey(suggestion.to);

    // Derive associated token accounts
    const fromAta = getAssociatedTokenAddressSync(mintPubkey, fromPubkey);
    const toAta = getAssociatedTokenAddressSync(mintPubkey, toPubkey);

    const instructions = [];

    // Check if destination ATA exists; if not, create it
    const toAtaExists = await this.tokenAccountExists(toAta);
    if (!toAtaExists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          fromPubkey, // payer
          toAta,
          toPubkey,
          mintPubkey,
        ),
      );
    }

    // Create the SPL token transfer instruction
    instructions.push(
      createTransferInstruction(
        fromAta,
        toAta,
        fromPubkey,
        BigInt(suggestion.tokenAmount.toString()),
      ),
    );

    // Build and sign the transaction
    const transaction = new Transaction().add(...instructions);
    const latestBlockhash =
      await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.feePayer = fromPubkey;

    // We emit an event for the coordinator to sign and send
    // since we don't hold keypairs directly
    const serialized = transaction
      .serialize({ requireAllSignatures: false })
      .toString('base64');

    this.eventBus.emit(
      'position:rebalance-tx-ready',
      'trading' as SwarmEventCategory,
      EVENT_SOURCE,
      {
        mint: mintAddress,
        from: suggestion.from,
        to: suggestion.to,
        amount: suggestion.tokenAmount.toString(),
        transaction: serialized,
        reason: suggestion.reason,
      },
    );

    // Wait for the coordinator to sign and broadcast, then return the sig
    const resultEvent = await this.eventBus.waitFor(
      'position:rebalance-confirmed',
      60_000,
    );

    const signature = resultEvent.payload['signature'] as string;

    // Update internal tracking: move tokens from source to dest
    const state = this.trackedTokens.get(mintAddress);
    if (state) {
      const fromEntry = state.wallets.get(suggestion.from);
      const toEntry = state.wallets.get(suggestion.to);
      if (fromEntry && toEntry) {
        fromEntry.tokens = fromEntry.tokens.sub(suggestion.tokenAmount);
        toEntry.tokens = toEntry.tokens.add(suggestion.tokenAmount);

        // Transfer proportional cost basis
        if (!fromEntry.tokens.add(suggestion.tokenAmount).isZero()) {
          const originalFromTokens = fromEntry.tokens.add(
            suggestion.tokenAmount,
          );
          const costTransfer = fromEntry.costBasis
            .mul(suggestion.tokenAmount)
            .div(originalFromTokens);
          fromEntry.costBasis = fromEntry.costBasis.sub(costTransfer);
          toEntry.costBasis = toEntry.costBasis.add(costTransfer);
        }
      }
    }

    this.eventBus.emit(
      'position:rebalanced',
      'trading' as SwarmEventCategory,
      EVENT_SOURCE,
      {
        mint: mintAddress,
        from: suggestion.from,
        to: suggestion.to,
        amount: suggestion.tokenAmount.toString(),
        signature,
      },
    );

    return signature;
  }

  // ── Value Calculation ─────────────────────────────────────

  /**
   * Calculate total position value in SOL at current price.
   * Refreshes price if data is stale.
   */
  async getTotalValue(mint: string): Promise<BN> {
    const state = this.trackedTokens.get(mint);
    if (!state) return new BN(0);

    // Refresh if stale (>10s)
    if (Date.now() - state.updatedAt > 10_000) {
      await this.refreshTokenPositions(mint);
    }

    const position = this.getAggregatePosition(mint);
    return position.currentValue;
  }

  // ── Auto-Refresh ──────────────────────────────────────────

  /**
   * Start automatic periodic refresh of all tracked positions.
   */
  startAutoRefresh(
    intervalMs: number = DEFAULT_REFRESH_INTERVAL_MS,
  ): void {
    this.stopAutoRefresh();

    this.autoRefreshTimer = setInterval(() => {
      void this.refreshPositions().catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : String(err);
        this.eventBus.emit(
          'position:refresh-error',
          'error' as SwarmEventCategory,
          EVENT_SOURCE,
          { error: message },
        );
      });
    }, intervalMs);

    this.eventBus.emit(
      'position:auto-refresh-started',
      'trading' as SwarmEventCategory,
      EVENT_SOURCE,
      { intervalMs },
    );
  }

  /**
   * Stop the automatic refresh timer.
   */
  stopAutoRefresh(): void {
    if (this.autoRefreshTimer !== undefined) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;

      this.eventBus.emit(
        'position:auto-refresh-stopped',
        'trading' as SwarmEventCategory,
        EVENT_SOURCE,
        {},
      );
    }
  }

  // ── Private Helpers ───────────────────────────────────────

  /**
   * Refresh positions for a single tracked token.
   */
  private async refreshTokenPositions(mint: string): Promise<void> {
    const state = this.trackedTokens.get(mint);
    if (!state) return;

    const mintPubkey = new PublicKey(mint);

    // Fetch total supply and all wallet balances concurrently
    const supplyPromise = this.connection.getTokenSupply(mintPubkey);

    const walletEntries = [...state.wallets.values()];
    const balancePromises = walletEntries.map((entry) =>
      this.fetchWalletTokenBalance(mintPubkey, entry.walletAddress),
    );

    const [supplyResult, ...balances] = await Promise.all([
      supplyPromise,
      ...balancePromises,
    ]);

    // Update total supply
    state.totalSupply = new BN(supplyResult.value.amount);

    // Update individual wallet balances
    for (let i = 0; i < walletEntries.length; i++) {
      const entry = walletEntries[i];
      const balance = balances[i];
      if (entry && balance !== undefined) {
        entry.tokens = balance;
      }
    }

    // Update current price from bonding curve event or on-chain data
    await this.refreshCurrentPrice(mint, state);

    state.updatedAt = Date.now();

    // Check position limits after refresh
    this.checkPositionLimit(mint);
  }

  /**
   * Fetch the token balance of a specific wallet for a given mint.
   */
  private async fetchWalletTokenBalance(
    mint: PublicKey,
    walletAddress: string,
  ): Promise<BN> {
    try {
      const walletPubkey = new PublicKey(walletAddress);
      const ata = await getAssociatedTokenAddress(mint, walletPubkey);
      const account = await getAccount(this.connection, ata);
      return new BN(account.amount.toString());
    } catch {
      // Account doesn't exist or has zero balance
      return new BN(0);
    }
  }

  /**
   * Refresh current price by reading bonding curve state or recent trades.
   * Falls back to the last known price if on-chain fetch fails.
   */
  private async refreshCurrentPrice(
    mint: string,
    state: TokenTrackingState,
  ): Promise<void> {
    // Look for a recent price event from the event bus
    const recentEvents = this.eventBus.getHistory({
      type: 'trade:executed',
      limit: 50,
    });

    for (const event of recentEvents.reverse()) {
      const payload = event.payload as Record<string, unknown>;
      const orderPayload = payload['order'] as
        | Record<string, unknown>
        | undefined;
      const mintFromEvent = orderPayload?.['mint'] as string | undefined;
      const executionPrice = payload['executionPrice'] as
        | string
        | undefined;

      if (mintFromEvent === mint && executionPrice) {
        state.currentPrice = new BN(executionPrice);
        return;
      }
    }

    // If no recent trade events, try to derive price from on-chain data
    // by looking at bonding curve state events
    const curveEvents = this.eventBus.getHistory({
      category: 'trading',
      limit: 50,
    });

    for (const event of curveEvents.reverse()) {
      if (!event.type.startsWith('curve:')) continue;
      const payload = event.payload as Record<string, unknown>;
      if (payload['mint'] === mint && payload['currentPriceSol']) {
        // Convert SOL price to lamports-per-token
        const priceSol = payload['currentPriceSol'] as number;
        state.currentPrice = new BN(
          Math.round(priceSol * 1_000_000_000),
        );
        return;
      }
    }
  }

  /**
   * Check if position exceeds limit and emit event if so.
   */
  private checkPositionLimit(mint: string): void {
    const state = this.trackedTokens.get(mint);
    if (!state) return;

    const position = this.getAggregatePosition(mint);
    if (position.supplyPercent > state.maxPositionPercent) {
      this.eventBus.emit(
        'position:over-limit',
        'trading' as SwarmEventCategory,
        EVENT_SOURCE,
        {
          mint,
          currentPercent: position.supplyPercent,
          limit: state.maxPositionPercent,
        },
      );
    }
  }

  /**
   * Check if a token account exists on-chain.
   */
  private async tokenAccountExists(
    ata: PublicKey,
  ): Promise<boolean> {
    try {
      await getAccount(this.connection, ata);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find which tracked token a wallet belongs to.
   * Returns the first mint found (wallets typically track one token).
   */
  private findMintForWallet(walletAddress: string): string | undefined {
    for (const [mint, state] of this.trackedTokens) {
      if (state.wallets.has(walletAddress)) {
        return mint;
      }
    }
    return undefined;
  }

  /**
   * Subscribe to trade events to automatically update cost basis.
   */
  private subscribeToTradeEvents(): void {
    this.eventBus.subscribe(
      'trade:executed',
      (event) => {
        const payload = event.payload as Record<string, unknown>;
        const order = payload['order'] as
          | Record<string, unknown>
          | undefined;
        const success = payload['success'] as boolean | undefined;

        if (!order || success !== true) return;

        const mint = order['mint'] as string | undefined;
        const direction = order['direction'] as string | undefined;
        const amountOut = payload['amountOut'] as string | undefined;
        const traderId = order['traderId'] as string | undefined;

        if (!mint || !direction || !amountOut || !traderId) return;

        // Find the wallet address for this trader
        const state = this.trackedTokens.get(mint);
        if (!state) return;

        // Look up wallet by agentId
        for (const entry of state.wallets.values()) {
          if (entry.agentId === traderId) {
            const amount = order['amount'] as string | undefined;
            const tokens = new BN(amountOut);
            const sol = amount ? new BN(amount) : new BN(0);

            this.recordTrade(
              mint,
              entry.walletAddress,
              direction as 'buy' | 'sell',
              tokens,
              sol,
            );
            break;
          }
        }
      },
      { source: EVENT_SOURCE },
    );
  }

  /**
   * Create a zero-initialized aggregate position.
   */
  private emptyAggregatePosition(mint: string): AggregatePosition {
    return {
      mint,
      totalTokens: new BN(0),
      totalCostBasis: new BN(0),
      avgCostBasis: new BN(0),
      currentPrice: new BN(0),
      currentValue: new BN(0),
      unrealizedPnl: new BN(0),
      unrealizedPnlPercent: 0,
      supplyPercent: 0,
      walletCount: 0,
      walletPositions: [],
      updatedAt: 0,
    };
  }

  /**
   * Create a zero-initialized wallet position.
   */
  private emptyWalletPosition(walletAddress: string): WalletPosition {
    return {
      walletAddress,
      agentId: '',
      tokens: new BN(0),
      costBasis: new BN(0),
      percentOfSwarmPosition: 0,
      percentOfSupply: 0,
    };
  }
}
