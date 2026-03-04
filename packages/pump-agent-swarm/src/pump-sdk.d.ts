/**
 * Type declarations for @pump-fun/pump-sdk
 *
 * The SDK ships without .d.ts files. These declarations cover the
 * subset of the API we use in the pump-agent-swarm package.
 *
 * Source: https://github.com/nirholas/pump-fun-sdk
 */

declare module '@pump-fun/pump-sdk' {
  import type {
    Connection,
    PublicKey,
    TransactionInstruction,
    AccountInfo,
  } from '@solana/web3.js';
  import type BN from 'bn.js';

  // ─── Decoded Accounts ────────────────────────────────────

  interface DecodedGlobal {
    feeBasisPoints: BN;
    creatorFeeBasisPoints: BN;
    [key: string]: unknown;
  }

  interface DecodedBondingCurve {
    virtualSolReserves: BN;
    virtualTokenReserves: BN;
    realSolReserves: BN;
    realTokenReserves: BN;
    tokenTotalSupply: BN;
    complete: boolean;
    creator: PublicKey;
    isMayhemMode: boolean;
    [key: string]: unknown;
  }

  // ─── State Fetched by OnlinePumpSdk ──────────────────────

  interface BuyState {
    bondingCurveAccountInfo: AccountInfo<Buffer>;
    bondingCurve: DecodedBondingCurve;
    associatedUserAccountInfo: AccountInfo<Buffer> | null;
  }

  interface SellState {
    bondingCurveAccountInfo: AccountInfo<Buffer>;
    bondingCurve: DecodedBondingCurve;
  }

  // ─── Instruction Parameters ──────────────────────────────

  interface CreateV2Params {
    mint: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    creator: PublicKey;
    user: PublicKey;
    mayhemMode: boolean;
    cashback?: boolean;
  }

  interface CreateV2AndBuyParams {
    global: DecodedGlobal;
    mint: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    creator: PublicKey;
    user: PublicKey;
    amount: BN;
    solAmount: BN;
    mayhemMode: boolean;
    cashback?: boolean;
  }

  interface BuyInstructionParams {
    global: DecodedGlobal;
    mint: PublicKey;
    creator: PublicKey;
    user: PublicKey;
    associatedUser: PublicKey;
    amount: BN;
    solAmount: BN;
    slippage: number;
    tokenProgram?: PublicKey;
    mayhemMode?: boolean;
  }

  interface BuyInstructionsParams {
    global: DecodedGlobal;
    bondingCurveAccountInfo: AccountInfo<Buffer>;
    bondingCurve: DecodedBondingCurve;
    associatedUserAccountInfo: AccountInfo<Buffer> | null;
    mint: PublicKey;
    user: PublicKey;
    amount: BN;
    solAmount: BN;
    slippage: number;
    tokenProgram?: PublicKey;
  }

  interface SellInstructionsParams {
    global: DecodedGlobal;
    bondingCurveAccountInfo: AccountInfo<Buffer>;
    bondingCurve: DecodedBondingCurve;
    mint: PublicKey;
    user: PublicKey;
    amount: BN;
    solAmount: BN;
    slippage: number;
    tokenProgram?: PublicKey;
    mayhemMode?: boolean;
    cashback?: boolean;
  }

  // ─── PumpSdk (offline — no connection needed) ────────────

  class PumpSdk {
    constructor();

    decodeBondingCurve(accountInfo: AccountInfo<Buffer>): DecodedBondingCurve;
    decodeGlobal(accountInfo: AccountInfo<Buffer>): DecodedGlobal;

    createInstruction(params: CreateV2Params): Promise<TransactionInstruction>;
    createV2Instruction(params: CreateV2Params): Promise<TransactionInstruction>;
    createV2AndBuyInstructions(params: CreateV2AndBuyParams): Promise<TransactionInstruction[]>;
    createAndBuyInstructions(params: CreateV2AndBuyParams): Promise<TransactionInstruction[]>;

    buyInstruction(params: BuyInstructionParams): Promise<TransactionInstruction>;
    buyInstructions(params: BuyInstructionsParams): Promise<TransactionInstruction[]>;
    sellInstructions(params: SellInstructionsParams): Promise<TransactionInstruction[]>;
  }

  // ─── OnlinePumpSdk (needs connection) ────────────────────

  class OnlinePumpSdk extends PumpSdk {
    connection: Connection;

    constructor(connection: Connection);

    fetchGlobal(): Promise<DecodedGlobal>;
    fetchFeeConfig(): Promise<unknown>;
    fetchBondingCurve(mint: PublicKey): Promise<DecodedBondingCurve>;
    fetchBuyState(
      mint: PublicKey,
      user: PublicKey,
      tokenProgram?: PublicKey,
    ): Promise<BuyState>;
    fetchSellState(
      mint: PublicKey,
      user: PublicKey,
      tokenProgram?: PublicKey,
    ): Promise<SellState>;
    fetchGraduationProgress(mint: PublicKey): Promise<number>;
    fetchTokenPrice(mint: PublicKey): Promise<number>;
    isGraduated(mint: PublicKey): Promise<boolean>;
    getTokenBalance(mint: PublicKey, user: PublicKey): Promise<BN>;
    sellAllInstructions(params: SellInstructionsParams): Promise<TransactionInstruction[]>;
    fetchBondingCurveSummary(mint: PublicKey): Promise<unknown>;
  }

  // ─── Pre-instantiated singleton ──────────────────────────

  const PUMP_SDK: PumpSdk;

  // ─── Helper functions ────────────────────────────────────

  function bondingCurvePda(mint: PublicKey): PublicKey;
  function canonicalPumpPoolPda(mint: PublicKey): PublicKey;
  function getGraduationProgress(bondingCurve: DecodedBondingCurve): number;
  function getTokenPrice(bondingCurve: DecodedBondingCurve): number;
  function getBuyTokenAmountFromSolAmount(
    bondingCurve: DecodedBondingCurve,
    solAmount: BN,
  ): BN;
  function getSellSolAmountFromTokenAmount(
    bondingCurve: DecodedBondingCurve,
    tokenAmount: BN,
  ): BN;

  // ─── Constants ───────────────────────────────────────────

  const PUMP_PROGRAM_ID: PublicKey;
  const PUMP_AMM_PROGRAM_ID: PublicKey;
  const PUMP_FEE_PROGRAM_ID: PublicKey;
  const GLOBAL_PDA: PublicKey;
  const ONE_BILLION_SUPPLY: BN;
}
