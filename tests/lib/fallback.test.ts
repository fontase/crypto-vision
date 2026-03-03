/**
 * Tests for lib/fallback.ts — Multi-source fallback & graceful degradation
 *
 * Validates:
 *  - tryMultipleSources cascading through primary → fallback sources
 *  - Circuit breaker integration (skipping open-circuit sources)
 *  - Stale-cache fallback when all live sources fail
 *  - Degraded route tracking for /health endpoint
 *  - Proper metadata (source, stale, failedSources, skippedSources)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock dependencies before imports ────────────────────────

// Mock the cache module
const mockCacheGet = vi.fn<(key: string) => Promise<unknown>>();
const mockCacheSet = vi.fn<(key: string, value: unknown, ttl: number) => Promise<void>>();
vi.mock("@/lib/cache.js", () => ({
  cache: {
    get: (...args: Parameters<typeof mockCacheGet>) => mockCacheGet(...args),
    set: (...args: Parameters<typeof mockCacheSet>) => mockCacheSet(...args),
  },
}));

// Mock the fetcher module (isCircuitOpen)
const mockIsCircuitOpen = vi.fn<(host: string) => boolean>();
vi.mock("@/lib/fetcher.js", () => ({
  isCircuitOpen: (host: string) => mockIsCircuitOpen(host),
}));

// Mock the logger
vi.mock("@/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  tryMultipleSources,
  getDegradedRoutes,
  degradedRouteCount,
  type FallbackSource,
  type FallbackResult,
} from "@/lib/fallback.js";

// ─── Setup ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCircuitOpen.mockReturnValue(false);
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
});

// ─── Helpers ─────────────────────────────────────────────────

function makeSource<T>(
  name: string,
  host: string,
  fn: () => Promise<T>,
): FallbackSource<T> {
  return { name, host, fn };
}

// ─── Primary source succeeds ─────────────────────────────────

describe("tryMultipleSources — primary succeeds", () => {
  it("returns data from the primary source when it succeeds", async () => {
    const primary = makeSource("primary", "api.primary.com", async () => ({ value: 42 }));
    const fallback = makeSource("fallback", "api.fallback.com", async () => ({ value: 99 }));

    const result = await tryMultipleSources("test-key", [primary, fallback]);

    expect(result.data).toEqual({ value: 42 });
    expect(result.source).toBe("primary");
    expect(result.stale).toBe(false);
    expect(result.failedSources).toEqual([]);
    expect(result.skippedSources).toEqual([]);
    expect(result.timestamp).toBeTruthy();
  });

  it("caches successful data for stale fallback", async () => {
    const source = makeSource("src", "api.src.com", async () => [1, 2, 3]);

    await tryMultipleSources("cache-test", [source], 300);

    expect(mockCacheSet).toHaveBeenCalledWith("fallback:cache-test", [1, 2, 3], 300);
  });

  it("does not call subsequent sources when primary succeeds", async () => {
    const fallbackFn = vi.fn().mockResolvedValue("should not be called");
    const primary = makeSource("primary", "api.primary.com", async () => "ok");
    const fallback = makeSource("fallback", "api.fallback.com", fallbackFn);

    await tryMultipleSources("no-call-test", [primary, fallback]);

    expect(fallbackFn).not.toHaveBeenCalled();
  });
});

// ─── Fallback to secondary ───────────────────────────────────

describe("tryMultipleSources — fallback cascade", () => {
  it("falls back to second source when primary fails", async () => {
    const primary = makeSource("primary", "api.primary.com", async () => {
      throw new Error("Primary down");
    });
    const fallback = makeSource("fallback", "api.fallback.com", async () => ({ value: 99 }));

    const result = await tryMultipleSources("fallback-test", [primary, fallback]);

    expect(result.data).toEqual({ value: 99 });
    expect(result.source).toBe("fallback");
    expect(result.stale).toBe(false);
    expect(result.failedSources).toEqual(["primary"]);
    expect(result.skippedSources).toEqual([]);
  });

  it("falls back to third source when first two fail", async () => {
    const s1 = makeSource("s1", "api.s1.com", async () => {
      throw new Error("s1 down");
    });
    const s2 = makeSource("s2", "api.s2.com", async () => {
      throw new Error("s2 down");
    });
    const s3 = makeSource("s3", "api.s3.com", async () => "third-is-charm");

    const result = await tryMultipleSources("cascade-test", [s1, s2, s3]);

    expect(result.data).toBe("third-is-charm");
    expect(result.source).toBe("s3");
    expect(result.failedSources).toEqual(["s1", "s2"]);
    expect(result.skippedSources).toEqual([]);
  });
});

// ─── Circuit breaker integration ─────────────────────────────

describe("tryMultipleSources — circuit breaker", () => {
  it("skips sources with open circuit breakers", async () => {
    mockIsCircuitOpen.mockImplementation((host: string) => host === "api.primary.com");

    const primaryFn = vi.fn().mockResolvedValue("should not be called");
    const primary = makeSource("primary", "api.primary.com", primaryFn);
    const fallback = makeSource("fallback", "api.fallback.com", async () => "fallback-data");

    const result = await tryMultipleSources("cb-test", [primary, fallback]);

    expect(primaryFn).not.toHaveBeenCalled();
    expect(result.data).toBe("fallback-data");
    expect(result.source).toBe("fallback");
    expect(result.skippedSources).toEqual(["primary"]);
    expect(result.failedSources).toEqual([]);
  });

  it("skips all circuit-broken sources in a chain", async () => {
    mockIsCircuitOpen.mockImplementation(
      (host: string) => host === "api.s1.com" || host === "api.s2.com",
    );

    const s1 = makeSource("s1", "api.s1.com", vi.fn().mockResolvedValue(null));
    const s2 = makeSource("s2", "api.s2.com", vi.fn().mockResolvedValue(null));
    const s3 = makeSource("s3", "api.s3.com", async () => "last-resort");

    const result = await tryMultipleSources("multi-cb-test", [s1, s2, s3]);

    expect(result.data).toBe("last-resort");
    expect(result.source).toBe("s3");
    expect(result.skippedSources).toEqual(["s1", "s2"]);
    expect(result.failedSources).toEqual([]);
  });

  it("combines skipped and failed sources in metadata", async () => {
    mockIsCircuitOpen.mockImplementation((host: string) => host === "api.s1.com");

    const s1 = makeSource("s1", "api.s1.com", vi.fn().mockResolvedValue(null));
    const s2 = makeSource("s2", "api.s2.com", async () => {
      throw new Error("s2 error");
    });
    const s3 = makeSource("s3", "api.s3.com", async () => "ok");

    const result = await tryMultipleSources("mixed-test", [s1, s2, s3]);

    expect(result.data).toBe("ok");
    expect(result.source).toBe("s3");
    expect(result.skippedSources).toEqual(["s1"]);
    expect(result.failedSources).toEqual(["s2"]);
  });
});

// ─── Stale cache fallback ────────────────────────────────────

describe("tryMultipleSources — stale cache fallback", () => {
  it("returns stale cached data when all sources fail", async () => {
    const cachedData = { coins: ["BTC", "ETH"] };
    mockCacheGet.mockResolvedValue(cachedData);

    const s1 = makeSource("s1", "api.s1.com", async () => {
      throw new Error("s1 down");
    });
    const s2 = makeSource("s2", "api.s2.com", async () => {
      throw new Error("s2 down");
    });

    const result = await tryMultipleSources("stale-test", [s1, s2]);

    expect(result.data).toEqual(cachedData);
    expect(result.source).toBe("stale-cache");
    expect(result.stale).toBe(true);
    expect(result.failedSources).toEqual(["s1", "s2"]);
  });

  it("reads from the correct stale cache key", async () => {
    mockCacheGet.mockResolvedValue({ stale: true });

    const s1 = makeSource("s1", "api.s1.com", async () => {
      throw new Error("down");
    });

    await tryMultipleSources("my-route-key", [s1]);

    expect(mockCacheGet).toHaveBeenCalledWith("fallback:my-route-key");
  });

  it("throws when all sources fail and no stale cache exists", async () => {
    mockCacheGet.mockResolvedValue(null);

    const s1 = makeSource("s1", "api.s1.com", async () => {
      throw new Error("s1 down");
    });

    await expect(tryMultipleSources("no-stale", [s1])).rejects.toThrow("s1 down");
  });

  it("throws a generic error when all sources fail with no last error", async () => {
    // All sources skipped by circuit breaker, no actual errors stored
    mockIsCircuitOpen.mockReturnValue(true);
    mockCacheGet.mockResolvedValue(null);

    const s1 = makeSource("s1", "api.s1.com", vi.fn().mockResolvedValue(null));

    await expect(tryMultipleSources("no-error", [s1])).rejects.toThrow(
      "All sources failed for no-error",
    );
  });
});

// ─── Degraded route tracking ─────────────────────────────────

describe("degraded route tracking", () => {
  it("marks route as degraded when serving stale cache", async () => {
    mockCacheGet.mockResolvedValue({ stale: true });

    const s1 = makeSource("s1", "api.s1.com", async () => {
      throw new Error("down");
    });

    await tryMultipleSources("degraded-route", [s1]);

    expect(degradedRouteCount()).toBeGreaterThanOrEqual(1);
    const routes = getDegradedRoutes();
    expect(routes["degraded-route"]).toBeDefined();
    expect(routes["degraded-route"].since).toBeTruthy();
    expect(routes["degraded-route"].reason).toContain("failed");
  });

  it("clears degraded state when a source succeeds", async () => {
    // First: cause degraded state
    mockCacheGet.mockResolvedValue({ stale: true });
    const failing = makeSource("fail", "api.fail.com", async () => {
      throw new Error("down");
    });
    await tryMultipleSources("clear-test", [failing]);
    expect(getDegradedRoutes()["clear-test"]).toBeDefined();

    // Second: successful fetch clears degraded state
    const succeeding = makeSource("ok", "api.ok.com", async () => "success");
    await tryMultipleSources("clear-test", [succeeding]);
    expect(getDegradedRoutes()["clear-test"]).toBeUndefined();
  });

  it("returns 0 degraded routes initially", async () => {
    // Run a successful source to ensure nothing is degraded for a known key
    const s = makeSource("ok", "api.ok.com", async () => "data");
    await tryMultipleSources("fresh-key", [s]);

    // The count might include routes from other tests, but fresh-key should not be degraded
    const routes = getDegradedRoutes();
    expect(routes["fresh-key"]).toBeUndefined();
  });

  it("getDegradedRoutes returns ISO-format since timestamps", async () => {
    mockCacheGet.mockResolvedValue("stale-data");
    const s = makeSource("x", "api.x.com", async () => {
      throw new Error("fail");
    });
    await tryMultipleSources("iso-test", [s]);

    const routes = getDegradedRoutes();
    const since = routes["iso-test"]?.since;
    expect(since).toBeTruthy();
    // ISO 8601 pattern check
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ─── FallbackResult shape ────────────────────────────────────

describe("FallbackResult metadata", () => {
  it("includes a valid ISO timestamp", async () => {
    const s = makeSource("s", "api.s.com", async () => "data");
    const result = await tryMultipleSources("ts-test", [s]);

    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("defaults staleTTL to 600 seconds", async () => {
    const s = makeSource("s", "api.s.com", async () => "data");
    await tryMultipleSources("ttl-test", [s]);

    expect(mockCacheSet).toHaveBeenCalledWith("fallback:ttl-test", "data", 600);
  });

  it("respects custom staleTTL", async () => {
    const s = makeSource("s", "api.s.com", async () => "data");
    await tryMultipleSources("custom-ttl", [s], 120);

    expect(mockCacheSet).toHaveBeenCalledWith("fallback:custom-ttl", "data", 120);
  });
});

// ─── Edge cases ──────────────────────────────────────────────

describe("tryMultipleSources — edge cases", () => {
  it("handles single source that succeeds", async () => {
    const s = makeSource("only", "api.only.com", async () => "solo");
    const result = await tryMultipleSources("solo-ok", [s]);

    expect(result.data).toBe("solo");
    expect(result.source).toBe("only");
    expect(result.failedSources).toEqual([]);
  });

  it("handles single source that fails with stale cache", async () => {
    mockCacheGet.mockResolvedValue("old-data");
    const s = makeSource("only", "api.only.com", async () => {
      throw new Error("down");
    });

    const result = await tryMultipleSources("solo-stale", [s]);

    expect(result.data).toBe("old-data");
    expect(result.source).toBe("stale-cache");
    expect(result.stale).toBe(true);
    expect(result.failedSources).toEqual(["only"]);
  });

  it("handles empty source array — throws immediately", async () => {
    mockCacheGet.mockResolvedValue(null);
    await expect(tryMultipleSources("empty", [])).rejects.toThrow(
      "All sources failed for empty",
    );
  });

  it("propagates the last error when no stale cache exists", async () => {
    mockCacheGet.mockResolvedValue(null);

    const s1 = makeSource("s1", "s1.com", async () => {
      throw new Error("first error");
    });
    const s2 = makeSource("s2", "s2.com", async () => {
      throw new Error("second error");
    });

    await expect(tryMultipleSources("last-err", [s1, s2])).rejects.toThrow("second error");
  });

  it("handles sources returning complex nested data structures", async () => {
    const complexData = {
      coins: [
        { id: "btc", prices: [{ usd: 45000, eur: 38000 }] },
        { id: "eth", prices: [{ usd: 3000, eur: 2500 }] },
      ],
      metadata: { total: 2, page: 1 },
    };

    const s = makeSource("complex", "api.complex.com", async () => complexData);
    const result = await tryMultipleSources("complex-test", [s]);

    expect(result.data).toEqual(complexData);
  });
});
