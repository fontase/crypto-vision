/**
 * Wallet Rotation System — Anti-Pattern Trading
 *
 * Manages which wallets are used for trading at any given time,
 * ensuring no single wallet is overused and trading patterns look
 * organic across multiple addresses.
 *
 * Supports multiple rotation strategies:
 * - round-robin: Cycle through wallets in deterministic order
 * - random: Uniformly random among eligible wallets
 * - least-used: Always pick the wallet with fewest trades in the tracking window
 * - weighted-random: Random but biased toward less-used wallets (exponential decay)
 */

import BN from 'bn.js';
import type { AgentWallet, TradeDirection } from '../types.js';

// ─── Configuration ────────────────────────────────────────────

export interface RotationConfig {
  /** Max trades from same wallet in a row (default: 3) */
  maxConsecutiveUses: number;
  /** Cooldown duration after hitting max consecutive uses in ms (default: 60_000) */
  cooldownAfterMaxMs: number;
  /** Strategy for selecting the next wallet */
  rotationStrategy: 'round-robin' | 'random' | 'least-used' | 'weighted-random';
  /** Prefer wallets with SOL balance for buys */
  preferBuyerForBuys: boolean;
  /** Prefer wallets with token balance for sells */
  preferSellerForSells: boolean;
  /** Max trades per wallet per hour */
  maxTradesPerWalletPerHour: number;
  /** Window for usage tracking in ms (default: 3_600_000 = 1 hour) */
  trackingWindowMs: number;
}

// ─── Usage Stats ──────────────────────────────────────────────

export interface WalletUsageStats {
  address: string;
  totalTrades: number;
  tradesInWindow: number;
  lastUsedAt: number;
  consecutiveUses: number;
  onCooldown: boolean;
  cooldownEndsAt?: number;
  buyCount: number;
  sellCount: number;
}

// ─── Internal State ───────────────────────────────────────────

interface WalletState {
  wallet: AgentWallet;
  totalTrades: number;
  /** Timestamps of trades within the current tracking window */
  tradeTimestamps: number[];
  lastUsedAt: number;
  consecutiveUses: number;
  cooldownEndsAt: number;
  buyCount: number;
  sellCount: number;
  /** Token balance (lamport-scale BN) tracked externally via markUsed */
  tokenBalance: BN;
}

/** Minimum SOL required to execute a buy (covers fees + small trade) */
const MIN_SOL_FOR_BUY = new BN(10_000_000); // 0.01 SOL

// ─── Default Config ───────────────────────────────────────────

const DEFAULT_CONFIG: RotationConfig = {
  maxConsecutiveUses: 3,
  cooldownAfterMaxMs: 60_000,
  rotationStrategy: 'round-robin',
  preferBuyerForBuys: true,
  preferSellerForSells: true,
  maxTradesPerWalletPerHour: 20,
  trackingWindowMs: 3_600_000,
};

// ─── WalletRotation Class ─────────────────────────────────────

export class WalletRotation {
  private readonly wallets: Map<string, WalletState> = new Map();
  private readonly config: RotationConfig;
  /** Ordered list of addresses for round-robin cycling */
  private roundRobinOrder: string[] = [];
  /** Current index for round-robin strategy */
  private roundRobinIndex = 0;
  /** Address of the last wallet used (for consecutive tracking) */
  private lastUsedAddress: string | null = null;

  constructor(wallets: AgentWallet[], config?: Partial<RotationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    for (const wallet of wallets) {
      this.addWalletInternal(wallet);
    }
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Returns the best wallet for the next trade based on the configured
   * rotation strategy and smart selection criteria.
   *
   * @throws Error if no eligible wallet is available
   */
  getNextWallet(direction: TradeDirection): AgentWallet {
    const now = Date.now();
    this.pruneExpiredTimestamps(now);

    const eligible = this.getEligibleWallets(direction, now);
    if (eligible.length === 0) {
      throw new Error(
        `No eligible wallet available for ${direction}. ` +
          `All wallets are on cooldown or have exceeded rate limits.`,
      );
    }

    let selected: WalletState;

    switch (this.config.rotationStrategy) {
      case 'round-robin':
        selected = this.selectRoundRobin(eligible);
        break;
      case 'random':
        selected = this.selectRandom(eligible);
        break;
      case 'least-used':
        selected = this.selectLeastUsed(eligible);
        break;
      case 'weighted-random':
        selected = this.selectWeightedRandom(eligible);
        break;
    }

    return selected.wallet;
  }

  /**
   * Record that a wallet was used for a trade.
   * Updates usage counters, timestamps, and enforces cooldown if needed.
   */
  markUsed(address: string, direction?: TradeDirection): void {
    const state = this.wallets.get(address);
    if (!state) {
      throw new Error(`Wallet ${address} not found in rotation pool`);
    }

    const now = Date.now();

    state.totalTrades++;
    state.tradeTimestamps.push(now);
    state.lastUsedAt = now;

    if (direction === 'buy') {
      state.buyCount++;
    } else if (direction === 'sell') {
      state.sellCount++;
    }

    // Track consecutive uses
    if (this.lastUsedAddress === address) {
      state.consecutiveUses++;
    } else {
      // Reset consecutive counter for previous wallet
      if (this.lastUsedAddress) {
        const prev = this.wallets.get(this.lastUsedAddress);
        if (prev) {
          prev.consecutiveUses = 0;
        }
      }
      state.consecutiveUses = 1;
    }
    this.lastUsedAddress = address;

    // Enforce cooldown if max consecutive uses reached
    if (state.consecutiveUses >= this.config.maxConsecutiveUses) {
      state.cooldownEndsAt = now + this.config.cooldownAfterMaxMs;
      state.consecutiveUses = 0;
    }
  }

  /**
   * Manually set a cooldown on a wallet.
   */
  setCooldown(address: string, durationMs: number): void {
    const state = this.wallets.get(address);
    if (!state) {
      throw new Error(`Wallet ${address} not found in rotation pool`);
    }
    state.cooldownEndsAt = Date.now() + durationMs;
  }

  /**
   * Check whether a wallet is currently on cooldown.
   */
  isOnCooldown(address: string): boolean {
    const state = this.wallets.get(address);
    if (!state) {
      throw new Error(`Wallet ${address} not found in rotation pool`);
    }
    return state.cooldownEndsAt > Date.now();
  }

  /**
   * Return per-wallet usage statistics.
   */
  getUsageStats(): Record<string, WalletUsageStats> {
    const now = Date.now();
    this.pruneExpiredTimestamps(now);

    const result: Record<string, WalletUsageStats> = {};

    for (const [address, state] of this.wallets) {
      const onCooldown = state.cooldownEndsAt > now;
      result[address] = {
        address,
        totalTrades: state.totalTrades,
        tradesInWindow: state.tradeTimestamps.length,
        lastUsedAt: state.lastUsedAt,
        consecutiveUses: state.consecutiveUses,
        onCooldown,
        cooldownEndsAt: onCooldown ? state.cooldownEndsAt : undefined,
        buyCount: state.buyCount,
        sellCount: state.sellCount,
      };
    }

    return result;
  }

  /**
   * Add a new wallet to the rotation pool.
   */
  addWallet(wallet: AgentWallet): void {
    if (this.wallets.has(wallet.address)) {
      throw new Error(`Wallet ${wallet.address} is already in the rotation pool`);
    }
    this.addWalletInternal(wallet);
  }

  /**
   * Remove a wallet from the rotation pool.
   */
  removeWallet(address: string): void {
    if (!this.wallets.has(address)) {
      throw new Error(`Wallet ${address} not found in rotation pool`);
    }
    this.wallets.delete(address);
    this.roundRobinOrder = this.roundRobinOrder.filter((a) => a !== address);

    // Reset round-robin index if it's out of bounds
    if (this.roundRobinIndex >= this.roundRobinOrder.length) {
      this.roundRobinIndex = 0;
    }

    // Clear last-used tracking if removed wallet was the last used
    if (this.lastUsedAddress === address) {
      this.lastUsedAddress = null;
    }
  }

  /**
   * Reset usage counters periodically for all wallets.
   * Clears total trade counts, trade timestamps, and consecutive use counters.
   * Does NOT clear cooldowns — those expire naturally.
   */
  rebalanceUsage(): void {
    for (const state of this.wallets.values()) {
      state.totalTrades = 0;
      state.tradeTimestamps = [];
      state.consecutiveUses = 0;
      state.buyCount = 0;
      state.sellCount = 0;
    }
    this.roundRobinIndex = 0;
    this.lastUsedAddress = null;
  }

  /**
   * Current number of wallets in the pool.
   */
  get size(): number {
    return this.wallets.size;
  }

  // ── Private Helpers ───────────────────────────────────────

  private addWalletInternal(wallet: AgentWallet): void {
    this.wallets.set(wallet.address, {
      wallet,
      totalTrades: 0,
      tradeTimestamps: [],
      lastUsedAt: 0,
      consecutiveUses: 0,
      cooldownEndsAt: 0,
      buyCount: 0,
      sellCount: 0,
      tokenBalance: new BN(0),
    });
    this.roundRobinOrder.push(wallet.address);
  }

  /**
   * Remove trade timestamps outside the tracking window.
   */
  private pruneExpiredTimestamps(now: number): void {
    const cutoff = now - this.config.trackingWindowMs;
    for (const state of this.wallets.values()) {
      state.tradeTimestamps = state.tradeTimestamps.filter((ts) => ts >= cutoff);
    }
  }

  /**
   * Filter wallets eligible for a trade based on:
   *  - Not on cooldown
   *  - Below hourly rate limit
   *  - Won't exceed max consecutive uses (unless it's the only wallet)
   *  - Has sufficient balance for the trade direction
   */
  private getEligibleWallets(direction: TradeDirection, now: number): WalletState[] {
    const eligible: WalletState[] = [];

    for (const state of this.wallets.values()) {
      // Skip wallets on cooldown
      if (state.cooldownEndsAt > now) continue;

      // Enforce hourly rate limit
      if (state.tradeTimestamps.length >= this.config.maxTradesPerWalletPerHour) continue;

      // Smart balance checks
      if (direction === 'buy' && this.config.preferBuyerForBuys) {
        // Wallet needs enough SOL for a buy
        if (state.wallet.balanceLamports.lt(MIN_SOL_FOR_BUY)) continue;
      }
      if (direction === 'sell' && this.config.preferSellerForSells) {
        // Wallet needs tokens to sell
        if (state.tokenBalance.isZero()) continue;
      }

      eligible.push(state);
    }

    // If preference filters excluded everything, fall back to non-cooldown, non-rate-limited wallets
    if (eligible.length === 0) {
      for (const state of this.wallets.values()) {
        if (state.cooldownEndsAt > now) continue;
        if (state.tradeTimestamps.length >= this.config.maxTradesPerWalletPerHour) continue;
        eligible.push(state);
      }
    }

    return eligible;
  }

  /**
   * Round-robin: deterministic cycling through the ordered wallet list.
   * Skips ineligible wallets and wraps around.
   */
  private selectRoundRobin(eligible: WalletState[]): WalletState {
    const eligibleAddresses = new Set(eligible.map((s) => s.wallet.address));

    // Walk from current index until we find an eligible wallet
    const totalWallets = this.roundRobinOrder.length;
    for (let i = 0; i < totalWallets; i++) {
      const idx = (this.roundRobinIndex + i) % totalWallets;
      const address = this.roundRobinOrder[idx];
      if (eligibleAddresses.has(address)) {
        this.roundRobinIndex = (idx + 1) % totalWallets;
        return this.wallets.get(address)!;
      }
    }

    // Fallback (should never reach here since eligible is non-empty)
    return eligible[0];
  }

  /**
   * Random: uniformly random selection among eligible wallets.
   */
  private selectRandom(eligible: WalletState[]): WalletState {
    const index = Math.floor(Math.random() * eligible.length);
    return eligible[index];
  }

  /**
   * Least-used: select the wallet with the fewest trades in the tracking window.
   * Ties broken by longest time since last use.
   */
  private selectLeastUsed(eligible: WalletState[]): WalletState {
    let best = eligible[0];
    for (let i = 1; i < eligible.length; i++) {
      const candidate = eligible[i];
      if (
        candidate.tradeTimestamps.length < best.tradeTimestamps.length ||
        (candidate.tradeTimestamps.length === best.tradeTimestamps.length &&
          candidate.lastUsedAt < best.lastUsedAt)
      ) {
        best = candidate;
      }
    }
    return best;
  }

  /**
   * Weighted-random: random selection biased toward less-used wallets.
   * Uses exponential decay weighting: weight = e^(-tradesInWindow * decayFactor)
   *
   * A wallet with 0 trades has weight 1.0, a wallet with many trades
   * has an exponentially smaller weight.
   */
  private selectWeightedRandom(eligible: WalletState[]): WalletState {
    const decayFactor = 0.5;

    const weights: number[] = eligible.map((state) => {
      return Math.exp(-state.tradeTimestamps.length * decayFactor);
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let random = Math.random() * totalWeight;
    for (let i = 0; i < eligible.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return eligible[i];
      }
    }

    // Floating-point edge case
    return eligible[eligible.length - 1];
  }
}
