/**
 * Crypto Vision — Shared Redis Client
 *
 * Single Redis connection shared across the entire process:
 *   cache, rate-limiter, auth/key store, WebSocket pub/sub.
 *
 * At 10M+ users with hundreds of Cloud Run instances, each instance
 * should use only ONE connection to Redis (plus one for Pub/Sub subscriber).
 * This prevents connection exhaustion on Memorystore.
 *
 * Features:
 *  - Lazy singleton — connects on first use
 *  - Graceful degradation — returns null if REDIS_URL is unset
 *  - Dedicated subscriber connection for Pub/Sub (SUBSCRIBE blocks the connection)
 *  - Health check helper
 */

import { logger } from "./logger.js";

// ─── Singleton Connections ───────────────────────────────────

let _client: import("ioredis").default | null = null;
let _subscriber: import("ioredis").default | null = null;
let _connecting: Promise<import("ioredis").default | null> | null = null;
let _connectingSub: Promise<import("ioredis").default | null> | null = null;

const REDIS_OPTIONS: import("ioredis").RedisOptions = {
  maxRetriesPerRequest: 2,
  connectTimeout: 3000,
  lazyConnect: true,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  // Keep-alive to avoid idle disconnections behind VPC connectors
  keepAlive: 30_000,
};

/**
 * Get the shared Redis client (for commands: GET, SET, EVAL, etc.).
 * Returns null if REDIS_URL is not configured.
 */
export async function getRedis(): Promise<import("ioredis").default | null> {
  if (_client) return _client;
  if (_connecting) return _connecting;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  _connecting = (async () => {
    try {
      const { default: Redis } = await import("ioredis");
      _client = new Redis(url, { ...REDIS_OPTIONS });
      await _client.connect();
      logger.info("Redis shared client connected");
      _client.on("error", (err) => logger.warn({ err: err.message }, "Redis error"));
      _client.on("close", () => {
        logger.warn("Redis shared client disconnected");
        _client = null;
      });
      return _client;
    } catch (err) {
      logger.warn({ err }, "Redis unavailable — running without Redis");
      _client = null;
      return null;
    } finally {
      _connecting = null;
    }
  })();

  return _connecting;
}

/**
 * Get a dedicated Redis subscriber connection (for SUBSCRIBE / PSUBSCRIBE).
 * SUBSCRIBE blocks the connection, so it cannot be shared with command clients.
 */
export async function getRedisSubscriber(): Promise<import("ioredis").default | null> {
  if (_subscriber) return _subscriber;
  if (_connectingSub) return _connectingSub;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  _connectingSub = (async () => {
    try {
      const { default: Redis } = await import("ioredis");
      _subscriber = new Redis(url, { ...REDIS_OPTIONS });
      await _subscriber.connect();
      logger.info("Redis subscriber connection established");
      _subscriber.on("error", (err) => logger.warn({ err: err.message }, "Redis subscriber error"));
      _subscriber.on("close", () => {
        logger.warn("Redis subscriber disconnected");
        _subscriber = null;
      });
      return _subscriber;
    } catch (err) {
      logger.warn({ err }, "Redis subscriber unavailable");
      _subscriber = null;
      return null;
    } finally {
      _connectingSub = null;
    }
  })();

  return _connectingSub;
}

/**
 * Check if the shared Redis client is connected and responsive.
 */
export function isRedisConnected(): boolean {
  return _client !== null && _client.status === "ready";
}

/**
 * Disconnect all Redis connections for graceful shutdown.
 */
export async function disconnectRedis(): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (_subscriber) {
    const sub = _subscriber;
    _subscriber = null;
    tasks.push(sub.quit().then(() => {}).catch(() => {}));
  }

  if (_client) {
    const client = _client;
    _client = null;
    tasks.push(client.quit().then(() => {}).catch(() => {}));
  }

  await Promise.all(tasks);
  logger.info("Redis connections closed");
}
