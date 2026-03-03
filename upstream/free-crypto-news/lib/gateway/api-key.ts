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
 * API Key Management — Validation, issuance, rotation, and usage tracking
 *
 * Tier hierarchy:
 *   free      — No API key. IP-based rate limiting: 30 req/min, 1,000/day
 *   starter   — Free API key (cda_*). 300 req/min, 50,000/day
 *   pro       — Paid $29/mo (cda_pro_*). 3,000 req/min, unlimited
 *   enterprise— Paid $199/mo (cda_ent_*). 30,000 req/min, SLA
 *
 * Keys are stored hashed (SHA-256) in Vercel KV / Upstash Redis.
 * The plaintext key is only ever shown once on creation.
 *
 * @module gateway/api-key
 */

import { randomBytes, createHash } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export type ApiTier = 'free' | 'starter' | 'pro' | 'enterprise';

export interface ApiKeyRecord {
  /** The SHA-256 hash of the actual key */
  keyHash: string;
  /** Key prefix (first 8 chars) for identification */
  prefix: string;
  /** Owner email */
  email: string;
  /** Subscription tier */
  tier: ApiTier;
  /** When the key was created */
  createdAt: string;
  /** When the key was last used */
  lastUsedAt: string | null;
  /** When the key was last rotated */
  rotatedAt: string | null;
  /** Whether the key is active */
  active: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface TierLimits {
  /** Requests per minute */
  requestsPerMinute: number;
  /** Requests per day */
  requestsPerDay: number;
  /** Max results per response */
  maxResults: number;
  /** Whether AI/premium endpoints are accessible */
  aiAccess: boolean;
  /** Whether historical/archive endpoints are accessible */
  archiveAccess: boolean;
  /** Whether WebSocket connections are allowed */
  wsAccess: boolean;
  /** Rate limit burst allowance */
  burstSize: number;
}

export interface UsageRecord {
  /** Current minute's request count */
  minuteCount: number;
  /** Current day's request count */
  dayCount: number;
  /** Total lifetime requests */
  totalRequests: number;
  /** Remaining requests this minute */
  remainingMinute: number;
  /** Remaining requests today */
  remainingDay: number;
}

// =============================================================================
// TIER CONFIGURATION
// =============================================================================

export const TIER_LIMITS: Record<ApiTier, TierLimits> = {
  free: {
    requestsPerMinute: 30,
    requestsPerDay: 1_000,
    maxResults: 25,
    aiAccess: false,
    archiveAccess: false,
    wsAccess: false,
    burstSize: 10,
  },
  starter: {
    requestsPerMinute: 300,
    requestsPerDay: 50_000,
    maxResults: 100,
    aiAccess: false,
    archiveAccess: true,
    wsAccess: true,
    burstSize: 50,
  },
  pro: {
    requestsPerMinute: 3_000,
    requestsPerDay: -1, // unlimited
    maxResults: 500,
    aiAccess: true,
    archiveAccess: true,
    wsAccess: true,
    burstSize: 200,
  },
  enterprise: {
    requestsPerMinute: 30_000,
    requestsPerDay: -1, // unlimited
    maxResults: 1_000,
    aiAccess: true,
    archiveAccess: true,
    wsAccess: true,
    burstSize: 1000,
  },
};

// =============================================================================
// KEY GENERATION
// =============================================================================

const PREFIX_MAP: Record<ApiTier, string> = {
  free: 'cda_free_',
  starter: 'cda_',
  pro: 'cda_pro_',
  enterprise: 'cda_ent_',
};

/**
 * Generate a new API key for the given tier.
 *
 * @returns The plaintext key (show once) and the record to store
 */
export function generateApiKey(
  email: string,
  tier: ApiTier = 'starter',
  metadata?: Record<string, unknown>,
): { plaintextKey: string; record: ApiKeyRecord } {
  const prefix = PREFIX_MAP[tier];
  const random = randomBytes(24).toString('base64url');
  const plaintextKey = `${prefix}${random}`;

  const keyHash = hashKey(plaintextKey);

  return {
    plaintextKey,
    record: {
      keyHash,
      prefix: plaintextKey.slice(0, 12),
      email,
      tier,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      rotatedAt: null,
      active: true,
      metadata,
    },
  };
}

/**
 * Rotate an existing key — generates a new random portion, same tier.
 */
export function rotateApiKey(
  existingRecord: ApiKeyRecord,
): { plaintextKey: string; record: ApiKeyRecord } {
  const prefix = PREFIX_MAP[existingRecord.tier];
  const random = randomBytes(24).toString('base64url');
  const plaintextKey = `${prefix}${random}`;
  const keyHash = hashKey(plaintextKey);

  return {
    plaintextKey,
    record: {
      ...existingRecord,
      keyHash,
      prefix: plaintextKey.slice(0, 12),
      rotatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Hash a plaintext API key for storage.
 */
export function hashKey(plaintextKey: string): string {
  return createHash('sha256').update(plaintextKey).digest('hex');
}

/**
 * Parse the tier from a key prefix.
 */
export function parseTierFromKey(key: string): ApiTier {
  if (key.startsWith('cda_ent_')) return 'enterprise';
  if (key.startsWith('cda_pro_')) return 'pro';
  if (key.startsWith('cda_free_')) return 'free';
  if (key.startsWith('cda_')) return 'starter';
  return 'free';
}

/**
 * Build X-RateLimit-* headers for the response.
 */
export function rateLimitHeaders(tier: ApiTier, usage: UsageRecord): Record<string, string> {
  const limits = TIER_LIMITS[tier];
  return {
    'X-RateLimit-Limit': String(limits.requestsPerMinute),
    'X-RateLimit-Remaining': String(Math.max(0, usage.remainingMinute)),
    'X-RateLimit-Reset': String(Math.ceil(Date.now() / 60_000) * 60),
    'X-RateLimit-Day-Limit': limits.requestsPerDay === -1 ? 'unlimited' : String(limits.requestsPerDay),
    'X-RateLimit-Day-Remaining': limits.requestsPerDay === -1 ? 'unlimited' : String(Math.max(0, usage.remainingDay)),
    'X-Api-Tier': tier,
  };
}

/**
 * Check if a request is within rate limits.
 */
export function isWithinLimits(tier: ApiTier, usage: UsageRecord): boolean {
  const limits = TIER_LIMITS[tier];
  if (usage.minuteCount >= limits.requestsPerMinute) return false;
  if (limits.requestsPerDay !== -1 && usage.dayCount >= limits.requestsPerDay) return false;
  return true;
}
