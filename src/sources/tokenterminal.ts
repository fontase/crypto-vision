/**
 * Crypto Vision — Token Terminal Data Source
 *
 * Token Terminal v2 REST API — protocol-level financial metrics:
 * revenue, fees, earnings, P/S ratios, active users, developer activity.
 *
 * Auth: Authorization: Bearer {TOKENTERMINAL_API_KEY}
 * All responses wrap data in { data: [...] }.
 *
 * @see https://docs.tokenterminal.com
 */

import { z } from "zod";
import { fetchJSON } from "../lib/fetcher.js";
import { cache } from "../lib/cache.js";
import { logger } from "../lib/logger.js";

// ─── Configuration ───────────────────────────────────────────

const API = "https://api.tokenterminal.com/v2";

function headers(): Record<string, string> {
  const key =
    process.env.TOKENTERMINAL_API_KEY ?? process.env.TOKEN_TERMINAL_API_KEY;
  if (!key) {
    logger.warn("No TOKENTERMINAL_API_KEY set — requests will likely fail");
    return {};
  }
  return { Authorization: `Bearer ${key}` };
}

function ttFetch<T>(path: string, ttl: number): Promise<T> {
  return cache.wrap(`tt:${path}`, ttl, () =>
    fetchJSON<T>(`${API}${path}`, { headers: headers() }),
  );
}

// ─── Zod Schemas ─────────────────────────────────────────────

export const TTProjectSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  symbol: z.string().optional().default(""),
  category: z.string().optional().default(""),
  market_cap: z.number().nullable().optional().default(null),
  fully_diluted_valuation: z.number().nullable().optional().default(null),
  revenue_30d: z.number().nullable().optional().default(null),
  revenue_annualized: z.number().nullable().optional().default(null),
  fees_30d: z.number().nullable().optional().default(null),
  fees_annualized: z.number().nullable().optional().default(null),
  earnings_30d: z.number().nullable().optional().default(null),
  tvl: z.number().nullable().optional().default(null),
  active_users_30d: z.number().nullable().optional().default(null),
  price_to_sales: z.number().nullable().optional().default(null),
  price_to_fees: z.number().nullable().optional().default(null),
  price_to_earnings: z.number().nullable().optional().default(null),
  token_incentives_30d: z.number().nullable().optional().default(null),
});
export type TTProject = z.infer<typeof TTProjectSchema>;

export const TTMetricTimeseriesSchema = z.object({
  timestamp: z.string(),
  value: z.number(),
});
export type TTMetricTimeseries = z.infer<typeof TTMetricTimeseriesSchema>;

export const TTMarketSectorSchema = z.object({
  category: z.string(),
  total_revenue: z.number(),
  total_fees: z.number(),
  total_tvl: z.number(),
  project_count: z.number(),
  top_projects: z.array(TTProjectSchema),
});
export type TTMarketSector = z.infer<typeof TTMarketSectorSchema>;

export const TTFinancialStatementSchema = z.object({
  revenue: z.object({
    daily: z.number().nullable().optional(),
    "7d": z.number().nullable().optional(),
    "30d": z.number().nullable().optional(),
    "90d": z.number().nullable().optional(),
    "180d": z.number().nullable().optional(),
    "365d": z.number().nullable().optional(),
  }),
  fees: z.object({
    daily: z.number().nullable().optional(),
    "7d": z.number().nullable().optional(),
    "30d": z.number().nullable().optional(),
    "90d": z.number().nullable().optional(),
    "180d": z.number().nullable().optional(),
    "365d": z.number().nullable().optional(),
  }),
  earnings: z.object({
    daily: z.number().nullable().optional(),
    "7d": z.number().nullable().optional(),
    "30d": z.number().nullable().optional(),
    "90d": z.number().nullable().optional(),
    "180d": z.number().nullable().optional(),
    "365d": z.number().nullable().optional(),
  }),
  token_incentives: z.object({
    daily: z.number().nullable().optional(),
    "7d": z.number().nullable().optional(),
    "30d": z.number().nullable().optional(),
    "90d": z.number().nullable().optional(),
    "180d": z.number().nullable().optional(),
    "365d": z.number().nullable().optional(),
  }),
  active_users: z.object({
    daily: z.number().nullable().optional(),
    "7d": z.number().nullable().optional(),
    "30d": z.number().nullable().optional(),
    "90d": z.number().nullable().optional(),
    "180d": z.number().nullable().optional(),
    "365d": z.number().nullable().optional(),
  }),
});
export type TTFinancialStatement = z.infer<typeof TTFinancialStatementSchema>;

// ─── Backward-Compatible Types (used by analytics route) ─────

export interface ProtocolMetrics {
  project_id: string;
  project_name: string;
  symbol: string;
  category: string;
  revenue_24h?: number;
  revenue_7d?: number;
  revenue_30d?: number;
  revenue_annualized?: number;
  fees_24h?: number;
  fees_7d?: number;
  fees_30d?: number;
  fees_annualized?: number;
  earnings_24h?: number;
  earnings_7d?: number;
  earnings_30d?: number;
  tvl?: number;
  market_cap?: number;
  ps_ratio?: number;
  pe_ratio?: number;
  token_price?: number;
  active_users_24h?: number;
  active_users_7d?: number;
  active_users_30d?: number;
}

export interface MarketMetrics {
  metric_id: string;
  data: Array<{
    timestamp: string;
    value: number;
  }>;
}

// ─── Internal Helpers ────────────────────────────────────────

/** Parse raw API response into validated TTProject array */
function parseProjects(raw: unknown): TTProject[] {
  const wrapper = z
    .object({ data: z.array(z.record(z.unknown())) })
    .safeParse(raw);
  if (!wrapper.success) {
    logger.warn({ error: wrapper.error.message }, "TT projects parse failed");
    return [];
  }
  return wrapper.data.data
    .map((item) => {
      // Normalize: API uses project_name or name interchangeably
      const normalized = {
        ...item,
        project_id: item["project_id"] ?? item["id"] ?? "",
        name: item["name"] ?? item["project_name"] ?? "",
        symbol: item["symbol"] ?? "",
        category: item["category"] ?? "",
      };
      const result = TTProjectSchema.safeParse(normalized);
      return result.success ? result.data : null;
    })
    .filter((p): p is TTProject => p !== null);
}

/** Parse timeseries array from API response */
function parseTimeseries(raw: unknown): TTMetricTimeseries[] {
  const wrapper = z
    .object({ data: z.array(z.record(z.unknown())) })
    .safeParse(raw);
  if (!wrapper.success) {
    logger.warn(
      { error: wrapper.error.message },
      "TT timeseries parse failed",
    );
    return [];
  }
  return wrapper.data.data
    .map((item) => {
      const result = TTMetricTimeseriesSchema.safeParse(item);
      return result.success ? result.data : null;
    })
    .filter((t): t is TTMetricTimeseries => t !== null);
}

/** Convert TTProject to legacy ProtocolMetrics for backward compat */
function toProtocolMetrics(p: TTProject): ProtocolMetrics {
  return {
    project_id: p.project_id,
    project_name: p.name,
    symbol: p.symbol,
    category: p.category,
    revenue_30d: p.revenue_30d ?? undefined,
    revenue_annualized: p.revenue_annualized ?? undefined,
    fees_30d: p.fees_30d ?? undefined,
    fees_annualized: p.fees_annualized ?? undefined,
    earnings_30d: p.earnings_30d ?? undefined,
    tvl: p.tvl ?? undefined,
    market_cap: p.market_cap ?? undefined,
    ps_ratio: p.price_to_sales ?? undefined,
    pe_ratio: p.price_to_earnings ?? undefined,
    active_users_30d: p.active_users_30d ?? undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// PRIMARY EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// ─── getProjects ─────────────────────────────────────────────

export async function getProjects(
  limit?: number,
): Promise<{ data: TTProject[] }> {
  const raw = await ttFetch<unknown>("/projects", 120);
  const projects = parseProjects(raw);
  const sliced = limit ? projects.slice(0, limit) : projects;
  return { data: sliced };
}

// ─── getProjectDetail ────────────────────────────────────────

export async function getProjectDetail(
  id: string,
): Promise<{ data: TTProject | null }> {
  const raw = await ttFetch<unknown>(`/projects/${encodeURIComponent(id)}`, 120);
  const wrapper = z.object({ data: z.record(z.unknown()) }).safeParse(raw);
  if (!wrapper.success) {
    logger.warn({ id, error: wrapper.error.message }, "TT project detail parse failed");
    return { data: null };
  }
  const normalized = {
    ...wrapper.data.data,
    project_id:
      wrapper.data.data["project_id"] ?? wrapper.data.data["id"] ?? id,
    name:
      wrapper.data.data["name"] ?? wrapper.data.data["project_name"] ?? id,
    symbol: wrapper.data.data["symbol"] ?? "",
    category: wrapper.data.data["category"] ?? "",
  };
  const result = TTProjectSchema.safeParse(normalized);
  return { data: result.success ? result.data : null };
}

// ─── getProjectMetrics ───────────────────────────────────────

export async function getProjectMetrics(
  id: string,
  metric?: string,
  interval?: string,
): Promise<{ data: TTMetricTimeseries[] }> {
  const metricPath = metric ? `/${encodeURIComponent(metric)}` : "";
  const params = interval ? `?interval=${encodeURIComponent(interval)}` : "";
  const raw = await ttFetch<unknown>(
    `/projects/${encodeURIComponent(id)}/metrics${metricPath}${params}`,
    120,
  );
  const timeseries = parseTimeseries(raw);
  return { data: timeseries };
}

// ─── getProjectFinancials ────────────────────────────────────

export async function getProjectFinancials(
  id: string,
): Promise<{ data: TTFinancialStatement | null }> {
  const raw = await ttFetch<unknown>(
    `/projects/${encodeURIComponent(id)}/financials`,
    120,
  );
  const wrapper = z.object({ data: z.record(z.unknown()) }).safeParse(raw);
  if (!wrapper.success) {
    logger.warn(
      { id, error: wrapper.error.message },
      "TT financials parse failed",
    );
    return { data: null };
  }
  const result = TTFinancialStatementSchema.safeParse(wrapper.data.data);
  return { data: result.success ? result.data : null };
}

// ─── getMarketSectors ────────────────────────────────────────

export async function getMarketSectors(): Promise<{
  data: TTMarketSector[];
}> {
  const raw = await ttFetch<unknown>("/market-sectors", 300);
  const wrapper = z
    .object({ data: z.array(z.record(z.unknown())) })
    .safeParse(raw);
  if (!wrapper.success) {
    logger.warn(
      { error: wrapper.error.message },
      "TT market sectors parse failed",
    );
    return { data: [] };
  }
  const sectors = wrapper.data.data
    .map((item) => {
      const result = TTMarketSectorSchema.safeParse(item);
      return result.success ? result.data : null;
    })
    .filter((s): s is TTMarketSector => s !== null);
  return { data: sectors };
}

// ═══════════════════════════════════════════════════════════════
// SORTED / FILTERED FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/** Top projects by revenue (30d) */
export async function getTopByRevenue(
  limit = 50,
): Promise<{ data: TTProject[] }> {
  const { data: projects } = await getProjects();
  const sorted = [...projects]
    .filter((p) => p.revenue_30d !== null && p.revenue_30d !== undefined)
    .sort((a, b) => (b.revenue_30d ?? 0) - (a.revenue_30d ?? 0))
    .slice(0, limit);
  return { data: sorted };
}

/** Top projects by fees (30d) */
export async function getTopByFees(
  limit = 50,
): Promise<{ data: TTProject[] }> {
  const { data: projects } = await getProjects();
  const sorted = [...projects]
    .filter((p) => p.fees_30d !== null && p.fees_30d !== undefined)
    .sort((a, b) => (b.fees_30d ?? 0) - (a.fees_30d ?? 0))
    .slice(0, limit);
  return { data: sorted };
}

/** Top projects by active users (30d) */
export async function getTopByUsers(
  limit = 50,
): Promise<{ data: TTProject[] }> {
  const { data: projects } = await getProjects();
  const sorted = [...projects]
    .filter(
      (p) => p.active_users_30d !== null && p.active_users_30d !== undefined,
    )
    .sort((a, b) => (b.active_users_30d ?? 0) - (a.active_users_30d ?? 0))
    .slice(0, limit);
  return { data: sorted };
}

/** Top projects by TVL */
export async function getTopByTVL(
  limit = 50,
): Promise<{ data: TTProject[] }> {
  const { data: projects } = await getProjects();
  const sorted = [...projects]
    .filter((p) => p.tvl !== null && p.tvl !== undefined)
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
    .slice(0, limit);
  return { data: sorted };
}

/** Most undervalued projects (lowest P/S ratio, positive revenue) */
export async function getMostUndervalued(
  limit = 50,
): Promise<{ data: TTProject[] }> {
  const { data: projects } = await getProjects();
  const sorted = [...projects]
    .filter(
      (p) =>
        p.price_to_sales !== null &&
        p.price_to_sales !== undefined &&
        p.price_to_sales > 0 &&
        p.revenue_annualized !== null &&
        p.revenue_annualized !== undefined &&
        p.revenue_annualized > 0,
    )
    .sort((a, b) => (a.price_to_sales ?? Infinity) - (b.price_to_sales ?? Infinity))
    .slice(0, limit);
  return { data: sorted };
}

// ─── Metric Timeseries Shortcuts ─────────────────────────────

export function getRevenueTimeseries(
  id: string,
  interval = "daily",
): Promise<{ data: TTMetricTimeseries[] }> {
  return cache.wrap(`tt:rev-ts:${id}:${interval}`, 300, () =>
    getProjectMetrics(id, "revenue", interval),
  );
}

export function getFeesTimeseries(
  id: string,
  interval = "daily",
): Promise<{ data: TTMetricTimeseries[] }> {
  return cache.wrap(`tt:fees-ts:${id}:${interval}`, 300, () =>
    getProjectMetrics(id, "fees", interval),
  );
}

export function getActiveUsersTimeseries(
  id: string,
  interval = "daily",
): Promise<{ data: TTMetricTimeseries[] }> {
  return cache.wrap(`tt:users-ts:${id}:${interval}`, 300, () =>
    getProjectMetrics(id, "active_users", interval),
  );
}

// ═══════════════════════════════════════════════════════════════
// FINANCIAL ANALYTICS
// ═══════════════════════════════════════════════════════════════

/** Price-to-Sales ratio: market cap / annualized revenue */
export function calculatePSRatio(
  marketCap: number,
  annualizedRevenue: number,
): number {
  if (annualizedRevenue <= 0) return Infinity;
  return marketCap / annualizedRevenue;
}

/** Price-to-Earnings ratio: market cap / annualized earnings */
export function calculatePERatio(
  marketCap: number,
  annualizedEarnings: number,
): number {
  if (annualizedEarnings <= 0) return Infinity;
  return marketCap / annualizedEarnings;
}

/** Revenue multiple: FDV / annualized revenue */
export function calculateRevenueMultiple(
  fdv: number,
  annualizedRevenue: number,
): number {
  if (annualizedRevenue <= 0) return Infinity;
  return fdv / annualizedRevenue;
}

/** Token incentive efficiency: revenue / incentives (higher = better) */
export function calculateTokenIncentiveEfficiency(
  revenue: number,
  incentives: number,
): number {
  if (incentives <= 0) return Infinity;
  return revenue / incentives;
}

/** Rank projects by a given numeric metric field (descending) */
export function rankByFundamental(
  projects: TTProject[],
  metric: keyof TTProject,
): TTProject[] {
  return [...projects]
    .filter((p) => {
      const v = p[metric];
      return v !== null && v !== undefined && typeof v === "number";
    })
    .sort((a, b) => {
      const va = a[metric] as number;
      const vb = b[metric] as number;
      return vb - va;
    });
}

/**
 * Identify undervalued projects: those with P/S ratio below
 * the median P/S of all projects with positive revenue.
 */
export function identifyUndervalued(projects: TTProject[]): TTProject[] {
  const withPS = projects.filter(
    (p) =>
      p.price_to_sales !== null &&
      p.price_to_sales !== undefined &&
      p.price_to_sales > 0 &&
      p.revenue_annualized !== null &&
      p.revenue_annualized !== undefined &&
      p.revenue_annualized > 0,
  );

  if (withPS.length === 0) return [];

  // Calculate median P/S
  const sorted = [...withPS].sort(
    (a, b) => (a.price_to_sales ?? 0) - (b.price_to_sales ?? 0),
  );
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1].price_to_sales ?? 0) +
          (sorted[mid].price_to_sales ?? 0)) /
        2
      : (sorted[mid].price_to_sales ?? 0);

  return withPS
    .filter((p) => (p.price_to_sales ?? Infinity) < median)
    .sort((a, b) => (a.price_to_sales ?? Infinity) - (b.price_to_sales ?? Infinity));
}

/** Aggregate projects into sector-level comparisons */
export function sectorComparison(projects: TTProject[]): TTMarketSector[] {
  const sectorMap = new Map<
    string,
    { revenue: number; fees: number; tvl: number; projects: TTProject[] }
  >();

  for (const p of projects) {
    const cat = p.category || "Unknown";
    const existing = sectorMap.get(cat) ?? {
      revenue: 0,
      fees: 0,
      tvl: 0,
      projects: [],
    };
    existing.revenue += p.revenue_30d ?? 0;
    existing.fees += p.fees_30d ?? 0;
    existing.tvl += p.tvl ?? 0;
    existing.projects.push(p);
    sectorMap.set(cat, existing);
  }

  const sectors: TTMarketSector[] = [];
  for (const [category, data] of sectorMap) {
    // Top 5 projects by revenue within sector
    const topProjects = [...data.projects]
      .sort((a, b) => (b.revenue_30d ?? 0) - (a.revenue_30d ?? 0))
      .slice(0, 5);

    sectors.push({
      category,
      total_revenue: data.revenue,
      total_fees: data.fees,
      total_tvl: data.tvl,
      project_count: data.projects.length,
      top_projects: topProjects,
    });
  }

  // Sort sectors by total revenue descending
  sectors.sort((a, b) => b.total_revenue - a.total_revenue);
  return sectors;
}

/**
 * Calculate growth rate over a period from timeseries data.
 * Returns percentage change (e.g. 25.5 means +25.5%).
 */
export function calculateGrowthRate(
  timeseries: TTMetricTimeseries[],
  period: "7d" | "30d" | "90d",
): number {
  if (timeseries.length < 2) return 0;

  // Sort by timestamp ascending
  const sorted = [...timeseries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const periodDays = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const latestTs = new Date(sorted[sorted.length - 1].timestamp).getTime();
  const cutoff = latestTs - periodDays * 24 * 60 * 60 * 1000;

  // Find earliest data point at or after the cutoff
  const startPoint = sorted.find(
    (t) => new Date(t.timestamp).getTime() >= cutoff,
  );
  const endPoint = sorted[sorted.length - 1];

  if (!startPoint || startPoint.value === 0) return 0;

  return ((endPoint.value - startPoint.value) / startPoint.value) * 100;
}

// ═══════════════════════════════════════════════════════════════
// BACKWARD-COMPATIBLE LEGACY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Legacy: get project metrics as ProtocolMetrics (used by analytics route).
 * Maps to getProjectDetail under the hood.
 */
export async function getProtocolRevenue(): Promise<{
  data: ProtocolMetrics[];
}> {
  const { data: projects } = await getTopByRevenue(200);
  return { data: projects.map(toProtocolMetrics) };
}

export async function getProtocolFees(): Promise<{
  data: ProtocolMetrics[];
}> {
  const { data: projects } = await getTopByFees(200);
  return { data: projects.map(toProtocolMetrics) };
}

export async function getActiveUsers(): Promise<{
  data: ProtocolMetrics[];
}> {
  const { data: projects } = await getTopByUsers(200);
  return { data: projects.map(toProtocolMetrics) };
}

export function getMarketMetric(
  metricId: string,
  days = 30,
): Promise<MarketMetrics> {
  return ttFetch<MarketMetrics>(
    `/market-metrics/${encodeURIComponent(metricId)}?days=${days}`,
    600,
  );
}
