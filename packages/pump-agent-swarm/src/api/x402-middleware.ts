/**
 * Hono x402 Payment Middleware — Solana USDC Micropayments
 *
 * Intercepts requests to premium endpoints and enforces x402 payment flow:
 *
 * 1. Client requests a premium endpoint without `X-PAYMENT` header
 *    → Returns HTTP 402 with `X-PAYMENT-REQUIRED` (base64 challenge)
 *
 * 2. Client sends USDC + Memo tx on Solana, retries with `X-PAYMENT` header
 *    → Middleware verifies on-chain, passes through to route if valid
 *
 * No EVM. No facilitator. Direct Solana settlement in ~400ms.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import type { SolanaX402Server } from '../x402/server.js';
import type { PaymentVerificationResult, SolanaX402PaymentProof } from '../x402/types.js';

// ─── Types ────────────────────────────────────────────────────

export interface X402EndpointConfig {
  /** USDC amount in raw units (6 decimals). e.g. "10000" = $0.01 */
  priceRaw: string;

  /** Human-readable price, e.g. "0.01" */
  priceUsdc: string;

  /** Human-readable description of what the payment unlocks */
  description: string;
}

export interface X402MiddlewareConfig {
  /** The SolanaX402Server instance for challenge generation and payment verification */
  server: SolanaX402Server;

  /** Map of route patterns to pricing config. Key is the path, e.g. "/api/pump/analytics/:mint" */
  endpoints: Map<string, X402EndpointConfig>;

  /** If true, skip payment enforcement (dev mode) */
  devMode?: boolean;

  /** Called when a payment is verified. Useful for logging/analytics. */
  onPaymentVerified?: (result: PaymentVerificationResult, path: string) => void;

  /** Called when a payment fails verification. */
  onPaymentFailed?: (reason: string, path: string) => void;
}

// ─── Payment Context ──────────────────────────────────────────

/**
 * Injected into the Hono context after successful payment verification.
 * Route handlers can access this via `c.get('x402')`.
 */
export interface X402PaymentContext {
  /** Whether this request was paid for */
  paid: boolean;

  /** Verification result (if paid) */
  verification?: PaymentVerificationResult;

  /** Payment signature (if paid) */
  signature?: string;

  /** Payer wallet address (if paid) */
  payer?: string;

  /** Amount paid in raw USDC units (if paid) */
  amountRaw?: string;
}

// ─── Helper: Match Route Pattern ──────────────────────────────

/**
 * Match a request path against registered endpoint patterns.
 * Supports Hono-style `:param` segments.
 */
function matchEndpoint(
  path: string,
  endpoints: Map<string, X402EndpointConfig>,
): X402EndpointConfig | undefined {
  // Direct match first
  const direct = endpoints.get(path);
  if (direct) return direct;

  // Pattern match with :param segments
  for (const [pattern, config] of endpoints) {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');

    if (patternParts.length !== pathParts.length) continue;

    let matches = true;
    for (let i = 0; i < patternParts.length; i++) {
      const part = patternParts[i];
      if (part === undefined || pathParts[i] === undefined) {
        matches = false;
        break;
      }
      if (part.startsWith(':')) continue; // wildcard param
      if (part !== pathParts[i]) {
        matches = false;
        break;
      }
    }

    if (matches) return config;
  }

  return undefined;
}

// ─── Middleware Factory ───────────────────────────────────────

/**
 * Create the x402 payment middleware for Hono.
 *
 * Usage:
 * ```ts
 * const endpoints = new Map([
 *   ['/api/pump/analytics/:mint', { priceRaw: '10000', priceUsdc: '0.01', description: 'Token analytics' }],
 * ]);
 * app.use('/api/pump/*', createX402Middleware({ server, endpoints }));
 * ```
 */
export function createX402Middleware(config: X402MiddlewareConfig): MiddlewareHandler {
  const { server, endpoints, devMode = false, onPaymentVerified, onPaymentFailed } = config;

  return async (c: Context, next: Next) => {
    const path = c.req.path;

    // Find the endpoint config for this path
    const endpointConfig = matchEndpoint(path, endpoints);

    // If no matching endpoint, not a premium route — pass through
    if (!endpointConfig) {
      c.set('x402', { paid: false } satisfies X402PaymentContext);
      await next();
      return;
    }

    // Dev mode bypass — skip payment enforcement
    if (devMode) {
      c.set('x402', { paid: false } satisfies X402PaymentContext);
      await next();
      return;
    }

    // Check for payment proof header
    const paymentHeader = c.req.header('X-PAYMENT');

    if (!paymentHeader) {
      // No payment proof — return 402 with challenge
      const headers = server.create402Headers(
        path,
        endpointConfig.priceRaw,
        endpointConfig.description,
      );

      c.status(402);
      for (const [key, value] of Object.entries(headers)) {
        c.header(key, value);
      }

      return c.json({
        error: 'Payment Required',
        message: endpointConfig.description,
        price: {
          usdc: endpointConfig.priceUsdc,
          raw: endpointConfig.priceRaw,
        },
        protocol: 'x402',
        scheme: 'exact-solana',
        instructions: 'Decode the X-PAYMENT-REQUIRED header (base64 JSON) for payment details. '
          + 'Send a Solana USDC transfer with Memo containing the challenge nonce, '
          + 'then retry this request with the X-PAYMENT header containing base64-encoded proof.',
      });
    }

    // Payment proof provided — verify it
    let proof: SolanaX402PaymentProof;
    try {
      const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
      proof = JSON.parse(decoded) as SolanaX402PaymentProof;
    } catch {
      onPaymentFailed?.('Malformed X-PAYMENT header: invalid base64 or JSON', path);
      c.status(400);
      return c.json({
        error: 'Bad Request',
        message: 'Malformed X-PAYMENT header. Expected base64-encoded JSON payment proof.',
      });
    }

    // Validate proof structure
    if (proof.x402Version !== 2 || proof.scheme !== 'exact-solana' || !proof.payload?.signature) {
      onPaymentFailed?.('Invalid payment proof structure', path);
      c.status(400);
      return c.json({
        error: 'Bad Request',
        message: 'Invalid payment proof. Expected x402Version: 2, scheme: "exact-solana", and a valid payload.',
      });
    }

    // Verify the payment on-chain
    let result: PaymentVerificationResult;
    try {
      result = await server.verifyPayment(paymentHeader);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown verification error';
      onPaymentFailed?.(message, path);
      c.status(502);
      return c.json({
        error: 'Payment Verification Failed',
        message: `Could not verify payment: ${message}`,
      });
    }

    if (!result.valid) {
      onPaymentFailed?.(result.reason ?? 'Unknown', path);
      c.status(402);

      // Generate a fresh challenge for retry
      const retryHeaders = server.create402Headers(
        path,
        endpointConfig.priceRaw,
        endpointConfig.description,
      );
      for (const [key, value] of Object.entries(retryHeaders)) {
        c.header(key, value);
      }

      return c.json({
        error: 'Payment Invalid',
        message: result.reason ?? 'Payment verification failed',
        retry: true,
      });
    }

    // Payment verified — inject context and continue
    const paymentContext: X402PaymentContext = {
      paid: true,
      verification: result,
      signature: result.signature,
      payer: result.payer,
      amountRaw: result.amount,
    };

    c.set('x402', paymentContext);
    onPaymentVerified?.(result, path);

    // Add verification headers to response
    c.header('X-PAYMENT-VERIFIED', 'true');
    if (result.signature) {
      c.header('X-PAYMENT-TX', result.signature);
    }

    await next();
  };
}
