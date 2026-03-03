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
 * API Key Usage Endpoint
 *
 * GET /api/keys/usage — Returns detailed usage statistics for an API key
 *
 * Authentication: API key via X-API-Key header, Authorization: Bearer, or ?api_key= query param
 *
 * Response includes:
 * - Today's usage count
 * - Monthly usage count
 * - All-time usage count
 * - Last 7 days daily breakdown
 * - Rate limit info (limit, remaining, reset time)
 * - Tier info (name, features, permissions)
 *
 * @module api/keys/usage
 */

import { type NextRequest, NextResponse } from 'next/server';
import {
  validateApiKey,
  extractApiKey,
  getUsageStats,
  API_KEY_TIERS,
  isKvConfigured,
} from '@/lib/api-keys';
import { API_TIERS } from '@/lib/x402/pricing';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Extract API key
  const rawKey = extractApiKey(request);

  if (!rawKey) {
    return NextResponse.json(
      {
        error: 'API key required',
        message: 'Provide your API key via X-API-Key header, Authorization: Bearer <key>, or ?api_key= query param',
        docs: '/api/register',
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

  try {
    // Validate the key
    const keyData = await validateApiKey(rawKey);

    if (!keyData) {
      return NextResponse.json(
        { error: 'Invalid or revoked API key' },
        { status: 401 }
      );
    }

    const tierConfig = API_KEY_TIERS[keyData.tier];

    // Get detailed usage stats from KV
    const usageStats = await getUsageStats(keyData.id);

    const todayUsage = usageStats?.today ?? keyData.usageToday ?? 0;
    const limit = tierConfig.requestsPerDay;
    const remaining = limit === -1 ? -1 : Math.max(0, limit - todayUsage);

    return NextResponse.json(
      {
        key: {
          id: keyData.id,
          prefix: keyData.keyPrefix,
          name: keyData.name,
          tier: keyData.tier,
          active: keyData.active,
          createdAt: keyData.createdAt,
          lastUsedAt: keyData.lastUsedAt,
        },

        usage: {
          today: todayUsage,
          month: usageStats?.month ?? keyData.usageMonth ?? 0,
          allTime: usageStats?.allTime ?? 0,
          daily: usageStats?.daily ?? {},
        },

        rateLimit: {
          limit,
          remaining,
          resetAt: usageStats?.resetAt ?? null,
          tier: keyData.tier,
          burstLimit: tierConfig.requestsPerMinute,
        },

        tier: {
          name: tierConfig.name,
          price: API_TIERS[keyData.tier]?.priceDisplay ?? 'Free',
          features: tierConfig.features,
          permissions: keyData.permissions,
        },

        upgrade: keyData.tier === 'free'
          ? {
              message: 'Upgrade to Pro for 50,000 requests/day and AI access',
              endpoint: '/api/keys/upgrade',
              tiers: Object.entries(API_TIERS)
                .filter(([id]) => id !== 'free')
                .map(([id, t]) => ({
                  id,
                  name: t.name,
                  price: t.priceDisplay,
                  requestsPerDay: t.requestsPerDay,
                })),
            }
          : undefined,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
        },
      }
    );
  } catch (error) {
    console.error('[API Keys] Usage endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage data' },
      { status: 500 }
    );
  }
}
