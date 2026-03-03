/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

/**
 * API Route Security Utilities
 *
 * Reusable security helpers for Next.js API route handlers.
 * Covers:
 * - HTTP method enforcement
 * - Request origin validation
 * - JSON body parsing with size limits
 * - Response header hardening
 * - Safe error responses (no stack traces in production)
 *
 * @module lib/api-security
 */

import { type NextRequest, NextResponse } from 'next/server';

// =============================================================================
// HTTP METHOD ENFORCEMENT
// =============================================================================

type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/**
 * Validate the HTTP method of a request and return a 405 if not allowed.
 *
 * @param request - Incoming request
 * @param allowed - Array of allowed HTTP methods
 * @returns NextResponse with 405 if method is not allowed, null if OK
 *
 * @example
 * const methodError = enforceMethod(request, ['GET', 'HEAD']);
 * if (methodError) return methodError;
 */
export function enforceMethod(
  request: NextRequest,
  allowed: HttpMethod[],
): NextResponse | null {
  if (allowed.includes(request.method as HttpMethod)) return null;

  return NextResponse.json(
    {
      error: 'Method Not Allowed',
      code: 'METHOD_NOT_ALLOWED',
      message: `This endpoint supports: ${allowed.join(', ')}`,
      timestamp: new Date().toISOString(),
    },
    {
      status: 405,
      headers: {
        Allow: allowed.join(', '),
        'Content-Type': 'application/json',
        ...HARDENED_HEADERS,
      },
    },
  );
}

// =============================================================================
// CORS PREFLIGHT
// =============================================================================

/**
 * Handle CORS preflight (OPTIONS) requests with proper security headers.
 *
 * @param allowedMethods - Methods to advertise in Access-Control-Allow-Methods
 * @returns NextResponse for OPTIONS request
 */
export function corsPreflightResponse(
  allowedMethods: HttpMethod[] = ['GET', 'POST', 'OPTIONS'],
): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': allowedMethods.join(', '),
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-API-Key, X-Request-ID, X-CSRF-Token',
      'Access-Control-Expose-Headers':
        'X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After',
      'Access-Control-Max-Age': '86400',
      ...HARDENED_HEADERS,
    },
  });
}

// =============================================================================
// SAFE JSON BODY PARSING
// =============================================================================

/**
 * Safely parse JSON body with size limit enforcement.
 * Returns a typed object or an error response.
 *
 * @param request - Incoming request
 * @param maxBytes - Maximum allowed body size (default: 1 MB)
 * @returns Parsed body or NextResponse error
 *
 * @example
 * const result = await safeParseJsonBody<{ title: string }>(request);
 * if (result instanceof NextResponse) return result; // error
 * console.log(result.title); // typed
 */
export async function safeParseJsonBody<T = unknown>(
  request: NextRequest,
  maxBytes = 1_048_576,
): Promise<T | NextResponse> {
  // Check content-type
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      {
        error: 'Unsupported Media Type',
        code: 'INVALID_CONTENT_TYPE',
        message: 'Content-Type must be application/json',
        timestamp: new Date().toISOString(),
      },
      { status: 415, headers: HARDENED_HEADERS },
    );
  }

  // Check content-length upfront
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const len = parseInt(contentLength, 10);
    if (!isNaN(len) && len > maxBytes) {
      return NextResponse.json(
        {
          error: 'Payload Too Large',
          code: 'REQUEST_TOO_LARGE',
          message: `Body exceeds ${maxBytes} bytes`,
          timestamp: new Date().toISOString(),
        },
        { status: 413, headers: HARDENED_HEADERS },
      );
    }
  }

  try {
    const body = await request.json();

    // Reject non-object bodies (arrays, primitives) unless explicitly desired
    if (body === null || typeof body !== 'object') {
      return NextResponse.json(
        {
          error: 'Invalid Request Body',
          code: 'INVALID_JSON',
          message: 'Request body must be a JSON object',
          timestamp: new Date().toISOString(),
        },
        { status: 400, headers: HARDENED_HEADERS },
      );
    }

    return body as T;
  } catch {
    return NextResponse.json(
      {
        error: 'Invalid JSON',
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
        timestamp: new Date().toISOString(),
      },
      { status: 400, headers: HARDENED_HEADERS },
    );
  }
}

// =============================================================================
// RESPONSE HARDENING
// =============================================================================

/**
 * Standard hardened headers applied to every API response.
 * These supplement the global middleware headers with API-specific values.
 */
export const HARDENED_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
} as const;

/**
 * Create a hardened JSON response with security headers baked in.
 *
 * @param data - Response payload
 * @param status - HTTP status code (default: 200)
 * @param extraHeaders - Optional additional headers
 * @returns NextResponse with security headers
 */
export function secureJsonResponse<T>(
  data: T,
  status = 200,
  extraHeaders: Record<string, string> = {},
): NextResponse<T> {
  return NextResponse.json(data, {
    status,
    headers: {
      ...HARDENED_HEADERS,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

// =============================================================================
// SAFE ERROR RESPONSES
// =============================================================================

/**
 * Create an error response that never leaks stack traces or internal details
 * in production.
 *
 * @param message - User-facing error message
 * @param code - Machine-readable error code
 * @param status - HTTP status code
 * @param devDetails - Details only included in development
 * @returns NextResponse
 */
export function safeErrorResponse(
  message: string,
  code: string,
  status: number,
  devDetails?: unknown,
): NextResponse {
  const body: Record<string, unknown> = {
    error: message,
    code,
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === 'development' && devDetails) {
    body.details = devDetails;
  }

  return NextResponse.json(body, {
    status,
    headers: HARDENED_HEADERS,
  });
}

// =============================================================================
// REQUEST FINGERPRINTING (lightweight, for abuse detection)
// =============================================================================

/**
 * Derive a short fingerprint from request metadata.
 * NOT a substitute for proper auth — used for abuse heuristics.
 *
 * @param request - Incoming request
 * @returns A short hash string
 */
export async function requestFingerprint(request: NextRequest): Promise<string> {
  const parts = [
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    request.headers.get('user-agent') ?? '',
    request.headers.get('accept-language') ?? '',
  ].join('|');

  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(parts),
  );
  const hash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hash.substring(0, 16); // 64 bits of entropy — enough for fingerpress
}
