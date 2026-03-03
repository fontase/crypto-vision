/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

import { type NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { isKvConfigured, type ApiKeyData } from '@/lib/api-keys';
import { requireAdminAuth } from '@/lib/admin-auth';
import { API_TIERS } from '@/lib/x402/pricing';

export const runtime = 'nodejs';

async function getAllApiKeys(): Promise<ApiKeyData[]> {
  if (!isKvConfigured()) {
    return [];
  }

  try {
    const keys: ApiKeyData[] = [];
    let cursor: string | number = 0;

    do {
      const result = await kv.scan(cursor, { match: 'apikey:*', count: 100 });
      cursor = result[0] as string | number;
      const keyNames = result[1] as string[];

      for (const keyName of keyNames) {
        // Skip reverse lookup keys
        if (keyName.includes(':id:')) continue;

        const keyData = await kv.get<ApiKeyData>(keyName);
        if (keyData && keyData.id) {
          keys.push(keyData);
        }
      }
    } while (cursor !== 0);

    return keys;
  } catch (error) {
    console.error('Failed to fetch API keys:', error);
    return [];
  }
}

/**
 * Get live usage counts from KV for a given key ID
 */
async function getKeyUsageFromKV(keyId: string): Promise<{
  today: number;
  month: number;
  allTime: number;
}> {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const month = today.substring(0, 7);

    const [todayCount, monthCount, allTimeCount] = await Promise.all([
      kv.get<number>(`usage:${keyId}:${today}`),
      kv.get<number>(`usage:${keyId}:${month}`),
      kv.get<number>(`usage:${keyId}:total`),
    ]);

    return {
      today: todayCount ?? 0,
      month: monthCount ?? 0,
      allTime: allTimeCount ?? 0,
    };
  } catch {
    return { today: 0, month: 0, allTime: 0 };
  }
}

/**
 * Get global platform stats from KV
 */
async function getGlobalStats(): Promise<{
  requestsToday: number;
  requestsThisMonth: number;
}> {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const month = today.substring(0, 7);

    const [todayCount, monthCount] = await Promise.all([
      kv.get<number>(`stats:requests:${today}`),
      kv.get<number>(`stats:requests:${month}`),
    ]);

    return {
      requestsToday: todayCount ?? 0,
      requestsThisMonth: monthCount ?? 0,
    };
  } catch {
    return { requestsToday: 0, requestsThisMonth: 0 };
  }
}

export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const search = searchParams.get('search')?.toLowerCase() || '';
    const tier = searchParams.get('tier') as 'free' | 'pro' | 'enterprise' | null;
    const status = searchParams.get('status') as 'active' | 'inactive' | null;
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 1 : -1;

    let keys = await getAllApiKeys();

    // Apply filters
    if (search) {
      keys = keys.filter(
        (k) =>
          k.email.toLowerCase().includes(search) ||
          k.name.toLowerCase().includes(search) ||
          k.keyPrefix.toLowerCase().includes(search) ||
          k.id.toLowerCase().includes(search)
      );
    }

    if (tier) {
      keys = keys.filter((k) => k.tier === tier);
    }

    if (status === 'active') {
      keys = keys.filter((k) => k.active);
    } else if (status === 'inactive') {
      keys = keys.filter((k) => !k.active);
    }

    // Apply sorting
    keys.sort((a, b) => {
      let aVal: string | number | undefined;
      let bVal: string | number | undefined;

      switch (sortBy) {
        case 'usageToday':
          aVal = a.usageToday || 0;
          bVal = b.usageToday || 0;
          break;
        case 'usageMonth':
          aVal = a.usageMonth || 0;
          bVal = b.usageMonth || 0;
          break;
        case 'lastUsedAt':
          aVal = a.lastUsedAt || '';
          bVal = b.lastUsedAt || '';
          break;
        case 'email':
          aVal = a.email;
          bVal = b.email;
          break;
        case 'tier':
          aVal = a.tier;
          bVal = b.tier;
          break;
        case 'createdAt':
        default:
          aVal = a.createdAt;
          bVal = b.createdAt;
          break;
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * sortOrder;
      }
      return String(aVal).localeCompare(String(bVal)) * sortOrder;
    });

    // Calculate pagination
    const total = keys.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedKeys = keys.slice(offset, offset + limit);

    // Return sanitized key data with live usage (no hashed keys exposed)
    const sanitizedKeysPromises = paginatedKeys.map(async (k) => {
      const liveUsage = await getKeyUsageFromKV(k.id);
      return {
        id: k.id,
        keyPrefix: k.keyPrefix,
        name: k.name,
        email: k.email,
        tier: k.tier,
        permissions: k.permissions,
        rateLimit: k.rateLimit,
        usageToday: liveUsage.today || k.usageToday || 0,
        usageMonth: liveUsage.month || k.usageMonth || 0,
        usageAllTime: liveUsage.allTime,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        active: k.active,
      };
    });
    const sanitizedKeys = await Promise.all(sanitizedKeysPromises);

    // Calculate revenue estimates
    const tierPrices: Record<string, number> = {};
    for (const [id, cfg] of Object.entries(API_TIERS)) {
      tierPrices[id] = (cfg as any).price ?? 0;
    }

    const allKeys = keys; // full unfiltered list for revenue calc
    const totalByTier = {
      free: allKeys.filter((k) => k.tier === 'free' && k.active).length,
      pro: allKeys.filter((k) => k.tier === 'pro' && k.active).length,
      enterprise: allKeys.filter((k) => k.tier === 'enterprise' && k.active).length,
    };

    const mrr = // Monthly Recurring Revenue
      totalByTier.pro * (tierPrices.pro ?? 29) +
      totalByTier.enterprise * (tierPrices.enterprise ?? 99);

    // Global platform stats
    const globalStats = await getGlobalStats();

    return NextResponse.json({
      keys: sanitizedKeys,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      filters: {
        search: search || null,
        tier: tier || null,
        status: status || null,
        sortBy,
        sortOrder: sortOrder === 1 ? 'asc' : 'desc',
      },
      summary: {
        totalKeys: allKeys.length,
        activeKeys: allKeys.filter((k) => k.active).length,
        byTier: totalByTier,
      },
      revenue: {
        mrr,
        arr: mrr * 12,
        currency: 'USD',
        breakdown: {
          pro: { count: totalByTier.pro, pricePerMonth: tierPrices.pro ?? 29, total: totalByTier.pro * (tierPrices.pro ?? 29) },
          enterprise: { count: totalByTier.enterprise, pricePerMonth: tierPrices.enterprise ?? 99, total: totalByTier.enterprise * (tierPrices.enterprise ?? 99) },
        },
      },
      platform: {
        requestsToday: globalStats.requestsToday,
        requestsThisMonth: globalStats.requestsThisMonth,
      },
    });
  } catch (error) {
    console.error('Admin keys error:', error);
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 });
  }
}

// Revoke or update a key
export async function PATCH(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { keyId, action, tier } = body;

    if (!keyId) {
      return NextResponse.json({ error: 'keyId is required' }, { status: 400 });
    }

    if (!isKvConfigured()) {
      return NextResponse.json({ error: 'KV storage not configured' }, { status: 500 });
    }

    // Get the hashed key from the keyId
    const hashedKey = await kv.get<string>(`apikey:id:${keyId}`);
    if (!hashedKey) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }

    const keyData = await kv.get<ApiKeyData>(`apikey:${hashedKey}`);
    if (!keyData) {
      return NextResponse.json({ error: 'Key data not found' }, { status: 404 });
    }

    const updatedData = { ...keyData };

    switch (action) {
      case 'revoke':
        updatedData.active = false;
        break;
      case 'activate':
        updatedData.active = true;
        break;
      case 'upgrade':
        if (tier && ['free', 'pro', 'enterprise'].includes(tier)) {
          updatedData.tier = tier;
        }
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: revoke, activate, or upgrade' },
          { status: 400 }
        );
    }

    await kv.set(`apikey:${hashedKey}`, updatedData);

    return NextResponse.json({
      success: true,
      key: {
        id: updatedData.id,
        keyPrefix: updatedData.keyPrefix,
        email: updatedData.email,
        tier: updatedData.tier,
        active: updatedData.active,
      },
    });
  } catch (error) {
    console.error('Admin key update error:', error);
    return NextResponse.json({ error: 'Failed to update key' }, { status: 500 });
  }
}
