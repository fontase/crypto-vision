import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rateLimit } from "@/lib/rate-limit.js";
import type { RateLimitConfig } from "@/lib/rate-limit.js";

// ─── Hono Context Mock ───────────────────────────────────────

function createMockContext(ip = "192.168.1.1") {
  const headers = new Map<string, string>();
  let responseStatus = 200;
  let responseBody: unknown = null;

  const c = {
    req: {
      header: vi.fn((name: string) => {
        if (name === "x-forwarded-for") return ip;
        if (name === "x-real-ip") return ip;
        return undefined;
      }),
    },
    header: vi.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
    json: vi.fn((body: unknown, status?: number) => {
      responseBody = body;
      responseStatus = status ?? 200;
      return { body, status: responseStatus };
    }),
    // helper accessors for assertions
    _getHeaders: () => Object.fromEntries(headers),
    _getStatus: () => responseStatus,
    _getBody: () => responseBody,
  };

  return c;
}

// ─── Tests ───────────────────────────────────────────────────

describe("rateLimit middleware", () => {
  // We don't set REDIS_URL so everything uses in-memory backend

  describe("window enforcement", () => {
    it("allows requests under the limit", async () => {
      const middleware = rateLimit({ limit: 5, windowSeconds: 60, prefix: "test-allow" });
      const c = createMockContext("10.0.0.1");
      const next = vi.fn();

      await middleware(c as any, next);

      expect(next).toHaveBeenCalledTimes(1);
      // Should not return a 429
      expect(c.json).not.toHaveBeenCalled();
    });

    it("blocks requests exceeding the limit", async () => {
      const middleware = rateLimit({ limit: 3, windowSeconds: 60, prefix: "test-block" });
      const ip = "10.0.0.2";
      const next = vi.fn();

      // Make 3 allowed requests
      for (let i = 0; i < 3; i++) {
        const c = createMockContext(ip);
        await middleware(c as any, next);
        expect(c.json).not.toHaveBeenCalled();
      }

      expect(next).toHaveBeenCalledTimes(3);

      // 4th request should be rate limited
      const blocked = createMockContext(ip);
      const result = await middleware(blocked as any, next);

      expect(blocked.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "RATE_LIMIT_EXCEEDED",
        }),
        429,
      );
      // next should NOT be called for the blocked request
      expect(next).toHaveBeenCalledTimes(3);
    });

    it("resets counter after window expires", async () => {
      vi.useFakeTimers();
      try {
        const middleware = rateLimit({ limit: 2, windowSeconds: 10, prefix: "test-reset" });
        const ip = "10.0.0.3";
        const next = vi.fn();

        // Exhaust limit
        for (let i = 0; i < 2; i++) {
          const c = createMockContext(ip);
          await middleware(c as any, next);
        }

        // Should be blocked
        const blocked = createMockContext(ip);
        await middleware(blocked as any, next);
        expect(blocked.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: "RATE_LIMIT_EXCEEDED" }),
          429,
        );

        // Advance past window
        vi.advanceTimersByTime(11_000);

        // Should be allowed again
        const renewed = createMockContext(ip);
        await middleware(renewed as any, next);
        expect(renewed.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(3); // 2 + the renewed one
      } finally {
        vi.useRealTimers();
      }
    });

    it("tracks different IPs independently", async () => {
      const middleware = rateLimit({ limit: 1, windowSeconds: 60, prefix: "test-ips" });
      const next = vi.fn();

      // First IP — allowed
      const c1 = createMockContext("10.0.1.1");
      await middleware(c1 as any, next);
      expect(c1.json).not.toHaveBeenCalled();

      // Second IP — allowed (separate counter)
      const c2 = createMockContext("10.0.1.2");
      await middleware(c2 as any, next);
      expect(c2.json).not.toHaveBeenCalled();

      // First IP again — blocked
      const c1b = createMockContext("10.0.1.1");
      await middleware(c1b as any, next);
      expect(c1b.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "RATE_LIMIT_EXCEEDED" }),
        429,
      );
    });
  });

  // ─── Header setting ────────────────────────────────────────

  describe("header setting", () => {
    it("sets X-RateLimit-Limit header", async () => {
      const middleware = rateLimit({ limit: 100, windowSeconds: 60, prefix: "test-hdr-limit" });
      const c = createMockContext("10.0.2.1");
      const next = vi.fn();

      await middleware(c as any, next);

      expect(c.header).toHaveBeenCalledWith("X-RateLimit-Limit", "100");
    });

    it("sets X-RateLimit-Remaining header", async () => {
      const middleware = rateLimit({ limit: 5, windowSeconds: 60, prefix: "test-hdr-remain" });
      const next = vi.fn();

      const c1 = createMockContext("10.0.2.2");
      await middleware(c1 as any, next);
      expect(c1.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "4");

      const c2 = createMockContext("10.0.2.2");
      await middleware(c2 as any, next);
      expect(c2.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "3");
    });

    it("sets X-RateLimit-Reset header as unix timestamp", async () => {
      const middleware = rateLimit({ limit: 10, windowSeconds: 60, prefix: "test-hdr-reset" });
      const c = createMockContext("10.0.2.3");
      const next = vi.fn();

      await middleware(c as any, next);

      // Find the X-RateLimit-Reset call
      const resetCall = c.header.mock.calls.find(
        ([name]: [string, string]) => name === "X-RateLimit-Reset",
      );
      expect(resetCall).toBeDefined();

      const resetValue = Number(resetCall![1]);
      const nowSec = Math.ceil(Date.now() / 1000);
      // Reset should be in the future, within the window
      expect(resetValue).toBeGreaterThanOrEqual(nowSec);
      expect(resetValue).toBeLessThanOrEqual(nowSec + 61);
    });

    it("remaining is 0 when limit is reached (not negative)", async () => {
      const middleware = rateLimit({ limit: 1, windowSeconds: 60, prefix: "test-hdr-zero" });
      const next = vi.fn();

      const c1 = createMockContext("10.0.2.4");
      await middleware(c1 as any, next);
      expect(c1.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");

      // Over limit — still 0, not negative
      const c2 = createMockContext("10.0.2.4");
      await middleware(c2 as any, next);
      expect(c2.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");
    });

    it("sets Retry-After header when rate limited", async () => {
      const middleware = rateLimit({ limit: 1, windowSeconds: 30, prefix: "test-hdr-retry" });
      const next = vi.fn();

      // Use up the limit
      const c1 = createMockContext("10.0.2.5");
      await middleware(c1 as any, next);

      // Blocked request should have Retry-After
      const c2 = createMockContext("10.0.2.5");
      await middleware(c2 as any, next);

      const retryCall = c2.header.mock.calls.find(
        ([name]: [string, string]) => name === "Retry-After",
      );
      expect(retryCall).toBeDefined();

      const retryValue = Number(retryCall![1]);
      expect(retryValue).toBeGreaterThan(0);
      expect(retryValue).toBeLessThanOrEqual(30);
    });
  });

  // ─── Default config ────────────────────────────────────────

  describe("default config", () => {
    it("uses default limit of 200 and 60s window", async () => {
      const middleware = rateLimit(); // no config = defaults
      const c = createMockContext("10.0.3.1");
      const next = vi.fn();

      await middleware(c as any, next);

      expect(c.header).toHaveBeenCalledWith("X-RateLimit-Limit", "200");
      expect(c.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "199");
    });
  });

  // ─── IP extraction ─────────────────────────────────────────

  describe("IP extraction", () => {
    it("uses x-forwarded-for for client IP", async () => {
      const middleware = rateLimit({ limit: 1, windowSeconds: 60, prefix: "test-xff" });
      const next = vi.fn();

      // Custom context with x-forwarded-for containing multiple IPs
      const c = {
        req: {
          header: vi.fn((name: string) => {
            if (name === "x-forwarded-for") return "1.2.3.4, 5.6.7.8";
            return undefined;
          }),
        },
        header: vi.fn(),
        json: vi.fn(),
      };

      await middleware(c as any, next);
      expect(next).toHaveBeenCalled();

      // Second request from same first IP in x-forwarded-for should be blocked
      const c2 = {
        req: {
          header: vi.fn((name: string) => {
            if (name === "x-forwarded-for") return "1.2.3.4, 9.9.9.9";
            return undefined;
          }),
        },
        header: vi.fn(),
        json: vi.fn(),
      };

      await middleware(c2 as any, next);
      expect(c2.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "RATE_LIMIT_EXCEEDED" }),
        429,
      );
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
      const middleware = rateLimit({ limit: 1, windowSeconds: 60, prefix: "test-realip" });
      const next = vi.fn();

      const c = {
        req: {
          header: vi.fn((name: string) => {
            if (name === "x-forwarded-for") return undefined;
            if (name === "x-real-ip") return "99.99.99.99";
            return undefined;
          }),
        },
        header: vi.fn(),
        json: vi.fn(),
      };

      await middleware(c as any, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // ─── Response body shape ───────────────────────────────────

  describe("429 response body", () => {
    it("returns structured error with retryAfter", async () => {
      const middleware = rateLimit({ limit: 1, windowSeconds: 30, prefix: "test-body" });
      const next = vi.fn();

      const c1 = createMockContext("10.0.4.1");
      await middleware(c1 as any, next);

      const c2 = createMockContext("10.0.4.1");
      await middleware(c2 as any, next);

      expect(c2.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "RATE_LIMIT_EXCEEDED",
          message: expect.stringContaining("Too many requests"),
          retryAfter: expect.any(Number),
        }),
        429,
      );
    });
  });
});
