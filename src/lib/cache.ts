/**
 * Crypto Vision — Cache Layer
 *
 * Two-tier caching designed for 10M+ users:
 *  1. In-memory LRU (instant, per-instance, up to 200k entries)
 *  2. Redis (shared across instances, GCP Memorystore in prod)
 *
 * Scalability features:
 *  - Cache stampede protection (single-flight / request coalescing)
 *  - Stale-while-revalidate: serve stale data while refreshing in background
 *  - Graceful degradation: memory-only if Redis is down
 *  - Batch eviction for efficiency under high load
 *  - Uses shared Redis connection from lib/redis.ts (prevents connection exhaustion)
 *  - Hit/miss counters for observability
 *  - Configurable via environment variables
 *
 * Every upstream call goes through cache.wrap() so we never
 * hammer free-tier APIs and stay well within rate limits.
 */

import { logger } from "./logger.js";
import { getRedis, isRedisConnected, disconnectRedis } from "./redis.js";

// ─── Configuration ───────────────────────────────────────────

const MEMORY_MAX_SIZE = Number(process.env.CACHE_MAX_ENTRIES || 200_000);
const STALE_RATIO = 0.8; // serve stale at 80% TTL

// ─── In-Memory LRU ──────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  /** Soft expiry — serve stale but trigger background refresh */
  staleAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxSize: number;

  // Observability counters
  hits = 0;
  misses = 0;
  staleHits = 0;
  evictions = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get<T>(key: string): { value: T; stale: boolean } | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) { this.misses++; return null; }
    const now = Date.now();
    if (now > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    // Move to end of Map for LRU ordering (Map iteration is insertion order)
    this.store.delete(key);
    this.store.set(key, entry);
    const stale = now > entry.staleAt;
    if (stale) { this.staleHits++; } else { this.hits++; }
    return { value: entry.value, stale };
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    // Evict if at capacity
    if (this.store.size >= this.maxSize) {
      const evictCount = Math.ceil(this.maxSize * 0.1);
      const iter = this.store.keys();
      for (let i = 0; i < evictCount; i++) {
        const k = iter.next().value;
        if (k) this.store.delete(k);
      }
      this.evictions += evictCount;
    }
    const now = Date.now();
    this.store.set(key, {
      value,
      staleAt: now + ttlSeconds * 1000 * STALE_RATIO,
      expiresAt: now + ttlSeconds * 1000,
    });
  }

  delete(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  get size(): number { return this.store.size; }

  /** Hit rate percentage */
  get hitRate(): number {
    const total = this.hits + this.staleHits + this.misses;
    return total === 0 ? 0 : Math.round(((this.hits + this.staleHits) / total) * 10000) / 100;
  }
}

// ─── Single-Flight (Cache Stampede Protection) ───────────────

const inflight = new Map<string, Promise<unknown>>();

// ─── Unified Cache Interface ─────────────────────────────────

const mem = new MemoryCache(MEMORY_MAX_SIZE);

export const cache = {
  /**
   * Get a value, trying memory first, then Redis.
   */
  async get<T>(key: string): Promise<T | null> {
    const memHit = mem.get<T>(key);
    if (memHit !== null && !memHit.stale) return memHit.value;

    const r = await getRedis();
    if (r) {
      try {
        const raw = await r.get(`cv:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as T;
          // Backfill memory with remaining TTL from Redis
          const ttl = await r.ttl(`cv:${key}`).catch(() => 30);
          mem.set(key, parsed, Math.max(ttl, 10));
          return parsed;
        }
      } catch {
        // Redis read failure — not critical
      }
    }

    // Return stale memory data as last resort
    if (memHit !== null) return memHit.value;
    return null;
  },

  /**
   * Set a value in both memory and Redis.
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    mem.set(key, value, ttlSeconds);
    const r = await getRedis();
    if (r) {
      try {
        await r.set(`cv:${key}`, JSON.stringify(value), "EX", ttlSeconds);
      } catch {
        // Redis write failure — not critical
      }
    }
  },

  /**
   * Cache-aside wrapper with stampede protection and stale-while-revalidate.
   *
   * - Fresh hit → return immediately
   * - Stale hit → return stale, refresh in background
   * - Miss → single-flight fetch (1 call even with 10k concurrent requests)
   */
  async wrap<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Check memory for stale-while-revalidate
    const memHit = mem.get<T>(key);
    if (memHit !== null && !memHit.stale) return memHit.value;

    if (memHit !== null && memHit.stale) {
      // Serve stale, refresh in background
      void this._singleFlight(key, ttlSeconds, fn).catch(() => {});
      return memHit.value;
    }

    // Check Redis
    const r = await getRedis();
    if (r) {
      try {
        const raw = await r.get(`cv:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as T;
          mem.set(key, parsed, ttlSeconds);
          return parsed;
        }
      } catch { /* Redis miss */ }
    }

    // Cold miss — single-flight fetch
    return this._singleFlight(key, ttlSeconds, fn);
  },

  /** Deduplicated concurrent fetch for the same cache key. */
  async _singleFlight<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = fn()
      .then(async (result) => { await this.set(key, result, ttlSeconds); return result; })
      .finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
  },

  /** Invalidate a key. */
  async del(key: string): Promise<void> {
    mem.delete(key);
    const r = await getRedis();
    if (r) { try { await r.del(`cv:${key}`); } catch { /* noop */ } }
  },

  /** Stats for /health — includes hit rate metrics for observability. */
  stats() {
    return {
      memoryEntries: mem.size,
      memoryMaxSize: MEMORY_MAX_SIZE,
      memoryHitRate: mem.hitRate,
      memoryHits: mem.hits,
      memoryMisses: mem.misses,
      memoryStaleHits: mem.staleHits,
      memoryEvictions: mem.evictions,
      redisConnected: isRedisConnected(),
      inflightRequests: inflight.size,
    };
  },

  /** Disconnect Redis for graceful shutdown. */
  async disconnect(): Promise<void> {
    await disconnectRedis();
  },
};
