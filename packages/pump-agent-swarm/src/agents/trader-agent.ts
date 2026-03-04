/**
 * Trader Agent — Buys and sells tokens on Pump.fun bonding curves
 *
 * Each trader agent:
 * 1. Has its own Solana wallet
 * 2. Follows a trading strategy (interval, size, buy/sell ratio)
 * 3. Executes trades on the bonding curve using the Pump SDK
 * 4. Tracks its own P&L and token balance
 * 5. Communicates state back to the swarm coordinator
 *
 * Multiple trader agents run concurrently, each making independent
 * buy/sell decisions based on the strategy parameters + randomization.
 */

import {
  Connection,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_SDK, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type {
  AgentWallet,
  TradingStrategy,
  TradeOrder,
  TradeResult,
  TradeDirection,
  TraderStats,
} from '../types.js';

// ─── Events ───────────────────────────────────────────────────

interface TraderAgentEvents {
  'trade:submitted': (order: TradeOrder) => void;
  'trade:executed': (result: TradeResult) => void;
  'trade:failed': (order: TradeOrder, error: Error) => void;
  'balance:updated': (sol: number, tokens: number) => void;
  'stopped': (reason: string) => void;
}

// ─── Trader Agent ─────────────────────────────────────────────

export class TraderAgent extends EventEmitter<TraderAgentEvents> {
  readonly id: string;
  readonly wallet: AgentWallet;

  private readonly connection: Connection;
  private readonly strategy: TradingStrategy;
  private onlineSdk: OnlinePumpSdk | null = null;
  private mint: PublicKey | null = null;
  private running = false;
  private tradeTimer: ReturnType<typeof setTimeout> | null = null;

  // Stats tracking
  private stats: TraderStats;
  private tradeHistory: TradeResult[] = [];
  private startedAt = 0;

  constructor(
    id: string,
    wallet: AgentWallet,
    connection: Connection,
    strategy: TradingStrategy,
  ) {
    super();
    this.id = id;
    this.wallet = wallet;
    this.connection = connection;
    this.strategy = strategy;

    this.stats = {
      traderId: id,
      address: wallet.address,
      totalBuys: 0,
      totalSells: 0,
      solSpent: new BN(0),
      solReceived: new BN(0),
      tokensHeld: new BN(0),
    };
  }

  private getOnlineSdk(): OnlinePumpSdk {
    if (!this.onlineSdk) {
      this.onlineSdk = new OnlinePumpSdk(this.connection);
    }
    return this.onlineSdk;
  }

  /**
   * Start the trading loop for a specific token.
   *
   * The agent will trade at random intervals within the strategy's
   * min/max interval range, choosing buy or sell based on the
   * configured buy/sell ratio and current token holdings.
   */
  start(mintAddress: string): void {
    this.mint = new PublicKey(mintAddress);
    this.running = true;
    this.startedAt = Date.now();

    console.log(`[trader:${this.id}] Started trading ${mintAddress}`);
    this.scheduleNextTrade();
  }

  /**
   * Stop the trading loop gracefully.
   */
  stop(reason: string = 'manual'): void {
    this.running = false;
    if (this.tradeTimer) {
      clearTimeout(this.tradeTimer);
      this.tradeTimer = null;
    }
    this.emit('stopped', reason);
    console.log(`[trader:${this.id}] Stopped: ${reason}`);
  }

  /**
   * Execute a single buy order on the bonding curve.
   */
  async buy(solAmountLamports: BN, slippageBps: number): Promise<TradeResult> {
    if (!this.mint) throw new Error('No mint set — call start() first');

    const order: TradeOrder = {
      id: uuid(),
      traderId: this.id,
      mint: this.mint.toBase58(),
      direction: 'buy',
      amount: solAmountLamports,
      slippageBps,
      priorityFeeMicroLamports: this.strategy.priorityFeeMicroLamports,
    };

    this.emit('trade:submitted', order);

    try {
      // Fetch on-chain state required by buyInstructions
      const sdk = this.getOnlineSdk();
      const global = await sdk.fetchGlobal();
      const buyState = await sdk.fetchBuyState(
        this.mint,
        this.wallet.keypair.publicKey,
        TOKEN_PROGRAM_ID,
      );

      const buyIxs = await PUMP_SDK.buyInstructions({
        global,
        bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
        bondingCurve: buyState.bondingCurve,
        associatedUserAccountInfo: buyState.associatedUserAccountInfo,
        mint: this.mint,
        user: this.wallet.keypair.publicKey,
        amount: new BN(0),
        solAmount: solAmountLamports,
        slippage: slippageBps / 100,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      const computeIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.strategy.priorityFeeMicroLamports,
        }),
      ];

      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: this.wallet.keypair.publicKey });
      tx.add(...computeIxs, ...buyIxs);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.wallet.keypair],
        { commitment: 'confirmed', maxRetries: 3 },
      );

      // Fetch token balance after buy to determine tokens received
      const ata = await getAssociatedTokenAddress(this.mint, this.wallet.keypair.publicKey);
      let tokensReceived = new BN(0);
      try {
        const tokenAccount = await getAccount(this.connection, ata);
        const newBalance = new BN(tokenAccount.amount.toString());
        tokensReceived = newBalance.sub(this.stats.tokensHeld);
        this.stats.tokensHeld = newBalance;
      } catch {
        // ATA might not exist yet on first buy
      }

      const result: TradeResult = {
        order,
        signature,
        amountOut: tokensReceived,
        executionPrice: tokensReceived.gtn(0)
          ? solAmountLamports.mul(new BN(LAMPORTS_PER_SOL)).div(tokensReceived)
          : new BN(0),
        feesPaid: new BN(5000), // Estimate tx fee
        success: true,
        executedAt: Date.now(),
      };

      // Update stats
      this.stats.totalBuys++;
      this.stats.solSpent = this.stats.solSpent.add(solAmountLamports);
      this.stats.lastTradeAt = result.executedAt;
      this.tradeHistory.push(result);

      this.emit('trade:executed', result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const failedResult: TradeResult = {
        order,
        signature: '',
        amountOut: new BN(0),
        executionPrice: new BN(0),
        feesPaid: new BN(0),
        success: false,
        error: err.message,
        executedAt: Date.now(),
      };
      this.tradeHistory.push(failedResult);
      this.emit('trade:failed', order, err);
      return failedResult;
    }
  }

  /**
   * Execute a single sell order on the bonding curve.
   */
  async sell(tokenAmount: BN, slippageBps: number): Promise<TradeResult> {
    if (!this.mint) throw new Error('No mint set — call start() first');

    const order: TradeOrder = {
      id: uuid(),
      traderId: this.id,
      mint: this.mint.toBase58(),
      direction: 'sell',
      amount: tokenAmount,
      slippageBps,
      priorityFeeMicroLamports: this.strategy.priorityFeeMicroLamports,
    };

    this.emit('trade:submitted', order);

    try {
      // Fetch on-chain state required by sellInstructions
      const sdk = this.getOnlineSdk();
      const global = await sdk.fetchGlobal();
      const sellState = await sdk.fetchSellState(
        this.mint,
        this.wallet.keypair.publicKey,
        TOKEN_PROGRAM_ID,
      );

      const sellIxs = await PUMP_SDK.sellInstructions({
        global,
        bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
        bondingCurve: sellState.bondingCurve,
        mint: this.mint,
        user: this.wallet.keypair.publicKey,
        amount: tokenAmount,
        solAmount: new BN(0),
        slippage: slippageBps / 100,
        tokenProgram: TOKEN_PROGRAM_ID,
        mayhemMode: false,
      });

      const computeIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.strategy.priorityFeeMicroLamports,
        }),
      ];

      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: this.wallet.keypair.publicKey });
      tx.add(...computeIxs, ...sellIxs);

      // Get SOL balance before sell to calculate SOL received
      const solBefore = await this.connection.getBalance(this.wallet.keypair.publicKey);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.wallet.keypair],
        { commitment: 'confirmed', maxRetries: 3 },
      );

      const solAfter = await this.connection.getBalance(this.wallet.keypair.publicKey);
      const solReceived = new BN(Math.max(0, solAfter - solBefore));

      // Update token balance
      const ata = await getAssociatedTokenAddress(this.mint, this.wallet.keypair.publicKey);
      try {
        const tokenAccount = await getAccount(this.connection, ata);
        this.stats.tokensHeld = new BN(tokenAccount.amount.toString());
      } catch {
        this.stats.tokensHeld = new BN(0);
      }

      const result: TradeResult = {
        order,
        signature,
        amountOut: solReceived,
        executionPrice: tokenAmount.gtn(0)
          ? solReceived.mul(new BN(LAMPORTS_PER_SOL)).div(tokenAmount)
          : new BN(0),
        feesPaid: new BN(5000),
        success: true,
        executedAt: Date.now(),
      };

      // Update stats
      this.stats.totalSells++;
      this.stats.solReceived = this.stats.solReceived.add(solReceived);
      this.stats.lastTradeAt = result.executedAt;
      this.tradeHistory.push(result);

      this.emit('trade:executed', result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const failedResult: TradeResult = {
        order,
        signature: '',
        amountOut: new BN(0),
        executionPrice: new BN(0),
        feesPaid: new BN(0),
        success: false,
        error: err.message,
        executedAt: Date.now(),
      };
      this.tradeHistory.push(failedResult);
      this.emit('trade:failed', order, err);
      return failedResult;
    }
  }

  // ─── Private: Trading Loop ──────────────────────────────────

  private scheduleNextTrade(): void {
    if (!this.running) return;

    // Check stopping conditions
    if (this.shouldStop()) return;

    // Random interval between min and max
    const intervalMs =
      (this.strategy.minIntervalSeconds +
        Math.random() * (this.strategy.maxIntervalSeconds - this.strategy.minIntervalSeconds)) *
      1000;

    this.tradeTimer = setTimeout(async () => {
      if (!this.running) return;

      try {
        await this.executeTradeCycle();
      } catch (error) {
        console.error(`[trader:${this.id}] Trade cycle error:`, error);
      }

      // Schedule next
      this.scheduleNextTrade();
    }, intervalMs);
  }

  private async executeTradeCycle(): Promise<void> {
    // Decide direction based on buy/sell ratio + current holdings
    const direction = this.decideDirection();
    const slippageBps = 500; // 5% default slippage

    if (direction === 'buy') {
      // Random trade size between min and max
      const size = this.randomTradeSize();
      await this.buy(size, slippageBps);
    } else {
      // Sell a portion of holdings
      if (this.stats.tokensHeld.gtn(0)) {
        // Sell 10-50% of holdings
        const sellFraction = 0.1 + Math.random() * 0.4;
        const sellAmount = this.stats.tokensHeld
          .mul(new BN(Math.floor(sellFraction * 10000)))
          .div(new BN(10000));

        if (sellAmount.gtn(0)) {
          await this.sell(sellAmount, slippageBps);
        }
      } else {
        // No tokens to sell, buy instead
        const size = this.randomTradeSize();
        await this.buy(size, slippageBps);
      }
    }
  }

  private decideDirection(): TradeDirection {
    // If we have no tokens, always buy
    if (this.stats.tokensHeld.isZero()) return 'buy';

    // Use buy/sell ratio as probability
    // ratio > 1 means more buys, ratio < 1 means more sells
    const buyProbability = this.strategy.buySellRatio / (1 + this.strategy.buySellRatio);
    return Math.random() < buyProbability ? 'buy' : 'sell';
  }

  private randomTradeSize(): BN {
    const min = this.strategy.minTradeSizeLamports.toNumber();
    const max = this.strategy.maxTradeSizeLamports.toNumber();
    const size = min + Math.random() * (max - min);
    return new BN(Math.floor(size));
  }

  private shouldStop(): boolean {
    // Max trades reached
    if (this.strategy.maxTrades && this.tradeHistory.length >= this.strategy.maxTrades) {
      this.stop('max-trades-reached');
      return true;
    }

    // Max duration reached
    if (this.strategy.maxDurationSeconds) {
      const elapsed = (Date.now() - this.startedAt) / 1000;
      if (elapsed >= this.strategy.maxDurationSeconds) {
        this.stop('max-duration-reached');
        return true;
      }
    }

    // Budget exhausted
    if (this.stats.solSpent.gte(this.strategy.maxTotalBudgetLamports)) {
      this.stop('budget-exhausted');
      return true;
    }

    return false;
  }

  // ─── Public: Stats & State ──────────────────────────────────

  getStats(): TraderStats {
    return { ...this.stats };
  }

  getTradeHistory(): TradeResult[] {
    return [...this.tradeHistory];
  }

  getNetPnl(): BN {
    return this.stats.solReceived.sub(this.stats.solSpent);
  }

  isRunning(): boolean {
    return this.running;
  }
}
