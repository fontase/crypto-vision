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
 * StakingRewards Adapter — Staking Yield & Validator Data
 *
 * StakingRewards provides the most comprehensive staking data:
 * - Staking yields across 200+ PoS networks
 * - Real-time reward rates (annual %)
 * - Staking ratios (% of supply staked)
 * - Validator/provider details
 * - Adjusted returns (accounting for inflation)
 *
 * Free tier: Public API endpoints for basic data.
 * Pro tier: Set STAKINGREWARDS_API_KEY for full access.
 *
 * API: https://www.stakingrewards.com/developers
 * env: STAKINGREWARDS_API_KEY (optional, enables richer data)
 *
 * @module providers/adapters/staking-data/stakingrewards
 */

import type { DataProvider, FetchParams, RateLimitConfig } from "../../types";
import type { StakingYield } from "./types";

const BASE = "https://api.stakingrewards.com/public/query";
const STAKINGREWARDS_API_KEY = process.env.STAKINGREWARDS_API_KEY ?? "";

const RATE_LIMIT: RateLimitConfig = {
  maxRequests: STAKINGREWARDS_API_KEY ? 60 : 20,
  windowMs: 60_000,
};

export const stakingRewardsAdapter: DataProvider<StakingYield[]> = {
  name: "stakingrewards",
  description:
    "StakingRewards — Comprehensive staking yields, ratios, and validator data for 200+ PoS chains",
  priority: 1,
  weight: 0.55,
  rateLimit: RATE_LIMIT,
  capabilities: ["staking-data"],

  async fetch(params: FetchParams): Promise<StakingYield[]> {
    const limit = params.limit ?? 50;
    const now = new Date().toISOString();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "free-crypto-news/2.0",
    };

    if (STAKINGREWARDS_API_KEY) {
      headers["X-API-KEY"] = STAKINGREWARDS_API_KEY;
    }

    // GraphQL query for staking assets
    const query = {
      query: `{
        assets(
          where: { isActive: true }
          order: { stakedValueUsd: desc }
          limit: ${limit}
        ) {
          name
          symbol
          slug
          metrics(where: { metricKeys: [
            "reward_rate",
            "adjusted_reward_rate",
            "staking_ratio",
            "staked_value_usd",
            "market_cap",
            "price",
            "inflation_rate",
            "lock_up_period",
            "minimum_staking",
            "validator_count"
          ] }) {
            metricKey
            defaultValue
          }
          tags { name }
        }
      }`,
    };

    const res = await fetch(BASE, {
      method: "POST",
      headers,
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 429) {
      throw new Error("StakingRewards rate limit exceeded (429)");
    }

    if (!res.ok) {
      throw new Error(`StakingRewards API error: ${res.status}`);
    }

    const json = await res.json();
    const assets: SRAsset[] = json?.data?.assets ?? [];

    return assets.slice(0, limit).map((asset): StakingYield => {
      const metrics = metricsToMap(asset.metrics ?? []);
      return {
        name: asset.name ?? "Unknown",
        symbol: (asset.symbol ?? "").toUpperCase(),
        rewardRate: metrics.reward_rate ?? 0,
        adjustedRewardRate: metrics.adjusted_reward_rate ?? 0,
        stakingRatio: metrics.staking_ratio ?? 0,
        stakedValueUsd: metrics.staked_value_usd ?? 0,
        marketCap: metrics.market_cap ?? 0,
        price: metrics.price ?? 0,
        inflationRate: metrics.inflation_rate ?? 0,
        lockupDays: metrics.lock_up_period ?? 0,
        minStake: metrics.minimum_staking ?? 0,
        validatorCount: metrics.validator_count ?? 0,
        stakingType: asset.tags?.find((t) => t.name)?.name ?? "PoS",
        chain: asset.slug ?? asset.name ?? "",
        source: "stakingrewards",
        timestamp: now,
      };
    });
  },

  async healthCheck(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (STAKINGREWARDS_API_KEY) headers["X-API-KEY"] = STAKINGREWARDS_API_KEY;

      const res = await fetch(BASE, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: "{ assets(limit: 1) { name } }" }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  validate(data: StakingYield[]): boolean {
    return Array.isArray(data) && data.length > 0;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function metricsToMap(metrics: SRMetric[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const m of metrics) {
    if (m.metricKey && m.defaultValue != null) {
      map[m.metricKey] = Number(m.defaultValue) || 0;
    }
  }
  return map;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal types
// ────────────────────────────────────────────────────────────────────────────

interface SRAsset {
  name?: string;
  symbol?: string;
  slug?: string;
  metrics?: SRMetric[];
  tags?: { name: string }[];
}

interface SRMetric {
  metricKey?: string;
  defaultValue?: number | string;
}
