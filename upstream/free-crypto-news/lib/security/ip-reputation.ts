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
 * IP Reputation Scoring — Detect and block abusive IPs
 *
 * Maintains a rolling score (0–100) per IP address:
 *   0-30  → Good actor
 *   30-60 → Suspicious (soft-limited)
 *   60-80 → Bad actor (heavily rate-limited)
 *   80+   → Auto-blocked
 *
 * Signals that increase score:
 *   - High request rate (>5x tier limit)
 *   - Repeated 4xx errors
 *   - Scanning patterns (sequential endpoint probing)
 *   - Missing/forged headers
 *   - Known bad user agents (scrapers)
 *
 * Scores decay over time (halve every 30 minutes of inactivity).
 *
 * @module security/ip-reputation
 */

// =============================================================================
// TYPES
// =============================================================================

export interface IpRecord {
  score: number;
  requestCount: number;
  errorCount: number;
  lastSeen: number;
  firstSeen: number;
  uniqueEndpoints: Set<string>;
  blocked: boolean;
}

export interface ReputationConfig {
  /** Score threshold to auto-block. Default: 80 */
  blockThreshold: number;
  /** Score half-life in ms. Default: 1800000 (30 min) */
  decayHalfLifeMs: number;
  /** Max tracked IPs before pruning. Default: 50000 */
  maxEntries: number;
  /** Score increment per signal type */
  weights: {
    rateExceeded: number;
    error4xx: number;
    error403: number;
    scanPattern: number;
    missingHeaders: number;
    badUserAgent: number;
  };
}

const DEFAULT_CONFIG: ReputationConfig = {
  blockThreshold: 80,
  decayHalfLifeMs: 30 * 60_000,
  maxEntries: 50_000,
  weights: {
    rateExceeded: 15,
    error4xx: 5,
    error403: 10,
    scanPattern: 20,
    missingHeaders: 8,
    badUserAgent: 25,
  },
};

const BAD_USER_AGENTS = /python-requests|scrapy|curl\/|wget\/|httpclient|go-http-client/i;

// =============================================================================
// IP REPUTATION TRACKER
// =============================================================================

export class IpReputationTracker {
  private records = new Map<string, IpRecord>();
  private config: ReputationConfig;

  constructor(config?: Partial<ReputationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a request from an IP and return the current reputation.
   */
  recordRequest(
    ip: string,
    info: {
      statusCode?: number;
      endpoint?: string;
      userAgent?: string;
      hasAcceptHeader?: boolean;
    } = {},
  ): { score: number; blocked: boolean } {
    const now = Date.now();
    let record = this.records.get(ip);

    if (!record) {
      record = {
        score: 0,
        requestCount: 0,
        errorCount: 0,
        lastSeen: now,
        firstSeen: now,
        uniqueEndpoints: new Set(),
        blocked: false,
      };
      this.records.set(ip, record);
    }

    // Apply time decay
    const elapsed = now - record.lastSeen;
    if (elapsed > 0) {
      const decayFactor = Math.pow(0.5, elapsed / this.config.decayHalfLifeMs);
      record.score *= decayFactor;
    }

    record.requestCount++;
    record.lastSeen = now;

    if (info.endpoint) {
      record.uniqueEndpoints.add(info.endpoint);
    }

    // Score signals
    const { weights } = this.config;

    // 4xx errors
    if (info.statusCode && info.statusCode >= 400 && info.statusCode < 500) {
      record.errorCount++;
      record.score += info.statusCode === 403 ? weights.error403 : weights.error4xx;
    }

    // Missing Accept header
    if (info.hasAcceptHeader === false) {
      record.score += weights.missingHeaders;
    }

    // Bad user agent
    if (info.userAgent && BAD_USER_AGENTS.test(info.userAgent)) {
      record.score += weights.badUserAgent;
    }

    // Scanning pattern detection: >20 unique endpoints in 5 minutes
    if (record.uniqueEndpoints.size > 20 && now - record.firstSeen < 5 * 60_000) {
      record.score += weights.scanPattern;
    }

    // Cap at 100
    record.score = Math.min(100, record.score);

    // Auto-block
    if (record.score >= this.config.blockThreshold) {
      record.blocked = true;
    }

    return { score: record.score, blocked: record.blocked };
  }

  /**
   * Record a rate limit violation (heavier penalty).
   */
  recordRateExceeded(ip: string): void {
    const record = this.records.get(ip);
    if (record) {
      record.score = Math.min(100, record.score + this.config.weights.rateExceeded);
      if (record.score >= this.config.blockThreshold) {
        record.blocked = true;
      }
    }
  }

  /**
   * Check if an IP is currently blocked.
   */
  isBlocked(ip: string): boolean {
    return this.records.get(ip)?.blocked ?? false;
  }

  /**
   * Manually unblock an IP.
   */
  unblock(ip: string): void {
    const record = this.records.get(ip);
    if (record) {
      record.blocked = false;
      record.score = 0;
    }
  }

  /**
   * Get reputation info for an IP.
   */
  getReputation(ip: string): { score: number; blocked: boolean; requestCount: number } | null {
    const record = this.records.get(ip);
    if (!record) return null;
    return { score: record.score, blocked: record.blocked, requestCount: record.requestCount };
  }

  /**
   * Prune old entries to keep memory bounded.
   */
  prune(): void {
    if (this.records.size <= this.config.maxEntries) return;

    const now = Date.now();
    const staleThreshold = 60 * 60_000; // 1 hour

    // Remove stale entries first
    for (const [ip, record] of this.records) {
      if (now - record.lastSeen > staleThreshold && !record.blocked) {
        this.records.delete(ip);
      }
    }

    // If still over limit, remove lowest-score entries
    if (this.records.size > this.config.maxEntries) {
      const entries = [...this.records.entries()]
        .sort((a, b) => a[1].score - b[1].score);
      const toRemove = entries.slice(0, entries.length - this.config.maxEntries);
      for (const [ip] of toRemove) {
        this.records.delete(ip);
      }
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const ipReputation = new IpReputationTracker();

// Prune every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => ipReputation.prune(), 10 * 60_000);
}
