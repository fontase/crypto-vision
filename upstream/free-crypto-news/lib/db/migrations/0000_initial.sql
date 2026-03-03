-- Copyright 2024-2026 nirholas. All rights reserved.
-- SPDX-License-Identifier: SEE LICENSE IN LICENSE
-- https://github.com/nirholas/free-crypto-news
--
-- This file is part of free-crypto-news.
-- Unauthorized copying, modification, or distribution is strictly prohibited.

-- free-crypto-news: initial Postgres migration
-- Mirrors the JSON archive into relational tables with full-text search.

-- ────────────────────────────────────────────────────────────────────────────
-- articles
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "articles" (
  "id"                    varchar(64) PRIMARY KEY,
  "slug"                  varchar(255),
  "schema_version"        varchar(16)   DEFAULT '2.0.0',
  "title"                 text          NOT NULL,
  "link"                  text          NOT NULL,
  "canonical_link"        text,
  "description"           text,
  "source"                varchar(255)  NOT NULL,
  "source_key"            varchar(128)  NOT NULL,
  "category"              varchar(64)   NOT NULL,
  "pub_date"              timestamptz,
  "first_seen"            timestamptz   NOT NULL,
  "last_seen"             timestamptz   NOT NULL,
  "fetch_count"           integer       DEFAULT 1,
  "tickers"               text[]        DEFAULT '{}'::text[],
  "tags"                  text[]        DEFAULT '{}'::text[],
  "entities"              jsonb,
  "sentiment_score"       real          DEFAULT 0,
  "sentiment_label"       varchar(32)   DEFAULT 'neutral',
  "sentiment_confidence"  real          DEFAULT 0.5,
  "market_context"        jsonb,
  "content_hash"          varchar(64),
  "meta"                  jsonb,
  "search_vector"         tsvector,
  "created_at"            timestamptz   DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS "idx_articles_pub_date"    ON "articles" ("pub_date");
CREATE INDEX IF NOT EXISTS "idx_articles_first_seen"  ON "articles" ("first_seen");
CREATE INDEX IF NOT EXISTS "idx_articles_source_key"  ON "articles" ("source_key");
CREATE INDEX IF NOT EXISTS "idx_articles_category"    ON "articles" ("category");
CREATE INDEX IF NOT EXISTS "idx_articles_sentiment"   ON "articles" ("sentiment_label");
CREATE INDEX IF NOT EXISTS "idx_articles_tickers"     ON "articles" USING gin ("tickers");
CREATE INDEX IF NOT EXISTS "idx_articles_tags"        ON "articles" USING gin ("tags");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_articles_slug" ON "articles" ("slug");

-- Full-text search index (GIN on tsvector)
CREATE INDEX IF NOT EXISTS "idx_articles_fts" ON "articles" USING gin ("search_vector");

-- Auto-build tsvector on INSERT / UPDATE
CREATE OR REPLACE FUNCTION articles_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.source, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tickers, ' '), '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_articles_search_vector ON "articles";
CREATE TRIGGER trg_articles_search_vector
  BEFORE INSERT OR UPDATE ON "articles"
  FOR EACH ROW EXECUTE FUNCTION articles_search_vector_update();

-- ────────────────────────────────────────────────────────────────────────────
-- prices_history
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "prices_history" (
  "id"          serial PRIMARY KEY,
  "ticker"      varchar(16)  NOT NULL,
  "price"       real         NOT NULL,
  "market_cap"  real,
  "volume_24h"  real,
  "change_24h"  real,
  "timestamp"   timestamptz  NOT NULL,
  "source"      varchar(64),
  "created_at"  timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_prices_ticker"    ON "prices_history" ("ticker");
CREATE INDEX IF NOT EXISTS "idx_prices_timestamp" ON "prices_history" ("timestamp");
CREATE INDEX IF NOT EXISTS "idx_prices_ticker_ts" ON "prices_history" ("ticker", "timestamp");

-- ────────────────────────────────────────────────────────────────────────────
-- market_snapshots
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "market_snapshots" (
  "id"               serial PRIMARY KEY,
  "timestamp"        timestamptz NOT NULL,
  "hour"             integer     NOT NULL,
  "article_count"    integer     DEFAULT 0,
  "top_articles"     text[]      DEFAULT '{}'::text[],
  "top_tickers"      jsonb,
  "source_counts"    jsonb,
  "btc_price"        real,
  "eth_price"        real,
  "fear_greed_index" real,
  "created_at"       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_snapshots_timestamp" ON "market_snapshots" ("timestamp");
CREATE INDEX IF NOT EXISTS "idx_snapshots_hour"      ON "market_snapshots" ("hour");

-- ────────────────────────────────────────────────────────────────────────────
-- predictions
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "predictions" (
  "id"              serial PRIMARY KEY,
  "ticker"          varchar(16)   NOT NULL,
  "prediction_type" varchar(64)   NOT NULL,
  "direction"       varchar(16),
  "confidence"      real,
  "source"          varchar(128),
  "reasoning"       text,
  "target_price"    real,
  "target_date"     timestamptz,
  "outcome"         varchar(32),
  "meta"            jsonb,
  "timestamp"       timestamptz   NOT NULL,
  "created_at"      timestamptz   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_predictions_ticker" ON "predictions" ("ticker");
CREATE INDEX IF NOT EXISTS "idx_predictions_ts"     ON "predictions" ("timestamp");

-- ────────────────────────────────────────────────────────────────────────────
-- tag_scores
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tag_scores" (
  "id"            serial PRIMARY KEY,
  "tag"           varchar(128) NOT NULL,
  "score"         real         NOT NULL,
  "article_count" integer      DEFAULT 0,
  "last_updated"  timestamptz  DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tag_scores_tag" ON "tag_scores" ("tag");

-- ────────────────────────────────────────────────────────────────────────────
-- user_watchlists
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "user_watchlists" (
  "id"         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "user_id"    varchar(255) NOT NULL,
  "tickers"    text[]       DEFAULT '{}'::text[],
  "name"       varchar(128) DEFAULT 'Default',
  "created_at" timestamptz  DEFAULT now(),
  "updated_at" timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_watchlists_user" ON "user_watchlists" ("user_id");
