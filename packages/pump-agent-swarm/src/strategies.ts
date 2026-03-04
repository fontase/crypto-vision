/**
 * Preset Trading Strategies
 *
 * Ready-to-use strategy configurations for common swarm patterns.
 * Each strategy defines trade intervals, sizes, buy/sell ratios,
 * and budget limits.
 */

import BN from 'bn.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { TradingStrategy } from './types.js';

/**
 * Gentle accumulation — slow, small buys with occasional sells.
 * Looks organic, builds position gradually.
 *
 * Profile:
 *   - Trades every 30-120 seconds
 *   - 0.01-0.05 SOL per trade
 *   - 70% buys / 30% sells
 *   - Max 2 SOL budget per trader
 */
export const STRATEGY_ORGANIC: TradingStrategy = {
  id: 'organic',
  name: 'Organic Accumulation',
  minIntervalSeconds: 30,
  maxIntervalSeconds: 120,
  minTradeSizeLamports: new BN(0.01 * LAMPORTS_PER_SOL),
  maxTradeSizeLamports: new BN(0.05 * LAMPORTS_PER_SOL),
  buySellRatio: 2.33, // ~70% buys
  maxTotalBudgetLamports: new BN(2 * LAMPORTS_PER_SOL),
  useJitoBundles: false,
  priorityFeeMicroLamports: 50_000,
  maxTrades: 100,
  maxDurationSeconds: 3600, // 1 hour
};

/**
 * Volume generation — high frequency, balanced buys and sells.
 * Creates trading activity without net position change.
 *
 * Profile:
 *   - Trades every 5-20 seconds
 *   - 0.02-0.1 SOL per trade
 *   - 50% buys / 50% sells
 *   - Max 5 SOL budget per trader
 */
export const STRATEGY_VOLUME: TradingStrategy = {
  id: 'volume',
  name: 'Volume Generation',
  minIntervalSeconds: 5,
  maxIntervalSeconds: 20,
  minTradeSizeLamports: new BN(0.02 * LAMPORTS_PER_SOL),
  maxTradeSizeLamports: new BN(0.1 * LAMPORTS_PER_SOL),
  buySellRatio: 1.0, // balanced
  maxTotalBudgetLamports: new BN(5 * LAMPORTS_PER_SOL),
  useJitoBundles: true,
  priorityFeeMicroLamports: 100_000,
  maxTrades: 500,
  maxDurationSeconds: 1800, // 30 minutes
};

/**
 * Graduation push — aggressive buying to push the bonding curve
 * toward graduation (85 SOL threshold).
 *
 * Profile:
 *   - Trades every 10-30 seconds
 *   - 0.1-0.5 SOL per trade
 *   - 90% buys / 10% sells
 *   - Max 10 SOL budget per trader
 */
export const STRATEGY_GRADUATION: TradingStrategy = {
  id: 'graduation',
  name: 'Graduation Push',
  minIntervalSeconds: 10,
  maxIntervalSeconds: 30,
  minTradeSizeLamports: new BN(0.1 * LAMPORTS_PER_SOL),
  maxTradeSizeLamports: new BN(0.5 * LAMPORTS_PER_SOL),
  buySellRatio: 9.0, // ~90% buys
  maxTotalBudgetLamports: new BN(10 * LAMPORTS_PER_SOL),
  useJitoBundles: true,
  priorityFeeMicroLamports: 200_000,
  maxDurationSeconds: 3600,
};

/**
 * Sniper exit — fast sells after initial pump, taking profit.
 *
 * Profile:
 *   - Trades every 3-10 seconds
 *   - 0.05-0.2 SOL per trade
 *   - 20% buys / 80% sells
 *   - Max 3 SOL budget per trader
 */
export const STRATEGY_EXIT: TradingStrategy = {
  id: 'exit',
  name: 'Sniper Exit',
  minIntervalSeconds: 3,
  maxIntervalSeconds: 10,
  minTradeSizeLamports: new BN(0.05 * LAMPORTS_PER_SOL),
  maxTradeSizeLamports: new BN(0.2 * LAMPORTS_PER_SOL),
  buySellRatio: 0.25, // ~20% buys, ~80% sells
  maxTotalBudgetLamports: new BN(3 * LAMPORTS_PER_SOL),
  useJitoBundles: true,
  priorityFeeMicroLamports: 200_000,
  maxTrades: 50,
  maxDurationSeconds: 600, // 10 minutes
};

/** All preset strategies indexed by ID */
export const PRESET_STRATEGIES: Record<string, TradingStrategy> = {
  organic: STRATEGY_ORGANIC,
  volume: STRATEGY_VOLUME,
  graduation: STRATEGY_GRADUATION,
  exit: STRATEGY_EXIT,
};
