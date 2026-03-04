/**
 * Swarm Config Manager — Runtime configuration management with hot-reload and validation.
 *
 * Allows changing swarm parameters without restart for hot-reloadable sections
 * (trading, risk, agents, antiDetection). Infrastructure changes are accepted
 * but flagged as requiring restart.
 */

import { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ---------------------------------------------------------------------------
// Type Helpers
// ---------------------------------------------------------------------------

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? U[]
    : T[P] extends readonly (infer U2)[]
      ? readonly U2[]
      : T[P] extends object
        ? DeepPartial<T[P]>
        : T[P];
};

// ---------------------------------------------------------------------------
// Configuration Interfaces
// ---------------------------------------------------------------------------

export interface SwarmRuntimeConfig {
  /** Trading parameters (hot-reloadable) */
  trading: {
    /** Default strategy name */
    strategy: string;
    /** Trade interval range minimum (ms) */
    minInterval: number;
    /** Trade interval range maximum (ms) */
    maxInterval: number;
    /** Buy/sell ratio (0-1, e.g., 0.6 = 60% buys) */
    buyRatio: number;
    /** Max SOL per trade */
    maxTradeSize: number;
    /** Slippage tolerance (basis points) */
    slippageBps: number;
    /** Whether trading is enabled */
    enabled: boolean;
  };
  /** Risk parameters (hot-reloadable) */
  risk: {
    /** Stop-loss percent (0-1) */
    stopLoss: number;
    /** Max drawdown percent (0-1) */
    maxDrawdown: number;
    /** Max position size (SOL) */
    maxPositionSize: number;
    /** Circuit breaker enabled */
    circuitBreakerEnabled: boolean;
    /** Max concurrent positions */
    maxConcurrentPositions: number;
  };
  /** Agent parameters (hot-reloadable) */
  agents: {
    /** Number of active trader agents */
    traderCount: number;
    /** Heartbeat interval (ms) */
    heartbeatInterval: number;
    /** Auto-restart on failure */
    autoRestart: boolean;
  };
  /** Anti-detection parameters (hot-reloadable) */
  antiDetection: {
    /** Amount variance percent */
    amountVariance: number;
    /** Timing jitter range (ms) */
    timingJitter: [number, number];
    /** Max trades per wallet per hour */
    maxTradesPerWalletPerHour: number;
    /** Enable noise transactions */
    enableNoise: boolean;
  };
  /** Infrastructure parameters (NOT hot-reloadable) */
  infrastructure: {
    /** RPC URLs */
    rpcUrls: string[];
    /** Network */
    network: 'mainnet-beta' | 'devnet';
    /** Log level */
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** Dashboard port */
    dashboardPort: number;
  };
}

export interface ConfigUpdateResult {
  success: boolean;
  /** Config paths that were updated */
  applied: string[];
  /** Config paths that were rejected */
  rejected: string[];
  /** Warnings about the changes */
  warnings: string[];
  /** Errors (for rejected paths) */
  errors: string[];
  /** True if non-hot-reloadable fields changed */
  requiresRestart: boolean;
}

export interface ConfigChange {
  timestamp: number;
  changes: Array<{
    path: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
  source: 'api' | 'internal' | 'default-reset';
  appliedSuccessfully: boolean;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string; value: unknown }>;
  warnings: Array<{ path: string; message: string; value: unknown }>;
}

export interface ConfigSchemaInfo {
  path: string;
  type: string;
  description: string;
  defaultValue: unknown;
  currentValue: unknown;
  hotReloadable: boolean;
  validation: { min?: number; max?: number; enum?: string[] };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_STRATEGIES = [
  'momentum',
  'mean-reversion',
  'arbitrage',
  'market-making',
  'scalping',
  'trend-following',
  'breakout',
  'dca',
  'snipe',
  'pump-and-dump',
] as const;

const HOT_RELOADABLE_SECTIONS = new Set<string>([
  'trading',
  'risk',
  'agents',
  'antiDetection',
]);

const MAX_HISTORY_SIZE = 500;

// ---------------------------------------------------------------------------
// Schema Definitions (for validation + dashboard)
// ---------------------------------------------------------------------------

interface SchemaFieldDef {
  path: string;
  type: string;
  description: string;
  hotReloadable: boolean;
  validation: { min?: number; max?: number; enum?: string[] };
}

const SCHEMA_FIELDS: SchemaFieldDef[] = [
  // Trading
  {
    path: 'trading.strategy',
    type: 'string',
    description: 'Default strategy name',
    hotReloadable: true,
    validation: { enum: [...KNOWN_STRATEGIES] },
  },
  {
    path: 'trading.minInterval',
    type: 'number',
    description: 'Minimum trade interval (ms)',
    hotReloadable: true,
    validation: { min: 1_000, max: 600_000 },
  },
  {
    path: 'trading.maxInterval',
    type: 'number',
    description: 'Maximum trade interval (ms)',
    hotReloadable: true,
    validation: { min: 1_001, max: 600_000 },
  },
  {
    path: 'trading.buyRatio',
    type: 'number',
    description: 'Buy/sell ratio (0.1–0.9)',
    hotReloadable: true,
    validation: { min: 0.1, max: 0.9 },
  },
  {
    path: 'trading.maxTradeSize',
    type: 'number',
    description: 'Max SOL per trade',
    hotReloadable: true,
    validation: { min: 0.001, max: 100 },
  },
  {
    path: 'trading.slippageBps',
    type: 'number',
    description: 'Slippage tolerance (basis points)',
    hotReloadable: true,
    validation: { min: 10, max: 5_000 },
  },
  {
    path: 'trading.enabled',
    type: 'boolean',
    description: 'Whether trading is enabled',
    hotReloadable: true,
    validation: {},
  },
  // Risk
  {
    path: 'risk.stopLoss',
    type: 'number',
    description: 'Stop-loss percent (0.1–0.99)',
    hotReloadable: true,
    validation: { min: 0.1, max: 0.99 },
  },
  {
    path: 'risk.maxDrawdown',
    type: 'number',
    description: 'Max drawdown percent (0.05–0.50)',
    hotReloadable: true,
    validation: { min: 0.05, max: 0.50 },
  },
  {
    path: 'risk.maxPositionSize',
    type: 'number',
    description: 'Max position size (SOL)',
    hotReloadable: true,
    validation: { min: 0.01, max: 1_000 },
  },
  {
    path: 'risk.circuitBreakerEnabled',
    type: 'boolean',
    description: 'Circuit breaker enabled',
    hotReloadable: true,
    validation: {},
  },
  {
    path: 'risk.maxConcurrentPositions',
    type: 'number',
    description: 'Max concurrent positions',
    hotReloadable: true,
    validation: { min: 1, max: 1_000 },
  },
  // Agents
  {
    path: 'agents.traderCount',
    type: 'number',
    description: 'Number of active trader agents',
    hotReloadable: true,
    validation: { min: 1, max: 1_000 },
  },
  {
    path: 'agents.heartbeatInterval',
    type: 'number',
    description: 'Heartbeat interval (ms)',
    hotReloadable: true,
    validation: { min: 500, max: 300_000 },
  },
  {
    path: 'agents.autoRestart',
    type: 'boolean',
    description: 'Auto-restart on failure',
    hotReloadable: true,
    validation: {},
  },
  // Anti-detection
  {
    path: 'antiDetection.amountVariance',
    type: 'number',
    description: 'Amount variance percent',
    hotReloadable: true,
    validation: { min: 1, max: 50 },
  },
  {
    path: 'antiDetection.timingJitter',
    type: 'tuple<number,number>',
    description: 'Timing jitter range [min, max] (ms)',
    hotReloadable: true,
    validation: { min: 0, max: 60_000 },
  },
  {
    path: 'antiDetection.maxTradesPerWalletPerHour',
    type: 'number',
    description: 'Max trades per wallet per hour',
    hotReloadable: true,
    validation: { min: 1, max: 100 },
  },
  {
    path: 'antiDetection.enableNoise',
    type: 'boolean',
    description: 'Enable noise transactions',
    hotReloadable: true,
    validation: {},
  },
  // Infrastructure
  {
    path: 'infrastructure.rpcUrls',
    type: 'string[]',
    description: 'RPC URLs',
    hotReloadable: false,
    validation: { min: 1 },
  },
  {
    path: 'infrastructure.network',
    type: 'string',
    description: 'Solana network',
    hotReloadable: false,
    validation: { enum: ['mainnet-beta', 'devnet'] },
  },
  {
    path: 'infrastructure.logLevel',
    type: 'string',
    description: 'Log level',
    hotReloadable: false,
    validation: { enum: ['debug', 'info', 'warn', 'error'] },
  },
  {
    path: 'infrastructure.dashboardPort',
    type: 'number',
    description: 'Dashboard port',
    hotReloadable: false,
    validation: { min: 1, max: 65_535 },
  },
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Deep-clone a value (structuredClone-safe) */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Get a nested value from an object by dot-separated path */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a nested value on an object by dot-separated path */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Flatten a DeepPartial into an array of { path, value } pairs.
 * Only flattens to leaf values — arrays and primitives are leaves.
 */
function flattenPatch(
  obj: Record<string, unknown>,
  prefix = '',
): Array<{ path: string; value: unknown }> {
  const result: Array<{ path: string; value: unknown }> = [];
  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (
      value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      result.push(...flattenPatch(value as Record<string, unknown>, fullPath));
    } else {
      result.push({ path: fullPath, value });
    }
  }
  return result;
}

/** Deep-freeze an object recursively (returns frozen reference) */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return obj;
}

// ---------------------------------------------------------------------------
// SwarmConfigManager
// ---------------------------------------------------------------------------

export class SwarmConfigManager {
  private config: SwarmRuntimeConfig;
  private readonly initialConfig: SwarmRuntimeConfig;
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;
  private readonly history: ConfigChange[] = [];
  private readonly changeListeners = new Set<(change: ConfigChange) => void>();

  constructor(initialConfig: SwarmRuntimeConfig, eventBus: SwarmEventBus) {
    this.initialConfig = deepClone(initialConfig);
    this.config = deepClone(initialConfig);
    this.eventBus = eventBus;
    this.logger = SwarmLogger.create('config-manager', 'coordination');

    // Validate initial config — warn but don't throw
    const validation = this.validateConfig(initialConfig);
    if (!validation.valid) {
      for (const err of validation.errors) {
        this.logger.warn(`Initial config validation error at ${err.path}: ${err.message}`, {
          path: err.path,
          value: err.value,
        });
      }
    }
    for (const w of validation.warnings) {
      this.logger.warn(`Initial config warning at ${w.path}: ${w.message}`, {
        path: w.path,
        value: w.value,
      });
    }

    this.logger.info('Config manager initialised', {
      sections: Object.keys(initialConfig),
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Return a frozen deep copy of the current config. */
  getConfig(): Readonly<SwarmRuntimeConfig> {
    return deepFreeze(deepClone(this.config));
  }

  /** Apply a partial config update. Validates and rejects dangerous changes. */
  updateConfig(
    patch: DeepPartial<SwarmRuntimeConfig>,
    source: 'api' | 'internal' = 'api',
  ): ConfigUpdateResult {
    const result: ConfigUpdateResult = {
      success: false,
      applied: [],
      rejected: [],
      warnings: [],
      errors: [],
      requiresRestart: false,
    };

    const leaves = flattenPatch(patch as Record<string, unknown>);
    if (leaves.length === 0) {
      result.success = true;
      this.logger.info('Empty config patch — nothing to apply');
      return result;
    }

    // Validate entire patch first
    const validation = this.validateConfig(patch);
    const rejectedPaths = new Set(validation.errors.map((e) => e.path));
    result.errors = validation.errors.map((e) => `${e.path}: ${e.message}`);
    result.warnings = validation.warnings.map((w) => `${w.path}: ${w.message}`);

    const changeDiffs: ConfigChange['changes'] = [];
    const configAsRecord = this.config as unknown as Record<string, unknown>;

    for (const { path, value } of leaves) {
      if (rejectedPaths.has(path)) {
        result.rejected.push(path);
        continue;
      }

      const topSection = path.split('.')[0];

      // Check hot-reloadable vs restart-required
      if (!HOT_RELOADABLE_SECTIONS.has(topSection)) {
        result.requiresRestart = true;
        result.warnings.push(
          `${path}: change requires restart to take effect`,
        );
      }

      // Cross-field validation: maxInterval must be > minInterval
      if (path === 'trading.minInterval') {
        const currentMax =
          (getNestedValue(patch as Record<string, unknown>, 'trading.maxInterval') as
            | number
            | undefined) ?? this.config.trading.maxInterval;
        if ((value as number) >= currentMax) {
          result.rejected.push(path);
          result.errors.push(
            `${path}: minInterval (${value as number}) must be less than maxInterval (${currentMax})`,
          );
          continue;
        }
      }
      if (path === 'trading.maxInterval') {
        const currentMin =
          (getNestedValue(patch as Record<string, unknown>, 'trading.minInterval') as
            | number
            | undefined) ?? this.config.trading.minInterval;
        if ((value as number) <= currentMin) {
          result.rejected.push(path);
          result.errors.push(
            `${path}: maxInterval (${value as number}) must be greater than minInterval (${currentMin})`,
          );
          continue;
        }
      }

      // Timing jitter cross-field: jitter[0] <= jitter[1]
      if (path === 'antiDetection.timingJitter') {
        const tuple = value as [number, number];
        if (tuple[0] > tuple[1]) {
          result.rejected.push(path);
          result.errors.push(
            `${path}: jitter min (${tuple[0]}) must be <= jitter max (${tuple[1]})`,
          );
          continue;
        }
      }

      const oldValue = getNestedValue(configAsRecord, path);
      changeDiffs.push({ path, oldValue: deepClone(oldValue), newValue: deepClone(value) });
      setNestedValue(configAsRecord, path, value);
      result.applied.push(path);
    }

    result.success = result.rejected.length === 0 && result.applied.length > 0;

    // Record history
    const historyEntry: ConfigChange = {
      timestamp: Date.now(),
      changes: changeDiffs,
      source,
      appliedSuccessfully: result.applied.length > 0,
    };
    this.pushHistory(historyEntry);

    // Notify listeners and emit event for hot-reloadable changes
    if (result.applied.length > 0) {
      this.notifyListeners(historyEntry);

      const hotReloadedPaths = result.applied.filter((p) =>
        HOT_RELOADABLE_SECTIONS.has(p.split('.')[0]),
      );

      if (hotReloadedPaths.length > 0) {
        this.eventBus.emit(
          'config:changed',
          'coordination',
          'config-manager',
          {
            applied: result.applied,
            rejected: result.rejected,
            requiresRestart: result.requiresRestart,
            changes: changeDiffs,
          },
        );
      }

      this.logger.info('Config updated', {
        applied: result.applied.length,
        rejected: result.rejected.length,
        requiresRestart: result.requiresRestart,
      });
    }

    if (result.rejected.length > 0) {
      this.logger.warn('Some config changes rejected', {
        rejected: result.rejected,
        errors: result.errors,
      });
    }

    return result;
  }

  /** Restore all config values to the initial defaults. */
  resetToDefaults(): void {
    const oldConfig = deepClone(this.config);
    this.config = deepClone(this.initialConfig);

    const diffs = this.diffConfigs(
      oldConfig as unknown as Record<string, unknown>,
      this.config as unknown as Record<string, unknown>,
    );

    const historyEntry: ConfigChange = {
      timestamp: Date.now(),
      changes: diffs,
      source: 'default-reset',
      appliedSuccessfully: true,
    };
    this.pushHistory(historyEntry);
    this.notifyListeners(historyEntry);

    this.eventBus.emit('config:changed', 'coordination', 'config-manager', {
      applied: diffs.map((d) => d.path),
      rejected: [],
      requiresRestart: false,
      changes: diffs,
      reset: true,
    });

    this.logger.info('Config reset to defaults', { changedPaths: diffs.length });
  }

  /** Return the full change history. */
  getConfigHistory(): ConfigChange[] {
    return deepClone(this.history);
  }

  /** Register a callback for config changes. Returns an unsubscribe function. */
  onConfigChange(callback: (change: ConfigChange) => void): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  /** Validate a partial config patch without applying it. */
  validateConfig(config: DeepPartial<SwarmRuntimeConfig>): ConfigValidationResult {
    const errors: ConfigValidationResult['errors'] = [];
    const warnings: ConfigValidationResult['warnings'] = [];

    const leaves = flattenPatch(config as Record<string, unknown>);

    for (const { path, value } of leaves) {
      const schemaDef = SCHEMA_FIELDS.find((f) => f.path === path);
      if (!schemaDef) {
        errors.push({ path, message: 'Unknown config path', value });
        continue;
      }

      // Type checks
      switch (schemaDef.type) {
        case 'number': {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push({ path, message: 'Must be a finite number', value });
            continue;
          }
          if (schemaDef.validation.min !== undefined && value < schemaDef.validation.min) {
            errors.push({
              path,
              message: `Must be >= ${schemaDef.validation.min}`,
              value,
            });
          }
          if (schemaDef.validation.max !== undefined && value > schemaDef.validation.max) {
            errors.push({
              path,
              message: `Must be <= ${schemaDef.validation.max}`,
              value,
            });
          }
          break;
        }

        case 'string': {
          if (typeof value !== 'string') {
            errors.push({ path, message: 'Must be a string', value });
            continue;
          }
          if (schemaDef.validation.enum && !schemaDef.validation.enum.includes(value)) {
            errors.push({
              path,
              message: `Must be one of: ${schemaDef.validation.enum.join(', ')}`,
              value,
            });
          }
          break;
        }

        case 'boolean': {
          if (typeof value !== 'boolean') {
            errors.push({ path, message: 'Must be a boolean', value });
          }
          break;
        }

        case 'string[]': {
          if (!Array.isArray(value)) {
            errors.push({ path, message: 'Must be an array of strings', value });
            continue;
          }
          if (
            schemaDef.validation.min !== undefined &&
            value.length < schemaDef.validation.min
          ) {
            errors.push({
              path,
              message: `Must have at least ${schemaDef.validation.min} element(s)`,
              value,
            });
          }
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== 'string') {
              errors.push({
                path: `${path}[${i}]`,
                message: 'Array element must be a string',
                value: value[i],
              });
            }
          }
          break;
        }

        case 'tuple<number,number>': {
          if (!Array.isArray(value) || value.length !== 2) {
            errors.push({ path, message: 'Must be a tuple [min, max]', value });
            continue;
          }
          const [a, b] = value as [unknown, unknown];
          if (typeof a !== 'number' || !Number.isFinite(a)) {
            errors.push({ path: `${path}[0]`, message: 'Must be a finite number', value: a });
          }
          if (typeof b !== 'number' || !Number.isFinite(b)) {
            errors.push({ path: `${path}[1]`, message: 'Must be a finite number', value: b });
          }
          if (typeof a === 'number' && typeof b === 'number') {
            if (
              schemaDef.validation.min !== undefined &&
              (a < schemaDef.validation.min || b < schemaDef.validation.min)
            ) {
              errors.push({
                path,
                message: `Both values must be >= ${schemaDef.validation.min}`,
                value,
              });
            }
            if (
              schemaDef.validation.max !== undefined &&
              (a > schemaDef.validation.max || b > schemaDef.validation.max)
            ) {
              errors.push({
                path,
                message: `Both values must be <= ${schemaDef.validation.max}`,
                value,
              });
            }
          }
          break;
        }
      }

      // Section-level warnings
      if (!schemaDef.hotReloadable) {
        warnings.push({
          path,
          message: 'This field requires a restart to take effect',
          value,
        });
      }
    }

    // Extra cross-field validations that can be checked in isolation
    const patchRecord = config as Record<string, unknown>;
    const tradingPatch = patchRecord['trading'] as Record<string, unknown> | undefined;
    if (tradingPatch) {
      const minInterval = tradingPatch['minInterval'] as number | undefined;
      const maxInterval = tradingPatch['maxInterval'] as number | undefined;
      if (minInterval !== undefined && maxInterval !== undefined && minInterval >= maxInterval) {
        errors.push({
          path: 'trading.minInterval',
          message: `minInterval (${minInterval}) must be less than maxInterval (${maxInterval})`,
          value: minInterval,
        });
      }
    }

    const antiDetectionPatch = patchRecord['antiDetection'] as Record<string, unknown> | undefined;
    if (antiDetectionPatch) {
      const jitter = antiDetectionPatch['timingJitter'] as [number, number] | undefined;
      if (jitter && Array.isArray(jitter) && jitter.length === 2 && jitter[0] > jitter[1]) {
        errors.push({
          path: 'antiDetection.timingJitter',
          message: `Jitter min (${jitter[0]}) must be <= jitter max (${jitter[1]})`,
          value: jitter,
        });
      }
    }

    // Risk warnings for aggressive settings
    const riskPatch = patchRecord['risk'] as Record<string, unknown> | undefined;
    if (riskPatch) {
      const stopLoss = riskPatch['stopLoss'] as number | undefined;
      if (stopLoss !== undefined && stopLoss > 0.5) {
        warnings.push({
          path: 'risk.stopLoss',
          message: `Stop-loss of ${(stopLoss * 100).toFixed(0)}% is aggressive — consider a tighter value`,
          value: stopLoss,
        });
      }
      const maxDrawdown = riskPatch['maxDrawdown'] as number | undefined;
      if (maxDrawdown !== undefined && maxDrawdown > 0.3) {
        warnings.push({
          path: 'risk.maxDrawdown',
          message: `Max drawdown of ${(maxDrawdown * 100).toFixed(0)}% is aggressive`,
          value: maxDrawdown,
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /** Describe all config fields for dashboard UI generation. */
  getConfigSchema(): ConfigSchemaInfo[] {
    const configRecord = this.config as unknown as Record<string, unknown>;
    const initialRecord = this.initialConfig as unknown as Record<string, unknown>;

    return SCHEMA_FIELDS.map((field) => ({
      path: field.path,
      type: field.type,
      description: field.description,
      defaultValue: deepClone(getNestedValue(initialRecord, field.path)),
      currentValue: deepClone(getNestedValue(configRecord, field.path)),
      hotReloadable: field.hotReloadable,
      validation: { ...field.validation },
    }));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Push a history entry, evicting oldest if over limit. */
  private pushHistory(entry: ConfigChange): void {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history.splice(0, this.history.length - MAX_HISTORY_SIZE);
    }
  }

  /** Notify all registered change listeners. */
  private notifyListeners(change: ConfigChange): void {
    for (const listener of this.changeListeners) {
      try {
        listener(change);
      } catch (err) {
        this.logger.error(
          'Config change listener threw',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }

  /** Diff two config objects (both already record-typed). */
  private diffConfigs(
    oldCfg: Record<string, unknown>,
    newCfg: Record<string, unknown>,
  ): ConfigChange['changes'] {
    const diffs: ConfigChange['changes'] = [];
    for (const field of SCHEMA_FIELDS) {
      const oldVal = getNestedValue(oldCfg, field.path);
      const newVal = getNestedValue(newCfg, field.path);
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diffs.push({
          path: field.path,
          oldValue: deepClone(oldVal),
          newValue: deepClone(newVal),
        });
      }
    }
    return diffs;
  }
}
