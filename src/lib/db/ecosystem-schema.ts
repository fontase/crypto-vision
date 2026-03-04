/**
 * Agent Ecosystem — Database Schema (Drizzle ORM + PostgreSQL)
 *
 * PumpFun for AI Agents: autonomous digital organisms that trade, compete,
 * learn, and evolve on real markets. Each agent has a Solana bonding curve
 * token. Users fund them and spectate. Agents do the rest.
 *
 * Core tables:
 * - Agent organisms (the living agents with their identity, skills, state)
 * - Agent skills (registry of all learnable skills)
 * - Agent trades (real PumpFun trades executed by agents)
 * - Agent interactions (agent-to-agent encounters: cooperate, compete, observe)
 * - Agent compositions (merge events producing new organisms)
 * - Agent holdings (agents investing in each other's tokens)
 * - Ecosystem events (immutable event log)
 * - Agent owners / funders
 *
 * @copyright 2024-2026 nirholas. All rights reserved.
 */

import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────

/** Agent lifecycle status */
export const agentStatusEnum = pgEnum("agent_status", [
  "genesis",       // Just created, token not yet minted
  "incubating",    // Token minted, waiting for funding threshold
  "active",        // Funded and actively trading/executing
  "dormant",       // Ran out of compute budget, slowed ticks
  "merged",        // Composed into a new organism
  "extinct",       // Lost all capital, permanently stopped
]);

/** How an agent acquired a skill */
export const skillAcquisitionEnum = pgEnum("skill_acquisition", [
  "genesis",       // Born with it (founding population)
  "learned",       // Acquired through market experience
  "composed",      // Inherited from a composition event
  "observed",      // Picked up from watching another agent
]);

/** Agent-to-agent interaction type */
export const interactionTypeEnum = pgEnum("interaction_type", [
  "cooperate",     // Agents shared information, both benefited
  "compete",       // Agents took opposing positions
  "observe",       // One agent watched another's trades
  "compose",       // Agents merged into a new organism
  "trade",         // Agents traded against each other
]);

/** Interaction outcome */
export const interactionOutcomeEnum = pgEnum("interaction_outcome", [
  "win",           // Initiator profited
  "loss",          // Initiator lost
  "draw",          // Neutral outcome
  "synergy",       // Both benefited (cooperation)
  "pending",       // Outcome not yet resolved
]);

/** Ecosystem-wide event types */
export const ecosystemEventTypeEnum = pgEnum("ecosystem_event_type", [
  "organism:created",
  "organism:funded",
  "organism:activated",
  "organism:dormant",
  "organism:extinct",
  "trade:executed",
  "trade:won",
  "trade:lost",
  "skill:acquired",
  "skill:leveled_up",
  "interaction:started",
  "interaction:resolved",
  "composition:triggered",
  "composition:completed",
  "investment:made",
  "investment:exited",
  "milestone:reached",
  "owner:funded",
  "owner:withdrew",
]);

/** Skill category */
export const skillCategoryEnum = pgEnum("skill_category", [
  "analysis",      // Market analysis, sentiment, technicals
  "trading",       // Execution, timing, position sizing
  "defi",          // DeFi-specific (yield, LP, staking)
  "risk",          // Risk management, hedging
  "data",          // Data sourcing, aggregation
  "social",        // Social signals, news interpretation
  "onchain",       // On-chain analysis, whale tracking
  "meta",          // Meta-strategy, multi-agent coordination
]);

/** Agent generation tier */
export const generationTierEnum = pgEnum("generation_tier", [
  "gen0",          // Genesis population (the original 43)
  "gen1",          // First compositions
  "gen2",          // Second wave
  "gen3",          // Third wave
  "genN",          // Deep compositions (4+)
]);

// ─── Agent Organisms ────────────────────────────────────────

/**
 * The core entity: a living AI agent with a bonding curve token.
 * Each organism trades on real markets, earns/loses real SOL,
 * acquires skills, and can compose with other organisms.
 */
export const agentOrganisms = pgTable(
  "agent_organisms",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // ─ Identity
    name: varchar("name", { length: 256 }).notNull(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    description: text("description"),
    avatar: varchar("avatar", { length: 16 }), // Emoji or short string
    systemPrompt: text("system_prompt").notNull(),
    systemPromptHash: varchar("system_prompt_hash", { length: 64 }).notNull(),

    // ─ On-chain
    tokenMint: varchar("token_mint", { length: 64 }),
    bondingCurvePda: varchar("bonding_curve_pda", { length: 64 }),
    creatorWallet: varchar("creator_wallet", { length: 64 }),
    metadataUri: varchar("metadata_uri", { length: 512 }),

    // ─ Lifecycle
    status: agentStatusEnum("status").default("genesis").notNull(),
    generation: integer("generation").default(0).notNull(),
    generationTier: generationTierEnum("generation_tier").default("gen0").notNull(),

    // ─ Lineage
    parentIds: jsonb("parent_ids").$type<string[]>().default([]),
    childIds: jsonb("child_ids").$type<string[]>().default([]),

    // ─ Economics
    /** Total SOL deposited by owner(s) to fund this agent */
    totalFundedLamports: decimal("total_funded_lamports").default("0").notNull(),
    /** Current SOL balance available for trading */
    currentBalanceLamports: decimal("current_balance_lamports").default("0").notNull(),
    /** Total SOL earned from profitable trades */
    totalEarnedLamports: decimal("total_earned_lamports").default("0").notNull(),
    /** Total SOL lost from unprofitable trades */
    totalLostLamports: decimal("total_lost_lamports").default("0").notNull(),
    /** Net P&L in SOL (earned - lost) */
    netPnlLamports: decimal("net_pnl_lamports").default("0").notNull(),
    /** Total number of trades executed */
    totalTrades: integer("total_trades").default(0).notNull(),
    /** Winning trades */
    winningTrades: integer("winning_trades").default(0).notNull(),
    /** Losing trades */
    losingTrades: integer("losing_trades").default(0).notNull(),
    /** Win rate (0-1) */
    winRate: real("win_rate").default(0).notNull(),
    /** Current streak (positive = wins, negative = losses) */
    currentStreak: integer("current_streak").default(0).notNull(),
    /** Best ever streak */
    bestStreak: integer("best_streak").default(0).notNull(),

    // ─ Bonding curve state
    tokenPriceSol: decimal("token_price_sol").default("0"),
    marketCapSol: decimal("market_cap_sol").default("0"),
    graduationProgress: real("graduation_progress").default(0),
    isGraduated: boolean("is_graduated").default(false).notNull(),

    // ─ Compute / metabolism
    /** How often this agent ticks (seconds between actions) */
    tickIntervalSeconds: integer("tick_interval_seconds").default(60).notNull(),
    /** Total compute units consumed (LLM tokens, API calls, etc.) */
    totalComputeConsumed: decimal("total_compute_consumed").default("0").notNull(),
    /** Last time the agent performed an action */
    lastTickAt: timestamp("last_tick_at"),
    /** Total number of ticks/actions taken */
    totalTicks: integer("total_ticks").default(0).notNull(),

    // ─ Rankings
    /** Global rank among all organisms (updated periodically) */
    globalRank: integer("global_rank"),
    /** ELO-style rating for competitive interactions */
    eloRating: integer("elo_rating").default(1200).notNull(),
    /** Performance score (composite metric) */
    performanceScore: real("performance_score").default(0).notNull(),

    // ─ Owner
    ownerWallet: varchar("owner_wallet", { length: 64 }),
    ownerTelegramId: varchar("owner_telegram_id", { length: 64 }),

    // ─ Config
    /** Trading strategy configuration */
    strategyConfig: jsonb("strategy_config").$type<Record<string, unknown>>().default({}),
    /** Maximum SOL per trade */
    maxTradeSizeLamports: decimal("max_trade_size_lamports"),
    /** Maximum percentage of balance per trade */
    maxTradePercentage: real("max_trade_percentage").default(5),
    /** Risk tolerance (0-1, conservative to aggressive) */
    riskTolerance: real("risk_tolerance").default(0.5).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("organisms_token_mint_idx").on(t.tokenMint),
    uniqueIndex("organisms_symbol_idx").on(t.symbol),
    index("organisms_status_idx").on(t.status),
    index("organisms_generation_idx").on(t.generation),
    index("organisms_global_rank_idx").on(t.globalRank),
    index("organisms_elo_rating_idx").on(t.eloRating),
    index("organisms_performance_score_idx").on(t.performanceScore),
    index("organisms_owner_wallet_idx").on(t.ownerWallet),
    index("organisms_win_rate_idx").on(t.winRate),
    index("organisms_net_pnl_idx").on(t.netPnlLamports),
    index("organisms_created_at_idx").on(t.createdAt),
  ],
);

// ─── Skills ─────────────────────────────────────────────────

/**
 * Registry of all skills an agent can possess.
 * Skills are the building blocks of agent capability.
 */
export const agentSkills = pgTable(
  "agent_skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 128 }).notNull(),
    description: text("description"),
    category: skillCategoryEnum("category").notNull(),
    /** Base weight — how impactful this skill is (1-10) */
    baseWeight: real("base_weight").default(5).notNull(),
    /** How rare this skill is (0-1, 0 = common, 1 = legendary) */
    rarity: real("rarity").default(0.5).notNull(),
    /** How many organisms currently possess this skill */
    holderCount: integer("holder_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("skills_slug_idx").on(t.slug),
    index("skills_category_idx").on(t.category),
    index("skills_rarity_idx").on(t.rarity),
  ],
);

// ─── Organism ↔ Skill Junction ──────────────────────────────

/**
 * Which skills each organism has and at what proficiency level.
 * Proficiency grows through usage and successful outcomes.
 */
export const agentOrganismSkills = pgTable(
  "agent_organism_skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organismId: uuid("organism_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),
    skillId: uuid("skill_id")
      .references(() => agentSkills.id, { onDelete: "cascade" })
      .notNull(),
    /** Proficiency level (0.0 to 1.0) — improves with experience */
    proficiency: real("proficiency").default(0.1).notNull(),
    /** How this skill was acquired */
    acquisition: skillAcquisitionEnum("acquisition").default("genesis").notNull(),
    /** XP towards next proficiency level */
    experiencePoints: integer("experience_points").default(0).notNull(),
    /** Number of times this skill was used in trades */
    usageCount: integer("usage_count").default(0).notNull(),
    /** Success rate when using this skill */
    successRate: real("success_rate").default(0).notNull(),
    acquiredAt: timestamp("acquired_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("organism_skills_unique_idx").on(t.organismId, t.skillId),
    index("organism_skills_organism_idx").on(t.organismId),
    index("organism_skills_skill_idx").on(t.skillId),
    index("organism_skills_proficiency_idx").on(t.proficiency),
  ],
);

// ─── Agent Trades ───────────────────────────────────────────

/**
 * Every real trade an agent executes on PumpFun.
 * This is the raw performance data — real SOL, real outcomes.
 */
export const agentTrades = pgTable(
  "agent_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organismId: uuid("organism_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),

    // ─ Trade details
    /** Target token mint address */
    targetMint: varchar("target_mint", { length: 64 }).notNull(),
    targetSymbol: varchar("target_symbol", { length: 64 }),
    targetName: varchar("target_name", { length: 256 }),
    direction: varchar("direction", { length: 4 }).notNull(), // "buy" | "sell"

    // ─ Amounts
    /** SOL spent (buys) or received (sells) in lamports */
    solAmountLamports: decimal("sol_amount_lamports").notNull(),
    /** Tokens received (buys) or sold (sells) */
    tokenAmount: decimal("token_amount").notNull(),
    /** Price at execution (SOL per token) */
    executionPriceSol: decimal("execution_price_sol").notNull(),
    /** Slippage from intended price */
    slippageBps: integer("slippage_bps"),

    // ─ P&L (for sells / position closings)
    /** Realized P&L in SOL lamports (null for open buys) */
    realizedPnlLamports: decimal("realized_pnl_lamports"),
    /** Return percentage (null for open buys) */
    returnPercentage: real("return_percentage"),
    /** Was this a winning trade? */
    isWin: boolean("is_win"),

    // ─ Context
    /** Why the agent made this trade (LLM reasoning summary) */
    reasoning: text("reasoning"),
    /** Which skills influenced this decision */
    skillsUsed: jsonb("skills_used").$type<string[]>().default([]),
    /** Market conditions at trade time */
    marketContext: jsonb("market_context").$type<Record<string, unknown>>().default({}),
    /** Confidence score (0-1) — how sure the agent was */
    confidence: real("confidence"),

    // ─ On-chain
    txSignature: varchar("tx_signature", { length: 128 }),
    blockSlot: integer("block_slot"),

    executedAt: timestamp("executed_at").defaultNow().notNull(),
  },
  (t) => [
    index("trades_organism_idx").on(t.organismId),
    index("trades_target_mint_idx").on(t.targetMint),
    index("trades_direction_idx").on(t.direction),
    index("trades_executed_at_idx").on(t.executedAt),
    index("trades_is_win_idx").on(t.isWin),
    index("trades_pnl_idx").on(t.realizedPnlLamports),
  ],
);

// ─── Agent Interactions ─────────────────────────────────────

/**
 * When two agents encounter each other.
 * This drives skill acquisition, competition, and composition triggers.
 */
export const agentInteractions = pgTable(
  "agent_interactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The initiating organism */
    initiatorId: uuid("initiator_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),
    /** The other organism */
    targetId: uuid("target_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),

    interactionType: interactionTypeEnum("interaction_type").notNull(),
    outcome: interactionOutcomeEnum("outcome").default("pending").notNull(),

    /** Context of the interaction (what triggered it, market conditions) */
    context: jsonb("context").$type<Record<string, unknown>>().default({}),
    /** Net P&L for the initiator from this interaction */
    initiatorPnlLamports: decimal("initiator_pnl_lamports"),
    /** Net P&L for the target */
    targetPnlLamports: decimal("target_pnl_lamports"),
    /** Skills exchanged or influenced */
    skillsInvolved: jsonb("skills_involved").$type<string[]>().default([]),

    /** Running count of total interactions between this pair */
    pairInteractionCount: integer("pair_interaction_count").default(1).notNull(),

    startedAt: timestamp("started_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("interactions_initiator_idx").on(t.initiatorId),
    index("interactions_target_idx").on(t.targetId),
    index("interactions_type_idx").on(t.interactionType),
    index("interactions_outcome_idx").on(t.outcome),
    index("interactions_started_at_idx").on(t.startedAt),
  ],
);

// ─── Agent Compositions ─────────────────────────────────────

/**
 * When two or more agents merge to create a new organism.
 * Parents persist (additive, not destructive). The child inherits
 * a novel combination of skills from its parents.
 */
export const agentCompositions = pgTable(
  "agent_compositions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** IDs of parent organisms */
    parentIds: jsonb("parent_ids").$type<string[]>().notNull(),
    /** The newly created child organism */
    childId: uuid("child_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),

    /** What triggered this composition */
    trigger: varchar("trigger", { length: 64 }).notNull(), // "autonomous" | "market-driven" | "owner-initiated"
    /** Map of which skills from which parent were inherited */
    skillInheritanceMap: jsonb("skill_inheritance_map").$type<
      Array<{ parentId: string; skillId: string; inheritedProficiency: number }>
    >().default([]),
    /** Novel skills that emerged from the combination (not in either parent) */
    emergentSkills: jsonb("emergent_skills").$type<string[]>().default([]),

    /** Interaction count between parents that led to this composition */
    interactionCountAtTrigger: integer("interaction_count_at_trigger").default(0).notNull(),
    /** Mutual investment level between parents at trigger time */
    mutualInvestmentLamports: decimal("mutual_investment_lamports"),

    composedAt: timestamp("composed_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("compositions_child_idx").on(t.childId),
    index("compositions_composed_at_idx").on(t.composedAt),
  ],
);

// ─── Agent Holdings (Agents Investing in Each Other) ────────

/**
 * Agents can autonomously invest in each other's tokens.
 * Holding another agent's token = gaining exposure to that agent's skills.
 * This creates an emergent ecosystem of interdependence.
 */
export const agentHoldings = pgTable(
  "agent_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The organism doing the investing */
    holderId: uuid("holder_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),
    /** The organism being invested in */
    heldId: uuid("held_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),
    /** Number of tokens held */
    tokenAmount: decimal("token_amount").notNull(),
    /** SOL cost basis */
    costBasisLamports: decimal("cost_basis_lamports").notNull(),
    /** Current value in SOL */
    currentValueLamports: decimal("current_value_lamports"),
    /** Unrealized P&L */
    unrealizedPnlLamports: decimal("unrealized_pnl_lamports"),

    acquiredAt: timestamp("acquired_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("holdings_holder_held_idx").on(t.holderId, t.heldId),
    index("holdings_holder_idx").on(t.holderId),
    index("holdings_held_idx").on(t.heldId),
  ],
);

// ─── Owner Funding ──────────────────────────────────────────

/**
 * Tracks every funding event from human owners to their agents.
 * The core user interaction: deposit SOL → your agent lives.
 */
export const agentFundingEvents = pgTable(
  "agent_funding_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organismId: uuid("organism_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),
    /** Funder's Solana wallet */
    funderWallet: varchar("funder_wallet", { length: 64 }).notNull(),
    /** Amount in lamports */
    amountLamports: decimal("amount_lamports").notNull(),
    /** "deposit" or "withdrawal" */
    direction: varchar("direction", { length: 16 }).notNull(),
    /** On-chain tx signature */
    txSignature: varchar("tx_signature", { length: 128 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("funding_organism_idx").on(t.organismId),
    index("funding_wallet_idx").on(t.funderWallet),
    index("funding_created_at_idx").on(t.createdAt),
  ],
);

// ─── Ecosystem Events (Immutable Log) ───────────────────────

/**
 * Every significant event in the ecosystem, immutable and append-only.
 * The source of truth for replaying ecosystem history and building
 * real-time visualizations.
 */
export const ecosystemEvents = pgTable(
  "ecosystem_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: ecosystemEventTypeEnum("event_type").notNull(),
    /** Organisms involved in this event */
    organismIds: jsonb("organism_ids").$type<string[]>().default([]),
    /** Event-specific payload */
    data: jsonb("data").$type<Record<string, unknown>>().default({}),
    /** Human-readable summary */
    summary: text("summary"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("events_type_idx").on(t.eventType),
    index("events_created_at_idx").on(t.createdAt),
  ],
);

// ─── Ecosystem Snapshots (Periodic State Captures) ──────────

/**
 * Periodic snapshots of global ecosystem metrics.
 * Powers charts, historical views, and trend analysis.
 */
export const ecosystemSnapshots = pgTable(
  "ecosystem_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Total active organisms */
    totalActive: integer("total_active").notNull(),
    /** Total extinct organisms */
    totalExtinct: integer("total_extinct").notNull(),
    /** Total compositions that have occurred */
    totalCompositions: integer("total_compositions").notNull(),
    /** Total trades across all organisms */
    totalTrades: integer("total_trades").notNull(),
    /** Total SOL volume traded */
    totalVolumeLamports: decimal("total_volume_lamports").notNull(),
    /** Average win rate across all active organisms */
    avgWinRate: real("avg_win_rate").notNull(),
    /** Average ELO rating */
    avgEloRating: real("avg_elo_rating").notNull(),
    /** Top performer organism ID */
    topPerformerId: uuid("top_performer_id"),
    /** Global ecosystem health score (0-100) */
    healthScore: real("health_score").notNull(),
    /** Number of unique skills in the ecosystem */
    uniqueSkillCount: integer("unique_skill_count").notNull(),
    /** Average generation depth */
    avgGeneration: real("avg_generation").notNull(),
    /** Additional metrics */
    metrics: jsonb("metrics").$type<Record<string, unknown>>().default({}),
    snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
  },
  (t) => [
    index("snapshots_at_idx").on(t.snapshotAt),
  ],
);

// ─── Leaderboard Cache ──────────────────────────────────────

/**
 * Materialized leaderboard for fast reads.
 * Updated periodically by the ecosystem engine.
 */
export const agentLeaderboard = pgTable(
  "agent_leaderboard",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organismId: uuid("organism_id")
      .references(() => agentOrganisms.id, { onDelete: "cascade" })
      .notNull(),
    /** Global rank (1 = best) */
    rank: integer("rank").notNull(),
    /** Category: "pnl" | "winrate" | "trades" | "elo" | "streak" | "overall" */
    category: varchar("category", { length: 32 }).notNull(),
    /** Score for this category */
    score: real("score").notNull(),
    /** Rank change since last update (+N = moved up, -N = moved down) */
    rankChange: integer("rank_change").default(0).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("leaderboard_organism_category_idx").on(t.organismId, t.category),
    index("leaderboard_category_rank_idx").on(t.category, t.rank),
  ],
);

// ─── Type Exports ───────────────────────────────────────────

export type AgentOrganism = typeof agentOrganisms.$inferSelect;
export type NewAgentOrganism = typeof agentOrganisms.$inferInsert;
export type AgentSkill = typeof agentSkills.$inferSelect;
export type NewAgentSkill = typeof agentSkills.$inferInsert;
export type AgentOrganismSkill = typeof agentOrganismSkills.$inferSelect;
export type AgentTrade = typeof agentTrades.$inferSelect;
export type NewAgentTrade = typeof agentTrades.$inferInsert;
export type AgentInteraction = typeof agentInteractions.$inferSelect;
export type NewAgentInteraction = typeof agentInteractions.$inferInsert;
export type AgentComposition = typeof agentCompositions.$inferSelect;
export type AgentHolding = typeof agentHoldings.$inferSelect;
export type AgentFundingEvent = typeof agentFundingEvents.$inferSelect;
export type EcosystemEvent = typeof ecosystemEvents.$inferSelect;
export type EcosystemSnapshot = typeof ecosystemSnapshots.$inferSelect;
export type LeaderboardEntry = typeof agentLeaderboard.$inferSelect;
