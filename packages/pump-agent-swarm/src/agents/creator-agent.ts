/**
 * Creator Agent — Mints tokens on Pump.fun bonding curves
 *
 * This agent:
 * 1. Creates a new token using createV2Instruction
 * 2. Optionally executes a dev buy atomically with creation
 * 3. Optionally bundles additional wallet buys in the same block
 * 4. Reports the mint address + bonding curve to the swarm coordinator
 *
 * Uses @pump-fun/pump-sdk for all on-chain operations.
 */

import {
  Connection,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_SDK, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { EventEmitter } from 'eventemitter3';
import type {
  AgentWallet,
  TokenConfig,
  BundleBuyConfig,
  MintResult,
  BondingCurveState,
} from '../types.js';

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
  private readonly onlineSdk: OnlinePumpSdk;

  constructor(
    rpcUrl: string,
    wallet: AgentWallet,
  ) {
    super();
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.wallet = wallet;
    this.onlineSdk = new OnlinePumpSdk(this.connection);
  }

  /**
   * Create a new token on Pump.fun with an atomic dev buy.
   *
   * The transaction includes:
   * 1. Compute budget instruction (priority fee)
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

    const mintKeypair = Keypair.generate();
    const creatorPubkey = this.wallet.keypair.publicKey;

    try {
      // Compute budget for priority
      const computeIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      ];

      // Build create instructions — use createV2AndBuyInstructions for atomic dev buy
      let createIxs;
      if (bundle.devBuyLamports.gtn(0)) {
        const global = await this.onlineSdk.fetchGlobal();
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

      // Build transaction
      const { blockhash } =
        await this.connection.getLatestBlockhash('confirmed');

      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: creatorPubkey,
      });

      tx.add(...computeIxs, ...createIxs);

      // Sign with both creator (fee payer) and mint (required for create)
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.wallet.keypair, mintKeypair],
        {
          commitment: 'confirmed',
          maxRetries: 3,
        },
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
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const ata = await getAssociatedTokenAddress(mintKeypair.publicKey, creatorPubkey);
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

      this.emit('mint:success', result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('mint:failed', err);
      throw err;
    }
  }

  /**
   * Execute bundled buys from multiple wallets after token creation.
   *
   * Each wallet sends its own buy transaction. For true atomic bundling
   * (same slot), use Jito bundles in production.
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
    const signatures: string[] = [];
    const { PublicKey } = await import('@solana/web3.js');
    const mintPubkey = new PublicKey(mint);

    // Fetch global state once (shared across all buys)
    const global = await this.onlineSdk.fetchGlobal();

    for (const { wallet, amountLamports } of bundle.bundleWallets) {
      try {
        // Fetch buy state (bonding curve + user ATA) for this buyer
        const buyState = await this.onlineSdk.fetchBuyState(
          mintPubkey,
          wallet.keypair.publicKey,
          TOKEN_PROGRAM_ID,
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

        const computeIxs = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        ];

        const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.keypair.publicKey });
        tx.add(...computeIxs, ...buyIxs);

        const sig = await sendAndConfirmTransaction(
          this.connection,
          tx,
          [wallet.keypair],
          { commitment: 'confirmed', maxRetries: 3 },
        );

        signatures.push(sig);
      } catch (error) {
        console.error(`[creator] Bundle buy failed for ${wallet.label}:`, error);
        // Continue with other wallets
      }
    }

    this.emit('bundle:success', signatures);
    return signatures;
  }

  /**
   * Fetch the current bonding curve state for a token.
   */
  async getBondingCurveState(mint: string): Promise<BondingCurveState> {
    const { PublicKey } = await import('@solana/web3.js');
    const mintPubkey = new PublicKey(mint);
    const bondingCurvePdaKey = bondingCurvePda(mintPubkey);

    const accountInfo = await this.connection.getAccountInfo(bondingCurvePdaKey);
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
    const totalSupply = 1_000_000_000;
    const marketCapSol = priceSol * totalSupply;
    // Graduation: the curve graduates when realSolReserves reaches ~85 SOL
    const graduationThresholdLamports = 85 * LAMPORTS_PER_SOL;
    const graduationProgress = Math.min(
      100,
      (realSolReserves.toNumber() / graduationThresholdLamports) * 100,
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
}
