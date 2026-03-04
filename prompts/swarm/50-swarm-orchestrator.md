# Prompt 50 — Swarm Orchestrator

## Agent Identity & Rules

```
You are the SWARM-ORCHESTRATOR builder. This is the MOST IMPORTANT prompt in the entire system.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — this wires together ALL real components
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add SwarmOrchestrator — the main brain coordinating all agents"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/swarm-orchestrator.ts` — **THE MAIN BRAIN**. This is a complete rewrite/replacement of the existing `swarm.ts`, using all the new infrastructure built in prompts 01-49. It creates and manages every agent, coordinates all phases, makes strategic decisions, and handles the full lifecycle from startup to shutdown.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/swarm-orchestrator.ts`
- **Note**: Does NOT modify `swarm.ts` — the old file remains for backward compatibility. This is the new orchestrator.

## Dependencies

- `types.ts` — all shared types
- `strategies.ts` — preset strategies
- `infra/rpc-pool.ts` — `RPCConnectionPool`
- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/state-machine.ts` — `SwarmStateMachine`
- `infra/logger.ts` — `SwarmLogger`
- `infra/metrics.ts` — `MetricsCollector`
- `infra/error-handler.ts` — `ErrorHandler`
- `config/index.ts` — `SwarmConfigManager`
- `wallet-manager.ts` — wallet operations
- `agents/narrative-agent.ts` — `NarrativeAgent`
- `agents/scanner-agent.ts` — `ScannerAgent`
- `agents/creator-agent.ts` — `CreatorAgent`
- `agents/trader-agent.ts` — `TraderAgent`
- `agents/sniper-agent.ts` — `SniperAgent`
- `agents/market-maker-agent.ts` — `MarketMakerAgent`
- `agents/volume-agent.ts` — `VolumeAgent`
- `agents/accumulator-agent.ts` — `AccumulatorAgent`
- `agents/exit-agent.ts` — `ExitAgent`
- `agents/sentinel-agent.ts` — `SentinelAgent`
- `intelligence/strategy-brain.ts` — `StrategyBrain`
- `intelligence/risk-manager.ts` — `RiskManager`
- `intelligence/signal-generator.ts` — `SignalGenerator`
- `bundle/launch-sequencer.ts` — `LaunchSequencer`
- `trading/wash-engine.ts` — `WashEngine`
- `coordination/audit-logger.ts` — `AuditLogger`
- `coordination/phase-controller.ts` — `PhaseController`
- `coordination/health-monitor.ts` — `HealthMonitor`
- `coordination/lifecycle-manager.ts` — `LifecycleManager`
- `coordination/agent-messenger.ts` — `AgentMessenger`

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/swarm-orchestrator.ts`

This is the largest and most complex file. Target 600+ lines.

1. **`SwarmOrchestrator` class**:
   - `constructor(config: SwarmOrchestratorConfig)`
   - `initialize(): Promise<void>` — set up all infrastructure and agents
   - `start(): Promise<void>` — begin the autonomous swarm loop
   - `stop(reason?: string): Promise<void>` — graceful shutdown
   - `pause(): void` — pause trading (keep monitoring)
   - `resume(): void` — resume trading
   - `getStatus(): SwarmOrchestratorStatus` — comprehensive status
   - `executeDecision(decision: StrategyDecision): Promise<void>` — execute a strategic decision
   - `getMetrics(): SwarmMetrics` — current metrics
   - `getAuditTrail(): AuditEntry[]` — full audit trail
   - `destroy(): Promise<void>` — cleanup all resources

2. **SwarmOrchestratorConfig**:
   ```typescript
   interface SwarmOrchestratorConfig {
     /** Solana RPC URLs (primary + fallbacks) */
     rpcUrls: string[];
     /** Master wallet secret key (base58 or Uint8Array) */
     masterWalletSecret: string | Uint8Array;
     /** Total SOL budget for operations */
     totalBudgetSOL: number;
     /** Number of trader agents to spawn */
     traderCount: number;
     /** Network: mainnet-beta or devnet */
     network: 'mainnet-beta' | 'devnet';
     /** OpenRouter API key for AI decisions */
     openRouterApiKey: string;
     /** Trading strategy preference */
     defaultStrategy: 'organic' | 'volume' | 'graduation' | 'exit';
     /** Risk limits */
     riskLimits: RiskLimits;
     /** Auto-mode: let the brain decide everything */
     autonomous: boolean;
     /** Max duration for the entire swarm session (ms) */
     maxSessionDuration: number;
     /** Dashboard port (0 = disabled) */
     dashboardPort: number;
     /** Log level */
     logLevel: 'debug' | 'info' | 'warn' | 'error';
   }
   ```

3. **Initialization sequence** (`initialize()`):
   ```typescript
   // Step 1: Create infrastructure
   //   - RPCConnectionPool with configured URLs
   //   - SwarmEventBus
   //   - SwarmStateMachine (initial state: 'initializing')
   //   - SwarmLogger with configured level
   //   - MetricsCollector
   //   - ErrorHandler
   //   - AuditLogger (subscribes to event bus)

   // Step 2: Set up wallets
   //   - Restore master wallet from secret
   //   - Generate trader wallet pool (N wallets)
   //   - Check master wallet balance vs budget

   // Step 3: Create intelligence layer
   //   - StrategyBrain with OpenRouter config
   //   - RiskManager with risk limits
   //   - SignalGenerator

   // Step 4: Create coordination layer
   //   - PhaseController
   //   - HealthMonitor
   //   - LifecycleManager
   //   - AgentMessenger

   // Step 5: Create agents (via LifecycleManager)
   //   - NarrativeAgent (1)
   //   - ScannerAgent (1)
   //   - CreatorAgent (1)
   //   - SentinelAgent (1)
   //   - TraderAgents (N, based on traderCount)
   //   - MarketMakerAgent (1)
   //   - VolumeAgent (1)
   //   - AccumulatorAgent (1)
   //   - ExitAgent (1)

   // Step 6: Create operational components
   //   - LaunchSequencer
   //   - WashEngine

   // Step 7: Wire event handlers
   //   - Listen for strategic events: phase changes, risk alerts, signals
   //   - Connect agents to event bus
   //   - Set up health monitoring

   // Step 8: Transition state to 'ready'
   //   - Emit 'swarm:initialized' event
   //   - Log initialization summary
   ```

4. **Main loop** (`start()`):
   ```typescript
   // The autonomous swarm loop:
   // 1. Transition to 'scouting' phase
   // 2. Gather market context (SOL price, trends, Fear/Greed, etc.)
   // 3. Ask StrategyBrain for decision
   // 4. Validate decision with RiskManager
   // 5. Execute decision:
   //    - 'launch-new': NarrativeAgent → CreatorAgent → LaunchSequencer → start trading
   //    - 'buy-existing': ScannerAgent finds target → SniperAgent buys → start trading
   //    - 'adjust-strategy': update trading parameters
   //    - 'exit-position': ExitAgent coordinates exit
   //    - 'hold': wait and monitor
   //    - 'wait': sleep and re-evaluate
   // 6. Monitor trading (if active):
   //    - Poll signals every 10s
   //    - Check risk every 30s
   //    - Check health every 60s
   //    - Adjust strategy based on performance
   // 7. Check exit conditions:
   //    - Session duration exceeded
   //    - Budget exhausted
   //    - Circuit breaker tripped
   //    - Target P&L reached
   //    - Manual stop requested
   // 8. If not exiting, loop back to step 2 (re-evaluate every N minutes)
   ```

5. **Phase management** (delegates to PhaseController):
   ```typescript
   // Phases and their behaviors:
   // 'idle' → waiting for start()
   // 'scouting' → ScannerAgent + AlphaScanner running, gathering market data
   // 'preparing' → NarrativeAgent generating, wallets being funded
   // 'launching' → LaunchSequencer executing (create → dev buy → bundle)
   // 'accumulating' → AccumulatorAgent buying more supply
   // 'trading' → WashEngine + MarketMaker + VolumeAgent active
   // 'monitoring' → SentinelAgent watching, signals being generated
   // 'exiting' → ExitAgent coordinating sell-off
   // 'cleanup' → Reclaim funds, generate reports, shutdown
   ```

6. **Event handling** — the orchestrator listens to these events:
   ```typescript
   // 'risk:circuit-breaker-tripped' → pause all trading, evaluate
   // 'risk:stop-loss-triggered' → coordinate exit for that position
   // 'signal:strong-buy' → consider adding to position
   // 'signal:strong-sell' → consider exiting
   // 'alpha:opportunity-found' → evaluate and potentially act
   // 'agent:unhealthy' → attempt restart via LifecycleManager
   // 'phase:transition' → log and coordinate
   // 'trade:executed' → update positions, check risk
   // 'health:critical' → emergency procedures
   ```

7. **SwarmOrchestratorStatus**:
   ```typescript
   interface SwarmOrchestratorStatus {
     /** Current state machine state */
     state: string;
     /** Current phase */
     phase: string;
     /** Is actively trading? */
     trading: boolean;
     /** Is paused? */
     paused: boolean;
     /** Uptime (ms) */
     uptime: number;
     /** Session start time */
     startedAt: number;
     /** Active token mint (if any) */
     activeMint?: string;
     /** Active token name */
     activeTokenName?: string;
     /** Agent statuses */
     agents: Array<{ id: string; type: string; status: string }>;
     /** Portfolio summary */
     portfolio: {
       totalInvested: number;
       currentValue: number;
       pnl: number;
       pnlPercent: number;
       roi: number;
     };
     /** Last decision made */
     lastDecision?: {
       action: string;
       reasoning: string;
       timestamp: number;
     };
     /** Next evaluation time */
     nextEvaluation: number;
     /** Health status */
     health: 'healthy' | 'degraded' | 'critical';
     /** Trade count this session */
     tradeCount: number;
     /** Error count this session */
     errorCount: number;
   }
   ```

8. **Graceful shutdown** (`stop()`):
   ```typescript
   // 1. Set state to 'stopping'
   // 2. Signal all agents to stop accepting new tasks
   // 3. Wait for in-flight trades to complete (timeout: 30s)
   // 4. If positions open, coordinate orderly exit
   // 5. Reclaim funds from all wallets to master
   // 6. Generate final session report
   // 7. Destroy all agents via LifecycleManager
   // 8. Close RPC connections
   // 9. Export audit log
   // 10. Emit 'swarm:shutdown' event
   // 11. Set state to 'stopped'
   ```

9. **Error recovery**:
   - Agent crashes → restart via LifecycleManager (max 3 restarts per agent)
   - RPC failures → pool automatically rotates to next RPC
   - LLM failures → fallback to rule-based strategy selection
   - Transaction failures → retry with higher priority fee
   - Unhandled errors → log to audit, emit error event, continue if possible

### Success Criteria

- Successfully wires together ALL infrastructure from prompts 01-49
- Initialization creates all required components in correct order
- Main loop autonomously gathers context, decides, and acts
- Phase transitions follow correct dependency order
- Event-driven coordination: agents communicate via event bus, not direct calls
- Graceful shutdown properly cleans up all resources
- Error recovery prevents single failures from crashing the entire swarm
- Status reporting provides comprehensive real-time view
- Compiles with `npx tsc --noEmit`
