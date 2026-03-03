/**
 * Tests for lib/api-error.ts — Structured Error Response System
 *
 * Exercises the error code mapping, response builders, convenience factories,
 * AppError throwable, and extractErrorMessage utility.
 */

import { describe, expect, it } from "vitest";
import {
    AppError,
    ERROR_CODES,
    extractErrorMessage,
} from "../../src/lib/api-error.js";

// ─── ERROR_CODES ─────────────────────────────────────────────

describe("ERROR_CODES", () => {
    it("has all expected error codes as string constants", () => {
        expect(ERROR_CODES.INVALID_REQUEST).toBe("INVALID_REQUEST");
        expect(ERROR_CODES.NOT_FOUND).toBe("NOT_FOUND");
        expect(ERROR_CODES.RATE_LIMIT_EXCEEDED).toBe("RATE_LIMIT_EXCEEDED");
        expect(ERROR_CODES.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
        expect(ERROR_CODES.UPSTREAM_ERROR).toBe("UPSTREAM_ERROR");
        expect(ERROR_CODES.AI_SERVICE_ERROR).toBe("AI_SERVICE_ERROR");
    });

    it("keys match their values", () => {
        for (const [key, value] of Object.entries(ERROR_CODES)) {
            expect(key).toBe(value);
        }
    });
});

// ─── AppError ────────────────────────────────────────────────

describe("AppError", () => {
    it("creates an error with correct code and status", () => {
        const err = new AppError("NOT_FOUND", "Coin not found");
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("AppError");
        expect(err.code).toBe("NOT_FOUND");
        expect(err.statusCode).toBe(404);
        expect(err.message).toBe("Coin not found");
    });

    it("maps status codes correctly for all error types", () => {
        const cases: Array<[keyof typeof ERROR_CODES, number]> = [
            ["INVALID_REQUEST", 400],
            ["INVALID_JSON", 400],
            ["MISSING_PARAMETER", 400],
            ["VALIDATION_FAILED", 400],
            ["UNAUTHORIZED", 401],
            ["INVALID_API_KEY", 401],
            ["FORBIDDEN", 403],
            ["NOT_FOUND", 404],
            ["METHOD_NOT_ALLOWED", 405],
            ["REQUEST_TOO_LARGE", 413],
            ["RATE_LIMIT_EXCEEDED", 429],
            ["INTERNAL_ERROR", 500],
            ["UPSTREAM_ERROR", 502],
            ["SERVICE_UNAVAILABLE", 503],
            ["TIMEOUT", 504],
        ];

        for (const [code, expectedStatus] of cases) {
            const err = new AppError(code, `Test: ${code}`);
            expect(err.statusCode).toBe(expectedStatus);
        }
    });

    it("stores optional details", () => {
        const err = new AppError("INTERNAL_ERROR", "DB down", {
            details: { host: "db.example.com", timeout: 5000 },
        });
        expect(err.details).toEqual({
            host: "db.example.com",
            timeout: 5000,
        });
    });

    it("stores optional retryAfter", () => {
        const err = new AppError("RATE_LIMIT_EXCEEDED", "Too many requests", {
            retryAfter: 60,
        });
        expect(err.retryAfter).toBe(60);
    });

    it("is catchable as an Error", () => {
        try {
            throw new AppError("NOT_FOUND", "Not here");
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
            expect(e).toBeInstanceOf(AppError);
        }
    });
});

// ─── extractErrorMessage ─────────────────────────────────────

describe("extractErrorMessage", () => {
    it("extracts message from Error instances", () => {
        expect(extractErrorMessage(new Error("boom"))).toBe("boom");
    });

    it("extracts message from AppError instances", () => {
        expect(
            extractErrorMessage(new AppError("NOT_FOUND", "not here")),
        ).toBe("not here");
    });

    it("returns string values directly", () => {
        expect(extractErrorMessage("raw string error")).toBe(
            "raw string error",
        );
    });

    it("converts non-string non-Error values to string", () => {
        expect(extractErrorMessage(42)).toBe("42");
        expect(extractErrorMessage(null)).toBe("null");
        expect(extractErrorMessage(undefined)).toBe("undefined");
        expect(extractErrorMessage({ foo: "bar" })).toBe("[object Object]");
    });
});
