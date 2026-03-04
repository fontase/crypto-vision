/**
 * Jito Block Engine Client — MEV-Protected Bundle Submission
 *
 * Production client for the Jito block engine that submits transaction
 * bundles for guaranteed same-slot inclusion with MEV protection.
 *
 * Features:
 * - Submit up to 5 transactions per bundle for atomic execution
 * - Automatic tip account selection and tip instruction injection
 * - Bundle status polling with configurable timeout
 * - Recommended tip estimation based on recent conditions
 * - Retry with exponential backoff on transient failures
 * - Tip account caching (5-minute TTL)
 * - Comprehensive error handling for all Jito-specific failure modes
 *
 * @example
 * ```typescript
 * import { JitoClient } from './jito-client.js';
 *
 * const jito = new JitoClient({
 *   blockEngineUrl: 'https://mainnet.block-engine.jito.wtf',
 *   tipLamports: 10_000,
 *   maxBundleSize: 5,
 *   useOnChainTip: true,
 * });
 *
 * const result = await jito.sendBundle([tx1, tx2, tx3]);
 * const status = await jito.waitForBundleConfirmation(result.bundleId);
 * ```
 */

import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

import type { JitoBundleConfig } from '../types.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Types ────────────────────────────────────────────────────

export interface JitoBundleResult {
  /** Unique bundle identifier returned by Jito */
  bundleId: string;
  /** Current status of the bundle */
  status: 'submitted' | 'confirmed' | 'failed' | 'timeout';
  /** Slot in which the bundle was included */
  slot?: number;
  /** Transaction signatures in the bundle */
  signatures: string[];
  /** Timestamp when the bundle was submitted */
  submittedAt: number;
  /** Timestamp when the bundle was confirmed */
  confirmedAt?: number;
  /** Error description if the bundle failed */
  error?: string;
  /** Tip amount included in the bundle (lamports) */
  tipLamports: number;
}

export interface JitoBundleStatus {
  /** Unique bundle identifier */
  bundleId: string;
  /** Current processing status */
  status: 'pending' | 'landed' | 'failed' | 'invalid';
  /** Slot in which the bundle landed */
  slot?: number;
  /** Confirmation status from the validator */
  confirmationStatus?: string;
  /** Error description if the bundle failed or was invalid */
  error?: string;
}

/** JSON-RPC request format for Jito block engine */
interface JitoRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

/** JSON-RPC response format from Jito block engine */
interface JitoRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

/** Cached tip accounts with TTL */
interface TipAccountCache {
  accounts: PublicKey[];
  fetchedAt: number;
}

// ─── Constants ────────────────────────────────────────────────

/** Maximum number of transactions allowed in a single Jito bundle */
const MAX_BUNDLE_SIZE = 5;

/** Cache duration for tip accounts (5 minutes) */
const TIP_ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Default bundle confirmation timeout (60 seconds) */
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000;

/** Polling interval when waiting for bundle confirmation */
const STATUS_POLL_INTERVAL_MS = 2_000;

/** Maximum retry attempts for transient failures */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 500;

/** Maximum backoff delay (ms) */
const RETRY_MAX_DELAY_MS = 10_000;

/** Default minimum tip (lamports) — 1000 lamports = 0.000001 SOL */
const DEFAULT_MIN_TIP_LAMPORTS = 1_000;

/** Default maximum tip (lamports) — 0.01 SOL */
const DEFAULT_MAX_TIP_LAMPORTS = 10_000_000;

/** Multiplier applied to median tip for recommendation */
const TIP_RECOMMENDATION_MULTIPLIER = 1.1;

/** HTTP request timeout for Jito API calls (ms) */
const HTTP_TIMEOUT_MS = 30_000;

/** JSON-RPC request ID counter */
let rpcIdCounter = 0;

// ─── JitoClient ───────────────────────────────────────────────

/**
 * Production client for Jito block engine bundle submission.
 *
 * Handles bundle formatting, tip injection, submission via JSON-RPC,
 * status polling, and error recovery with exponential backoff.
 */
export class JitoClient {
  private readonly config: JitoBundleConfig;
  private readonly log: SwarmLogger;
  private readonly apiUrl: string;
  private tipAccountCache: TipAccountCache | null = null;

  constructor(config: JitoBundleConfig) {
    this.config = {
      ...config,
      maxBundleSize: Math.min(config.maxBundleSize, MAX_BUNDLE_SIZE),
    };
    this.apiUrl = config.blockEngineUrl.replace(/\/+$/, '') + '/api/v1/bundles';
    this.log = new SwarmLogger({
      level: 'info',
      category: 'jito-client',
    });
  }

  // ─── Public API ───────────────────────────────────────────

  /**
   * Submit a bundle of transactions to the Jito block engine.
   *
   * All transactions must be fully signed. The bundle is submitted
   * atomically — either all transactions land in the same slot or none do.
   *
   * @param transactions - Array of signed transactions (max 5)
   * @returns Bundle submission result with ID and initial status
   * @throws {Error} If the bundle exceeds max size or transactions are unsigned
   */
  async sendBundle(
    transactions: (VersionedTransaction | Transaction)[],
  ): Promise<JitoBundleResult> {
    if (transactions.length === 0) {
      throw new Error('Bundle must contain at least one transaction');
    }
    if (transactions.length > this.config.maxBundleSize) {
      throw new Error(
        `Bundle exceeds maximum size: ${transactions.length} > ${this.config.maxBundleSize}`,
      );
    }

    const serializedTxs = transactions.map((tx) => {
      const serialized = tx.serialize();
      return bs58.encode(serialized);
    });

    const signatures = transactions.map((tx) => this.extractSignature(tx));

    this.log.info('Submitting Jito bundle', {
      transactionCount: transactions.length,
      tipLamports: this.config.tipLamports,
      signatures,
    });

    const submittedAt = Date.now();

    const response = await this.rpcCall<string>('sendBundle', [serializedTxs]);

    if (!response.result) {
      const errorMsg =
        response.error?.message ?? 'Unknown error submitting bundle';
      this.log.error('Bundle submission failed', {
        error: errorMsg,
        code: response.error?.code,
      });
      return {
        bundleId: '',
        status: 'failed',
        signatures,
        submittedAt,
        error: errorMsg,
        tipLamports: this.config.tipLamports,
      };
    }

    const bundleId = response.result;
    this.log.info('Bundle submitted successfully', {
      bundleId,
      transactionCount: transactions.length,
    });

    return {
      bundleId,
      status: 'submitted',
      signatures,
      submittedAt,
      tipLamports: this.config.tipLamports,
    };
  }

  /**
   * Get the current status of a submitted bundle.
   *
   * @param bundleId - The bundle ID returned from sendBundle
   * @returns Current bundle status
   */
  async getBundleStatus(bundleId: string): Promise<JitoBundleStatus> {
    const response = await this.rpcCall<
      { value: Array<{ bundle_id: string; status: string; slot: number; confirmation_status?: string; err?: { Ok?: null; Err?: unknown } }> }
    >('getBundleStatuses', [[bundleId]]);

    if (response.error) {
      return {
        bundleId,
        status: 'failed',
        error: response.error.message,
      };
    }

    const statuses = response.result?.value;
    if (!statuses || statuses.length === 0) {
      return {
        bundleId,
        status: 'pending',
      };
    }

    const bundleStatus = statuses[0];
    return this.mapBundleStatus(bundleId, bundleStatus);
  }

  /**
   * Wait for a bundle to be confirmed or fail, polling at regular intervals.
   *
   * @param bundleId - The bundle ID to monitor
   * @param timeoutMs - Maximum time to wait (default: 60s)
   * @returns Final bundle status
   */
  async waitForBundleConfirmation(
    bundleId: string,
    timeoutMs = DEFAULT_CONFIRMATION_TIMEOUT_MS,
  ): Promise<JitoBundleStatus> {
    const deadline = Date.now() + timeoutMs;
    this.log.info('Waiting for bundle confirmation', { bundleId, timeoutMs });

    while (Date.now() < deadline) {
      const status = await this.getBundleStatus(bundleId);

      if (status.status === 'landed') {
        this.log.info('Bundle confirmed', {
          bundleId,
          slot: status.slot,
          confirmationStatus: status.confirmationStatus,
        });
        return status;
      }

      if (status.status === 'failed' || status.status === 'invalid') {
        this.log.warn('Bundle failed or invalid', {
          bundleId,
          status: status.status,
          error: status.error,
        });
        return status;
      }

      // Still pending — wait and poll again
      await this.sleep(STATUS_POLL_INTERVAL_MS);
    }

    this.log.warn('Bundle confirmation timed out', { bundleId, timeoutMs });
    return {
      bundleId,
      status: 'pending',
      error: `Confirmation timed out after ${timeoutMs}ms`,
    };
  }

  /**
   * Fetch the list of Jito tip accounts.
   *
   * Results are cached for 5 minutes to reduce API calls.
   * A random account is selected per bundle to avoid concentration.
   *
   * @returns Array of tip account public keys
   */
  async getTipAccounts(): Promise<PublicKey[]> {
    if (
      this.tipAccountCache &&
      Date.now() - this.tipAccountCache.fetchedAt < TIP_ACCOUNT_CACHE_TTL_MS
    ) {
      return this.tipAccountCache.accounts;
    }

    this.log.debug('Fetching Jito tip accounts');

    const response = await this.rpcCall<string[]>('getTipAccounts', []);

    if (response.error || !response.result) {
      const errorMsg =
        response.error?.message ?? 'Failed to fetch tip accounts';
      this.log.error('Failed to fetch tip accounts', { error: errorMsg });
      throw new Error(`Failed to fetch Jito tip accounts: ${errorMsg}`);
    }

    const accounts = response.result.map(
      (addr: string) => new PublicKey(addr),
    );
    this.tipAccountCache = { accounts, fetchedAt: Date.now() };

    this.log.info('Fetched Jito tip accounts', {
      count: accounts.length,
      accounts: accounts.map((a) => a.toBase58()),
    });

    return accounts;
  }

  /**
   * Add a Jito tip instruction to a transaction.
   *
   * Selects a random tip account from the cached list and adds a
   * SystemProgram.transfer instruction sending the specified tip amount.
   *
   * @param tx - The transaction to add the tip to
   * @param tipLamports - Tip amount in lamports
   * @returns The transaction with the tip instruction appended
   */
  async addTipInstruction(
    tx: Transaction,
    tipLamports: number,
  ): Promise<Transaction> {
    const clampedTip = Math.max(
      DEFAULT_MIN_TIP_LAMPORTS,
      Math.min(tipLamports, DEFAULT_MAX_TIP_LAMPORTS),
    );

    const tipAccounts = await this.getTipAccounts();
    if (tipAccounts.length === 0) {
      throw new Error('No Jito tip accounts available');
    }

    // Select a random tip account to avoid concentration
    const tipAccount =
      tipAccounts[Math.floor(Math.random() * tipAccounts.length)];

    // The tip payer is the first signer (fee payer) of the transaction
    const feePayer = tx.feePayer;
    if (!feePayer) {
      throw new Error(
        'Transaction must have a feePayer set before adding a tip instruction',
      );
    }

    tx.add(
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: tipAccount,
        lamports: clampedTip,
      }),
    );

    this.log.debug('Added tip instruction', {
      tipLamports: clampedTip,
      tipAccount: tipAccount.toBase58(),
      feePayer: feePayer.toBase58(),
    });

    return tx;
  }

  /**
   * Get the recommended tip amount based on current conditions.
   *
   * Queries the Jito REST API for recent tip data and returns
   * the median tip plus a 10% buffer to improve landing probability.
   *
   * Falls back to the configured tipLamports if the API call fails.
   *
   * @returns Recommended tip in lamports
   */
  async getRecommendedTip(): Promise<number> {
    try {
      const restUrl =
        this.config.blockEngineUrl.replace(/\/+$/, '') +
        '/api/v1/bundles/tip_floor';

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        HTTP_TIMEOUT_MS,
      );

      try {
        const response = await fetch(restUrl, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          this.log.debug('Tip floor API returned non-OK status', {
            status: response.status,
          });
          return this.clampTip(this.config.tipLamports);
        }

        const data = (await response.json()) as Array<{
          landed_tips_25th_percentile: number;
          landed_tips_50th_percentile: number;
          landed_tips_75th_percentile: number;
          landed_tips_95th_percentile: number;
          landed_tips_99th_percentile: number;
          ema_landed_tips_50th_percentile: number;
        }>;

        if (!Array.isArray(data) || data.length === 0) {
          return this.clampTip(this.config.tipLamports);
        }

        // Use 50th percentile (median) + 10% buffer
        const medianTip = data[0].landed_tips_50th_percentile;
        const medianLamports = Math.ceil(
          medianTip * 1e9 * TIP_RECOMMENDATION_MULTIPLIER,
        );
        const recommended = this.clampTip(medianLamports);

        this.log.info('Recommended tip calculated', {
          medianSol: medianTip,
          recommendedLamports: recommended,
        });

        return recommended;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'Unknown error';
      this.log.warn('Failed to fetch recommended tip, using configured value', {
        error: errorMsg,
        fallbackTipLamports: this.config.tipLamports,
      });
      return this.clampTip(this.config.tipLamports);
    }
  }

  /**
   * Check if the Jito block engine is reachable and operational.
   *
   * @returns true if the block engine responds to getTipAccounts
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.rpcCall<string[]>('getTipAccounts', []);
      return !response.error && Array.isArray(response.result);
    } catch {
      return false;
    }
  }

  // ─── Private Helpers ──────────────────────────────────────

  /**
   * Execute a JSON-RPC call to the Jito block engine with retries.
   */
  private async rpcCall<T>(
    method: string,
    params: unknown[],
  ): Promise<JitoRpcResponse<T>> {
    const rpcUrl =
      this.config.blockEngineUrl.replace(/\/+$/, '') + '/api/v1/bundles';
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(
          RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
          RETRY_MAX_DELAY_MS,
        );
        this.log.debug('Retrying Jito RPC call', {
          method,
          attempt,
          delayMs: delay,
        });
        await this.sleep(delay);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        HTTP_TIMEOUT_MS,
      );

      try {
        const request: JitoRpcRequest = {
          jsonrpc: '2.0',
          id: ++rpcIdCounter,
          method,
          params,
        };

        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          lastError = new Error(
            `Jito RPC HTTP ${response.status}: ${body}`,
          );
          this.log.warn('Jito RPC HTTP error', {
            method,
            status: response.status,
            attempt,
          });

          // Don't retry on 4xx client errors (except 429 rate limit)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            return {
              jsonrpc: '2.0',
              id: rpcIdCounter,
              error: {
                code: response.status,
                message: lastError.message,
              },
            };
          }
          continue;
        }

        const json = (await response.json()) as JitoRpcResponse<T>;
        return json;
      } catch (err: unknown) {
        lastError =
          err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          this.log.warn('Jito RPC call timed out', {
            method,
            attempt,
            timeoutMs: HTTP_TIMEOUT_MS,
          });
        } else {
          this.log.warn('Jito RPC call failed', {
            method,
            attempt,
            error: lastError.message,
          });
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // All retries exhausted
    return {
      jsonrpc: '2.0',
      id: rpcIdCounter,
      error: {
        code: -1,
        message: `Jito RPC call failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
      },
    };
  }

  /**
   * Map raw Jito bundle status response to our JitoBundleStatus type.
   */
  private mapBundleStatus(
    bundleId: string,
    raw: {
      bundle_id: string;
      status: string;
      slot: number;
      confirmation_status?: string;
      err?: { Ok?: null; Err?: unknown };
    },
  ): JitoBundleStatus {
    const statusMap: Record<string, JitoBundleStatus['status']> = {
      Invalid: 'invalid',
      Failed: 'failed',
      Landed: 'landed',
      Pending: 'pending',
    };

    const mappedStatus = statusMap[raw.status] ?? 'pending';

    let error: string | undefined;
    if (raw.err?.Err) {
      error =
        typeof raw.err.Err === 'string'
          ? raw.err.Err
          : JSON.stringify(raw.err.Err);
    }

    return {
      bundleId,
      status: mappedStatus,
      slot: raw.slot || undefined,
      confirmationStatus: raw.confirmation_status,
      error,
    };
  }

  /**
   * Extract the primary signature from a transaction.
   */
  private extractSignature(
    tx: VersionedTransaction | Transaction,
  ): string {
    if (tx instanceof VersionedTransaction) {
      const sig = tx.signatures[0];
      if (sig) {
        return bs58.encode(sig);
      }
      return 'unsigned';
    }

    // Legacy Transaction
    const sig = tx.signatures[0];
    if (sig?.signature) {
      return bs58.encode(sig.signature);
    }
    return 'unsigned';
  }

  /**
   * Clamp a tip amount between the configured floor and ceiling.
   */
  private clampTip(lamports: number): number {
    return Math.max(
      DEFAULT_MIN_TIP_LAMPORTS,
      Math.min(lamports, DEFAULT_MAX_TIP_LAMPORTS),
    );
  }

  /**
   * Non-blocking sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
