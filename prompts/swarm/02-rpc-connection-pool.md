# Prompt 02 — RPC Connection Pool with Load Balancing

## Agent Identity & Rules

```
You are the RPC-POOL agent. Your sole responsibility is building a production-grade Solana RPC connection pool.

RULES:
- Work on current branch (main)
- Commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real RPC connections to real Solana endpoints
- TypeScript strict mode
- Run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add RPC connection pool with health checks and load balancing"
```

## Objective

Create `packages/pump-agent-swarm/src/infra/rpc-pool.ts` — a production Solana RPC connection pool that load-balances across multiple endpoints, performs health checks, tracks latency, handles failover, and respects rate limits.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/infra/rpc-pool.ts`

## Dependencies

- Types from `../types.ts` (P01): `RpcEndpoint`, `RpcPoolConfig`
- `@solana/web3.js`: `Connection`

## Deliverables

### Create `packages/pump-agent-swarm/src/infra/rpc-pool.ts`

Full implementation requirements:

1. **`RpcPool` class** with:
   - Constructor takes `RpcPoolConfig`
   - `getConnection(): Connection` — returns the best available connection using weighted random selection biased toward healthy, low-latency endpoints
   - `getJitoConnection(): Connection` — returns a connection that supports Jito bundles
   - `getAllConnections(): Connection[]` — returns all healthy connections
   - `healthCheck(): Promise<void>` — pings all endpoints with `getSlot()`, updates latency and health
   - `startHealthChecks(): void` — starts periodic health check interval
   - `stopHealthChecks(): void` — stops the interval
   - `getEndpointStats(): RpcEndpoint[]` — returns current stats for all endpoints
   - `markUnhealthy(url: string): void` — manually mark an endpoint as unhealthy
   - `addEndpoint(endpoint: RpcEndpoint): void` — add a new endpoint at runtime
   - `removeEndpoint(url: string): void` — remove an endpoint

2. **Load balancing algorithm**: Weighted random with health-aware filtering
   - Filter out unhealthy endpoints
   - Sort by latency if `preferLowLatency` is true
   - Weight by configured weight value
   - Track requests-per-second per endpoint for rate limiting
   - Fall back to any endpoint if all preferred ones are unhealthy

3. **Health check logic**:
   - Call `getSlot()` on each endpoint
   - Track rolling average latency (last 10 measurements)
   - Track consecutive failures
   - Mark unhealthy after `maxConsecutiveFailures`
   - Auto-recover: try unhealthy endpoints every 5 health check cycles
   - Emit events: `endpoint:healthy`, `endpoint:unhealthy`, `endpoint:latency`

4. **Default endpoints** (export as `DEFAULT_RPC_ENDPOINTS`):
   ```typescript
   // Mainnet
   { url: 'https://api.mainnet-beta.solana.com', weight: 1, rateLimit: 10, supportsJito: false, provider: 'solana' }
   // Users should add their own Helius/QuickNode/Triton endpoints
   ```

5. **Rate limiting**: Track requests per endpoint per second, skip endpoints at their limit

6. **Request wrapper**: `sendRequest<T>(method: string, params: unknown[]): Promise<T>` that picks the best connection and handles retries with exponential backoff

### Success Criteria

- Pool selects endpoints based on health and latency
- Unhealthy endpoints are automatically excluded and recovered
- Rate limits are respected
- Jito-specific connection selection works
- Health check interval runs without memory leaks
- Full JSDoc documentation
- Compiles with `npx tsc --noEmit`
