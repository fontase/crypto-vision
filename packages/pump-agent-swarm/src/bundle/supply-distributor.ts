/**
 * Supply Distributor — Post-launch token redistribution
 *
 * After a bundle buy acquires tokens into specific wallets, this module
 * redistributes tokens across all agent wallets so no single wallet holds
 * an outsized percentage. Supports multiple distribution strategies, ATA
 * creation, batched transactions, staggered transfers with configurable
 * delays, and Gini coefficient calculation for distribution analysis.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import BN from 'bn.js';
import { v4 as uuidv4 } from 'uuid';

import type { AgentWallet } from '../types.js';
import { SwarmEventBus } from '../infra/event-bus.js';
import { WalletVault } from '../wallet-manager.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Types ────────────────────────────────────────────────────

export type DistributionStrategy =
  | 'equal'
  | 'weighted'
  | 'random'
  | 'pyramid'
  | 'gaussian';

export interface DistributionConfig {
  strategy: DistributionStrategy;
  /** Max percentage any single wallet should hold */
  maxPerWalletPercent: number;
  /** Whether to stagger transfers for anti-detection */
  staggerTransfers: boolean;
  /** Delay between transfers (ms) */
  transferDelayMs: { min: number; max: number };
  /** Whether to add random noise to amounts */
  addNoise: boolean;
  /** Noise factor (0–0.3, percent deviation from target) */
  noiseFactor: number;
}

export interface DistributionPlan {
  id: string;
  mint: string;
  transfers: Array<{
    from: string;
    to: string;
    amount: BN;
    createAta: boolean;
    delayMs: number;
  }>;
  totalTokensToMove: BN;
  estimatedFees: BN;
  estimatedTimeMs: number;
}

export interface DistributionResult {
  planId: string;
  status: 'pending' | 'executing' | 'completed' | 'partial' | 'failed';
  successfulTransfers: number;
  failedTransfers: number;
  signatures: string[];
  errors: Array<{ transferIndex: number; error: string }>;
  startedAt: number;
  completedAt?: number;
}

export interface TokenDistribution {
  mint: string;
  totalSupply: BN;
  wallets: Array<{
    address: string;
    agentId: string;
    balance: BN;
    percentOfSupply: number;
    percentOfSwarmHoldings: number;
  }>;
  giniCoefficient: number;
  topWalletPercent: number;
  medianBalance: BN;
}

export interface DistributionAnalysis {
  isHealthy: boolean;
  giniCoefficient: number;
  topWalletPercent: number;
  medianBalance: BN;
  meanBalance: BN;
  stdDeviation: number;
  walletsAboveMax: number;
  walletsWithZero: number;
  recommendations: string[];
}

// ─── Constants ────────────────────────────────────────────────

/** Rent-exempt minimum for a token account (~0.00203 SOL) */
const ATA_RENT_LAMPORTS = new BN(2_039_280);

/** Max instructions per transaction (conservative) */
const MAX_INSTRUCTIONS_PER_TX = 6;

/** Default role weights for the 'weighted' strategy */
const ROLE_WEIGHTS: Record<string, number> = {
  market_maker: 3.0,
  accumulator: 2.5,
  trader: 1.5,
  volume_bot: 1.0,
  sniper: 0.8,
  creator: 0.5,
  exit_manager: 0.3,
  analyst: 0.1,
  sentinel: 0.1,
  scanner: 0.1,
  narrator: 0.1,
};

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random integer in [min, max] inclusive.
 */
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Box-Muller transform: generate a normally-distributed random number
 * with given mean and stddev.
 */
function gaussianRandom(mean: number, stddev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
  return mean + stddev * z;
}

/**
 * Apply noise to an amount based on the noise factor.
 * The noise factor (0–0.3) determines the max percent deviation.
 */
function applyNoise(amount: BN, noiseFactor: number): BN {
  if (noiseFactor <= 0) return amount;
  const deviation = (Math.random() * 2 - 1) * noiseFactor;
  const multiplier = 1 + deviation;
  const noisy = amount.toNumber() * multiplier;
  return new BN(Math.max(1, Math.round(noisy)));
}

/**
 * Calculate the Gini coefficient for an array of balances.
 * Returns a value between 0 (perfect equality) and 1 (maximum inequality).
 */
function calculateGini(balances: number[]): number {
  const n = balances.length;
  if (n === 0) return 0;

  const sorted = [...balances].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  if (sum === 0) return 0;

  let numerator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (2 * (i + 1) - n - 1) * sorted[i];
  }

  return numerator / (n * sum);
}

// ─── Supply Distributor ───────────────────────────────────────

export class SupplyDistributor {
  private readonly connection: Connection;
  private readonly walletVault: WalletVault;
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;
  private readonly results: Map<string, DistributionResult> = new Map();

  constructor(
    connection: Connection,
    walletVault: WalletVault,
    eventBus: SwarmEventBus,
  ) {
    this.connection = connection;
    this.walletVault = walletVault;
    this.eventBus = eventBus;
    this.logger = new SwarmLogger({
      level: 'info',
      agentId: 'supply-distributor',
      category: 'bundle',
    });
  }

  // ─── Plan Distribution ──────────────────────────────────

  /**
   * Plan a token distribution from source wallets to target wallets
   * according to the given strategy.
   */
  async planDistribution(
    mint: string,
    sourceWallets: AgentWallet[],
    targetWallets: AgentWallet[],
    strategy: DistributionStrategy,
    config: DistributionConfig = {
      strategy,
      maxPerWalletPercent: 10,
      staggerTransfers: true,
      transferDelayMs: { min: 500, max: 3000 },
      addNoise: true,
      noiseFactor: 0.15,
    },
  ): Promise<DistributionPlan> {
    const mintPubkey = new PublicKey(mint);

    // Fetch current balances for all source wallets
    const sourceBalances = await this.fetchTokenBalances(mintPubkey, sourceWallets);
    const totalAvailable = sourceBalances.reduce(
      (sum, sb) => sum.add(sb.balance),
      new BN(0),
    );

    if (totalAvailable.isZero()) {
      throw new Error(`[SupplyDistributor] No tokens available in source wallets for mint ${mint}`);
    }

    // Calculate target amounts per wallet based on strategy
    const targetAmounts = this.calculateTargetAmounts(
      totalAvailable,
      targetWallets,
      config,
    );

    // Determine which target wallets need ATA creation
    const ataStatus = await this.checkAtaStatus(mintPubkey, targetWallets);

    // Build transfer list, draining from source wallets in order
    const transfers: DistributionPlan['transfers'] = [];
    const sourceRemaining = sourceBalances.map((sb) => ({
      address: sb.address,
      remaining: sb.balance.clone(),
    }));

    let cumulativeDelay = 0;

    for (let i = 0; i < targetWallets.length; i++) {
      const target = targetWallets[i];
      let amountNeeded = targetAmounts[i];

      if (amountNeeded.isZero()) continue;

      // Check if this wallet is also a source — skip self-transfer
      const selfSourceIdx = sourceRemaining.findIndex(
        (s) => s.address === target.address,
      );
      if (selfSourceIdx >= 0) {
        // Reduce the needed amount by what the wallet already holds
        const alreadyHeld = sourceBalances.find(
          (sb) => sb.address === target.address,
        );
        if (alreadyHeld && alreadyHeld.balance.gte(amountNeeded)) {
          continue; // Already holds enough
        }
        if (alreadyHeld) {
          amountNeeded = amountNeeded.sub(alreadyHeld.balance);
        }
      }

      // Drain from sources
      for (const source of sourceRemaining) {
        if (amountNeeded.isZero()) break;
        if (source.remaining.isZero()) continue;
        if (source.address === target.address) continue;

        const transferAmount = BN.min(source.remaining, amountNeeded);

        const delayMs = config.staggerTransfers
          ? randomInRange(config.transferDelayMs.min, config.transferDelayMs.max)
          : 0;
        cumulativeDelay += delayMs;

        transfers.push({
          from: source.address,
          to: target.address,
          amount: transferAmount,
          createAta: ataStatus.get(target.address) === false,
          delayMs,
        });

        // Mark ATA as created for subsequent transfers to same target
        ataStatus.set(target.address, true);

        source.remaining = source.remaining.sub(transferAmount);
        amountNeeded = amountNeeded.sub(transferAmount);
      }
    }

    const totalTokensToMove = transfers.reduce(
      (sum, t) => sum.add(t.amount),
      new BN(0),
    );

    const ataCreations = transfers.filter((t) => t.createAta).length;
    // ~5000 lamports per signature + ATA rent for creations
    const estimatedFees = new BN(5000 * transfers.length).add(
      ATA_RENT_LAMPORTS.muln(ataCreations),
    );

    const plan: DistributionPlan = {
      id: uuidv4(),
      mint,
      transfers,
      totalTokensToMove,
      estimatedFees,
      estimatedTimeMs: cumulativeDelay + transfers.length * 500,
    };

    this.logger.info('Distribution plan created', {
      planId: plan.id,
      mint,
      strategy: config.strategy,
      transferCount: transfers.length,
      totalTokensToMove: totalTokensToMove.toString(),
      estimatedTimeMs: plan.estimatedTimeMs,
    });

    this.eventBus.emit({
      type: 'distribution:planned',
      category: 'bundle',
      source: 'supply-distributor',
      payload: {
        planId: plan.id,
        mint,
        strategy: config.strategy,
        transferCount: transfers.length,
      },
    });

    return plan;
  }

  // ─── Execute Distribution ───────────────────────────────

  /**
   * Execute a distribution plan, sending SPL token transfers
   * with optional staggered delays.
   */
  async executeDistribution(plan: DistributionPlan): Promise<DistributionResult> {
    const result: DistributionResult = {
      planId: plan.id,
      status: 'executing',
      successfulTransfers: 0,
      failedTransfers: 0,
      signatures: [],
      errors: [],
      startedAt: Date.now(),
    };

    this.results.set(plan.id, result);

    this.logger.info('Executing distribution plan', {
      planId: plan.id,
      transferCount: plan.transfers.length,
    });

    this.eventBus.emit({
      type: 'distribution:started',
      category: 'bundle',
      source: 'supply-distributor',
      payload: { planId: plan.id },
    });

    const mintPubkey = new PublicKey(plan.mint);

    // Group transfers that can be batched (same `from` wallet, consecutive, no delay between)
    const batches = this.batchTransfers(plan);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];

      // Apply delay before the batch (use the first transfer's delay)
      if (batch.delayMs > 0) {
        await sleep(batch.delayMs);
      }

      try {
        const signature = await this.executeBatch(
          mintPubkey,
          batch.from,
          batch.transfers,
        );

        result.signatures.push(signature);
        result.successfulTransfers += batch.transfers.length;

        this.logger.debug('Batch executed', {
          planId: plan.id,
          batchIndex: batchIdx,
          transferCount: batch.transfers.length,
          signature,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.failedTransfers += batch.transfers.length;

        for (const transfer of batch.transfers) {
          result.errors.push({
            transferIndex: transfer.originalIndex,
            error: errorMessage,
          });
        }

        this.logger.error('Batch failed', {
          planId: plan.id,
          batchIndex: batchIdx,
          error: errorMessage,
        });
      }
    }

    result.completedAt = Date.now();
    result.status =
      result.failedTransfers === 0
        ? 'completed'
        : result.successfulTransfers === 0
          ? 'failed'
          : 'partial';

    this.results.set(plan.id, result);

    this.logger.info('Distribution completed', {
      planId: plan.id,
      status: result.status,
      successful: result.successfulTransfers,
      failed: result.failedTransfers,
      durationMs: result.completedAt - result.startedAt,
    });

    this.eventBus.emit({
      type: `distribution:${result.status}`,
      category: 'bundle',
      source: 'supply-distributor',
      payload: {
        planId: plan.id,
        status: result.status,
        successful: result.successfulTransfers,
        failed: result.failedTransfers,
        signatures: result.signatures,
      },
    });

    return result;
  }

  // ─── Status ─────────────────────────────────────────────

  /**
   * Get the result of a previously executed distribution plan.
   */
  getDistributionStatus(planId: string): DistributionResult | undefined {
    return this.results.get(planId);
  }

  // ─── Current Distribution ───────────────────────────────

  /**
   * Fetch current token distribution across wallets.
   */
  async getCurrentDistribution(
    mint: string,
    wallets: AgentWallet[],
  ): Promise<TokenDistribution> {
    const mintPubkey = new PublicKey(mint);
    const balances = await this.fetchTokenBalances(mintPubkey, wallets);

    const totalHeld = balances.reduce((sum, b) => sum.add(b.balance), new BN(0));

    // Fetch total supply from mint account
    const mintInfo = await this.connection.getAccountInfo(mintPubkey);
    let totalSupply: BN;

    if (mintInfo?.data && mintInfo.data.length >= 44) {
      // SPL Token mint layout: supply is at offset 36, 8 bytes LE u64
      const supplyBytes = mintInfo.data.subarray(36, 44);
      totalSupply = new BN(supplyBytes, 'le');
    } else {
      // Fallback: use held amount as supply estimate
      totalSupply = totalHeld;
    }

    const totalHeldNum = totalHeld.toNumber();
    const totalSupplyNum = totalSupply.isZero() ? 1 : totalSupply.toNumber();

    const walletEntries = balances.map((b) => ({
      address: b.address,
      agentId: b.agentId,
      balance: b.balance,
      percentOfSupply: (b.balance.toNumber() / totalSupplyNum) * 100,
      percentOfSwarmHoldings:
        totalHeldNum === 0 ? 0 : (b.balance.toNumber() / totalHeldNum) * 100,
    }));

    const balanceNums = walletEntries.map((w) => w.balance.toNumber());
    const sorted = [...balanceNums].sort((a, b) => a - b);

    const medianBalance =
      sorted.length === 0
        ? new BN(0)
        : sorted.length % 2 === 1
          ? new BN(sorted[Math.floor(sorted.length / 2)])
          : new BN(
              Math.floor(
                (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
              ),
            );

    const topWalletPercent =
      walletEntries.length === 0
        ? 0
        : Math.max(...walletEntries.map((w) => w.percentOfSwarmHoldings));

    return {
      mint,
      totalSupply,
      wallets: walletEntries,
      giniCoefficient: calculateGini(balanceNums),
      topWalletPercent,
      medianBalance,
    };
  }

  // ─── Analysis ───────────────────────────────────────────

  /**
   * Analyze a token distribution and provide recommendations.
   */
  analyzeDistribution(
    distribution: TokenDistribution,
    maxPerWalletPercent = 10,
  ): DistributionAnalysis {
    const balances = distribution.wallets.map((w) => w.balance.toNumber());
    const n = balances.length;

    if (n === 0) {
      return {
        isHealthy: false,
        giniCoefficient: 0,
        topWalletPercent: 0,
        medianBalance: new BN(0),
        meanBalance: new BN(0),
        stdDeviation: 0,
        walletsAboveMax: 0,
        walletsWithZero: 0,
        recommendations: ['No wallets in the distribution — add wallets first.'],
      };
    }

    const sum = balances.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const variance = balances.reduce((acc, b) => acc + (b - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    const walletsAboveMax = distribution.wallets.filter(
      (w) => w.percentOfSwarmHoldings > maxPerWalletPercent,
    ).length;

    const walletsWithZero = balances.filter((b) => b === 0).length;

    const recommendations: string[] = [];

    if (distribution.giniCoefficient > 0.6) {
      recommendations.push(
        `High Gini coefficient (${distribution.giniCoefficient.toFixed(3)}) — distribution is very unequal. Consider redistribution.`,
      );
    } else if (distribution.giniCoefficient > 0.4) {
      recommendations.push(
        `Moderate Gini coefficient (${distribution.giniCoefficient.toFixed(3)}) — some inequality present. A redistribution pass would improve organic appearance.`,
      );
    }

    if (distribution.topWalletPercent > maxPerWalletPercent) {
      recommendations.push(
        `Top wallet holds ${distribution.topWalletPercent.toFixed(1)}% of swarm holdings — exceeds ${maxPerWalletPercent}% limit. Spread tokens to avoid concentration.`,
      );
    }

    if (walletsAboveMax > 0) {
      recommendations.push(
        `${walletsAboveMax} wallet(s) exceed the ${maxPerWalletPercent}% per-wallet limit.`,
      );
    }

    if (walletsWithZero > 0) {
      recommendations.push(
        `${walletsWithZero} wallet(s) hold zero tokens — consider including them in the next distribution.`,
      );
    }

    if (stdDev / (mean || 1) > 1.0) {
      recommendations.push(
        'High coefficient of variation — balance spread is very wide. Use "equal" or "gaussian" strategy for more uniformity.',
      );
    }

    const isHealthy =
      distribution.giniCoefficient < 0.4 &&
      distribution.topWalletPercent <= maxPerWalletPercent &&
      walletsAboveMax === 0;

    return {
      isHealthy,
      giniCoefficient: distribution.giniCoefficient,
      topWalletPercent: distribution.topWalletPercent,
      medianBalance: distribution.medianBalance,
      meanBalance: new BN(Math.round(mean)),
      stdDeviation: stdDev,
      walletsAboveMax,
      walletsWithZero,
      recommendations,
    };
  }

  // ─── Strategy Implementations ───────────────────────────

  /**
   * Calculate target amounts for each target wallet based on distribution strategy.
   */
  private calculateTargetAmounts(
    totalAvailable: BN,
    targetWallets: AgentWallet[],
    config: DistributionConfig,
  ): BN[] {
    const n = targetWallets.length;
    if (n === 0) return [];

    let raw: number[];

    switch (config.strategy) {
      case 'equal':
        raw = this.strategyEqual(n);
        break;
      case 'weighted':
        raw = this.strategyWeighted(targetWallets);
        break;
      case 'random':
        raw = this.strategyRandom(n);
        break;
      case 'pyramid':
        raw = this.strategyPyramid(n);
        break;
      case 'gaussian':
        raw = this.strategyGaussian(n);
        break;
      default: {
        const _: never = config.strategy;
        throw new Error(`Unknown distribution strategy: ${_ as string}`);
      }
    }

    // Normalize to sum = 1
    const rawSum = raw.reduce((a, b) => a + b, 0);
    const normalized = raw.map((r) => r / (rawSum || 1));

    // Enforce maxPerWalletPercent cap
    const maxFraction = config.maxPerWalletPercent / 100;
    const capped = this.capDistribution(normalized, maxFraction);

    // Convert fractions to token amounts
    const totalNum = totalAvailable.toNumber();
    let amounts = capped.map((frac) => {
      let amount = new BN(Math.floor(frac * totalNum));
      if (config.addNoise) {
        amount = applyNoise(amount, config.noiseFactor);
      }
      return amount;
    });

    // Adjust to not exceed total available
    const amountSum = amounts.reduce((s, a) => s.add(a), new BN(0));
    if (amountSum.gt(totalAvailable)) {
      const excess = amountSum.sub(totalAvailable);
      // Reduce from the largest allocation
      const maxIdx = amounts.reduce(
        (mi, a, i) => (a.gt(amounts[mi]) ? i : mi),
        0,
      );
      amounts[maxIdx] = amounts[maxIdx].sub(excess);
      if (amounts[maxIdx].isNeg()) {
        amounts[maxIdx] = new BN(0);
      }
    }

    return amounts;
  }

  private strategyEqual(n: number): number[] {
    return new Array(n).fill(1);
  }

  private strategyWeighted(wallets: AgentWallet[]): number[] {
    return wallets.map((w) => {
      // Infer role from label prefix
      const label = w.label.toLowerCase();
      for (const [role, weight] of Object.entries(ROLE_WEIGHTS)) {
        if (label.includes(role.replace('_', '-')) || label.includes(role.replace('_', ''))) {
          return weight;
        }
      }
      return 1.0; // default weight
    });
  }

  private strategyRandom(n: number): number[] {
    return Array.from({ length: n }, () => Math.random());
  }

  private strategyPyramid(n: number): number[] {
    // First few wallets get progressively more; the rest get less
    const weights: number[] = [];
    for (let i = 0; i < n; i++) {
      // Exponentially decreasing: first wallet gets most
      weights.push(Math.pow(0.7, i));
    }
    // Shuffle to avoid the first wallet always being the largest
    // Use Fisher-Yates shuffle
    for (let i = weights.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weights[i], weights[j]] = [weights[j], weights[i]];
    }
    return weights;
  }

  private strategyGaussian(n: number): number[] {
    const mean = 1;
    const stddev = 0.3;
    return Array.from({ length: n }, () =>
      Math.max(0.01, gaussianRandom(mean, stddev)),
    );
  }

  /**
   * Cap each element so no wallet exceeds maxFraction of the total.
   * Redistributes excess proportionally among uncapped wallets.
   */
  private capDistribution(fractions: number[], maxFraction: number): number[] {
    const result = [...fractions];
    let iterations = 0;
    const maxIterations = 20;

    while (iterations < maxIterations) {
      const excess = result.reduce(
        (acc, f) => acc + Math.max(0, f - maxFraction),
        0,
      );
      if (excess <= 1e-10) break;

      const uncappedIndices = result
        .map((f, i) => (f < maxFraction ? i : -1))
        .filter((i) => i >= 0);

      if (uncappedIndices.length === 0) {
        // All at cap — distribute evenly
        const even = 1 / result.length;
        return result.map(() => Math.min(even, maxFraction));
      }

      const uncappedSum = uncappedIndices.reduce((s, i) => s + result[i], 0);

      for (let i = 0; i < result.length; i++) {
        if (result[i] > maxFraction) {
          result[i] = maxFraction;
        }
      }

      // Redistribute excess proportionally among uncapped
      for (const idx of uncappedIndices) {
        const share = uncappedSum > 0 ? result[idx] / uncappedSum : 1 / uncappedIndices.length;
        result[idx] += excess * share;
      }

      iterations++;
    }

    return result;
  }

  // ─── Token Balance Fetching ─────────────────────────────

  private async fetchTokenBalances(
    mint: PublicKey,
    wallets: AgentWallet[],
  ): Promise<Array<{ address: string; agentId: string; balance: BN }>> {
    const results: Array<{ address: string; agentId: string; balance: BN }> = [];

    // Compute ATAs and batch-fetch
    const ataAddresses: PublicKey[] = [];
    for (const wallet of wallets) {
      const ata = await getAssociatedTokenAddress(
        mint,
        wallet.keypair.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      ataAddresses.push(ata);
    }

    const accountInfos = await this.connection.getMultipleAccountsInfo(ataAddresses);

    for (let i = 0; i < wallets.length; i++) {
      const info = accountInfos[i];
      let balance = new BN(0);

      if (info?.data && info.data.length >= 72) {
        // SPL Token account layout: amount is at offset 64, 8 bytes LE u64
        const amountBytes = info.data.subarray(64, 72);
        balance = new BN(amountBytes, 'le');
      }

      results.push({
        address: wallets[i].address,
        agentId: wallets[i].label,
        balance,
      });
    }

    return results;
  }

  /**
   * Check which target wallets have existing ATAs for the given mint.
   */
  private async checkAtaStatus(
    mint: PublicKey,
    wallets: AgentWallet[],
  ): Promise<Map<string, boolean>> {
    const statusMap = new Map<string, boolean>();
    const ataAddresses: PublicKey[] = [];

    for (const wallet of wallets) {
      const ata = await getAssociatedTokenAddress(
        mint,
        wallet.keypair.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      ataAddresses.push(ata);
    }

    const accountInfos = await this.connection.getMultipleAccountsInfo(ataAddresses);

    for (let i = 0; i < wallets.length; i++) {
      statusMap.set(wallets[i].address, accountInfos[i] !== null);
    }

    return statusMap;
  }

  // ─── Transaction Batching ───────────────────────────────

  /**
   * Group transfers into batches by source wallet.
   * Consecutive transfers from the same wallet with no delay
   * can be combined into a single transaction.
   */
  private batchTransfers(
    plan: DistributionPlan,
  ): Array<{
    from: string;
    delayMs: number;
    transfers: Array<{
      originalIndex: number;
      to: string;
      amount: BN;
      createAta: boolean;
    }>;
  }> {
    const batches: Array<{
      from: string;
      delayMs: number;
      transfers: Array<{
        originalIndex: number;
        to: string;
        amount: BN;
        createAta: boolean;
      }>;
    }> = [];

    let currentBatch: (typeof batches)[0] | undefined;

    for (let i = 0; i < plan.transfers.length; i++) {
      const transfer = plan.transfers[i];

      // Instructions per transfer: 1 for transfer, +1 if createAta
      const ixCount = transfer.createAta ? 2 : 1;

      const canAppend =
        currentBatch &&
        currentBatch.from === transfer.from &&
        transfer.delayMs === 0 &&
        currentBatch.transfers.reduce(
          (sum, t) => sum + (t.createAta ? 2 : 1),
          0,
        ) +
          ixCount <=
          MAX_INSTRUCTIONS_PER_TX;

      if (canAppend && currentBatch) {
        currentBatch.transfers.push({
          originalIndex: i,
          to: transfer.to,
          amount: transfer.amount,
          createAta: transfer.createAta,
        });
      } else {
        currentBatch = {
          from: transfer.from,
          delayMs: transfer.delayMs,
          transfers: [
            {
              originalIndex: i,
              to: transfer.to,
              amount: transfer.amount,
              createAta: transfer.createAta,
            },
          ],
        };
        batches.push(currentBatch);
      }
    }

    return batches;
  }

  /**
   * Execute a batch of transfers from a single source wallet.
   * Creates ATAs as needed and sends one transaction.
   */
  private async executeBatch(
    mint: PublicKey,
    fromAddress: string,
    transfers: Array<{
      originalIndex: number;
      to: string;
      amount: BN;
      createAta: boolean;
    }>,
  ): Promise<string> {
    // Find the source wallet's keypair from the vault
    const fromPubkey = new PublicKey(fromAddress);
    const fromKeypair = this.resolveKeypair(fromAddress);

    const fromAta = await getAssociatedTokenAddress(
      mint,
      fromPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const instructions: TransactionInstruction[] = [];

    for (const transfer of transfers) {
      const toPubkey = new PublicKey(transfer.to);
      const toAta = await getAssociatedTokenAddress(
        mint,
        toPubkey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      // Create ATA if needed
      if (transfer.createAta) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            fromPubkey, // payer
            toAta,
            toPubkey,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
      }

      // SPL Token transfer
      instructions.push(
        createTransferInstruction(
          fromAta,
          toAta,
          fromPubkey, // owner/authority
          BigInt(transfer.amount.toString()),
          [],
          TOKEN_PROGRAM_ID,
        ),
      );
    }

    const tx = new Transaction().add(...instructions);

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = fromPubkey;

    tx.sign(fromKeypair);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await this.connection.confirmTransaction(signature, 'confirmed');

    return signature;
  }

  /**
   * Resolve a wallet address to its Keypair via the WalletVault.
   * Falls back to iterating all assignments.
   */
  private resolveKeypair(address: string): import('@solana/web3.js').Keypair {
    // The WalletVault tracks assignments — iterate to find the keypair
    const allWallets = this.walletVault.getAllWallets();
    const match = allWallets.find((w) => w.address === address);
    if (match) return match.keypair;

    throw new Error(
      `[SupplyDistributor] Cannot resolve keypair for address ${address}. Wallet not found in vault.`,
    );
  }
}
