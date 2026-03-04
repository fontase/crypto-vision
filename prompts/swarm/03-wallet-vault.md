# Prompt 03 — Enhanced Wallet Vault with HD Derivation

## Agent Identity & Rules

```
You are the WALLET-VAULT agent. Your sole responsibility is enhancing the wallet management system.

RULES:
- Work on current branch (main)  
- Commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real Solana keypairs, real derivation paths
- TypeScript strict mode
- Run npx tsc --noEmit after changes
- Commit message: "feat(swarm): enhanced wallet vault with HD derivation and assignment tracking"
```

## Objective

Enhance `packages/pump-agent-swarm/src/wallet-manager.ts` to add HD wallet derivation from a master seed, wallet assignment/locking, concurrent transaction safety, encrypted key storage, and improved fund distribution strategies.

## File Ownership

- **Modifies**: `packages/pump-agent-swarm/src/wallet-manager.ts`

## Dependencies

- Types from `../types.ts`: `WalletVaultConfig`, `WalletAssignment`, `AgentWallet`, `WalletPool`, `AgentRole`
- `@solana/web3.js`: `Keypair`, `Connection`, `PublicKey`
- `ed25519-hd-key` or equivalent for HD derivation
- `tweetnacl` for key handling
- `bs58` for encoding

## Deliverables

### Enhance `packages/pump-agent-swarm/src/wallet-manager.ts`

Keep ALL existing exports working. Add a new `WalletVault` class:

1. **`WalletVault` class**:
   - `constructor(config: WalletVaultConfig, connection: Connection)`
   - `initialize(): Promise<void>` — generates wallet pool from seed or random
   - `getWallet(role: AgentRole, agentId: string): AgentWallet` — assigns a wallet to an agent, throws if none available
   - `releaseWallet(agentId: string): void` — releases a wallet assignment
   - `lockWallet(agentId: string, txSignature: string): void` — locks wallet during tx
   - `unlockWallet(agentId: string): void` — unlocks after tx completes
   - `isLocked(agentId: string): boolean` — check if wallet is locked
   - `getAssignment(agentId: string): WalletAssignment | undefined`
   - `getAllAssignments(): WalletAssignment[]`
   - `getUnassignedWallets(): AgentWallet[]`
   - `fundWallet(agentId: string, lamports: BN, funderKeypair: Keypair): Promise<string>` — fund a specific wallet
   - `fundAllTraders(funderKeypair: Keypair, totalLamports: BN, distribution: 'equal' | 'weighted' | 'random'): Promise<string[]>`
   - `reclaimAll(recipientPubkey: PublicKey): Promise<string[]>` — reclaim from all wallets
   - `reclaimFrom(agentId: string, recipientPubkey: PublicKey): Promise<string>`
   - `refreshAllBalances(): Promise<void>`
   - `getPoolBalance(): BN` — total SOL across all wallets
   - `exportKeys(): Record<string, string>` — export all keys (base58)
   - `importKeys(keys: Record<string, string>): void` — import saved keys
   - `encryptAndSave(filepath: string): Promise<void>` — encrypt keys to file
   - `loadAndDecrypt(filepath: string): Promise<void>` — load encrypted keys

2. **HD wallet derivation**:
   - Use BIP-39 mnemonic → seed
   - Derive Solana keypairs using path `m/44'/501'/{index}'/0'`
   - Support restoring entire pool from a single mnemonic
   - `generateMnemonic(): string` — creates a new 24-word mnemonic
   - `deriveFromMnemonic(mnemonic: string, count: number): AgentWallet[]`

3. **Fund distribution strategies**:
   - `equal`: Split total evenly
   - `weighted`: Creator gets 40%, traders split 60% based on strategy aggressiveness
   - `random`: Random distribution with min/max constraints (looks more organic)

4. **Concurrent safety**:
   - Prevent two transactions from the same wallet simultaneously
   - Lock/unlock mechanism with automatic timeout (60s max lock)
   - Event emission on lock/unlock

5. **Balance monitoring**:
   - Auto-alert when wallet drops below minimum balance
   - Emit `wallet:low-balance` event
   - Support auto-refund from a designated funder wallet

### Add Dependencies

Add to `package.json`:
```json
"bip39": "^3.1.0",
"ed25519-hd-key": "^1.3.0",
"tweetnacl": "^1.0.3"
```

### Success Criteria

- All existing `wallet-manager.ts` exports still work
- HD derivation produces valid Solana keypairs
- Assignments prevent double-allocation
- Locking prevents concurrent transactions
- Fund distribution works with all three strategies
- Encrypted export/import works
- Compiles with `npx tsc --noEmit`
