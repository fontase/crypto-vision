/**
 * Configuration Management — Barrel Export
 *
 * Re-exports all config modules and provides the convenience
 * `createSwarmConfig()` factory for building a validated config
 * from defaults + env + user overrides.
 */

import type { SwarmMasterConfig } from '../types.js';
import { loadSwarmConfigFromEnv } from './env.js';
import { validateSwarmConfig } from './validation.js';

// ─── Re-exports ───────────────────────────────────────────────

export {
  DEFAULT_SWARM_CONFIG,
  DEFAULT_RPC_CONFIG,
  DEFAULT_WALLET_CONFIG,
  DEFAULT_BUNDLE_CONFIG,
  DEFAULT_INTELLIGENCE_CONFIG,
  DEFAULT_DASHBOARD_CONFIG,
  DEFAULT_ANALYTICS_CONFIG,
  DEFAULT_EMERGENCY_EXIT_CONFIG,
  DEFAULT_AGENT_COUNTS,
} from './defaults.js';

export { loadSwarmConfigFromEnv } from './env.js';

export { validateSwarmConfig } from './validation.js';
export type { ValidationResult } from './validation.js';

// ─── Convenience Factory ──────────────────────────────────────

/**
 * Create a fully validated SwarmMasterConfig.
 *
 * Resolution order (last wins):
 *   1. Built-in defaults (`defaults.ts`)
 *   2. Environment variables (`env.ts`)
 *   3. Programmatic overrides (the `overrides` parameter)
 *
 * After merging, the config is validated. If validation fails,
 * an error is thrown with all validation errors concatenated.
 *
 * @param overrides - Partial config to merge on top of env + defaults.
 * @returns A fully populated and validated SwarmMasterConfig.
 * @throws {Error} When the resulting config is invalid.
 */
export function createSwarmConfig(
  overrides?: Partial<SwarmMasterConfig>,
): SwarmMasterConfig {
  // Start from env (which already incorporates defaults)
  const fromEnv = loadSwarmConfigFromEnv();

  // Deep-merge overrides on top
  const merged: SwarmMasterConfig = overrides
    ? deepMergeConfig(fromEnv, overrides)
    : fromEnv;

  // Validate
  const result = validateSwarmConfig(merged);

  if (!result.valid) {
    const errorList = result.errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    throw new Error(
      `Invalid swarm configuration (${result.errors.length} error${result.errors.length === 1 ? '' : 's'}):\n${errorList}`,
    );
  }

  // Log warnings to stderr so they're visible but don't throw
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn(`[config] WARNING: ${warning}`);
    }
  }

  return merged;
}

// ─── Deep Merge Helper ────────────────────────────────────────

/**
 * Deep-merge a partial config onto a base config.
 * Arrays are replaced (not concatenated). Undefined values are skipped.
 */
function deepMergeConfig(
  base: SwarmMasterConfig,
  overrides: Partial<SwarmMasterConfig>,
): SwarmMasterConfig {
  const result = { ...base };

  for (const key of Object.keys(overrides) as Array<keyof SwarmMasterConfig>) {
    const overrideVal = overrides[key];
    if (overrideVal === undefined) continue;

    const baseVal = base[key];

    // If both values are plain objects (not arrays, not BN, not null), recurse
    if (
      baseVal !== null &&
      overrideVal !== null &&
      typeof baseVal === 'object' &&
      typeof overrideVal === 'object' &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overrideVal) &&
      !('toArray' in baseVal) // Skip BN instances
    ) {
      // Use Object.assign for one-level merge of sub-objects
      (result as Record<string, unknown>)[key] = {
        ...(baseVal as Record<string, unknown>),
        ...(overrideVal as Record<string, unknown>),
      };
    } else {
      (result as Record<string, unknown>)[key] = overrideVal;
    }
  }

  return result;
}
