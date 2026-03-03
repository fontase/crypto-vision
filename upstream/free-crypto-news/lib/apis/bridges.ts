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
 * DefiLlama Bridges API
 *
 * Cross-chain bridge volume, flow, and history data.
 * Free API with no authentication required.
 *
 * @see https://bridges.llama.fi/docs
 * @module lib/apis/bridges
 */

const BASE_URL = 'https://bridges.llama.fi';

// =============================================================================
// Types
// =============================================================================

export interface Bridge {
  id: number;
  name: string;
  displayName: string;
  icon?: string;
  volumePrevDay: number;
  volumePrev2Day: number;
  lastHourlyVolume: number;
  currentDayVolume: number;
  lastDailyVolume: number;
  dayBeforeLastVolume: number;
  weeklyVolume: number;
  monthlyVolume: number;
  chains: string[];
  destinationChain?: string;
}

export interface BridgeVolume {
  date: number;
  depositUSD: number;
  withdrawUSD: number;
  depositTxs: number;
  withdrawTxs: number;
}

export interface BridgeHistoryEntry {
  date: number;
  depositUSD: number;
  withdrawUSD: number;
  depositTxs: number;
  withdrawTxs: number;
}

export interface BridgeVolumeChain {
  chain: string;
  volumeIn: number;
  volumeOut: number;
  netFlow: number;
  txsIn: number;
  txsOut: number;
}

export interface BridgeVolumesSummary {
  totalVolume24h: number;
  totalVolume7d: number;
  bridges: Bridge[];
  topByVolume: Bridge[];
  timestamp: string;
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Fetch from DefiLlama Bridges API with caching.
 */
async function bridgeFetch<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      next: { revalidate: 300 }, // 5 min cache
    });

    if (!response.ok) {
      console.error(`Bridges API error: ${response.status} for ${path}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Bridges API request failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bridge Data
// ---------------------------------------------------------------------------

/**
 * Get all bridges with volume data.
 */
export async function getBridges(): Promise<Bridge[]> {
  const data = await bridgeFetch<{ bridges: Bridge[] }>('/bridges');

  if (!data?.bridges) return [];

  return data.bridges
    .map((b) => ({
      id: b.id,
      name: b.name,
      displayName: b.displayName || b.name,
      icon: b.icon,
      volumePrevDay: b.volumePrevDay || 0,
      volumePrev2Day: b.volumePrev2Day || 0,
      lastHourlyVolume: b.lastHourlyVolume || 0,
      currentDayVolume: b.currentDayVolume || 0,
      lastDailyVolume: b.lastDailyVolume || 0,
      dayBeforeLastVolume: b.dayBeforeLastVolume || 0,
      weeklyVolume: b.weeklyVolume || 0,
      monthlyVolume: b.monthlyVolume || 0,
      chains: b.chains || [],
      destinationChain: b.destinationChain,
    }))
    .sort((a, b) => b.lastDailyVolume - a.lastDailyVolume);
}

/**
 * Get aggregated bridge volume data (24h and 7d totals).
 */
export async function getBridgeVolumes(): Promise<BridgeVolumesSummary> {
  const bridges = await getBridges();

  const totalVolume24h = bridges.reduce((sum, b) => sum + b.lastDailyVolume, 0);
  const totalVolume7d = bridges.reduce((sum, b) => sum + b.weeklyVolume, 0);

  return {
    totalVolume24h,
    totalVolume7d,
    bridges,
    topByVolume: bridges.slice(0, 20),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get historical volume for a specific bridge.
 *
 * @param bridgeId - Numeric bridge ID from DefiLlama
 */
export async function getBridgeHistory(bridgeId: number): Promise<BridgeHistoryEntry[]> {
  const data = await bridgeFetch<BridgeHistoryEntry[] | { data: BridgeHistoryEntry[] }>(
    `/bridgevolume/${bridgeId}`,
  );

  if (!data) return [];

  const entries = Array.isArray(data) ? data : data.data || [];

  return entries.map((e) => ({
    date: e.date,
    depositUSD: e.depositUSD || 0,
    withdrawUSD: e.withdrawUSD || 0,
    depositTxs: e.depositTxs || 0,
    withdrawTxs: e.withdrawTxs || 0,
  }));
}
