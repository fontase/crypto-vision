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
 * Request Fingerprinting — Detect distributed scraping and bot networks
 *
 * Even when IPs rotate, scrapers often share fingerprints:
 *   - Same TLS JA3/JA4 hash
 *   - Same Accept/Accept-Language patterns
 *   - Same request timing patterns
 *   - Sequential page enumeration
 *   - Identical or missing `Referer` headers
 *
 * This module groups requests by fingerprint and applies collective
 * rate limits to the fingerprint cluster.
 *
 * @module security/request-fingerprint
 */

import { createHash } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface RequestSignals {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  accept: string;
  referer?: string;
  secChUa?: string;
  /** TLS JA3 or JA4 hash if available from CDN headers */
  tlsFingerprint?: string;
}

export interface FingerprintCluster {
  fingerprint: string;
  ips: Set<string>;
  requestCount: number;
  firstSeen: number;
  lastSeen: number;
}

export interface FingerprintConfig {
  /** Max requests per fingerprint per minute before flagging. Default: 300 */
  maxRpmPerFingerprint: number;
  /** Min unique IPs in a cluster to be considered distributed. Default: 3 */
  minIpsForDistributed: number;
  /** Max tracked fingerprints. Default: 10000 */
  maxFingerprints: number;
}

const DEFAULT_CONFIG: FingerprintConfig = {
  maxRpmPerFingerprint: 300,
  minIpsForDistributed: 3,
  maxFingerprints: 10_000,
};

// =============================================================================
// FINGERPRINTER
// =============================================================================

export class RequestFingerprinter {
  private clusters = new Map<string, FingerprintCluster>();
  private minuteCounts = new Map<string, { count: number; resetAt: number }>();
  private config: FingerprintConfig;

  constructor(config?: Partial<FingerprintConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute a fingerprint from request signals and track it.
   *
   * @returns The fingerprint hash and whether this cluster is suspicious
   */
  track(signals: RequestSignals): {
    fingerprint: string;
    suspicious: boolean;
    clusterSize: number;
    reason?: string;
  } {
    const fingerprint = this.computeFingerprint(signals);
    const now = Date.now();

    // Get or create cluster
    let cluster = this.clusters.get(fingerprint);
    if (!cluster) {
      cluster = {
        fingerprint,
        ips: new Set(),
        requestCount: 0,
        firstSeen: now,
        lastSeen: now,
      };
      this.clusters.set(fingerprint, cluster);
    }

    cluster.ips.add(signals.ip);
    cluster.requestCount++;
    cluster.lastSeen = now;

    // Per-minute tracking
    let minute = this.minuteCounts.get(fingerprint);
    if (!minute || now >= minute.resetAt) {
      minute = { count: 0, resetAt: now + 60_000 };
      this.minuteCounts.set(fingerprint, minute);
    }
    minute.count++;

    // Check for suspicious behavior
    let suspicious = false;
    let reason: string | undefined;

    // High request rate from same fingerprint
    if (minute.count > this.config.maxRpmPerFingerprint) {
      suspicious = true;
      reason = `Fingerprint ${fingerprint.slice(0, 8)} exceeds ${this.config.maxRpmPerFingerprint} rpm`;
    }

    // Distributed scraping: same fingerprint from many IPs
    if (cluster.ips.size >= this.config.minIpsForDistributed && minute.count > 100) {
      suspicious = true;
      reason = `Distributed scraping: fingerprint from ${cluster.ips.size} IPs`;
    }

    return {
      fingerprint,
      suspicious,
      clusterSize: cluster.ips.size,
      reason,
    };
  }

  /**
   * Get cluster info for a fingerprint.
   */
  getCluster(fingerprint: string): FingerprintCluster | undefined {
    return this.clusters.get(fingerprint);
  }

  /**
   * List all suspicious clusters.
   */
  getSuspiciousClusters(): FingerprintCluster[] {
    return [...this.clusters.values()].filter(
      (c) => c.ips.size >= this.config.minIpsForDistributed,
    );
  }

  /**
   * Prune old entries.
   */
  prune(): void {
    const now = Date.now();
    const staleThreshold = 30 * 60_000; // 30 min

    for (const [key, cluster] of this.clusters) {
      if (now - cluster.lastSeen > staleThreshold) {
        this.clusters.delete(key);
        this.minuteCounts.delete(key);
      }
    }

    // Hard cap
    if (this.clusters.size > this.config.maxFingerprints) {
      const sorted = [...this.clusters.entries()]
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      const toRemove = sorted.slice(0, sorted.length - this.config.maxFingerprints);
      for (const [key] of toRemove) {
        this.clusters.delete(key);
        this.minuteCounts.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INTERNAL
  // ---------------------------------------------------------------------------

  private computeFingerprint(signals: RequestSignals): string {
    const components = [
      signals.userAgent,
      signals.acceptLanguage,
      signals.accept,
      signals.secChUa ?? '',
      signals.tlsFingerprint ?? '',
    ].join('|');

    return createHash('sha256').update(components).digest('hex').slice(0, 16);
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const requestFingerprinter = new RequestFingerprinter();

if (typeof setInterval !== 'undefined') {
  setInterval(() => requestFingerprinter.prune(), 10 * 60_000);
}
