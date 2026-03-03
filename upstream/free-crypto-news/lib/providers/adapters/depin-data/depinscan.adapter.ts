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
 * DePINscan Adapter — Decentralized Physical Infrastructure Network Data
 *
 * DePINscan (by IoTeX) tracks the DePIN ecosystem:
 * - Project metrics (devices, revenue, market cap)
 * - Network growth over time
 * - Category breakdowns (wireless, compute, sensors, etc.)
 * - Real-time node/device counts
 *
 * DePIN is a top 2025-2026 narrative — real-world infrastructure
 * tokenized on-chain (Helium, Hivemapper, DIMO, Render, Filecoin, etc.)
 *
 * Rate limit: ~30 requests/min (free, no key required)
 *
 * API: https://depinscan.io (public API)
 *
 * @module providers/adapters/depin-data/depinscan
 */

import type { DataProvider, FetchParams, RateLimitConfig } from "../../types";
import type { DePINProject } from "./types";

const BASE = "https://api.depinscan.io/api";

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60_000,
};

export const depinscanAdapter: DataProvider<DePINProject[]> = {
  name: "depinscan",
  description:
    "DePINscan — DePIN ecosystem metrics: device counts, revenue, growth (free, no key)",
  priority: 1,
  weight: 0.55,
  rateLimit: RATE_LIMIT,
  capabilities: ["depin-data"],

  async fetch(params: FetchParams): Promise<DePINProject[]> {
    const limit = params.limit ?? 50;
    const now = new Date().toISOString();

    const res = await fetch(`${BASE}/projects?limit=${limit}`, {
      headers: {
        "User-Agent": "free-crypto-news/2.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`DePINscan API error: ${res.status}`);
    }

    const projects: DePINscanProject[] = await res.json();

    return projects.slice(0, limit).map(
      (p): DePINProject => ({
        name: p.name ?? "Unknown",
        symbol: (p.symbol ?? "").toUpperCase(),
        slug: p.slug ?? "",
        category: mapCategory(p.category),
        marketCap: p.market_cap ?? 0,
        fdv: p.fdv ?? 0,
        price: p.price ?? 0,
        priceChange24h: p.price_change_24h ?? 0,
        activeDevices: p.active_devices ?? p.device_count ?? 0,
        deviceGrowth30d: p.device_growth_30d ?? 0,
        monthlyRevenue: p.monthly_revenue ?? 0,
        totalRevenue: p.total_revenue ?? 0,
        chains: p.chains ?? [],
        website: p.website,
        source: "depinscan",
        timestamp: now,
      }),
    );
  },

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/projects?limit=1`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: DePINProject[]): boolean {
    return Array.isArray(data) && data.length > 0;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, DePINProject["category"]> = {
  wireless: "wireless",
  compute: "compute",
  storage: "storage",
  sensor: "sensor",
  sensors: "sensor",
  energy: "energy",
  mapping: "mapping",
  cdn: "cdn",
};

function mapCategory(raw?: string): DePINProject["category"] {
  if (!raw) return "other";
  return CATEGORY_MAP[raw.toLowerCase()] ?? "other";
}

// ────────────────────────────────────────────────────────────────────────────
// Internal types
// ────────────────────────────────────────────────────────────────────────────

interface DePINscanProject {
  name?: string;
  symbol?: string;
  slug?: string;
  category?: string;
  market_cap?: number;
  fdv?: number;
  price?: number;
  price_change_24h?: number;
  active_devices?: number;
  device_count?: number;
  device_growth_30d?: number;
  monthly_revenue?: number;
  total_revenue?: number;
  chains?: string[];
  website?: string;
}
