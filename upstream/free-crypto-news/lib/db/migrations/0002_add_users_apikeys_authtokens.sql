-- Copyright 2024-2026 nirholas. All rights reserved.
-- SPDX-License-Identifier: SEE LICENSE IN LICENSE
-- https://github.com/nirholas/free-crypto-news
--
-- This file is part of free-crypto-news.
-- Unauthorized copying, modification, or distribution is strictly prohibited.

-- Migration: Add users, api_keys, auth_tokens tables for auth & dashboard
-- Created: 2026-06-23

-- ── users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(128),
  avatar_url TEXT,
  role VARCHAR(32) NOT NULL DEFAULT 'developer',
  provider VARCHAR(32) NOT NULL DEFAULT 'email',
  provider_id VARCHAR(255),
  email_verified BOOLEAN DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users (provider);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ── api_keys ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(64) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(128) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  name VARCHAR(128) NOT NULL DEFAULT 'Default',
  tier VARCHAR(32) NOT NULL DEFAULT 'pro',
  permissions TEXT[] DEFAULT '{}'::text[],
  rate_limit_day INTEGER NOT NULL DEFAULT 50000,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_apikeys_tier ON api_keys (tier);
CREATE INDEX IF NOT EXISTS idx_apikeys_active ON api_keys (active);

-- ── auth_tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_authtokens_hash ON auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_authtokens_user ON auth_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_authtokens_type ON auth_tokens (type);
CREATE INDEX IF NOT EXISTS idx_authtokens_expires ON auth_tokens (expires_at);
