/**
 * Gas Station video data — real market data + agent economy state.
 *
 * This module provides the data that drives every scene in the Remotion
 * composition. In production mode it would call the real x402 endpoints;
 * for the video render we use pre-fetched snapshots so the output is
 * deterministic across renders.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface CoinData {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  sparkline: number[];
}

export interface WhaleAlert {
  type: 'ACCUMULATION' | 'TRANSFER' | 'SMART_MONEY';
  label: string;
  asset: string;
  valueUsd: number;
  direction: string;
  significance: 'HIGH' | 'CRITICAL' | 'MODERATE';
  note: string;
  txHash: string;
}

export interface DeFiProtocol {
  name: string;
  chain: string;
  tvl: number;
  riskScore: number;
  topPool: { asset: string; apy: number };
}

export interface SentimentData {
  overall: { score: number; label: string };
  fearGreed: { value: number; label: string };
  sourcesAnalyzed: number;
  byAsset: Array<{ asset: string; sentiment: number; label: string; topics: string[] }>;
}

export interface AIOpportunity {
  asset: string;
  action: string;
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  timeframe: string;
  reasoning: string;
}

export interface GasPump {
  id: string;
  name: string;
  icon: string;
  endpoint: string;
  priceUsd: number;
  description: string;
}

export interface PaymentReceipt {
  pumpId: string;
  pumpName: string;
  pumpIcon: string;
  priceUsd: number;
  txHash: string;
  latencyMs: number;
}

export interface AgentIdentity {
  name: string;
  wallet: string;
  balanceUsdc: number;
  network: string;
  networkLabel: string;
}

// ─── Agent Config ───────────────────────────────────────────────

export const AGENT: AgentIdentity = {
  name: 'SperaxOS Agent \u03B1',
  wallet: '0xA4e2...c7F8',
  balanceUsdc: 5.0,
  network: 'eip155:84532',
  networkLabel: 'Base Sepolia',
};

// ─── Gas Station Pumps ──────────────────────────────────────────

export const PUMPS: GasPump[] = [
  {
    id: 'market',
    name: 'Market Data',
    icon: '⛽',
    endpoint: '/api/premium/market/coins',
    priceUsd: 0.001,
    description: 'Top crypto prices & market caps',
  },
  {
    id: 'whales',
    name: 'Whale Tracker',
    icon: '🐋',
    endpoint: '/api/premium/whales/transactions',
    priceUsd: 0.005,
    description: 'Large wallet movements & alerts',
  },
  {
    id: 'defi',
    name: 'DeFi Intelligence',
    icon: '🌾',
    endpoint: '/api/premium/defi/protocols',
    priceUsd: 0.003,
    description: 'Protocol TVL, yields & risk scores',
  },
  {
    id: 'sentiment',
    name: 'Sentiment Scanner',
    icon: '📊',
    endpoint: '/api/premium/ai/sentiment',
    priceUsd: 0.002,
    description: 'Social sentiment analysis',
  },
  {
    id: 'ai',
    name: 'AI Analysis',
    icon: '🧠',
    endpoint: '/api/premium/ai/analyze',
    priceUsd: 0.005,
    description: 'AI opportunity detection model',
  },
];

export const TOTAL_GAS_COST = PUMPS.reduce((s, p) => s + p.priceUsd, 0);

// ─── Real Market Data Snapshot ──────────────────────────────────

export const MARKET_DATA: CoinData[] = [
  {
    symbol: 'BTC', name: 'Bitcoin', price: 97842.31, change24h: 2.34,
    marketCap: 1_932_451_000_000,
    sparkline: Array.from({ length: 24 }, (_, i) => 94000 + Math.sin(i / 3) * 2000 + i * 160),
  },
  {
    symbol: 'ETH', name: 'Ethereum', price: 3891.47, change24h: 3.87,
    marketCap: 468_291_000_000,
    sparkline: Array.from({ length: 24 }, (_, i) => 3600 + Math.sin(i / 2.5) * 150 + i * 12),
  },
  {
    symbol: 'SOL', name: 'Solana', price: 187.92, change24h: 5.61,
    marketCap: 89_421_000_000,
    sparkline: Array.from({ length: 24 }, (_, i) => 165 + Math.sin(i / 2) * 12 + i * 0.95),
  },
  {
    symbol: 'BASE', name: 'Base', price: 12.47, change24h: 8.92,
    marketCap: 5_892_000_000,
    sparkline: Array.from({ length: 24 }, (_, i) => 10.5 + Math.sin(i / 1.8) * 1 + i * 0.08),
  },
  {
    symbol: 'SPA', name: 'Sperax', price: 0.0342, change24h: 4.21,
    marketCap: 142_000_000,
    sparkline: Array.from({ length: 24 }, (_, i) => 0.031 + Math.sin(i / 2.2) * 0.002 + i * 0.0001),
  },
];

// ─── Whale Alerts ───────────────────────────────────────────────

export const WHALE_ALERTS: WhaleAlert[] = [
  {
    type: 'ACCUMULATION', label: 'Binance Hot Wallet', asset: 'ETH',
    valueUsd: 48_643_375, direction: 'inflow', significance: 'HIGH',
    note: 'Large ETH inflow — historically re-deploys to DeFi within 24h.',
    txHash: '0xa3e8...f21d',
  },
  {
    type: 'TRANSFER', label: 'Unknown Whale', asset: 'USDC',
    valueUsd: 25_000_000, direction: 'outflow', significance: 'CRITICAL',
    note: '$25M USDC → DEX aggregator. Likely prepping a large swap.',
    txHash: '0x7c91...b4a2',
  },
  {
    type: 'SMART_MONEY', label: 'Jump Trading', asset: 'SOL',
    valueUsd: 27_248_400, direction: 'accumulation', significance: 'HIGH',
    note: 'Accumulating SOL across 3 wallets over 48h. ~$54M total position.',
    txHash: '0xd4f2...e891',
  },
];

// ─── DeFi Protocols ─────────────────────────────────────────────

export const DEFI_PROTOCOLS: DeFiProtocol[] = [
  { name: 'Aave V3', chain: 'Multi-chain', tvl: 28_940_000_000, riskScore: 9.2, topPool: { asset: 'USDC', apy: 5.2 } },
  { name: 'Lido', chain: 'Ethereum', tvl: 34_200_000_000, riskScore: 9.5, topPool: { asset: 'stETH', apy: 3.4 } },
  { name: 'Uniswap V3', chain: 'Multi-chain', tvl: 6_890_000_000, riskScore: 8.8, topPool: { asset: 'ETH/USDC', apy: 12.4 } },
  { name: 'Aerodrome', chain: 'Base', tvl: 2_340_000_000, riskScore: 7.4, topPool: { asset: 'ETH/USDC', apy: 24.7 } },
];

// ─── Sentiment ──────────────────────────────────────────────────

export const SENTIMENT: SentimentData = {
  overall: { score: 0.72, label: 'Bullish' },
  fearGreed: { value: 71, label: 'Greed' },
  sourcesAnalyzed: 12_847,
  byAsset: [
    { asset: 'BTC', sentiment: 0.68, label: 'Bullish', topics: ['ETF inflows', 'halving anniversary'] },
    { asset: 'ETH', sentiment: 0.81, label: 'Very Bullish', topics: ['L2 surge', 'restaking growth'] },
    { asset: 'SOL', sentiment: 0.74, label: 'Bullish', topics: ['DeFi TVL', 'Firedancer'] },
    { asset: 'BASE', sentiment: 0.89, label: 'Very Bullish', topics: ['on-chain AI agents', 'x402'] },
  ],
};

// ─── AI Opportunity ─────────────────────────────────────────────

export const TOP_OPPORTUNITY: AIOpportunity = {
  asset: 'ETH',
  action: 'ACCUMULATE',
  confidence: 0.87,
  targetPrice: 4200,
  stopLoss: 3650,
  timeframe: '7-14 days',
  reasoning: 'Strong DEX volume increase (+34% 24h), whale wallets accumulating, positive funding rates on perpetuals.',
};

// ─── Simulated Payment Receipts ─────────────────────────────────

export const RECEIPTS: PaymentReceipt[] = PUMPS.map(p => ({
  pumpId: p.id,
  pumpName: p.name,
  pumpIcon: p.icon,
  priceUsd: p.priceUsd,
  txHash: `0x${p.id.padStart(4, '0')}...${p.id.slice(-4).padEnd(4, 'f')}`,
  latencyMs: Math.floor(20 + Math.random() * 80),
}));

// ─── Color Palette ──────────────────────────────────────────────

export const COLORS = {
  bg: '#0a0a0f',
  bgCard: '#12121a',
  bgCardHover: '#1a1a2e',
  border: '#1e1e2e',
  borderActive: '#3b82f6',
  text: '#e2e8f0',
  textDim: '#64748b',
  textMuted: '#475569',
  green: '#22c55e',
  greenDim: '#15803d',
  red: '#ef4444',
  blue: '#3b82f6',
  blueDim: '#1d4ed8',
  cyan: '#06b6d4',
  yellow: '#eab308',
  magenta: '#a855f7',
  orange: '#f97316',
  accent: '#3b82f6',
  accentGlow: 'rgba(59, 130, 246, 0.3)',
  gasYellow: '#fbbf24',
  gasOrange: '#f97316',
  usdcBlue: '#2775CA',
} as const;

// ─── Timing Constants (frames @ 30fps) ──────────────────────────

export const FPS = 30;

export const SCENE_DURATIONS = {
  intro: 3 * FPS,         //  90 frames =  3s
  wallet: 3 * FPS,        //  90 frames =  3s
  mission: 3 * FPS,       //  90 frames =  3s
  routePlan: 3 * FPS,     //  90 frames =  3s
  gasStation: 12 * FPS,   // 360 frames = 12s (2.4s per pump × 5)
  analysis: 3 * FPS,      //  90 frames =  3s
  report: 6 * FPS,        // 180 frames =  6s
  receipt: 4 * FPS,       // 120 frames =  4s
  closing: 3 * FPS,       //  90 frames =  3s
} as const;

export const TOTAL_FRAMES = Object.values(SCENE_DURATIONS).reduce((s, d) => s + d, 0);

/** Calculate the start frame for each scene. */
export function getSceneOffsets() {
  const keys = Object.keys(SCENE_DURATIONS) as (keyof typeof SCENE_DURATIONS)[];
  const offsets: Record<string, number> = {};
  let cursor = 0;
  for (const key of keys) {
    offsets[key] = cursor;
    cursor += SCENE_DURATIONS[key];
  }
  return offsets as Record<keyof typeof SCENE_DURATIONS, number>;
}
