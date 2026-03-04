/**
 * x402 Analytics Client — Paid market intelligence for trading agents
 *
 * This client calls premium analytics APIs that are gated behind x402
 * micropayments. When the API returns HTTP 402, the client automatically:
 *
 * 1. Reads the X-PAYMENT-REQUIRED header (amount, token, recipient, chain)
 * 2. Signs a USDC transfer from the agent's EVM wallet
 * 3. Retries the request with an X-PAYMENT proof header
 * 4. Returns the premium data to the trading agent
 *
 * The user/developer never sees the payment — it's invisible middleware.
 *
 * Real-world example:
 *   Agent wants bonding curve analytics → calls GET /api/premium/pump/analytics
 *   → API returns 402 → client auto-pays 0.01 USDC → retries → gets data
 */

import { EventEmitter } from 'eventemitter3';
import type { TokenAnalytics, BondingCurveState } from '../types.js';

// ─── Types ────────────────────────────────────────────────────

interface X402PaymentRequirements {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
  }>;
}

interface X402ClientConfig {
  /** Base URL of the analytics API */
  apiBaseUrl: string;
  /** EVM private key for signing USDC payments (hex string with 0x prefix) */
  evmPrivateKey?: string;
  /** Maximum USDC to spend per request (human-readable, e.g. "0.05") */
  maxPaymentPerRequest?: string;
  /** Maximum total USDC budget for the session */
  maxTotalBudget?: string;
  /** Skip payments (dev mode — API must also be in dev mode) */
  devMode?: boolean;
}

interface AnalyticsClientEvents {
  'payment:required': (requirements: X402PaymentRequirements) => void;
  'payment:sent': (amount: string, recipient: string) => void;
  'payment:failed': (error: Error) => void;
  'request:success': (endpoint: string, latencyMs: number) => void;
  'budget:warning': (spent: number, remaining: number) => void;
}

// ─── Analytics Client ─────────────────────────────────────────

export class AnalyticsClient extends EventEmitter<AnalyticsClientEvents> {
  private readonly config: X402ClientConfig;
  private totalSpentUsdc = 0;
  private requestCount = 0;

  constructor(config: X402ClientConfig) {
    super();
    this.config = config;
  }

  /**
   * Fetch with automatic x402 payment handling.
   *
   * Makes the initial request. If the API returns 402, reads payment
   * requirements, signs a payment, and retries with proof.
   */
  private async fetchWithPayment<T>(endpoint: string): Promise<T> {
    const url = `${this.config.apiBaseUrl}${endpoint}`;
    const startTime = Date.now();

    // First attempt
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PumpAgentSwarm/1.0',
      },
    });

    // If not 402, handle normally
    if (response.status !== 402) {
      if (!response.ok) {
        throw new Error(`Analytics API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json() as T;
      this.requestCount++;
      this.emit('request:success', endpoint, Date.now() - startTime);
      return data;
    }

    // ─── Handle 402 Payment Required ────────────────────────

    if (this.config.devMode) {
      throw new Error(
        `[x402] Payment required for ${endpoint} but client is in devMode. ` +
        'Set devMode: false and provide an evmPrivateKey to enable payments.',
      );
    }

    if (!this.config.evmPrivateKey) {
      throw new Error(
        `[x402] Payment required for ${endpoint} but no evmPrivateKey configured. ` +
        'The agent needs an EVM wallet to pay for premium analytics.',
      );
    }

    // Parse payment requirements from header
    const paymentHeader = response.headers.get('X-PAYMENT-REQUIRED');
    if (!paymentHeader) {
      throw new Error('[x402] 402 response but no X-PAYMENT-REQUIRED header');
    }

    const requirements = JSON.parse(
      Buffer.from(paymentHeader, 'base64').toString('utf-8'),
    ) as X402PaymentRequirements;

    this.emit('payment:required', requirements);

    // Check budget
    const acceptedScheme = requirements.accepts[0];
    if (!acceptedScheme) {
      throw new Error('[x402] No accepted payment schemes in 402 response');
    }

    const paymentAmountUsdc = parseFloat(acceptedScheme.maxAmountRequired) / 1e6;
    const maxPerRequest = parseFloat(this.config.maxPaymentPerRequest ?? '0.10');
    if (paymentAmountUsdc > maxPerRequest) {
      throw new Error(
        `[x402] Payment amount $${paymentAmountUsdc} exceeds maxPaymentPerRequest $${maxPerRequest}`,
      );
    }

    const maxBudget = parseFloat(this.config.maxTotalBudget ?? '10.00');
    if (this.totalSpentUsdc + paymentAmountUsdc > maxBudget) {
      throw new Error(
        `[x402] Payment would exceed total budget. Spent: $${this.totalSpentUsdc}, ` +
        `Request: $${paymentAmountUsdc}, Budget: $${maxBudget}`,
      );
    }

    // Sign the payment
    // In production, this would use viem/ethers to sign an EIP-712 typed data
    // message authorizing the USDC transfer, which the x402 facilitator settles.
    const paymentProof = await this.signPayment(
      acceptedScheme.payTo,
      acceptedScheme.maxAmountRequired,
      acceptedScheme.asset,
      acceptedScheme.network,
    );

    this.emit('payment:sent', acceptedScheme.maxAmountRequired, acceptedScheme.payTo);

    // Retry with payment proof
    const paidResponse = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PumpAgentSwarm/1.0',
        'X-PAYMENT': paymentProof,
      },
    });

    if (!paidResponse.ok) {
      const errorBody = await paidResponse.text();
      throw new Error(`[x402] Paid request failed: ${paidResponse.status} — ${errorBody}`);
    }

    // Track spending
    this.totalSpentUsdc += paymentAmountUsdc;
    this.requestCount++;
    this.emit('request:success', endpoint, Date.now() - startTime);

    // Warn if approaching budget limit
    const remaining = maxBudget - this.totalSpentUsdc;
    if (remaining < maxBudget * 0.2) {
      this.emit('budget:warning', this.totalSpentUsdc, remaining);
    }

    return paidResponse.json() as Promise<T>;
  }

  /**
   * Sign an x402 payment using the agent's EVM wallet.
   *
   * Uses EIP-712 typed data signing compatible with the x402 facilitator.
   * The facilitator validates the signature and settles the USDC transfer
   * on Base (or the configured network).
   */
  private async signPayment(
    payTo: string,
    amount: string,
    asset: string,
    network: string,
  ): Promise<string> {
    // Dynamic import to avoid requiring ethers when in devMode
    const { Wallet } = await import('ethers');

    const wallet = new Wallet(this.config.evmPrivateKey!);

    // Build the x402 payment message
    // This follows the x402 v2 exact-evm scheme
    const paymentPayload = {
      x402Version: 2,
      scheme: 'exact',
      network,
      payload: {
        signature: '', // Will be filled
        authorization: {
          from: wallet.address,
          to: payTo,
          value: amount,
          validAfter: Math.floor(Date.now() / 1000) - 60,
          validBefore: Math.floor(Date.now() / 1000) + 300, // 5 min validity
          nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`,
        },
      },
    };

    // Sign the authorization (EIP-3009 transferWithAuthorization for USDC)
    const domain = {
      name: 'USD Coin',
      version: '2',
      chainId: network === 'eip155:8453' ? 8453 : 84532, // Base or Base Sepolia
      verifyingContract: asset,
    };

    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    };

    const signature = await wallet.signTypedData(domain, types, paymentPayload.payload.authorization);
    paymentPayload.payload.signature = signature;

    // Base64-encode the payment payload for the X-PAYMENT header
    return Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  }

  // ─── Public API: Analytics Endpoints ────────────────────────

  /**
   * Get comprehensive token analytics (x402-gated).
   *
   * Includes bonding curve state, holder distribution, trade volume,
   * rug risk score, and creator analysis.
   *
   * @param mint - Token mint address (Solana base58)
   * @returns Full token analytics
   * @price $0.02 per request
   */
  async getTokenAnalytics(mint: string): Promise<TokenAnalytics> {
    return this.fetchWithPayment<TokenAnalytics>(`/api/premium/pump/analytics?mint=${mint}`);
  }

  /**
   * Get bonding curve state (x402-gated).
   *
   * @param mint - Token mint address
   * @returns Current bonding curve reserves and graduation progress
   * @price $0.005 per request
   */
  async getBondingCurveState(mint: string): Promise<BondingCurveState> {
    return this.fetchWithPayment<BondingCurveState>(`/api/premium/pump/curve?mint=${mint}`);
  }

  /**
   * Get new token launches in the last N minutes (x402-gated).
   *
   * @param minutes - Lookback window (default: 60)
   * @param minMarketCapSol - Minimum market cap filter
   * @returns Array of recently launched tokens with analytics
   * @price $0.01 per request
   */
  async getNewLaunches(minutes: number = 60, minMarketCapSol?: number): Promise<TokenAnalytics[]> {
    let endpoint = `/api/premium/pump/launches?minutes=${minutes}`;
    if (minMarketCapSol !== undefined) {
      endpoint += `&minMarketCapSol=${minMarketCapSol}`;
    }
    return this.fetchWithPayment<TokenAnalytics[]>(endpoint);
  }

  /**
   * Get trading signals for a token (x402-gated).
   *
   * AI-generated buy/sell signals based on bonding curve dynamics,
   * holder behavior, and volume patterns.
   *
   * @param mint - Token mint address
   * @returns Trading signals with confidence scores
   * @price $0.03 per request
   */
  async getTradingSignals(mint: string): Promise<{
    signal: 'buy' | 'sell' | 'hold';
    confidence: number;
    reasoning: string;
    metrics: {
      volumeTrend: 'increasing' | 'decreasing' | 'stable';
      holderGrowth: number;
      priceChange1h: number;
      graduationEta: string;
    };
  }> {
    return this.fetchWithPayment(`/api/premium/pump/signals?mint=${mint}`);
  }

  // ─── Budget & Stats ─────────────────────────────────────────

  getTotalSpentUsdc(): number {
    return this.totalSpentUsdc;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  getRemainingBudget(): number {
    const maxBudget = parseFloat(this.config.maxTotalBudget ?? '10.00');
    return maxBudget - this.totalSpentUsdc;
  }
}
