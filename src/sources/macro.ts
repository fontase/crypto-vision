/**
 * Crypto Vision — Yahoo Finance Macro Data Source
 *
 * Unofficial public API, no authentication required.
 * https://query1.finance.yahoo.com
 *
 * Provides: stock indices (S&P 500, NASDAQ, DJI), VIX, DXY,
 *           commodities (gold, oil), treasury yields.
 */

import { fetchJSON } from "../lib/fetcher.js";
import { cache } from "../lib/cache.js";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

// ─── Symbol Registry ─────────────────────────────────────────

export const SYMBOLS = {
  // Stock indices
  SPX:     { symbol: "^GSPC",     name: "S&P 500" },
  NASDAQ:  { symbol: "^IXIC",     name: "NASDAQ Composite" },
  DJI:     { symbol: "^DJI",      name: "Dow Jones Industrial Average" },
  RUSSELL: { symbol: "^RUT",      name: "Russell 2000" },
  // Volatility
  VIX:     { symbol: "^VIX",      name: "CBOE Volatility Index" },
  // Currency
  DXY:     { symbol: "DX-Y.NYB",  name: "US Dollar Index" },
  // Commodities
  GOLD:    { symbol: "GC=F",      name: "Gold Futures" },
  SILVER:  { symbol: "SI=F",      name: "Silver Futures" },
  OIL:     { symbol: "CL=F",      name: "Crude Oil (WTI)" },
  NATGAS:  { symbol: "NG=F",      name: "Natural Gas" },
  // Bonds
  TNX:     { symbol: "^TNX",      name: "10-Year Treasury Yield" },
  TYX:     { symbol: "^TYX",      name: "30-Year Treasury Yield" },
  FVX:     { symbol: "^FVX",      name: "5-Year Treasury Yield" },
  IRX:     { symbol: "^IRX",      name: "13-Week Treasury Bill" },
  // Crypto benchmarks
  BTCUSD:  { symbol: "BTC-USD",   name: "Bitcoin USD" },
  ETHUSD:  { symbol: "ETH-USD",   name: "Ethereum USD" },
  SOLUSD:  { symbol: "SOL-USD",   name: "Solana USD" },
} as const;

type SymbolKey = keyof typeof SYMBOLS;

// ─── Core Fetcher ────────────────────────────────────────────

interface YFQuote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  timestamp: number;
}

async function fetchSymbol(symbol: string): Promise<YFQuote | null> {
  try {
    const data = await fetchJSON<Record<string, unknown>>(
      `${BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      { timeout: 8000 },
    );

    const chart = data.chart as Record<string, unknown> | undefined;
    const results = chart?.result as Record<string, unknown>[] | undefined;
    const result = results?.[0];
    if (!result) return null;

    const meta = result.meta as Record<string, unknown> | undefined;
    const indicators = result.indicators as Record<string, unknown> | undefined;
    const quotesArr = indicators?.quote as Record<string, unknown>[] | undefined;
    const quotes = quotesArr?.[0];
    const timestamps = result.timestamp as number[] | undefined;

    if (!meta || !quotes || !timestamps) return null;

    const lastIdx = timestamps.length - 1;
    const prevIdx = Math.max(0, lastIdx - 1);
    const closeArr = quotes.close as number[] | undefined;
    const highArr = quotes.high as number[] | undefined;
    const lowArr = quotes.low as number[] | undefined;
    const volumeArr = quotes.volume as number[] | undefined;
    const price = (meta.regularMarketPrice as number) || closeArr?.[lastIdx] || 0;
    const prevClose = closeArr?.[prevIdx] || (meta.previousClose as number) || price;
    const change = price - prevClose;
    const changePercent = prevClose ? (change / prevClose) * 100 : 0;

    return {
      symbol,
      name: (meta.shortName as string) || (meta.symbol as string) || symbol,
      price,
      previousClose: prevClose,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      dayHigh: (meta.regularMarketDayHigh as number) || highArr?.[lastIdx] || 0,
      dayLow: (meta.regularMarketDayLow as number) || lowArr?.[lastIdx] || 0,
      volume: (meta.regularMarketVolume as number) || volumeArr?.[lastIdx] || 0,
      timestamp: (timestamps[lastIdx] || 0) * 1000,
    };
  } catch {
    return null;
  }
}

// ─── Batch Fetch ─────────────────────────────────────────────

async function fetchMultiple(keys: SymbolKey[]): Promise<YFQuote[]> {
  const results = await Promise.all(
    keys.map(async (key): Promise<YFQuote | null> => {
      const info = SYMBOLS[key];
      const quote = await fetchSymbol(info.symbol);
      if (!quote) return null;
      const named: YFQuote = { ...quote, name: info.name as string };
      return named;
    }),
  );
  return results.filter((r): r is YFQuote => r !== null);
}

// ─── Public API ──────────────────────────────────────────────

export function getStockIndices(): Promise<YFQuote[]> {
  return cache.wrap("macro:indices", 120, () =>
    fetchMultiple(["SPX", "NASDAQ", "DJI", "RUSSELL"])
  );
}

export function getCommodities(): Promise<YFQuote[]> {
  return cache.wrap("macro:commodities", 120, () =>
    fetchMultiple(["GOLD", "SILVER", "OIL", "NATGAS"])
  );
}

export function getBondYields(): Promise<YFQuote[]> {
  return cache.wrap("macro:bonds", 120, () =>
    fetchMultiple(["TNX", "TYX", "FVX", "IRX"])
  );
}

export function getVolatility(): Promise<YFQuote | null> {
  return cache.wrap("macro:vix", 60, () => {
    const info = SYMBOLS.VIX;
    return fetchSymbol(info.symbol);
  });
}

export function getDXY(): Promise<YFQuote | null> {
  return cache.wrap("macro:dxy", 120, () => {
    const info = SYMBOLS.DXY;
    return fetchSymbol(info.symbol);
  });
}

export function getCryptoBenchmarks(): Promise<YFQuote[]> {
  return cache.wrap("macro:crypto_bench", 60, () =>
    fetchMultiple(["BTCUSD", "ETHUSD", "SOLUSD"])
  );
}

export interface MacroOverview {
  indices: YFQuote[];
  commodities: YFQuote[];
  bonds: YFQuote[];
  volatility: YFQuote | null;
  dxy: YFQuote | null;
  crypto: YFQuote[];
  timestamp: string;
}

export async function getMacroOverview(): Promise<MacroOverview> {
  return cache.wrap("macro:overview", 120, async () => {
    const [indices, commodities, bonds, volatility, dxy, crypto] = await Promise.all([
      getStockIndices(),
      getCommodities(),
      getBondYields(),
      getVolatility(),
      getDXY(),
      getCryptoBenchmarks(),
    ]);
    return {
      indices,
      commodities,
      bonds,
      volatility,
      dxy,
      crypto,
      timestamp: new Date().toISOString(),
    };
  });
}

export function getQuote(symbol: string): Promise<YFQuote | null> {
  return cache.wrap(`macro:quote:${symbol}`, 60, () =>
    fetchSymbol(symbol)
  );
}
