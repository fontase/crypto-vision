/**
 * Crypto Vision — API Key Authentication Middleware
 *
 * Four usage tiers:
 *  - public     (no key)  — 30 req/min
 *  - basic      (API key) — 200 req/min
 *  - pro        (API key) — 2 000 req/min
 *  - enterprise (API key) — 10 000 req/min
 *
 * Keys are loaded from:
 *  1. API_KEYS env var (comma-separated, with optional tier suffix)
 *  2. Redis (persistent across deploys — `cv:keys:*`)
 *
 * On startup, env keys are seeded into Redis so they survive restarts.
 * Dynamically created keys (POST /api/keys) are persisted to Redis.
 *
 * Admin operations require a key listed in ADMIN_API_KEYS.
 */

import type { Context, Next } from "hono";
import { logger } from "./logger.js";
import { getRedis } from "./redis.js";

// ─── Hono Context Augmentation ───────────────────────────────

declare module "hono" {
  interface ContextVariableMap {
    apiKey: string;
    apiTier: ApiTier;
  }
}

// ─── Tier Definitions ────────────────────────────────────────

export type ApiTier = "public" | "basic" | "pro" | "enterprise";

export interface TierConfig {
  rateLimit: number;      // requests per window
  windowSeconds: number;  // window size
}

export const TIER_LIMITS: Record<ApiTier, TierConfig> = {
  public:     { rateLimit: 30, windowSeconds: 60 },
  basic:      { rateLimit: 200, windowSeconds: 60 },
  pro:        { rateLimit: 2000, windowSeconds: 60 },
  enterprise: { rateLimit: 10_000, windowSeconds: 60 },
};

// ─── Key Store ───────────────────────────────────────────────

export interface KeyEntry {
  key: string;
  tier: ApiTier;
  createdAt: string;
}

/**
 * In-memory key store — acts as a fast L1 cache.
 * Authoritative source is Redis; memory is synced on startup and writes.
 */
const keyStore = new Map<string, KeyEntry>();

/** Admin key set (cannot be generated via API) */
const adminKeys = new Set<string>();

const REDIS_KEY_PREFIX = "cv:keys:";

/** Persist a key entry to Redis for cross-instance + cross-deploy durability. */
async function persistKeyToRedis(entry: KeyEntry): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(`${REDIS_KEY_PREFIX}${entry.key}`, JSON.stringify(entry));
  } catch {
    logger.warn("Failed to persist API key to Redis");
  }
}

/** Load a single key from Redis (fallback when memory misses). */
async function loadKeyFromRedis(apiKey: string): Promise<KeyEntry | null> {
  const r = await getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(`${REDIS_KEY_PREFIX}${apiKey}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as KeyEntry;
    // Backfill memory
    keyStore.set(apiKey, entry);
    return entry;
  } catch {
    return null;
  }
}

/** Load all keys from Redis into memory (called on startup). */
async function syncKeysFromRedis(): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await r.scan(
        cursor, "MATCH", `${REDIS_KEY_PREFIX}*`, "COUNT", 200,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        const values = await r.mget(...keys);
        for (const raw of values) {
          if (!raw) continue;
          try {
            const entry = JSON.parse(raw) as KeyEntry;
            if (!keyStore.has(entry.key)) {
              keyStore.set(entry.key, entry);
            }
          } catch { /* skip corrupted entries */ }
        }
      }
    } while (cursor !== "0");
    logger.info(`Auth: synced ${keyStore.size} key(s) from Redis`);
  } catch (err) {
    logger.warn({ err }, "Auth: failed to sync keys from Redis — using env-only");
  }
}

/** Load keys from environment on startup, then sync Redis. */
function loadKeysFromEnv(): void {
  const raw = process.env.API_KEYS || "";
  const validTiers = new Set(Object.keys(TIER_LIMITS));

  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [key, tierRaw] = entry.split(":");
    const tier: ApiTier = validTiers.has(tierRaw) ? (tierRaw as ApiTier) : "basic";
    keyStore.set(key, { key, tier, createdAt: new Date().toISOString() });
  }

  const adminRaw = process.env.ADMIN_API_KEYS || "";
  for (const key of adminRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
    adminKeys.add(key);
    if (!keyStore.has(key)) {
      keyStore.set(key, { key, tier: "pro", createdAt: new Date().toISOString() });
    }
  }

  logger.info(`Auth: loaded ${keyStore.size} API key(s) from env, ${adminKeys.size} admin key(s)`);
}

loadKeysFromEnv();

// Async: sync from Redis + seed env keys into Redis (non-blocking)
void (async () => {
  await syncKeysFromRedis();
  // Seed env keys into Redis so they persist
  for (const entry of keyStore.values()) {
    await persistKeyToRedis(entry);
  }
})();

// ─── Key helpers (used by routes/keys.ts) ────────────────────

export async function lookupKey(apiKey: string): Promise<KeyEntry | undefined> {
  const memEntry = keyStore.get(apiKey);
  if (memEntry) return memEntry;
  // Fallback to Redis for keys created on other instances
  const redisEntry = await loadKeyFromRedis(apiKey);
  return redisEntry ?? undefined;
}

export async function addKey(entry: KeyEntry): Promise<void> {
  keyStore.set(entry.key, entry);
  await persistKeyToRedis(entry);
}

export function isAdmin(apiKey: string): boolean {
  return adminKeys.has(apiKey);
}

// ─── Usage Tracking ──────────────────────────────────────────

export interface UsageRecord {
  requests: number;
  windowStart: number;
}

const usageMap = new Map<string, UsageRecord>();

export function trackUsage(apiKey: string): void {
  const now = Date.now();
  const windowMs = 60_000;
  let record = usageMap.get(apiKey);
  if (!record || now - record.windowStart > windowMs) {
    record = { requests: 0, windowStart: now };
    usageMap.set(apiKey, record);
  }
  record.requests++;
}

export function getUsage(apiKey: string): UsageRecord | undefined {
  return usageMap.get(apiKey);
}

// ─── Middleware ───────────────────────────────────────────────

/**
 * API key auth middleware.
 * Reads `X-API-Key` header (or `Authorization: Bearer` token),
 * resolves tier, and stores it on `c.set()`.
 *
 * Variables attached to context:
 *  - `apiTier`  — "public" | "basic" | "pro" | "enterprise"
 *  - `apiKey`   — the raw key string or "anonymous"
 */
export function apiKeyAuth() {
  return async (c: Context, next: Next) => {
    // Support both X-API-Key header and Authorization: Bearer
    const header =
      c.req.header("X-API-Key") ||
      c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");

    if (!header) {
      c.set("apiTier", "public" as ApiTier);
      c.set("apiKey", "anonymous");
      await next();
      return;
    }

    // Check memory first, then Redis
    let entry = keyStore.get(header);
    if (!entry) {
      const redisEntry = await loadKeyFromRedis(header);
      if (redisEntry) entry = redisEntry;
    }

    if (!entry) {
      return c.json(
        { error: "INVALID_API_KEY", message: "The provided API key is not valid." },
        401,
      );
    }

    c.set("apiTier", entry.tier);
    c.set("apiKey", header);

    trackUsage(header);

    await next();
  };
}

/**
 * Guard that requires an admin API key.
 * Must be applied AFTER `apiKeyAuth()`.
 */
export function requireAdmin() {
  return async (c: Context, next: Next) => {
    const apiKey = c.get("apiKey") as string | undefined;
    if (!apiKey || !adminKeys.has(apiKey)) {
      return c.json(
        { error: "FORBIDDEN", message: "Admin access required." },
        403,
      );
    }
    await next();
  };
}
