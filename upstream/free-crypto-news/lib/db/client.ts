/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

/**
 * Database Client
 *
 * Connects to Neon Postgres via the serverless driver for Vercel Edge compatibility.
 * Falls back gracefully when DATABASE_URL is not configured (JSON archive still works).
 */

import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Re-export schema for convenience
export * from './schema';

// ────────────────────────────────────────────────────────────────────────────
// Singleton client
// ────────────────────────────────────────────────────────────────────────────

let _db: NeonHttpDatabase<typeof schema> | null = null;

/**
 * Returns a Drizzle ORM database instance connected via Neon serverless HTTP.
 * Returns `null` when DATABASE_URL is not set (graceful degradation).
 */
export function getDb(): NeonHttpDatabase<typeof schema> | null {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;

  if (!_db) {
    const sql = neon(url);
    _db = drizzle(sql, { schema });
  }

  return _db;
}

/**
 * Convenience helper that throws when Postgres is unavailable.
 * Use inside routes that *require* a database connection.
 */
export function requireDb(): NeonHttpDatabase<typeof schema> {
  const db = getDb();
  if (!db) {
    throw new Error(
      'DATABASE_URL is not configured. Set DATABASE_URL to a Neon/Supabase Postgres connection string.'
    );
  }
  return db;
}

/**
 * Check whether the Postgres backend is available.
 */
export function isDbAvailable(): boolean {
  return !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}
