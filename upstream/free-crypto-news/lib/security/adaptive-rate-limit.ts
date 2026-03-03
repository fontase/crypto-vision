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
 * Adaptive Rate Limiting — Tightens limits under load
 *
 * Normal operation uses standard tier limits. When load shedder reports
 * elevated levels (YELLOW/ORANGE/RED), rate limits are progressively
 * tightened to protect the system.
 *
 * Multipliers:
 *   GREEN  → 1.0x (normal limits)
 *   YELLOW → 0.5x (halve limits)
 *   ORANGE → 0.25x (quarter limits)
 *   RED    → 0.1x (10% limits, critical endpoints only)
 *
 * @module security/adaptive-rate-limit
 */

import type { ServiceLevel } from '../load-shedding';
import { loadShedder } from '../load-shedding';

// =============================================================================
// TYPES
// =============================================================================

export interface AdaptiveRateLimitConfig {
  /** Base requests per minute for the tier */
  baseRpm: number;
  /** Base requests per day for the tier */
  baseRpd: number;
  /** Load level multipliers */
  multipliers: Record<ServiceLevel, number>;
}

const DEFAULT_MULTIPLIERS: Record<ServiceLevel, number> = {
  GREEN: 1.0,
  YELLOW: 0.5,
  ORANGE: 0.25,
  RED: 0.1,
};

// =============================================================================
// ADAPTIVE RATE LIMITER
// =============================================================================

export class AdaptiveRateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private dailyWindows = new Map<string, { count: number; resetAt: number }>();
  private multipliers: Record<ServiceLevel, number>;

  constructor(multipliers?: Record<ServiceLevel, number>) {
    this.multipliers = multipliers ?? DEFAULT_MULTIPLIERS;
  }

  /**
   * Check and increment rate limit for a given identifier.
   *
   * @param identifier  IP address or API key hash
   * @param baseRpm     Base requests per minute for this tier
   * @param baseRpd     Base requests per day (-1 for unlimited)
   * @returns Whether the request is allowed and remaining counts
   */
  check(
    identifier: string,
    baseRpm: number,
    baseRpd: number,
  ): { allowed: boolean; remainingMinute: number; remainingDay: number; retryAfterMs?: number } {
    const state = loadShedder.getState();
    const multiplier = this.multipliers[state.level];

    const effectiveRpm = Math.max(1, Math.floor(baseRpm * multiplier));
    const effectiveRpd = baseRpd === -1 ? -1 : Math.max(1, Math.floor(baseRpd * multiplier));

    const now = Date.now();

    // Per-minute window
    const minuteKey = `m:${identifier}`;
    let minute = this.windows.get(minuteKey);
    if (!minute || now >= minute.resetAt) {
      minute = { count: 0, resetAt: now + 60_000 };
      this.windows.set(minuteKey, minute);
    }

    // Per-day window
    const dayKey = `d:${identifier}`;
    let daily = this.dailyWindows.get(dayKey);
    if (!daily || now >= daily.resetAt) {
      daily = { count: 0, resetAt: now + 86_400_000 };
      this.dailyWindows.set(dayKey, daily);
    }

    // Check limits
    if (minute.count >= effectiveRpm) {
      return {
        allowed: false,
        remainingMinute: 0,
        remainingDay: effectiveRpd === -1 ? -1 : Math.max(0, effectiveRpd - daily.count),
        retryAfterMs: minute.resetAt - now,
      };
    }

    if (effectiveRpd !== -1 && daily.count >= effectiveRpd) {
      return {
        allowed: false,
        remainingMinute: Math.max(0, effectiveRpm - minute.count),
        remainingDay: 0,
        retryAfterMs: daily.resetAt - now,
      };
    }

    // Allowed — increment
    minute.count++;
    daily.count++;

    return {
      allowed: true,
      remainingMinute: Math.max(0, effectiveRpm - minute.count),
      remainingDay: effectiveRpd === -1 ? -1 : Math.max(0, effectiveRpd - daily.count),
    };
  }

  /**
   * Prune expired windows to prevent memory leaks.
   * Call periodically (e.g., every 5 minutes).
   */
  prune(): void {
    const now = Date.now();
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
    for (const [key, window] of this.dailyWindows) {
      if (now >= window.resetAt) this.dailyWindows.delete(key);
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const adaptiveRateLimiter = new AdaptiveRateLimiter();

// Prune expired windows every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => adaptiveRateLimiter.prune(), 5 * 60_000);
}
