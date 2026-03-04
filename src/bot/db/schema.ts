/**
 * Sect Bot — Database Schema (Drizzle ORM + PostgreSQL)
 *
 * Complete relational schema for the Telegram call-tracking bot:
 * - Users, Groups, Group Memberships
 * - Calls (token calls with market data snapshots)
 * - Leaderboard snapshots & performance points
 * - PNL records, user ranks
 * - Hardcore mode sessions
 * - Call channels
 * - Referrals & referral payouts
 * - Premium subscriptions & advertisements
 * - Insider alert subscriptions & alert filters
 * - Blocked users
 * - Languages
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
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────

export const callTypeEnum = pgEnum("call_type", ["alpha", "gamble"]);
export const callModeEnum = pgEnum("call_mode", ["auto", "button"]);
export const displayModeEnum = pgEnum("display_mode", ["simple", "advanced"]);
export const rankTierEnum = pgEnum("rank_tier", [
  "amateur",
  "novice",
  "contender",
  "guru",
  "oracle",
]);
export const channelPermissionEnum = pgEnum("channel_permission", [
  "owner",
  "owner_admins",
  "everyone",
]);
export const adTypeEnum = pgEnum("ad_type", [
  "button_24h",
  "button_72h",
  "button_1w",
  "broadcast",
]);
export const adStatusEnum = pgEnum("ad_status", [
  "pending",
  "active",
  "expired",
  "cancelled",
]);
export const chainEnum = pgEnum("chain", [
  "ethereum",
  "solana",
  "base",
  "bsc",
  "arbitrum",
  "polygon",
  "avalanche",
  "optimism",
]);
export const referralStatusEnum = pgEnum("referral_status", [
  "pending",
  "approved",
  "rejected",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "expired",
  "cancelled",
]);
export const languageEnum = pgEnum("language", [
  "en",
  "zh",
  "de",
  "ru",
  "vi",
  "pl",
  "pt",
  "ar",
]);

// ─── Users ───────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    telegramId: varchar("telegram_id", { length: 64 }).notNull(),
    username: varchar("username", { length: 128 }),
    firstName: varchar("first_name", { length: 256 }),
    lastName: varchar("last_name", { length: 256 }),
    bio: text("bio"),
    profilePhoto: text("profile_photo"),
    coverPhoto: text("cover_photo"),
    walletAddresses: jsonb("wallet_addresses").$type<string[]>().default([]),
    totalCalls: integer("total_calls").default(0).notNull(),
    totalWins: integer("total_wins").default(0).notNull(),
    performancePoints: integer("performance_points").default(0).notNull(),
    rankTier: rankTierEnum("rank_tier").default("amateur").notNull(),
    language: languageEnum("language").default("en").notNull(),
    isPremium: boolean("is_premium").default(false).notNull(),
    isBlocked: boolean("is_blocked").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    index("users_username_idx").on(t.username),
    index("users_rank_tier_idx").on(t.rankTier),
  ],
);

// ─── Groups ──────────────────────────────────────────────────

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    telegramId: varchar("telegram_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 512 }),
    callMode: callModeEnum("call_mode").default("button").notNull(),
    displayMode: displayModeEnum("display_mode").default("simple").notNull(),
    language: languageEnum("language").default("en").notNull(),
    isPremium: boolean("is_premium").default(false).notNull(),
    premiumExpiresAt: timestamp("premium_expires_at"),
    /** Hardcore mode settings */
    hardcoreEnabled: boolean("hardcore_enabled").default(false).notNull(),
    hardcoreMinWinRate: real("hardcore_min_win_rate").default(55),
    hardcoreMinCalls: integer("hardcore_min_calls").default(5),
    hardcoreRoundDays: integer("hardcore_round_days").default(7),
    hardcoreRoundStart: timestamp("hardcore_round_start"),
    /** Premium custom settings */
    minMarketCap: decimal("min_market_cap"),
    minLiquidity: decimal("min_liquidity"),
    maxCallsPerUser: integer("max_calls_per_user").default(20).notNull(),
    /** Custom ad (premium groups) */
    adMessage: text("ad_message"),
    adLink: text("ad_link"),
    ownerId: varchar("owner_id", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("groups_telegram_id_idx").on(t.telegramId),
    index("groups_owner_id_idx").on(t.ownerId),
  ],
);

// ─── Group Memberships ──────────────────────────────────────

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    isAdmin: boolean("is_admin").default(false).notNull(),
    isOwner: boolean("is_owner").default(false).notNull(),
    callCount: integer("call_count").default(0).notNull(),
    winCount: integer("win_count").default(0).notNull(),
    performancePoints: integer("performance_points").default(0).notNull(),
    isBlockedInGroup: boolean("is_blocked_in_group").default(false).notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_id_idx").on(t.userId),
  ],
);

// ─── Calls ──────────────────────────────────────────────────

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    /** Token info */
    tokenAddress: varchar("token_address", { length: 256 }).notNull(),
    tokenSymbol: varchar("token_symbol", { length: 64 }),
    tokenName: varchar("token_name", { length: 256 }),
    chain: chainEnum("chain").default("ethereum").notNull(),
    callType: callTypeEnum("call_type").default("alpha").notNull(),
    /** Market snapshot at call time */
    marketCapAtCall: decimal("market_cap_at_call"),
    priceAtCall: decimal("price_at_call"),
    liquidityAtCall: decimal("liquidity_at_call"),
    volumeAtCall: decimal("volume_at_call"),
    holdersAtCall: integer("holders_at_call"),
    tokenAge: varchar("token_age", { length: 128 }),
    /** Performance tracking */
    athAfterCall: decimal("ath_after_call"),
    athTimestamp: timestamp("ath_timestamp"),
    currentMultiplier: real("current_multiplier").default(1),
    peakMultiplier: real("peak_multiplier").default(1),
    performancePoints: integer("performance_points").default(0).notNull(),
    isWin: boolean("is_win").default(false).notNull(),
    /** Telegram message reference */
    messageId: integer("message_id"),
    /** Auto or button call */
    mode: callModeEnum("mode").default("button").notNull(),
    /** Forwarded to channel */
    forwardedToChannel: boolean("forwarded_to_channel").default(false).notNull(),
    /** Archival flag (after leaderboard wipe) */
    isArchived: boolean("is_archived").default(false).notNull(),
    calledAt: timestamp("called_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("calls_user_id_idx").on(t.userId),
    index("calls_group_id_idx").on(t.groupId),
    index("calls_token_address_idx").on(t.tokenAddress),
    index("calls_called_at_idx").on(t.calledAt),
    index("calls_chain_idx").on(t.chain),
    index("calls_call_type_idx").on(t.callType),
    index("calls_is_archived_idx").on(t.isArchived),
    index("calls_peak_multiplier_idx").on(t.peakMultiplier),
  ],
);

// ─── Call Channels ──────────────────────────────────────────

export const callChannels = pgTable(
  "call_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    channelTelegramId: varchar("channel_telegram_id", { length: 64 }).notNull(),
    channelTitle: varchar("channel_title", { length: 512 }),
    permission: channelPermissionEnum("permission")
      .default("everyone")
      .notNull(),
    isVerified: boolean("is_verified").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("call_channels_group_channel_idx").on(
      t.groupId,
      t.channelTelegramId,
    ),
  ],
);

// ─── Referrals ──────────────────────────────────────────────

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    referralCode: varchar("referral_code", { length: 64 }).notNull(),
    walletAddress: varchar("wallet_address", { length: 256 }).notNull(),
    status: referralStatusEnum("status").default("pending").notNull(),
    totalEarnings: decimal("total_earnings").default("0").notNull(),
    totalReferrals: integer("total_referrals").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("referrals_code_idx").on(t.referralCode),
    uniqueIndex("referrals_user_id_idx").on(t.userId),
  ],
);

export const referralPurchases = pgTable(
  "referral_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referralId: uuid("referral_id")
      .references(() => referrals.id, { onDelete: "cascade" })
      .notNull(),
    buyerTelegramId: varchar("buyer_telegram_id", { length: 64 }).notNull(),
    purchaseAmount: decimal("purchase_amount").notNull(),
    commissionAmount: decimal("commission_amount").notNull(),
    txHash: varchar("tx_hash", { length: 256 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("referral_purchases_referral_id_idx").on(t.referralId)],
);

// ─── Advertisements ─────────────────────────────────────────

export const advertisements = pgTable(
  "advertisements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advertiserTelegramId: varchar("advertiser_telegram_id", { length: 64 }).notNull(),
    adType: adTypeEnum("ad_type").notNull(),
    status: adStatusEnum("status").default("pending").notNull(),
    message: text("message"),
    buttonText: varchar("button_text", { length: 256 }),
    buttonUrl: text("button_url"),
    amountPaid: decimal("amount_paid"),
    txHash: varchar("tx_hash", { length: 256 }),
    startsAt: timestamp("starts_at"),
    expiresAt: timestamp("expires_at"),
    impressions: integer("impressions").default(0).notNull(),
    clicks: integer("clicks").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("ads_status_idx").on(t.status),
    index("ads_expires_at_idx").on(t.expiresAt),
  ],
);

// ─── Premium Subscriptions ──────────────────────────────────

export const premiumSubscriptions = pgTable(
  "premium_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    purchasedByUserId: uuid("purchased_by_user_id")
      .references(() => users.id)
      .notNull(),
    status: subscriptionStatusEnum("status").default("active").notNull(),
    amountPaid: decimal("amount_paid"),
    txHash: varchar("tx_hash", { length: 256 }),
    isLifetime: boolean("is_lifetime").default(false).notNull(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("premium_subs_group_id_idx").on(t.groupId),
    index("premium_subs_status_idx").on(t.status),
  ],
);

// ─── Insider Alert Subscriptions ────────────────────────────

export const insiderAlertSubscriptions = pgTable(
  "insider_alert_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    status: subscriptionStatusEnum("status").default("active").notNull(),
    /** Custom filter preferences */
    filterMinWinRate: real("filter_min_win_rate"),
    filterMinAvgGain: real("filter_min_avg_gain"),
    filterChains: jsonb("filter_chains").$type<string[]>(),
    filterMinMarketCap: decimal("filter_min_market_cap"),
    filterMaxMarketCap: decimal("filter_max_market_cap"),
    filterCallers: jsonb("filter_callers").$type<string[]>(),
    amountPaid: decimal("amount_paid"),
    txHash: varchar("tx_hash", { length: 256 }),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("insider_subs_user_id_idx").on(t.userId),
    index("insider_subs_status_idx").on(t.status),
  ],
);

// ─── Insider Alerts (generated) ─────────────────────────────

export const insiderAlerts = pgTable(
  "insider_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .references(() => calls.id, { onDelete: "cascade" })
      .notNull(),
    /** Wilson Score of the caller at time of alert */
    callerWilsonScore: real("caller_wilson_score").notNull(),
    callerWinRate: real("caller_win_rate").notNull(),
    callerAvgGain: real("caller_avg_gain").notNull(),
    callerTotalCalls: integer("caller_total_calls").notNull(),
    /** How many subscribers were notified */
    notifiedCount: integer("notified_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("insider_alerts_call_id_idx").on(t.callId),
    index("insider_alerts_created_at_idx").on(t.createdAt),
  ],
);

// ─── Hardcore Mode Sessions ─────────────────────────────────

export const hardcoreSessions = pgTable(
  "hardcore_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    roundNumber: integer("round_number").default(1).notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endsAt: timestamp("ends_at").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    /** JSON array of removed user IDs from this round */
    removedUsers: jsonb("removed_users").$type<string[]>().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("hardcore_sessions_group_id_idx").on(t.groupId),
    index("hardcore_sessions_is_active_idx").on(t.isActive),
  ],
);

// ─── Leaderboard Votes / Trending ───────────────────────────

export const tokenVotes = pgTable(
  "token_votes",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenAddress: varchar("token_address", { length: 256 }).notNull(),
    chain: chainEnum("chain").default("ethereum").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("token_votes_token_address_idx").on(t.tokenAddress),
    index("token_votes_created_at_idx").on(t.createdAt),
    uniqueIndex("token_votes_user_token_idx").on(t.userId, t.tokenAddress),
  ],
);

// ─── Type Exports ───────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type CallChannel = typeof callChannels.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type Advertisement = typeof advertisements.$inferSelect;
export type PremiumSubscription = typeof premiumSubscriptions.$inferSelect;
export type InsiderAlertSubscription = typeof insiderAlertSubscriptions.$inferSelect;
export type InsiderAlert = typeof insiderAlerts.$inferSelect;
export type HardcoreSession = typeof hardcoreSessions.$inferSelect;
export type TokenVote = typeof tokenVotes.$inferSelect;
