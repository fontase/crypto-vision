# Prompt 59 — Swarm Config Manager

## Agent Identity & Rules

```
You are the SWARM-CONFIG-MANAGER builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real validation and hot-reload
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add runtime config manager with hot-reload and validation"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/swarm-config-manager.ts` — runtime configuration management that allows changing swarm parameters without restart. Supports hot-reload for trading parameters and validates changes to prevent dangerous configurations.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/swarm-config-manager.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/swarm-config-manager.ts`

1. **`SwarmConfigManager` class**:
   - `constructor(initialConfig: SwarmRuntimeConfig, eventBus: SwarmEventBus)`
   - `getConfig(): Readonly<SwarmRuntimeConfig>` — current config (frozen copy)
   - `updateConfig(patch: DeepPartial<SwarmRuntimeConfig>): ConfigUpdateResult` — apply partial update
   - `resetToDefaults(): void` — restore initial config
   - `getConfigHistory(): ConfigChange[]` — change history
   - `onConfigChange(callback: (change: ConfigChange) => void): () => void`
   - `validateConfig(config: DeepPartial<SwarmRuntimeConfig>): ConfigValidationResult`
   - `getConfigSchema(): ConfigSchemaInfo[]` — describe all config fields

2. **SwarmRuntimeConfig**:
   ```typescript
   interface SwarmRuntimeConfig {
     /** Trading parameters (hot-reloadable) */
     trading: {
       /** Default strategy name */
       strategy: string;
       /** Trade interval range (ms) */
       minInterval: number;
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
   ```

3. **ConfigUpdateResult**:
   ```typescript
   interface ConfigUpdateResult {
     success: boolean;
     applied: string[];              // Config paths that were updated
     rejected: string[];             // Config paths that were rejected
     warnings: string[];             // Warnings about the changes
     errors: string[];               // Errors (for rejected paths)
     requiresRestart: boolean;       // True if non-hot-reloadable fields changed
   }
   ```

4. **ConfigChange** (history entry):
   ```typescript
   interface ConfigChange {
     timestamp: number;
     changes: Array<{
       path: string;
       oldValue: unknown;
       newValue: unknown;
     }>;
     source: 'api' | 'internal' | 'default-reset';
     appliedSuccessfully: boolean;
   }
   ```

5. **ConfigValidationResult**:
   ```typescript
   interface ConfigValidationResult {
     valid: boolean;
     errors: Array<{ path: string; message: string; value: unknown }>;
     warnings: Array<{ path: string; message: string; value: unknown }>;
   }
   ```

6. **Validation rules**:
   ```typescript
   // Trading:
   // - strategy: must be one of known strategies
   // - minInterval: >= 1000 (at least 1 second)
   // - maxInterval: > minInterval, <= 600000 (10 min)
   // - buyRatio: 0.1 to 0.9
   // - maxTradeSize: 0.001 to 100 SOL
   // - slippageBps: 10 to 5000

   // Risk:
   // - stopLoss: 0.1 to 0.99 (can't be 0 or 1)
   // - maxDrawdown: 0.05 to 0.50
   // - maxPositionSize: 0.01 to 1000 SOL

   // Anti-detection:
   // - amountVariance: 1 to 50 (percent)
   // - maxTradesPerWalletPerHour: 1 to 100

   // Infrastructure (reject if changed without restart flag):
   // - rpcUrls: at least 1 URL
   // - network: mainnet-beta or devnet
   ```

7. **Hot-reload vs restart-required**:
   - Hot-reloadable: `trading.*`, `risk.*`, `agents.*`, `antiDetection.*`
   - Restart-required: `infrastructure.*` — these changes are accepted but flagged with `requiresRestart: true`
   - On hot-reload: emit `config:changed` event with the changes

8. **DeepPartial type helper**:
   ```typescript
   type DeepPartial<T> = {
     [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
   };
   ```

9. **ConfigSchemaInfo** (for dashboard display):
   ```typescript
   interface ConfigSchemaInfo {
     path: string;
     type: string;
     description: string;
     defaultValue: unknown;
     currentValue: unknown;
     hotReloadable: boolean;
     validation: { min?: number; max?: number; enum?: string[] };
   }
   ```

### Success Criteria

- Config updates validate all fields before applying
- Hot-reload emits events for runtime subscribers
- Non-hot-reloadable changes are accepted but flagged
- Validation prevents dangerous configs (0% stop-loss, extreme values)
- Config history tracks all changes with diffs
- Config schema provides enough info for dashboard UI generation
- DeepPartial allows updating nested fields without providing full config
- Compiles with `npx tsc --noEmit`
