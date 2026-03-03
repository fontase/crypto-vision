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
 * API Key Rotation Endpoint
 *
 * POST /api/keys/rotate — Rotate an API key (generate new, invalidate old)
 *
 * Authentication: Current API key via X-API-Key header
 *
 * Request body:
 * {
 *   "email": "user@example.com"   // Must match the email on the key
 * }
 *
 * Response:
 * - New API key (shown only once!)
 * - Key metadata
 * - Old key is immediately invalidated
 *
 * @module api/keys/rotate
 */

import { type NextRequest, NextResponse } from 'next/server';
import {
  validateApiKey,
  extractApiKey,
  rotateApiKey,
  isKvConfigured,
} from '@/lib/api-keys';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // Extract current API key
  const rawKey = extractApiKey(request);

  if (!rawKey) {
    return NextResponse.json(
      {
        error: 'API key required',
        message: 'Provide your current API key via X-API-Key header to rotate it',
      },
      { status: 401 }
    );
  }

  if (!isKvConfigured()) {
    return NextResponse.json(
      { error: 'Service unavailable', message: 'KV storage not configured' },
      { status: 503 }
    );
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON', message: 'Request body must be valid JSON with { "email": "..." }' },
      { status: 400 }
    );
  }

  const { email } = body;

  if (!email || typeof email !== 'string') {
    return NextResponse.json(
      { error: 'Email required', message: 'Provide the email associated with this API key' },
      { status: 400 }
    );
  }

  try {
    // Validate the current key first
    const keyData = await validateApiKey(rawKey);

    if (!keyData) {
      return NextResponse.json(
        { error: 'Invalid or revoked API key' },
        { status: 401 }
      );
    }

    // Verify email matches
    if (keyData.email !== email) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Email does not match the API key owner' },
        { status: 403 }
      );
    }

    // Rotate the key
    const result = await rotateApiKey(keyData.id, email);

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'API key rotated successfully. SAVE THE NEW KEY — it will only be shown once!',

        newKey: result.key,
        oldKeyPrefix: keyData.keyPrefix,

        details: {
          id: result.data.id,
          prefix: result.data.keyPrefix,
          tier: result.data.tier,
          rateLimit: result.data.rateLimit,
          permissions: result.data.permissions,
        },

        usage: {
          header: `X-API-Key: ${result.key}`,
          bearer: `Authorization: Bearer ${result.key}`,
          queryParam: `?api_key=${result.key}`,
        },

        warning: 'Your old API key has been immediately invalidated. Update all clients with the new key.',
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (error) {
    console.error('[API Keys] Rotate endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to rotate API key' },
      { status: 500 }
    );
  }
}
