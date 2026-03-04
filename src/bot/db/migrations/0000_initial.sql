-- Crypto Vision — Initial Migration
-- Generated from Drizzle ORM schema (src/bot/db/schema.ts)
--
-- Creates all tables, enums, indexes, and foreign keys for the
-- Telegram call-tracking bot.

-- ─── Enums ───────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "call_type" AS ENUM ('alpha', 'gamble');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "call_mode" AS ENUM ('auto', 'button');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "display_mode" AS ENUM ('simple', 'advanced');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "rank_tier" AS ENUM ('amateur', 'novice', 'contender', 'guru', 'oracle');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "channel_permission" AS ENUM ('owner', 'owner_admins', 'everyone');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ad_type" AS ENUM ('button_24h', 'button_72h', 'button_1w', 'broadcast');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ad_status" AS ENUM ('pending', 'active', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "chain" AS ENUM ('ethereum', 'solana', 'base', 'bsc', 'arbitrum', 'polygon', 'avalanche', 'optimism');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "referral_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM ('active', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "language" AS ENUM ('en', 'zh', 'de', 'ru', 'vi', 'pl', 'pt', 'ar');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─── Tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "telegram_id" varchar(64) NOT NULL,
  "username" varchar(128),
  "first_name" varchar(256),
  "last_name" varchar(256),
  "bio" text,
  "profile_photo" text,
  "cover_photo" text,
  "wallet_addresses" jsonb DEFAULT '[]'::jsonb,
  "total_calls" integer DEFAULT 0 NOT NULL,
  "total_wins" integer DEFAULT 0 NOT NULL,
  "performance_points" integer DEFAULT 0 NOT NULL,
  "rank_tier" "rank_tier" DEFAULT 'amateur' NOT NULL,
  "language" "language" DEFAULT 'en' NOT NULL,
  "is_premium" boolean DEFAULT false NOT NULL,
  "is_blocked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "telegram_id" varchar(64) NOT NULL,
  "title" varchar(512),
  "call_mode" "call_mode" DEFAULT 'button' NOT NULL,
  "display_mode" "display_mode" DEFAULT 'simple' NOT NULL,
  "language" "language" DEFAULT 'en' NOT NULL,
  "is_premium" boolean DEFAULT false NOT NULL,
  "premium_expires_at" timestamp,
  "hardcore_enabled" boolean DEFAULT false NOT NULL,
  "hardcore_min_win_rate" real DEFAULT 55,
  "hardcore_min_calls" integer DEFAULT 5,
  "hardcore_round_days" integer DEFAULT 7,
  "hardcore_round_start" timestamp,
  "min_market_cap" numeric,
  "min_liquidity" numeric,
  "max_calls_per_user" integer DEFAULT 20 NOT NULL,
  "ad_message" text,
  "ad_link" text,
  "owner_id" varchar(64),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "group_members" (
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "is_admin" boolean DEFAULT false NOT NULL,
  "is_owner" boolean DEFAULT false NOT NULL,
  "call_count" integer DEFAULT 0 NOT NULL,
  "win_count" integer DEFAULT 0 NOT NULL,
  "performance_points" integer DEFAULT 0 NOT NULL,
  "is_blocked_in_group" boolean DEFAULT false NOT NULL,
  "joined_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("group_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "token_address" varchar(256) NOT NULL,
  "token_symbol" varchar(64),
  "token_name" varchar(256),
  "chain" "chain" DEFAULT 'ethereum' NOT NULL,
  "call_type" "call_type" DEFAULT 'alpha' NOT NULL,
  "market_cap_at_call" numeric,
  "price_at_call" numeric,
  "liquidity_at_call" numeric,
  "volume_at_call" numeric,
  "holders_at_call" integer,
  "token_age" varchar(128),
  "ath_after_call" numeric,
  "ath_timestamp" timestamp,
  "current_multiplier" real DEFAULT 1,
  "peak_multiplier" real DEFAULT 1,
  "performance_points" integer DEFAULT 0 NOT NULL,
  "is_win" boolean DEFAULT false NOT NULL,
  "message_id" integer,
  "mode" "call_mode" DEFAULT 'button' NOT NULL,
  "forwarded_to_channel" boolean DEFAULT false NOT NULL,
  "is_archived" boolean DEFAULT false NOT NULL,
  "called_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "call_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "channel_telegram_id" varchar(64) NOT NULL,
  "channel_title" varchar(512),
  "permission" "channel_permission" DEFAULT 'everyone' NOT NULL,
  "is_verified" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "referral_code" varchar(64) NOT NULL,
  "wallet_address" varchar(256) NOT NULL,
  "status" "referral_status" DEFAULT 'pending' NOT NULL,
  "total_earnings" numeric DEFAULT '0' NOT NULL,
  "total_referrals" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "referral_purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referral_id" uuid NOT NULL REFERENCES "referrals"("id") ON DELETE CASCADE,
  "buyer_telegram_id" varchar(64) NOT NULL,
  "purchase_amount" numeric NOT NULL,
  "commission_amount" numeric NOT NULL,
  "tx_hash" varchar(256),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "advertisements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "advertiser_telegram_id" varchar(64) NOT NULL,
  "ad_type" "ad_type" NOT NULL,
  "status" "ad_status" DEFAULT 'pending' NOT NULL,
  "message" text,
  "button_text" varchar(256),
  "button_url" text,
  "amount_paid" numeric,
  "tx_hash" varchar(256),
  "starts_at" timestamp,
  "expires_at" timestamp,
  "impressions" integer DEFAULT 0 NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "premium_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "purchased_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "status" "subscription_status" DEFAULT 'active' NOT NULL,
  "amount_paid" numeric,
  "tx_hash" varchar(256),
  "is_lifetime" boolean DEFAULT false NOT NULL,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "insider_alert_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "subscription_status" DEFAULT 'active' NOT NULL,
  "filter_min_win_rate" real,
  "filter_min_avg_gain" real,
  "filter_chains" jsonb,
  "filter_min_market_cap" numeric,
  "filter_max_market_cap" numeric,
  "filter_callers" jsonb,
  "amount_paid" numeric,
  "tx_hash" varchar(256),
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "insider_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "call_id" uuid NOT NULL REFERENCES "calls"("id") ON DELETE CASCADE,
  "caller_wilson_score" real NOT NULL,
  "caller_win_rate" real NOT NULL,
  "caller_avg_gain" real NOT NULL,
  "caller_total_calls" integer NOT NULL,
  "notified_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "hardcore_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "round_number" integer DEFAULT 1 NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "ends_at" timestamp NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "removed_users" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "token_votes" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_address" varchar(256) NOT NULL,
  "chain" "chain" DEFAULT 'ethereum' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ─── Indexes ─────────────────────────────────────────────────

-- Users
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_id_idx" ON "users" ("telegram_id");
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");
CREATE INDEX IF NOT EXISTS "users_rank_tier_idx" ON "users" ("rank_tier");

-- Groups
CREATE UNIQUE INDEX IF NOT EXISTS "groups_telegram_id_idx" ON "groups" ("telegram_id");
CREATE INDEX IF NOT EXISTS "groups_owner_id_idx" ON "groups" ("owner_id");

-- Group Members
CREATE INDEX IF NOT EXISTS "group_members_user_id_idx" ON "group_members" ("user_id");

-- Calls
CREATE INDEX IF NOT EXISTS "calls_user_id_idx" ON "calls" ("user_id");
CREATE INDEX IF NOT EXISTS "calls_group_id_idx" ON "calls" ("group_id");
CREATE INDEX IF NOT EXISTS "calls_token_address_idx" ON "calls" ("token_address");
CREATE INDEX IF NOT EXISTS "calls_called_at_idx" ON "calls" ("called_at");
CREATE INDEX IF NOT EXISTS "calls_chain_idx" ON "calls" ("chain");
CREATE INDEX IF NOT EXISTS "calls_call_type_idx" ON "calls" ("call_type");
CREATE INDEX IF NOT EXISTS "calls_is_archived_idx" ON "calls" ("is_archived");
CREATE INDEX IF NOT EXISTS "calls_peak_multiplier_idx" ON "calls" ("peak_multiplier");

-- Call Channels
CREATE UNIQUE INDEX IF NOT EXISTS "call_channels_group_channel_idx" ON "call_channels" ("group_id", "channel_telegram_id");

-- Referrals
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_code_idx" ON "referrals" ("referral_code");
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_user_id_idx" ON "referrals" ("user_id");

-- Referral Purchases
CREATE INDEX IF NOT EXISTS "referral_purchases_referral_id_idx" ON "referral_purchases" ("referral_id");

-- Advertisements
CREATE INDEX IF NOT EXISTS "ads_status_idx" ON "advertisements" ("status");
CREATE INDEX IF NOT EXISTS "ads_expires_at_idx" ON "advertisements" ("expires_at");

-- Premium Subscriptions
CREATE INDEX IF NOT EXISTS "premium_subs_group_id_idx" ON "premium_subscriptions" ("group_id");
CREATE INDEX IF NOT EXISTS "premium_subs_status_idx" ON "premium_subscriptions" ("status");

-- Insider Alert Subscriptions
CREATE UNIQUE INDEX IF NOT EXISTS "insider_subs_user_id_idx" ON "insider_alert_subscriptions" ("user_id");
CREATE INDEX IF NOT EXISTS "insider_subs_status_idx" ON "insider_alert_subscriptions" ("status");

-- Insider Alerts
CREATE INDEX IF NOT EXISTS "insider_alerts_call_id_idx" ON "insider_alerts" ("call_id");
CREATE INDEX IF NOT EXISTS "insider_alerts_created_at_idx" ON "insider_alerts" ("created_at");

-- Hardcore Sessions
CREATE INDEX IF NOT EXISTS "hardcore_sessions_group_id_idx" ON "hardcore_sessions" ("group_id");
CREATE INDEX IF NOT EXISTS "hardcore_sessions_is_active_idx" ON "hardcore_sessions" ("is_active");

-- Token Votes
CREATE INDEX IF NOT EXISTS "token_votes_token_address_idx" ON "token_votes" ("token_address");
CREATE INDEX IF NOT EXISTS "token_votes_created_at_idx" ON "token_votes" ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "token_votes_user_token_idx" ON "token_votes" ("user_id", "token_address");
