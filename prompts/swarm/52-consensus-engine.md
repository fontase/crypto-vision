# Prompt 52 — Consensus Engine

## Agent Identity & Rules

```
You are the CONSENSUS-ENGINE builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real voting logic with weighted consensus
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add multi-agent consensus engine for group decision-making"
```

## Objective

Create `packages/pump-agent-swarm/src/coordination/consensus-engine.ts` — resolves conflicting signals from multiple agents through voting. When the SignalGenerator says "buy" but the RiskManager says "sell", this engine resolves the conflict via configurable voting strategies.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/coordination/consensus-engine.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging

## Deliverables

### Create `packages/pump-agent-swarm/src/coordination/consensus-engine.ts`

1. **`ConsensusEngine` class**:
   - `constructor(eventBus: SwarmEventBus, config?: ConsensusConfig)`
   - `proposeAction(action: ProposedAction, voterIds: string[]): Promise<ConsensusResult>` — start a vote
   - `vote(proposalId: string, agentId: string, vote: AgentVote): void` — submit a vote
   - `resolveProposal(proposalId: string): ConsensusResult` — force-resolve a pending proposal
   - `getProposal(proposalId: string): Proposal | undefined` — get proposal details
   - `getPendingProposals(): Proposal[]` — all unresolved proposals
   - `getVotingHistory(): ConsensusResult[]` — historical results
   - `getAgentWeights(): Map<string, number>` — current agent voting weights
   - `updateAgentWeight(agentId: string, weight: number): void` — adjust weight

2. **ConsensusConfig**:
   ```typescript
   interface ConsensusConfig {
     /** Default voting strategy */
     defaultStrategy: VotingStrategy;
     /** Timeout for votes (ms) — resolve with votes received after timeout */
     voteTimeout: number;            // default: 10000 (10s)
     /** Minimum voter turnout (0-1) to consider result valid */
     minTurnout: number;             // default: 0.5
     /** Override rules: specific agent types can override consensus */
     overrideRules: OverrideRule[];
     /** Initial agent weights */
     initialWeights: Map<string, number>;
     /** Track record influence: adjust weights based on past accuracy */
     enableTrackRecord: boolean;
   }

   type VotingStrategy = 'majority' | 'supermajority' | 'weighted' | 'unanimous' | 'dictator';

   interface OverrideRule {
     /** Agent type that can override (e.g., 'risk-manager') */
     agentType: string;
     /** On what types of proposals */
     proposalTypes: string[];
     /** Override action: this agent's vote always wins */
     action: 'always-wins' | 'veto-power';
   }
   ```

3. **ProposedAction**:
   ```typescript
   interface ProposedAction {
     /** What is being proposed */
     type: 'trade' | 'strategy-change' | 'phase-transition' | 'exit' | 'launch';
     /** Detailed action description */
     description: string;
     /** Parameters of the proposed action */
     parameters: Record<string, unknown>;
     /** Who proposed this */
     proposedBy: string;
     /** Urgency affects timeout */
     urgency: 'immediate' | 'normal' | 'low';
   }
   ```

4. **AgentVote**:
   ```typescript
   interface AgentVote {
     /** Agent casting the vote */
     agentId: string;
     /** Vote direction */
     vote: 'approve' | 'reject' | 'abstain';
     /** Confidence in the vote (0-1) */
     confidence: number;
     /** Reasoning for the vote */
     reasoning: string;
     /** Alternative suggestion if rejecting */
     alternative?: string;
     /** Timestamp */
     votedAt: number;
   }
   ```

5. **ConsensusResult**:
   ```typescript
   interface ConsensusResult {
     proposalId: string;
     proposal: ProposedAction;
     /** Final decision */
     decision: 'approved' | 'rejected' | 'timeout' | 'overridden';
     /** Vote breakdown */
     votes: AgentVote[];
     /** Voting stats */
     stats: {
       totalVoters: number;
       votesReceived: number;
       approvals: number;
       rejections: number;
       abstentions: number;
       turnout: number;              // votesReceived / totalVoters
       weightedApproval: number;     // 0-1 weighted score
     };
     /** If overridden, which agent overrode */
     overriddenBy?: string;
     /** How long the vote took */
     duration: number;
     resolvedAt: number;
   }
   ```

6. **Proposal** (in-flight):
   ```typescript
   interface Proposal {
     id: string;
     action: ProposedAction;
     voterIds: string[];
     votes: Map<string, AgentVote>;
     strategy: VotingStrategy;
     status: 'pending' | 'resolved';
     createdAt: number;
     deadline: number;
     result?: ConsensusResult;
   }
   ```

7. **Voting strategy implementations**:
   ```typescript
   // majority: > 50% approve → approved
   // supermajority: > 66% approve → approved
   // weighted: sum(weight * vote_direction) > 0.5 → approved
   //   vote_direction: approve=1, reject=0, abstain=skip
   //   weighted score = sum(weight_i * direction_i * confidence_i) / sum(weight_i)
   // unanimous: 100% approve → approved (any reject = rejected)
   // dictator: only one agent's vote matters (configurable which)
   ```

8. **Track record system** (when enabled):
   - After each consensus decision, track the outcome
   - If decision was correct (profitable trade, etc.), increase weights of agents who voted for it
   - If decision was wrong, decrease their weights
   - Weight adjustment: ±5% per correct/incorrect vote
   - Minimum weight: 0.1, maximum weight: 5.0
   - This creates a natural selection of better-performing agents having more influence

9. **Override rules**:
   - RiskManager always wins on risk-related proposals (type: 'trade' with risk implications)
   - This means even if 4 agents say "buy", RiskManager can veto if it violates risk limits
   - Overrides are logged with reasoning in the ConsensusResult

### Success Criteria

- All voting strategies produce correct results for various vote distributions
- Timeout mechanism resolves proposals when not all votes arrive
- Override rules correctly give veto/dictator power to specified agents  
- Weighted voting correctly incorporates confidence and agent weights
- Track record system adjusts weights based on decision outcomes
- Vote history is maintained for analysis
- Compiles with `npx tsc --noEmit`
