/**
 * Pump.fun Screener API Server — x402 Micropayment-Gated
 *
 * A standalone Hono HTTP server that exposes premium Pump.fun analytics
 * endpoints gated by x402 Solana micropayments.
 *
 * Architecture:
 *   [Agent/Client] → HTTP Request
 *                  → x402 Middleware (checks X-PAYMENT header)
 *                  → If no payment: 402 + X-PAYMENT-REQUIRED challenge
 *                  → If payment valid: route handler → on-chain data → response
 *
 * Free endpoints:
 *   GET  /healthz            — Health check
 *   GET  /metrics            — Server analytics
 *   GET  /.well-known/x402   — x402 discovery document
 *
 * Premium endpoints (x402-gated):
 *   GET  /api/pump/analytics/:mint    — Full token analytics      ($0.02)
 *   GET  /api/pump/curve/:mint        — Bonding curve state       ($0.005)
 *   GET  /api/pump/whales/:mint       — Whale & sniper detection  ($0.025)
 *   GET  /api/pump/graduation/:mint   — Graduation probability    ($0.015)
 *   GET  /api/pump/signals/:mint      — AI trading signals        ($0.03)
 *   GET  /api/pump/launches           — Recent token launches     ($0.01)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { SolanaX402Server } from '../x402/server.js';
import type { SolanaX402ServerConfig, ScreenerEndpoint } from '../x402/types.js';
import { createX402Middleware } from './x402-middleware.js';
import { createPumpRoutes, PUMP_ENDPOINTS } from './routes/pump.js';

// ─── Server Configuration ─────────────────────────────────────

export interface ScreenerServerConfig {
  /** HTTP port to listen on */
  port: number;

  /** Hostname to bind to */
  hostname?: string;

  /** Solana RPC endpoint */
  rpcUrl: string;

  /** Solana network */
  network: 'mainnet-beta' | 'devnet';

  /** Server's USDC token account (ATA) — receives payments */
  payToAddress: string;

  /** Server wallet's public key (owner of the ATA) */
  serverWalletAddress: string;

  /** Base URL for the discovery document (e.g. "https://api.example.com") */
  baseUrl: string;

  /** Skip payment enforcement for development */
  devMode?: boolean;

  /** Challenge TTL in seconds (default: 300) */
  challengeTtlSeconds?: number;

  /** Enable CORS (default: true) */
  enableCors?: boolean;

  /** Enable request logging (default: true) */
  enableLogging?: boolean;
}

// ─── Server Factory ───────────────────────────────────────────

export interface ScreenerServerInstance {
  /** The Hono app instance */
  app: Hono;

  /** The x402 server instance (for stats, shutdown, etc.) */
  x402Server: SolanaX402Server;

  /** Start listening — returns a close function */
  start: () => { close: () => void };
}

/**
 * Create and configure the screener API server.
 *
 * Usage:
 * ```ts
 * const { app, x402Server, start } = createScreenerServer({
 *   port: 3402,
 *   rpcUrl: process.env.SOLANA_RPC_URL,
 *   network: 'mainnet-beta',
 *   payToAddress: process.env.USDC_PAY_TO_ATA,
 *   serverWalletAddress: process.env.SERVER_WALLET,
 *   baseUrl: 'https://pump-screener.example.com',
 * });
 *
 * const { close } = start();
 * ```
 */
export function createScreenerServer(config: ScreenerServerConfig): ScreenerServerInstance {
  const app = new Hono();

  // ─── Optional middleware ──────────────────────────────────

  if (config.enableCors !== false) {
    app.use('*', cors({
      origin: '*',
      allowHeaders: ['Content-Type', 'X-PAYMENT', 'X-PAYMENT-REQUIRED'],
      exposeHeaders: ['X-PAYMENT-REQUIRED', 'X-PAYMENT-VERIFIED', 'X-PAYMENT-TX'],
    }));
  }

  if (config.enableLogging !== false) {
    app.use('*', logger());
  }

  // ─── x402 Server ──────────────────────────────────────────

  const x402ServerConfig: SolanaX402ServerConfig = {
    rpcUrl: config.rpcUrl,
    payToAddress: config.payToAddress,
    serverWalletAddress: config.serverWalletAddress,
    network: config.network,
    challengeTtlSeconds: config.challengeTtlSeconds ?? 300,
  };

  const x402Server = new SolanaX402Server(x402ServerConfig);

  // ─── x402 Middleware on premium routes ────────────────────

  app.use(
    '/api/pump/*',
    createX402Middleware({
      server: x402Server,
      endpoints: PUMP_ENDPOINTS,
      devMode: config.devMode,
      onPaymentVerified: (result, path) => {
        console.log(
          `[x402] Payment verified: ${result.signature} for ${path} — `
          + `${result.amount} raw USDC from ${result.payer}`,
        );
      },
      onPaymentFailed: (reason, path) => {
        console.warn(`[x402] Payment failed for ${path}: ${reason}`);
      },
    }),
  );

  // ─── Free Endpoints ───────────────────────────────────────

  // Health check
  app.get('/healthz', (c) => {
    return c.json({
      status: 'ok',
      server: 'pump-screener',
      network: config.network,
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });

  // Server metrics
  app.get('/metrics', (c) => {
    const revenueByEndpoint: Record<string, { count: number; totalUsdc: number }> = {};
    for (const [path, stats] of x402Server.getRevenueByEndpoint()) {
      revenueByEndpoint[path] = stats;
    }

    return c.json({
      totalRevenue: x402Server.getTotalRevenue(),
      totalPayments: x402Server.getTotalPayments(),
      activeChallenges: x402Server.getActiveChallengeCount(),
      revenueByEndpoint,
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });

  // x402 discovery document
  app.get('/.well-known/x402', (c) => {
    const endpoints: ScreenerEndpoint[] = [];

    for (const [path, endpoint] of PUMP_ENDPOINTS) {
      endpoints.push({
        method: 'GET',
        path,
        description: endpoint.description,
        priceUsdc: endpoint.priceUsdc,
        priceRaw: endpoint.priceRaw,
        mimeType: 'application/json',
        free: false,
      });
    }

    // Add free endpoints
    endpoints.push(
      {
        method: 'GET',
        path: '/healthz',
        description: 'Health check',
        priceUsdc: '0',
        priceRaw: '0',
        mimeType: 'application/json',
        free: true,
      },
      {
        method: 'GET',
        path: '/metrics',
        description: 'Server analytics and revenue',
        priceUsdc: '0',
        priceRaw: '0',
        mimeType: 'application/json',
        free: true,
      },
    );

    const document = x402Server.createDiscoveryDocument(config.baseUrl, endpoints);
    return c.json(document);
  });

  // ─── Premium Routes (mount the sub-app) ───────────────────

  const pumpRoutes = createPumpRoutes({
    rpcUrl: config.rpcUrl,
    network: config.network,
  });

  app.route('/', pumpRoutes);

  // ─── 404 Handler ──────────────────────────────────────────

  app.notFound((c) => {
    c.status(404);
    return c.json({
      error: 'Not Found',
      message: `No route matches ${c.req.method} ${c.req.path}`,
      hint: 'Visit /.well-known/x402 for available endpoints and pricing.',
    });
  });

  // ─── Error Handler ────────────────────────────────────────

  app.onError((err, c) => {
    console.error(`[screener] Unhandled error on ${c.req.path}:`, err);
    c.status(500);
    return c.json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred. Please try again.',
    });
  });

  // ─── Start Function ───────────────────────────────────────

  const start = () => {
    const server = serve({
      fetch: app.fetch,
      port: config.port,
      hostname: config.hostname ?? '0.0.0.0',
    });

    console.log(`[screener] Pump.fun Screener API listening on ${config.hostname ?? '0.0.0.0'}:${config.port}`);
    console.log(`[screener] Network: ${config.network}`);
    console.log(`[screener] Pay-to: ${config.payToAddress}`);
    console.log(`[screener] Discovery: ${config.baseUrl}/.well-known/x402`);
    console.log(`[screener] Dev mode: ${config.devMode ? 'ON' : 'OFF'}`);

    return {
      close: () => {
        x402Server.destroy();
        if (server && typeof server === 'object' && 'close' in server) {
          (server as { close: () => void }).close();
        }
      },
    };
  };

  return { app, x402Server, start };
}

// ─── CLI Entrypoint ───────────────────────────────────────────

/**
 * Start the screener server from environment variables.
 *
 * Required env vars:
 *   SOLANA_RPC_URL        — Solana RPC endpoint
 *   USDC_PAY_TO_ATA       — Server's USDC token account (ATA)
 *   SERVER_WALLET_ADDRESS  — Server wallet public key
 *
 * Optional env vars:
 *   SCREENER_PORT         — HTTP port (default: 3402)
 *   SCREENER_HOST         — Hostname (default: 0.0.0.0)
 *   SCREENER_BASE_URL     — Base URL for discovery doc
 *   SOLANA_NETWORK        — mainnet-beta | devnet (default: mainnet-beta)
 *   X402_DEV_MODE         — Skip payment enforcement
 *   X402_CHALLENGE_TTL    — Challenge TTL seconds (default: 300)
 */
export function startFromEnv(): void {
  const rpcUrl = process.env['SOLANA_RPC_URL'];
  const payToAddress = process.env['USDC_PAY_TO_ATA'];
  const serverWalletAddress = process.env['SERVER_WALLET_ADDRESS'];

  if (!rpcUrl) {
    console.error('[screener] FATAL: SOLANA_RPC_URL is required');
    process.exit(1);
  }
  if (!payToAddress) {
    console.error('[screener] FATAL: USDC_PAY_TO_ATA is required');
    process.exit(1);
  }
  if (!serverWalletAddress) {
    console.error('[screener] FATAL: SERVER_WALLET_ADDRESS is required');
    process.exit(1);
  }

  const port = parseInt(process.env['SCREENER_PORT'] ?? '3402', 10);
  const hostname = process.env['SCREENER_HOST'] ?? '0.0.0.0';
  const network = (process.env['SOLANA_NETWORK'] ?? 'mainnet-beta') as 'mainnet-beta' | 'devnet';
  const devMode = process.env['X402_DEV_MODE'] === 'true';
  const challengeTtlSeconds = parseInt(process.env['X402_CHALLENGE_TTL'] ?? '300', 10);
  const baseUrl = process.env['SCREENER_BASE_URL'] ?? `http://${hostname}:${port}`;

  const { start } = createScreenerServer({
    port,
    hostname,
    rpcUrl,
    network,
    payToAddress,
    serverWalletAddress,
    baseUrl,
    devMode,
    challengeTtlSeconds,
  });

  const { close } = start();

  // Graceful shutdown
  const shutdown = () => {
    console.log('[screener] Shutting down...');
    close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
