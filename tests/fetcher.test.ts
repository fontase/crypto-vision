import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchJSON, FetchError } from "@/lib/fetcher.js";

// ─── Helpers ─────────────────────────────────────────────────

function mockFetchResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> ?? {}) },
    ...init,
  });
}

function mock429Response(retryAfter = "1") {
  return new Response(JSON.stringify({ error: "rate limited" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": retryAfter },
  });
}

function mockErrorResponse(status: number) {
  return new Response(JSON.stringify({ error: "fail" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Tests ───────────────────────────────────────────────────

describe("fetchJSON", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // ─── Success path ──────────────────────────────────────────

  describe("success", () => {
    it("fetches JSON successfully", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse({ price: 42000 }),
      );

      const result = await fetchJSON<{ price: number }>("https://api.example.com/btc", {
        retries: 0,
        skipCircuitBreaker: true,
      });
      expect(result).toEqual({ price: 42000 });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("sends correct headers and method", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse({ ok: true }),
      );

      await fetchJSON("https://api.example.com/data", {
        retries: 0,
        headers: { "X-Custom": "test" },
        skipCircuitBreaker: true,
      });

      const [, reqInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(reqInit.method).toBe("GET");
      expect(reqInit.headers).toMatchObject({
        Accept: "application/json",
        "User-Agent": "CryptoVision/1.0",
        "X-Custom": "test",
      });
    });

    it("sends POST with JSON body", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockFetchResponse({ created: true }),
      );

      await fetchJSON("https://api.example.com/post", {
        method: "POST",
        body: { name: "test" },
        retries: 0,
        skipCircuitBreaker: true,
      });

      const [, reqInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(reqInit.method).toBe("POST");
      expect(reqInit.body).toBe(JSON.stringify({ name: "test" }));
      expect(reqInit.headers).toMatchObject({ "Content-Type": "application/json" });
    });
  });

  // ─── Retry logic ──────────────────────────────────────────

  describe("retry logic", () => {
    it("retries on failure up to the configured count", async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error("network error"))
        .mockRejectedValueOnce(new Error("network error again"))
        .mockResolvedValue(mockFetchResponse({ recovered: true }));

      globalThis.fetch = fetchMock;

      const promise = fetchJSON("https://api.retry-test.com/data", {
        retries: 2,
        skipCircuitBreaker: true,
      });

      // Advance past backoff timers for the two retries
      await vi.advanceTimersByTimeAsync(2000); // first backoff ~1s
      await vi.advanceTimersByTimeAsync(5000); // second backoff ~2-4s

      const result = await promise;
      expect(result).toEqual({ recovered: true });
      expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("throws after exhausting all retries", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("persistent failure"));

      const promise = fetchJSON("https://api.retry-fail.com/data", {
        retries: 2,
        skipCircuitBreaker: true,
      });

      // Advance past all backoff timers
      await vi.advanceTimersByTimeAsync(20000);

      await expect(promise).rejects.toThrow("persistent failure");
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);

      // Flush any remaining timer callbacks / microtasks to avoid unhandled rejection warnings
      await vi.runAllTimersAsync();
    });

    it("does not retry when retries is 0", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("single failure"));

      await expect(
        fetchJSON("https://api.no-retry.com/data", {
          retries: 0,
          skipCircuitBreaker: true,
        }),
      ).rejects.toThrow("single failure");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Timeout ──────────────────────────────────────────────

  describe("timeout", () => {
    it("aborts request after timeout", async () => {
      // Track the abort rejection so it doesn't become unhandled
      let abortReject: ((reason: unknown) => void) | null = null;
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, init: RequestInit) => {
          const p = new Promise((_resolve, reject) => {
            abortReject = reject;
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          });
          // Suppress unhandled rejection for the mock promise
          p.catch(() => {});
          return p;
        },
      );

      const promise = fetchJSON("https://api.slow.com/data", {
        timeout: 500,
        retries: 0,
        skipCircuitBreaker: true,
      });

      await vi.advanceTimersByTimeAsync(600);

      await expect(promise).rejects.toThrow();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("completes if response arrives before timeout", async () => {
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, _init: RequestInit) =>
          Promise.resolve(mockFetchResponse({ fast: true })),
      );

      const result = await fetchJSON("https://api.fast.com/data", {
        timeout: 5000,
        retries: 0,
        skipCircuitBreaker: true,
      });
      expect(result).toEqual({ fast: true });
    });
  });

  // ─── 429 handling ──────────────────────────────────────────

  describe("429 rate-limit handling", () => {
    it("backs off on 429 and retries using Retry-After header", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mock429Response("1"))
        .mockResolvedValue(mockFetchResponse({ retried: true }));

      globalThis.fetch = fetchMock;

      const promise = fetchJSON("https://api.ratelimit.com/data", {
        retries: 2,
        skipCircuitBreaker: true,
      });

      // Advance past the Retry-After of 1 second
      await vi.advanceTimersByTimeAsync(1500);

      const result = await promise;
      expect(result).toEqual({ retried: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("respects custom Retry-After value", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mock429Response("3"))
        .mockResolvedValue(mockFetchResponse({ done: true }));

      globalThis.fetch = fetchMock;

      const promise = fetchJSON("https://api.ratelimit2.com/data", {
        retries: 2,
        skipCircuitBreaker: true,
      });

      // 3 seconds for retry-after
      await vi.advanceTimersByTimeAsync(3500);

      const result = await promise;
      expect(result).toEqual({ done: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("defaults to 5 second backoff when Retry-After header is missing", async () => {
      const response429 = new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response429)
        .mockResolvedValue(mockFetchResponse({ ok: true }));

      globalThis.fetch = fetchMock;

      const promise = fetchJSON("https://api.ratelimit3.com/data", {
        retries: 2,
        skipCircuitBreaker: true,
      });

      await vi.advanceTimersByTimeAsync(5500);

      const result = await promise;
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── Non-OK responses ─────────────────────────────────────

  describe("HTTP error responses", () => {
    it("throws FetchError with correct status on non-OK response", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockErrorResponse(500));

      const promise = fetchJSON("https://api.error.com/data", {
        retries: 0,
        skipCircuitBreaker: true,
      });

      await expect(promise).rejects.toThrow(FetchError);
      await expect(
        fetchJSON("https://api.error2.com/data", {
          retries: 0,
          skipCircuitBreaker: true,
        }),
      ).rejects.toMatchObject({ status: 500 });
    });
  });

  // ─── Circuit breaker ──────────────────────────────────────

  describe("circuit breaker", () => {
    it("opens circuit after repeated failures", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockErrorResponse(500));

      // Trigger CB_THRESHOLD (default 5) failures
      for (let i = 0; i < 6; i++) {
        try {
          await fetchJSON("https://api.circuit.com/data", {
            retries: 0,
          });
        } catch {
          // expected
        }
      }

      // Next call should get 503 circuit open
      await expect(
        fetchJSON("https://api.circuit.com/data", { retries: 0 }),
      ).rejects.toMatchObject({ status: 503 });
    });

    it("skipCircuitBreaker bypasses circuit check", async () => {
      // Even if circuit is open for a host, skipCircuitBreaker lets us through
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockFetchResponse({ bypass: true }));

      const result = await fetchJSON("https://api.circuit-bypass.com/data", {
        retries: 0,
        skipCircuitBreaker: true,
      });
      expect(result).toEqual({ bypass: true });
    });
  });
});
