/**
 * Tests for lib/cache.ts — MemoryCache + unified cache interface
 *
 * Redis is not available in test — all tests exercise the in-memory path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { cache } from "../../lib/cache.js";

// Ensure REDIS_URL is unset so we stay in memory-only mode
vi.stubEnv("REDIS_URL", "");

beforeEach(async () => {
  // Clear all cached data between tests
  await cache.del("test-get-set");
  await cache.del("test-wrap-miss");
  await cache.del("test-wrap-cached");
  await cache.del("test-del");
  await cache.del("test-stampede");
  await cache.del("test-stale");
});

// ─── get / set ───────────────────────────────────────────────

describe("cache.get / cache.set", () => {
  it("returns null for a key that was never set", async () => {
    const result = await cache.get("totally-unknown-key");
    expect(result).toBeNull();
  });

  it("stores and retrieves a value", async () => {
    await cache.set("test-get-set", { foo: "bar" }, 60);
    const val = await cache.get("test-get-set");
    expect(val).toEqual({ foo: "bar" });
  });

  it("stores different types (string, number, array)", async () => {
    await cache.set("t-str", "hello", 60);
    expect(await cache.get("t-str")).toBe("hello");

    await cache.set("t-num", 42, 60);
    expect(await cache.get("t-num")).toBe(42);

    await cache.set("t-arr", [1, 2, 3], 60);
    expect(await cache.get("t-arr")).toEqual([1, 2, 3]);

    // cleanup
    await cache.del("t-str");
    await cache.del("t-num");
    await cache.del("t-arr");
  });
});

// ─── wrap ────────────────────────────────────────────────────

describe("cache.wrap", () => {
  it("calls fn on cache miss and caches the result", async () => {
    const fn = vi.fn().mockResolvedValue({ price: 100 });

    const result = await cache.wrap("test-wrap-miss", 60, fn);
    expect(result).toEqual({ price: 100 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns cached value on subsequent calls without invoking fn", async () => {
    const fn1 = vi.fn().mockResolvedValue("first");
    const fn2 = vi.fn().mockResolvedValue("second");

    await cache.wrap("test-wrap-cached", 60, fn1);
    const result = await cache.wrap("test-wrap-cached", 60, fn2);

    expect(result).toBe("first");
    expect(fn2).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent calls for the same key (stampede protection)", async () => {
    let callCount = 0;
    const fn = () =>
      new Promise<string>((resolve) => {
        callCount++;
        setTimeout(() => resolve("result"), 50);
      });

    // Fire 5 concurrent wraps for the same key
    const results = await Promise.all([
      cache.wrap("test-stampede", 60, fn),
      cache.wrap("test-stampede", 60, fn),
      cache.wrap("test-stampede", 60, fn),
      cache.wrap("test-stampede", 60, fn),
      cache.wrap("test-stampede", 60, fn),
    ]);

    // All should receive the same result
    expect(results).toEqual(["result", "result", "result", "result", "result"]);
    // But fn should only be called once (single-flight)
    expect(callCount).toBe(1);
  });
});

// ─── del ─────────────────────────────────────────────────────

describe("cache.del", () => {
  it("removes a cached key", async () => {
    await cache.set("test-del", "to-remove", 60);
    expect(await cache.get("test-del")).toBe("to-remove");

    await cache.del("test-del");
    expect(await cache.get("test-del")).toBeNull();
  });

  it("is a no-op for non-existent keys", async () => {
    // Should not throw
    await expect(cache.del("nonexistent-key-xyz")).resolves.toBeUndefined();
  });
});

// ─── stats ───────────────────────────────────────────────────

describe("cache.stats", () => {
  it("returns the expected shape", () => {
    const stats = cache.stats();
    expect(stats).toHaveProperty("memoryEntries");
    expect(stats).toHaveProperty("memoryMaxSize");
    expect(stats).toHaveProperty("redisConnected");
    expect(stats).toHaveProperty("inflightRequests");
    expect(typeof stats.memoryEntries).toBe("number");
    expect(typeof stats.memoryMaxSize).toBe("number");
    expect(typeof stats.redisConnected).toBe("boolean");
    expect(typeof stats.inflightRequests).toBe("number");
  });

  it("reflects entry count after set operations", async () => {
    const before = cache.stats().memoryEntries;
    await cache.set("stats-test-key", "val", 60);
    const after = cache.stats().memoryEntries;
    expect(after).toBeGreaterThanOrEqual(before);
    await cache.del("stats-test-key");
  });

  it("redisConnected is false when REDIS_URL is empty", () => {
    expect(cache.stats().redisConnected).toBe(false);
  });
});
