/**
 * Configuration Validator
 *
 * Validates a SwarmMasterConfig before the swarm launches.
 * Catches misconfigurations early with clear, field-path-specific
 * error messages and actionable warnings.
 */

import type {
  SwarmMasterConfig,
  RpcPoolConfig,
  WalletVaultConfig,
  BundleBuyConfig,
  IntelligenceConfig,
  EmergencyExitConfig,
  TokenConfig,
  ScannerConfig,
  DashboardConfig,
} from '../types.js';

// ─── Result Type ──────────────────────────────────────────────

export interface ValidationResult {
  /** Whether the config is valid (no errors, warnings are ok) */
  valid: boolean;
  /** Errors that prevent launch */
  errors: string[];
  /** Warnings that don't prevent launch but should be reviewed */
  warnings: string[];
}

// ─── Validators ───────────────────────────────────────────────

const URL_PATTERN = /^https?:\/\/.+/;
const WS_URL_PATTERN = /^wss?:\/\/.+/;
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/;

function validateRpc(rpc: RpcPoolConfig, errors: string[], warnings: string[]): void {
  if (rpc.endpoints.length === 0) {
    errors.push('rpc.endpoints: at least one RPC endpoint is required');
    return;
  }

  for (let i = 0; i < rpc.endpoints.length; i++) {
    const ep = rpc.endpoints[i];
    if (!URL_PATTERN.test(ep.url)) {
      errors.push(`rpc.endpoints[${i}].url: invalid URL format "${ep.url}" — must start with http:// or https://`);
    }
    if (ep.wsUrl && !WS_URL_PATTERN.test(ep.wsUrl)) {
      errors.push(`rpc.endpoints[${i}].wsUrl: invalid WebSocket URL "${ep.wsUrl}" — must start with ws:// or wss://`);
    }
    if (ep.weight <= 0) {
      errors.push(`rpc.endpoints[${i}].weight: must be positive, got ${ep.weight}`);
    }
    if (ep.rateLimit <= 0) {
      errors.push(`rpc.endpoints[${i}].rateLimit: must be positive, got ${ep.rateLimit}`);
    }
  }

  if (rpc.endpoints.length === 1) {
    warnings.push('rpc.endpoints: only one RPC endpoint configured — no failover available');
  }

  if (rpc.healthCheckIntervalMs < 5_000) {
    warnings.push(`rpc.healthCheckIntervalMs: ${rpc.healthCheckIntervalMs}ms is very aggressive — consider >= 10000ms`);
  }

  if (rpc.maxRetries < 1) {
    errors.push(`rpc.maxRetries: must be >= 1, got ${rpc.maxRetries}`);
  }

  if (rpc.requestTimeoutMs < 1_000) {
    warnings.push(`rpc.requestTimeoutMs: ${rpc.requestTimeoutMs}ms is very low — may cause false positives`);
  }
}

function validateWallets(wallets: WalletVaultConfig, errors: string[], warnings: string[]): void {
  if (wallets.poolSize < 1) {
    errors.push(`wallets.poolSize: must be >= 1, got ${wallets.poolSize}`);
  }

  if (wallets.poolSize > 50) {
    warnings.push(`wallets.poolSize: ${wallets.poolSize} wallets is unusually large — consider reducing to avoid funding issues`);
  }

  if (wallets.minBalanceLamports.isNeg()) {
    errors.push('wallets.minBalanceLamports: cannot be negative');
  }

  if (wallets.encryptionPassword !== undefined && wallets.encryptionPassword.length < 8) {
    warnings.push('wallets.encryptionPassword: password is shorter than 8 characters — consider a stronger password');
  }

  if (wallets.mnemonic) {
    const wordCount = wallets.mnemonic.trim().split(/\s+/).length;
    if (wordCount !== 12 && wordCount !== 24) {
      errors.push(`wallets.mnemonic: BIP-39 mnemonic must be 12 or 24 words, got ${wordCount}`);
    }
  }
}

function validateToken(token: TokenConfig | undefined, scanner: ScannerConfig | undefined, errors: string[], warnings: string[]): void {
  if (token && scanner) {
    errors.push('token + scannerConfig: cannot set both token creation and scanner config — choose one');
  }

  if (!token && !scanner) {
    warnings.push('token + scannerConfig: neither token nor scanner configured — swarm will need manual token assignment');
  }

  if (token) {
    if (!token.name || token.name.trim().length === 0) {
      errors.push('token.name: cannot be empty');
    }
    if (token.name && token.name.length > 100) {
      warnings.push(`token.name: "${token.name}" is very long (${token.name.length} chars) — may be truncated on-chain`);
    }
    if (!token.symbol || token.symbol.trim().length === 0) {
      errors.push('token.symbol: cannot be empty');
    }
    if (token.symbol && token.symbol.length > 10) {
      warnings.push(`token.symbol: "${token.symbol}" is longer than typical (${token.symbol.length} chars)`);
    }
    if (!token.metadataUri || !URL_PATTERN.test(token.metadataUri)) {
      errors.push(`token.metadataUri: invalid URL "${token.metadataUri ?? ''}" — must be a valid HTTP(S) URL`);
    }
  }

  if (scanner) {
    if (scanner.minMarketCapSol >= scanner.maxMarketCapSol) {
      errors.push('scannerConfig: minMarketCapSol must be less than maxMarketCapSol');
    }
    if (scanner.maxDevHoldingsPercent < 0 || scanner.maxDevHoldingsPercent > 100) {
      errors.push(`scannerConfig.maxDevHoldingsPercent: must be 0-100, got ${scanner.maxDevHoldingsPercent}`);
    }
  }
}

function validateBundle(bundle: BundleBuyConfig, errors: string[], warnings: string[]): void {
  if (bundle.devBuyLamports.isNeg() || bundle.devBuyLamports.isZero()) {
    errors.push('bundle.devBuyLamports: must be positive');
  }

  if (bundle.slippageBps < 0) {
    errors.push(`bundle.slippageBps: cannot be negative, got ${bundle.slippageBps}`);
  }

  if (bundle.slippageBps > 5_000) {
    errors.push(`bundle.slippageBps: ${bundle.slippageBps} bps (${bundle.slippageBps / 100}%) is dangerously high — max 5000 bps (50%)`);
  }

  if (bundle.slippageBps > 1_000) {
    warnings.push(`bundle.slippageBps: ${bundle.slippageBps} bps (${bundle.slippageBps / 100}%) is above typical range`);
  }

  for (let i = 0; i < bundle.bundleWallets.length; i++) {
    const bw = bundle.bundleWallets[i];
    if (bw.amountLamports.isNeg() || bw.amountLamports.isZero()) {
      errors.push(`bundle.bundleWallets[${i}].amountLamports: must be positive`);
    }
  }
}

function validateIntelligence(intel: IntelligenceConfig, errors: string[], warnings: string[]): void {
  const validProviders = ['openai', 'anthropic', 'openrouter'];
  if (!validProviders.includes(intel.llmProvider)) {
    errors.push(`intelligence.llmProvider: "${intel.llmProvider}" is not supported — use one of: ${validProviders.join(', ')}`);
  }

  if (!intel.llmApiKey) {
    warnings.push('intelligence.llmApiKey: not set — narrative generation and AI signals will be disabled');
  }

  if (!intel.llmModel) {
    errors.push('intelligence.llmModel: cannot be empty when LLM provider is configured');
  }

  if (intel.riskTolerance < 0 || intel.riskTolerance > 1) {
    errors.push(`intelligence.riskTolerance: must be 0-1, got ${intel.riskTolerance}`);
  }

  if (intel.maxAllocationPerToken < 0 || intel.maxAllocationPerToken > 1) {
    errors.push(`intelligence.maxAllocationPerToken: must be 0-1, got ${intel.maxAllocationPerToken}`);
  }
}

function validateDashboard(dashboard: DashboardConfig | undefined, warnings: string[]): void {
  if (!dashboard) return;

  if (dashboard.port < 1 || dashboard.port > 65535) {
    warnings.push(`dashboard.port: ${dashboard.port} is out of valid range (1-65535)`);
  }

  if (dashboard.publicAccess && !dashboard.authToken) {
    warnings.push('dashboard: publicAccess is true but no authToken is set — dashboard will be unauthenticated');
  }

  if (dashboard.updateIntervalMs < 500) {
    warnings.push(`dashboard.updateIntervalMs: ${dashboard.updateIntervalMs}ms is very fast — may impact performance`);
  }
}

function validateStrategy(config: SwarmMasterConfig, errors: string[], warnings: string[]): void {
  const { strategy } = config;

  if (strategy.minIntervalSeconds < 0) {
    errors.push(`strategy.minIntervalSeconds: cannot be negative, got ${strategy.minIntervalSeconds}`);
  }

  if (strategy.maxIntervalSeconds < strategy.minIntervalSeconds) {
    errors.push('strategy.maxIntervalSeconds: must be >= minIntervalSeconds');
  }

  if (strategy.minTradeSizeLamports.isNeg() || strategy.minTradeSizeLamports.isZero()) {
    errors.push('strategy.minTradeSizeLamports: must be positive');
  }

  if (strategy.maxTradeSizeLamports.lt(strategy.minTradeSizeLamports)) {
    errors.push('strategy.maxTradeSizeLamports: must be >= minTradeSizeLamports');
  }

  if (strategy.buySellRatio <= 0) {
    errors.push(`strategy.buySellRatio: must be positive, got ${strategy.buySellRatio}`);
  }

  if (strategy.maxTotalBudgetLamports.isNeg() || strategy.maxTotalBudgetLamports.isZero()) {
    errors.push('strategy.maxTotalBudgetLamports: must be positive');
  }

  if (strategy.priorityFeeMicroLamports < 0) {
    errors.push(`strategy.priorityFeeMicroLamports: cannot be negative, got ${strategy.priorityFeeMicroLamports}`);
  }

  if (strategy.maxTrades !== undefined && strategy.maxTrades < 1) {
    errors.push(`strategy.maxTrades: must be >= 1, got ${strategy.maxTrades}`);
  }

  if (strategy.maxDurationSeconds !== undefined && strategy.maxDurationSeconds < 1) {
    errors.push(`strategy.maxDurationSeconds: must be >= 1, got ${strategy.maxDurationSeconds}`);
  }

  // Warn about aggressive strategies on mainnet
  if (config.network === 'mainnet-beta') {
    if (strategy.buySellRatio > 5) {
      warnings.push(`strategy.buySellRatio: ${strategy.buySellRatio} is very aggressive on mainnet — risk of significant losses`);
    }
  }
}

function validateEmergencyExit(exit: EmergencyExitConfig, errors: string[], warnings: string[]): void {
  if (exit.maxLossLamports.isNeg() || exit.maxLossLamports.isZero()) {
    errors.push('emergencyExit.maxLossLamports: must be positive');
  }

  if (exit.maxLossPercent < 0 || exit.maxLossPercent > 100) {
    errors.push(`emergencyExit.maxLossPercent: must be 0-100, got ${exit.maxLossPercent}`);
  }

  if (exit.maxLossPercent > 80) {
    warnings.push(`emergencyExit.maxLossPercent: ${exit.maxLossPercent}% is very high — consider lowering to limit risk`);
  }

  if (exit.maxSilenceMs < 10_000) {
    warnings.push(`emergencyExit.maxSilenceMs: ${exit.maxSilenceMs}ms is very short — may trigger false exits`);
  }

  if (!exit.sellAllOnExit && !exit.reclaimOnExit) {
    warnings.push('emergencyExit: both sellAllOnExit and reclaimOnExit are false — funds will remain in wallets on emergency exit');
  }
}

function validateAgentCounts(counts: Record<string, number>, errors: string[]): void {
  for (const [role, count] of Object.entries(counts)) {
    if (count < 0) {
      errors.push(`agentCounts.${role}: cannot be negative, got ${count}`);
    }
    if (!Number.isInteger(count)) {
      errors.push(`agentCounts.${role}: must be an integer, got ${count}`);
    }
  }

  if ((counts['trader'] ?? 0) < 1) {
    errors.push('agentCounts.trader: at least one trader agent is required');
  }

  if ((counts['creator'] ?? 0) < 1 && (counts['scanner'] ?? 0) < 1) {
    errors.push('agentCounts: at least one creator or scanner agent is required');
  }
}

// ─── Main Validator ───────────────────────────────────────────

/**
 * Validate a SwarmMasterConfig before launch.
 *
 * Returns errors (launch-blocking) and warnings (review recommended).
 * Check `result.valid` before proceeding.
 */
export function validateSwarmConfig(config: SwarmMasterConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Network
  if (config.network !== 'mainnet-beta' && config.network !== 'devnet') {
    errors.push(`network: must be "mainnet-beta" or "devnet", got "${config.network}"`);
  }

  // Log level
  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLogLevels.includes(config.logLevel)) {
    errors.push(`logLevel: must be one of ${validLogLevels.join(', ')}, got "${config.logLevel}"`);
  }

  // Devnet safety check
  if (config.network === 'devnet') {
    warnings.push('network: running on devnet — token creation and trading will use devnet SOL');
  }

  // Section validators
  validateRpc(config.rpc, errors, warnings);
  validateWallets(config.wallets, errors, warnings);
  validateToken(config.token, config.scannerConfig, errors, warnings);
  validateBundle(config.bundle, errors, warnings);
  validateIntelligence(config.intelligence, errors, warnings);
  validateDashboard(config.dashboard, warnings);
  validateStrategy(config, errors, warnings);
  validateEmergencyExit(config.emergencyExit, errors, warnings);
  validateAgentCounts(config.agentCounts, errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
