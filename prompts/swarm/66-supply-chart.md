# Prompt 66 — Supply Chart

## Agent Identity & Rules

```
You are the SUPPLY-CHART builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real token supply data from on-chain, real distribution calculations
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add token supply distribution chart with on-chain holder tracking"
```

## Objective

Create `packages/pump-agent-swarm/src/dashboard/supply-chart.ts` — tracks token supply distribution across all agent wallets and external holders, providing data formatted for pie/donut chart rendering on the dashboard.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/dashboard/supply-chart.ts`

## Dependencies

- `@solana/web3.js` — Connection, PublicKey
- `@solana/spl-token` — getTokenAccountsByOwner, TOKEN_PROGRAM_ID
- `../infra/event-bus` — SwarmEventBus (P04)
- `../infra/rpc-pool` — RPCConnectionPool (P02)
- `../infra/logging` — SwarmLogger (P07)

## Deliverables

### Create `packages/pump-agent-swarm/src/dashboard/supply-chart.ts`

1. **`SupplyChart` class**:
   - `constructor(rpcPool: RPCConnectionPool, eventBus: SwarmEventBus)`
   - `setTokenMint(mint: string): void` — set the token to track
   - `setSwarmWallets(wallets: SwarmWalletInfo[]): void` — identify which wallets are ours
   - `getDistribution(): Promise<SupplyDistribution>` — fetch current supply distribution
   - `getDistributionHistory(): SupplyDistribution[]` — historical snapshots
   - `startTracking(intervalMs?: number): void` — periodic distribution snapshots
   - `stopTracking(): void`
   - `getConcentrationMetrics(): ConcentrationMetrics` — Gini, HHI, top holder stats

2. **`SwarmWalletInfo` interface**:
   ```typescript
   interface SwarmWalletInfo {
     address: string;
     agentId: string;
     agentType: string;
     label: string;
   }
   ```

3. **`SupplyDistribution` interface**:
   ```typescript
   interface SupplyDistribution {
     timestamp: number;
     tokenMint: string;
     totalSupply: bigint;
     /** Holders sorted by balance descending */
     holders: SupplyHolder[];
     /** Aggregate swarm stats */
     swarmTotal: {
       tokens: bigint;
       percent: number;
       walletCount: number;
     };
     /** Aggregate external stats */
     externalTotal: {
       tokens: bigint;
       percent: number;
       walletCount: number;
     };
     /** Bonding curve / pool reserves */
     curveReserves: {
       tokens: bigint;
       percent: number;
     };
   }

   interface SupplyHolder {
     /** Wallet address */
     wallet: string;
     /** Display label (agent name or truncated address) */
     label: string;
     /** Token balance */
     tokens: bigint;
     /** Percentage of total supply */
     percent: number;
     /** Role: 'swarm', 'dev', 'curve', 'external' */
     role: 'swarm' | 'dev' | 'curve' | 'external';
     /** Agent ID if swarm wallet */
     agentId?: string;
     /** Agent type if swarm wallet */
     agentType?: string;
     /** Color for chart rendering */
     color: string;
   }
   ```

4. **`ConcentrationMetrics` interface**:
   ```typescript
   interface ConcentrationMetrics {
     /** Gini coefficient (0 = perfect equality, 1 = one holder has all) */
     giniCoefficient: number;
     /** Herfindahl-Hirschman Index (0-10000) */
     hhi: number;
     /** Top 1 holder percentage */
     top1Percent: number;
     /** Top 5 holders percentage */
     top5Percent: number;
     /** Top 10 holders percentage */
     top10Percent: number;
     /** Number of unique holders */
     uniqueHolders: number;
     /** Percent held by swarm */
     swarmControlPercent: number;
   }
   ```

5. **Core behavior**:
   - Fetch all token accounts for the mint using `connection.getTokenLargestAccounts()`
   - Cross-reference with known swarm wallets to categorize as swarm vs external
   - Identify bonding curve account (PDA from Pump.fun program) as 'curve'
   - Identify dev wallet (creator) as 'dev'
   - Assign colors: swarm wallets get blue shades, external get grey, curve gets yellow, dev gets red
   - Historical snapshots stored in circular buffer (max 1000 entries)
   - Gini coefficient calculation from balances
   - HHI = sum of (market share %)^2 for each holder

### Success Criteria

- Supply distribution fetched from on-chain token accounts
- Swarm vs external wallets correctly categorized
- Concentration metrics (Gini, HHI) calculated correctly
- Historical snapshots retained for trend analysis
- Color assignment consistent for chart rendering
- Compiles with `npx tsc --noEmit`
