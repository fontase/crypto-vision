import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache } from "@/lib/cache.js";

// No REDIS_URL → all operations use in-memory only

describe("cache", () => {
  beforeEach(async () => {
    // Clear any leftover state between tests
    // Use del on known keys and rely on fresh keys per test
  });

  // ─── get / set basics ─────────────────────────────────────

  describe("get / set", () => {
    it("returns null for missing keys", async () => {
      expect(await cache.get("nonexistent-key-" + Math.random())).toBeNull();
    });

    it("stores and retrieves a string value", async () => {
      const key = "test-str-" + Date.now();
      await cache.set(key, "hello", 60);
      expect(await cache.get(key)).toBe("hello");
    });

    it("stores and retrieves an object value", async () => {
      const key = "test-obj-" + Date.now();
      const obj = { price: 42_000, symbol: "BTC" };
      await cache.set(key, obj, 60);
      expect(await cache.get(key)).toEqual(obj);
    });

    it("stores and retrieves a numeric value", async () => {
      const key = "test-num-" + Date.now();
      await cache.set(key, 12345, 60);
      expect(await cache.get(key)).toBe(12345);
    });

    it("overwrites existing key with set()", async () => {
      const key = "test-overwrite-" + Date.now();
      await cache.set(key, "first", 60);
      await cache.set(key, "second", 60);
      expect(await cache.get(key)).toBe("second");
    });
  });

  // ─── expiry ───────────────────────────────────────────────

  describe("expiry", () => {
    it("expires entries after TTL", async () => {
      vi.useFakeTimers();
      try {
        const key = "test-expire-" + Date.now();
        await cache.set(key, "ephemeral", 2); // 2 second TTL

        // Immediately available
        expect(await cache.get(key)).toBe("ephemeral");

        // Advance past TTL (2000ms)
        vi.advanceTimersByTime(2100);
        expect(await cache.get(key)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns value before TTL expires", async () => {
      vi.useFakeTimers();
      try {
        const key = "test-no-expire-" + Date.now();
        await cache.set(key, "persistent", 10);

        vi.advanceTimersByTime(5000); // half the TTL
        expect(await cache.get(key)).toBe("persistent");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── eviction ─────────────────────────────────────────────

  describe("eviction (via wrap to fill memory cache)", () => {
    it("stats reports memoryEntries count", async () => {
      const baseEntries = cache.stats().memoryEntries;
      const key = "test-stats-" + Date.now();
      await cache.set(key, "val", 60);
      expect(cache.stats().memoryEntries).toBeGreaterThanOrEqual(baseEntries + 1);
    });

    it("stats has expected shape", () => {
      const stats = cache.stats();
      expect(stats).toHaveProperty("memoryEntries");
      expect(stats).toHaveProperty("memoryMaxSize");
      expect(stats).toHaveProperty("redisConnected");
      expect(stats).toHaveProperty("inflightRequests");
      expect(typeof stats.memoryEntries).toBe("number");
      expect(typeof stats.memoryMaxSize).toBe("number");
      expect(stats.memoryMaxSize).toBe(50_000);
    });
  });

  // ─── del ──────────────────────────────────────────────────

  describe("del", () => {
    it("removes a cached value", async () => {
      const key = "test-del-" + Date.now();
      await cache.set(key, "to-delete", 60);
      expect(await cache.get(key)).toBe("to-delete");
      await cache.del(key);
      expect(await cache.get(key)).toBeNull();
    });

    it("is a no-op for non-existent keys", async () => {
      // Should not throw
      await cache.del("nonexistent-del-" + Date.now());
    });
  });

  // ─── wrap (cache-aside + stampede protection) ──────────────

  describe("wrap", () => {
    it("calls fn on cache miss and caches the result", async () => {
      const key = "test-wrap-" + Date.now();
      const fn = vi.fn().mockResolvedValue({ data: "fresh" });

      const result = await cache.wrap(key, 60, fn);
      expect(result).toEqual({ data: "fresh" });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("returns cached value without calling fn on cache hit", async () => {
      const key = "test-wrap-hit-" + Date.now();
      const fn1 = vi.fn().mockResolvedValue("first-call");
      const fn2 = vi.fn().mockResolvedValue("second-call");

      await cache.wrap(key, 60, fn1);
      const result = await cache.wrap(key, 60, fn2);
      expect(result).toBe("first-call");
      expect(fn2).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent calls for the same key (stampede protection)", async () => {
      const key = "test-stampede-" + Date.now();
      let callCount = 0;
      const fn = () =>
        new Promise<string>((resolve) => {
          callCount++;
          setTimeout(() => resolve("stampede-result"), 50);
        });

      // Fire multiple concurrent requests for the same key
      const promises = Array.from({ length: 5 }, () => cache.wrap(key, 60, fn));
      const results = await Promise.all(promises);

      expect(callCount).toBe(1); // Only one actual fetch
      results.forEach((r) => expect(r).toBe("stampede-result"));
    });

    it("serves stale value and refreshes in background", async () => {
      vi.useFakeTimers();
      try {
        const key = "test-stale-" + Date.now();
        const fn1 = vi.fn().mockResolvedValue("original");
        const fn2 = vi.fn().mockResolvedValue("refreshed");

        await cache.wrap(key, 10, fn1); // set with 10s TTL

        // Advance past stale threshold (80% of TTL = 8s)
        vi.advanceTimersByTime(8100);

        // This should return stale value but trigger background refresh
        const result = await cache.wrap(key, 10, fn2);
        expect(result).toBe("original"); // stale value served

        // Let the background refresh complete
        await vi.advanceTimersByTimeAsync(100);
        expect(fn2).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("re-fetches after hard expiry", async () => {
      vi.useFakeTimers();
      try {
        const key = "test-hard-expire-" + Date.now();
        const fn1 = vi.fn().mockResolvedValue("old-data");
        const fn2 = vi.fn().mockResolvedValue("new-data");

        await cache.wrap(key, 5, fn1);
        expect(fn1).toHaveBeenCalledTimes(1);

        // Advance past hard expiry (5000ms)
        vi.advanceTimersByTime(5100);

        const result = await cache.wrap(key, 5, fn2);
        expect(result).toBe("new-data");
        expect(fn2).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("propagates errors from fn on cache miss", async () => {
      const key = "test-wrap-error-" + Date.now();
      const fn = vi.fn().mockRejectedValue(new Error("upstream down"));

      await expect(cache.wrap(key, 60, fn)).rejects.toThrow("upstream down");
    });
  });
});
