/**
 * Consensus Engine — Multi-agent voting and conflict resolution.
 *
 * Resolves conflicting signals from multiple agents through configurable
 * voting strategies. When the SignalGenerator says "buy" but the RiskManager
 * says "sell", this engine resolves the conflict via majority, supermajority,
 * weighted, unanimous, or dictator voting.
 *
 * Features:
 * - Five voting strategies with pluggable resolution
 * - Override rules: veto-power and always-wins for specific agent types
 * - Track record system: dynamic weight adjustment based on decision outcomes
 * - Timeout-based resolution when not all voters respond
 * - Full vote history for post-hoc analysis
 */

import { v4 as uuidv4 } from 'uuid';

import { SwarmEventBus } from '../infra/event-bus.js';
import { SwarmLogger } from '../infra/logger.js';

// ─── Types ────────────────────────────────────────────────────

export type VotingStrategy =
  | 'majority'
  | 'supermajority'
  | 'weighted'
  | 'unanimous'
  | 'dictator';

export type VoteDirection = 'approve' | 'reject' | 'abstain';
export type ProposalStatus = 'pending' | 'resolved';
export type ConsensusDecision = 'approved' | 'rejected' | 'timeout' | 'overridden';
export type ProposalType = 'trade' | 'strategy-change' | 'phase-transition' | 'exit' | 'launch';
export type ProposalUrgency = 'immediate' | 'normal' | 'low';
export type OverrideAction = 'always-wins' | 'veto-power';

export interface OverrideRule {
  /** Agent type that can override (e.g., 'risk-manager') */
  agentType: string;
  /** On what types of proposals */
  proposalTypes: string[];
  /** Override action: this agent's vote always wins */
  action: OverrideAction;
}

export interface ConsensusConfig {
  /** Default voting strategy */
  defaultStrategy: VotingStrategy;
  /** Timeout for votes (ms) — resolve with votes received after timeout */
  voteTimeout: number;
  /** Minimum voter turnout (0-1) to consider result valid */
  minTurnout: number;
  /** Override rules: specific agent types can override consensus */
  overrideRules: OverrideRule[];
  /** Initial agent weights */
  initialWeights: Map<string, number>;
  /** Track record influence: adjust weights based on past accuracy */
  enableTrackRecord: boolean;
}

export interface ProposedAction {
  /** What is being proposed */
  type: ProposalType;
  /** Detailed action description */
  description: string;
  /** Parameters of the proposed action */
  parameters: Record<string, unknown>;
  /** Who proposed this */
  proposedBy: string;
  /** Urgency affects timeout */
  urgency: ProposalUrgency;
}

export interface AgentVote {
  /** Agent casting the vote */
  agentId: string;
  /** Vote direction */
  vote: VoteDirection;
  /** Confidence in the vote (0-1) */
  confidence: number;
  /** Reasoning for the vote */
  reasoning: string;
  /** Alternative suggestion if rejecting */
  alternative?: string;
  /** Timestamp */
  votedAt: number;
}

export interface VoteStats {
  totalVoters: number;
  votesReceived: number;
  approvals: number;
  rejections: number;
  abstentions: number;
  /** votesReceived / totalVoters */
  turnout: number;
  /** 0-1 weighted approval score */
  weightedApproval: number;
}

export interface ConsensusResult {
  proposalId: string;
  proposal: ProposedAction;
  /** Final decision */
  decision: ConsensusDecision;
  /** Vote breakdown */
  votes: AgentVote[];
  /** Voting stats */
  stats: VoteStats;
  /** If overridden, which agent overrode */
  overriddenBy?: string;
  /** How long the vote took (ms) */
  duration: number;
  resolvedAt: number;
}

export interface Proposal {
  id: string;
  action: ProposedAction;
  voterIds: string[];
  votes: Map<string, AgentVote>;
  strategy: VotingStrategy;
  status: ProposalStatus;
  createdAt: number;
  deadline: number;
  result?: ConsensusResult;
}

// ─── Constants ────────────────────────────────────────────────

const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 5.0;
const TRACK_RECORD_DELTA = 0.05; // ±5% per correct/incorrect vote
const SUPERMAJORITY_THRESHOLD = 2 / 3;

const URGENCY_TIMEOUT_MULTIPLIER: Record<ProposalUrgency, number> = {
  immediate: 0.25,
  normal: 1,
  low: 2,
};

const DEFAULT_CONFIG: ConsensusConfig = {
  defaultStrategy: 'weighted',
  voteTimeout: 10_000,
  minTurnout: 0.5,
  overrideRules: [],
  initialWeights: new Map(),
  enableTrackRecord: false,
};

// ─── Helpers ──────────────────────────────────────────────────

function clampWeight(w: number): number {
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w));
}

function deepCloneVote(vote: AgentVote): AgentVote {
  return { ...vote };
}

// ─── Engine ───────────────────────────────────────────────────

export class ConsensusEngine {
  private readonly eventBus: SwarmEventBus;
  private readonly logger: SwarmLogger;
  private readonly config: ConsensusConfig;

  /** Active proposals keyed by proposal ID */
  private readonly proposals = new Map<string, Proposal>();
  /** Historical results in chronological order */
  private readonly history: ConsensusResult[] = [];
  /** Agent weights (mutable when track record enabled) */
  private readonly weights = new Map<string, number>();
  /** Pending timeout handles so we can cancel on early resolution */
  private readonly timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(eventBus: SwarmEventBus, config?: Partial<ConsensusConfig>) {
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = SwarmLogger.create('consensus-engine', 'coordination');

    // Seed initial weights
    for (const [agentId, weight] of this.config.initialWeights) {
      this.weights.set(agentId, clampWeight(weight));
    }

    this.logger.info('Consensus engine initialised', {
      strategy: this.config.defaultStrategy,
      voteTimeout: this.config.voteTimeout,
      minTurnout: this.config.minTurnout,
      overrideRules: this.config.overrideRules.length,
      trackRecord: this.config.enableTrackRecord,
    });
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Propose an action and open voting among the specified agents.
   * Resolves when all votes are in OR the deadline expires.
   */
  proposeAction(action: ProposedAction, voterIds: string[]): Promise<ConsensusResult> {
    if (voterIds.length === 0) {
      throw new Error('Cannot create a proposal with zero voters');
    }

    const proposalId = uuidv4();
    const now = Date.now();
    const urgencyMultiplier = URGENCY_TIMEOUT_MULTIPLIER[action.urgency];
    const deadline = now + this.config.voteTimeout * urgencyMultiplier;

    const proposal: Proposal = {
      id: proposalId,
      action,
      voterIds: [...voterIds],
      votes: new Map(),
      strategy: this.config.defaultStrategy,
      status: 'pending',
      createdAt: now,
      deadline,
    };

    this.proposals.set(proposalId, proposal);

    // Ensure every voter has a weight entry
    for (const vid of voterIds) {
      if (!this.weights.has(vid)) {
        this.weights.set(vid, 1.0);
      }
    }

    this.emitEvent('consensus:proposal:created', {
      proposalId,
      type: action.type,
      description: action.description,
      proposedBy: action.proposedBy,
      voterIds,
      strategy: proposal.strategy,
      deadline,
    });

    this.logger.info('Proposal created', {
      proposalId,
      type: action.type,
      voters: voterIds.length,
      deadline: new Date(deadline).toISOString(),
    });

    return new Promise<ConsensusResult>((resolve) => {
      // Store resolver for early resolution
      const onResolved = (result: ConsensusResult): void => {
        resolve(result);
      };

      // Timeout handler — resolve with whatever votes we have
      const timeoutMs = deadline - Date.now();
      const handle = setTimeout(() => {
        if (proposal.status === 'pending') {
          const result = this.resolveProposalInternal(proposalId, true);
          onResolved(result);
        }
      }, Math.max(0, timeoutMs));

      this.timeouts.set(proposalId, handle);

      // Attach early-resolution callback so vote() can trigger it
      (proposal as ProposalWithCallback).__onResolved = onResolved;
    });
  }

  /**
   * Submit a vote for a pending proposal.
   * If all votes are in after this call, the proposal resolves immediately.
   */
  vote(proposalId: string, agentId: string, vote: AgentVote): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    if (proposal.status === 'resolved') {
      this.logger.warn('Attempted to vote on resolved proposal', { proposalId, agentId });
      return;
    }
    if (!proposal.voterIds.includes(agentId)) {
      throw new Error(`Agent ${agentId} is not an eligible voter for proposal ${proposalId}`);
    }
    if (proposal.votes.has(agentId)) {
      this.logger.warn('Duplicate vote ignored', { proposalId, agentId });
      return;
    }

    // Validate confidence range
    const sanitisedVote: AgentVote = {
      ...vote,
      agentId,
      confidence: Math.max(0, Math.min(1, vote.confidence)),
      votedAt: vote.votedAt || Date.now(),
    };

    proposal.votes.set(agentId, sanitisedVote);

    this.emitEvent('consensus:vote:cast', {
      proposalId,
      agentId,
      vote: sanitisedVote.vote,
      confidence: sanitisedVote.confidence,
      reasoning: sanitisedVote.reasoning,
    });

    this.logger.debug('Vote cast', {
      proposalId,
      agentId,
      vote: sanitisedVote.vote,
      confidence: sanitisedVote.confidence,
    });

    // If all votes are in, resolve immediately
    if (proposal.votes.size >= proposal.voterIds.length) {
      const result = this.resolveProposalInternal(proposalId, false);
      const callback = (proposal as ProposalWithCallback).__onResolved;
      if (callback) {
        callback(result);
      }
    }
  }

  /**
   * Force-resolve a pending proposal with whatever votes have been received.
   */
  resolveProposal(proposalId: string): ConsensusResult {
    return this.resolveProposalInternal(proposalId, false);
  }

  /** Get proposal details (returns a snapshot). */
  getProposal(proposalId: string): Proposal | undefined {
    const p = this.proposals.get(proposalId);
    if (!p) return undefined;
    return this.snapshotProposal(p);
  }

  /** All unresolved proposals (snapshots). */
  getPendingProposals(): Proposal[] {
    const pending: Proposal[] = [];
    for (const p of this.proposals.values()) {
      if (p.status === 'pending') {
        pending.push(this.snapshotProposal(p));
      }
    }
    return pending;
  }

  /** Historical results in chronological order. */
  getVotingHistory(): ConsensusResult[] {
    return this.history.map((r) => ({ ...r, votes: r.votes.map(deepCloneVote) }));
  }

  /** Current agent voting weights. */
  getAgentWeights(): Map<string, number> {
    return new Map(this.weights);
  }

  /** Adjust an agent's voting weight (clamped to [0.1, 5.0]). */
  updateAgentWeight(agentId: string, weight: number): void {
    const clamped = clampWeight(weight);
    this.weights.set(agentId, clamped);

    this.emitEvent('consensus:weight:updated', { agentId, weight: clamped });
    this.logger.info('Agent weight updated', { agentId, weight: clamped });
  }

  /**
   * Record the outcome of a past consensus decision so the track-record
   * system can adjust agent weights accordingly.
   *
   * @param proposalId  The proposal whose outcome is being reported
   * @param wasCorrect  Whether the consensus decision turned out well
   */
  recordOutcome(proposalId: string, wasCorrect: boolean): void {
    if (!this.config.enableTrackRecord) return;

    const result = this.history.find((r) => r.proposalId === proposalId);
    if (!result) {
      this.logger.warn('Cannot record outcome — proposal not in history', { proposalId });
      return;
    }

    for (const v of result.votes) {
      if (v.vote === 'abstain') continue;

      const alignedWithDecision =
        (v.vote === 'approve' && result.decision === 'approved') ||
        (v.vote === 'reject' && result.decision === 'rejected');

      const votedCorrectly = alignedWithDecision === wasCorrect;
      const currentWeight = this.weights.get(v.agentId) ?? 1.0;
      const delta = votedCorrectly ? TRACK_RECORD_DELTA : -TRACK_RECORD_DELTA;
      const newWeight = clampWeight(currentWeight + currentWeight * delta);

      this.weights.set(v.agentId, newWeight);

      this.logger.debug('Track record weight adjustment', {
        agentId: v.agentId,
        wasCorrect: votedCorrectly,
        oldWeight: currentWeight,
        newWeight,
      });
    }

    this.emitEvent('consensus:track-record:updated', {
      proposalId,
      wasCorrect,
      updatedWeights: Object.fromEntries(this.weights),
    });
  }

  // ── Resolution Logic ──────────────────────────────────────

  private resolveProposalInternal(proposalId: string, timedOut: boolean): ConsensusResult {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    if (proposal.status === 'resolved' && proposal.result) {
      return proposal.result;
    }

    // Clear timeout if still pending
    const handle = this.timeouts.get(proposalId);
    if (handle) {
      clearTimeout(handle);
      this.timeouts.delete(proposalId);
    }

    const now = Date.now();
    const allVotes = Array.from(proposal.votes.values());
    const stats = this.computeStats(proposal);

    // Check override rules first
    const overrideResult = this.checkOverrides(proposal, allVotes, stats, now);
    if (overrideResult) {
      return this.finalise(proposal, overrideResult);
    }

    // If timed out and below minimum turnout, reject
    if (timedOut && stats.turnout < this.config.minTurnout) {
      const result: ConsensusResult = {
        proposalId,
        proposal: { ...proposal.action },
        decision: 'timeout',
        votes: allVotes.map(deepCloneVote),
        stats,
        duration: now - proposal.createdAt,
        resolvedAt: now,
      };
      return this.finalise(proposal, result);
    }

    // Apply voting strategy
    const decision = this.applyStrategy(proposal.strategy, stats, allVotes);

    // If timed out but turnout was sufficient, mark as timeout only when undecided
    const finalDecision: ConsensusDecision = timedOut && decision === null ? 'timeout' : (decision ?? 'rejected');

    const result: ConsensusResult = {
      proposalId,
      proposal: { ...proposal.action },
      decision: finalDecision,
      votes: allVotes.map(deepCloneVote),
      stats,
      duration: now - proposal.createdAt,
      resolvedAt: now,
    };

    return this.finalise(proposal, result);
  }

  private finalise(proposal: Proposal, result: ConsensusResult): ConsensusResult {
    proposal.status = 'resolved';
    proposal.result = result;
    this.history.push(result);

    this.emitEvent('consensus:proposal:resolved', {
      proposalId: result.proposalId,
      decision: result.decision,
      turnout: result.stats.turnout,
      weightedApproval: result.stats.weightedApproval,
      overriddenBy: result.overriddenBy,
      duration: result.duration,
    });

    this.logger.info('Proposal resolved', {
      proposalId: result.proposalId,
      decision: result.decision,
      turnout: `${(result.stats.turnout * 100).toFixed(0)}%`,
      weightedApproval: result.stats.weightedApproval.toFixed(3),
    });

    return result;
  }

  // ── Voting Strategies ─────────────────────────────────────

  /**
   * Returns 'approved' | 'rejected' | null (null = undecided/insufficient votes).
   */
  private applyStrategy(
    strategy: VotingStrategy,
    stats: VoteStats,
    votes: AgentVote[],
  ): ConsensusDecision | null {
    switch (strategy) {
      case 'majority':
        return this.majorityVote(stats);
      case 'supermajority':
        return this.supermajorityVote(stats);
      case 'weighted':
        return this.weightedVote(stats);
      case 'unanimous':
        return this.unanimousVote(stats, votes);
      case 'dictator':
        return this.dictatorVote(votes);
      default: {
        // Exhaustive check
        const _exhaustive: never = strategy;
        throw new Error(`Unknown voting strategy: ${_exhaustive}`);
      }
    }
  }

  /** > 50% of non-abstaining votes approve → approved */
  private majorityVote(stats: VoteStats): ConsensusDecision | null {
    const participating = stats.approvals + stats.rejections;
    if (participating === 0) return null;
    return stats.approvals / participating > 0.5 ? 'approved' : 'rejected';
  }

  /** > 66.7% of non-abstaining votes approve → approved */
  private supermajorityVote(stats: VoteStats): ConsensusDecision | null {
    const participating = stats.approvals + stats.rejections;
    if (participating === 0) return null;
    return stats.approvals / participating > SUPERMAJORITY_THRESHOLD ? 'approved' : 'rejected';
  }

  /** Weighted approval > 0.5 → approved */
  private weightedVote(stats: VoteStats): ConsensusDecision | null {
    if (stats.votesReceived === 0) return null;
    return stats.weightedApproval > 0.5 ? 'approved' : 'rejected';
  }

  /** All non-abstaining votes must approve; any rejection → rejected */
  private unanimousVote(stats: VoteStats, votes: AgentVote[]): ConsensusDecision | null {
    const nonAbstaining = votes.filter((v) => v.vote !== 'abstain');
    if (nonAbstaining.length === 0) return null;
    return nonAbstaining.every((v) => v.vote === 'approve') ? 'approved' : 'rejected';
  }

  /**
   * Only the first voter's vote matters (the "dictator").
   * Voter ordering follows the voterIds array order.
   */
  private dictatorVote(votes: AgentVote[]): ConsensusDecision | null {
    if (votes.length === 0) return null;
    const dictator = votes[0];
    if (dictator.vote === 'abstain') return null;
    return dictator.vote === 'approve' ? 'approved' : 'rejected';
  }

  // ── Override Rules ────────────────────────────────────────

  private checkOverrides(
    proposal: Proposal,
    votes: AgentVote[],
    stats: VoteStats,
    now: number,
  ): ConsensusResult | undefined {
    for (const rule of this.config.overrideRules) {
      if (!rule.proposalTypes.includes(proposal.action.type)) continue;

      // Find the vote from the overriding agent type
      const overriderVote = votes.find((v) => v.agentId === rule.agentType);
      if (!overriderVote) continue;

      if (rule.action === 'veto-power' && overriderVote.vote === 'reject') {
        this.logger.warn('Override: veto applied', {
          proposalId: proposal.id,
          overriddenBy: rule.agentType,
          reasoning: overriderVote.reasoning,
        });

        return {
          proposalId: proposal.id,
          proposal: { ...proposal.action },
          decision: 'overridden',
          votes: votes.map(deepCloneVote),
          stats,
          overriddenBy: rule.agentType,
          duration: now - proposal.createdAt,
          resolvedAt: now,
        };
      }

      if (rule.action === 'always-wins') {
        const decision: ConsensusDecision =
          overriderVote.vote === 'approve'
            ? 'approved'
            : overriderVote.vote === 'reject'
              ? 'rejected'
              : 'overridden'; // abstain treated as override with no clear direction

        this.logger.warn('Override: always-wins applied', {
          proposalId: proposal.id,
          overriddenBy: rule.agentType,
          decision,
        });

        return {
          proposalId: proposal.id,
          proposal: { ...proposal.action },
          decision: decision === 'approved' || decision === 'rejected'
            ? decision
            : 'overridden',
          votes: votes.map(deepCloneVote),
          stats,
          overriddenBy: rule.agentType,
          duration: now - proposal.createdAt,
          resolvedAt: now,
        };
      }
    }

    return undefined;
  }

  // ── Stats ─────────────────────────────────────────────────

  private computeStats(proposal: Proposal): VoteStats {
    const allVotes = Array.from(proposal.votes.values());
    const totalVoters = proposal.voterIds.length;
    const votesReceived = allVotes.length;

    let approvals = 0;
    let rejections = 0;
    let abstentions = 0;

    for (const v of allVotes) {
      if (v.vote === 'approve') approvals++;
      else if (v.vote === 'reject') rejections++;
      else abstentions++;
    }

    const turnout = totalVoters > 0 ? votesReceived / totalVoters : 0;

    // Weighted approval: sum(weight_i * direction_i * confidence_i) / sum(weight_i)
    // direction: approve=1, reject=0, abstain=skip
    let weightedNumerator = 0;
    let weightedDenominator = 0;

    for (const v of allVotes) {
      if (v.vote === 'abstain') continue;
      const w = this.weights.get(v.agentId) ?? 1.0;
      const direction = v.vote === 'approve' ? 1 : 0;
      weightedNumerator += w * direction * v.confidence;
      weightedDenominator += w;
    }

    const weightedApproval = weightedDenominator > 0
      ? weightedNumerator / weightedDenominator
      : 0;

    return {
      totalVoters,
      votesReceived,
      approvals,
      rejections,
      abstentions,
      turnout,
      weightedApproval,
    };
  }

  // ── Internal Helpers ──────────────────────────────────────

  private snapshotProposal(p: Proposal): Proposal {
    return {
      ...p,
      voterIds: [...p.voterIds],
      votes: new Map(Array.from(p.votes.entries()).map(([k, v]) => [k, deepCloneVote(v)])),
      action: { ...p.action },
      result: p.result
        ? { ...p.result, votes: p.result.votes.map(deepCloneVote) }
        : undefined,
    };
  }

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    this.eventBus.emit(type, 'coordination', 'consensus-engine', payload);
  }
}

// Internal extension to attach one-time resolve callbacks
interface ProposalWithCallback extends Proposal {
  __onResolved?: (result: ConsensusResult) => void;
}
