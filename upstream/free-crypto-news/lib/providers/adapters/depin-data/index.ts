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
 * DePIN Data Chain — Pre-wired provider for DePIN ecosystem metrics
 *
 * | Provider    | Priority | Weight | Rate Limit    | Coverage           |
 * |-------------|----------|--------|---------------|--------------------|
 * | DePINscan   | 1        | 0.55   | 30/min (free) | 100+ DePIN projects|
 *
 * DePIN (Decentralized Physical Infrastructure) is a major 2025-2026 narrative.
 * Tracks: Helium, Hivemapper, DIMO, Render, Filecoin, IoTeX, Akash, etc.
 *
 * @module providers/adapters/depin-data
 */

import type { ProviderChainConfig, ResolutionStrategy } from "../../types";
import { ProviderChain } from "../../provider-chain";
import type { DePINProject } from "./types";
import { depinscanAdapter } from "./depinscan.adapter";

export type { DePINProject } from "./types";

export interface DePINChainOptions {
  strategy?: ResolutionStrategy;
  cacheTtlSeconds?: number;
  staleWhileError?: boolean;
}

export function createDePINChain(
  options: DePINChainOptions = {},
): ProviderChain<DePINProject[]> {
  const {
    strategy = "fallback",
    cacheTtlSeconds = 300,
    staleWhileError = true,
  } = options;

  const config: Partial<ProviderChainConfig> = {
    strategy,
    cacheTtlSeconds,
    staleWhileError,
  };
  const chain = new ProviderChain<DePINProject[]>("depin-data", config);
  chain.addProvider(depinscanAdapter);

  return chain;
}

/** Default DePIN data chain */
export const depinChain = createDePINChain();
