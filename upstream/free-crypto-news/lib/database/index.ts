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
 * Database module — Public API
 *
 * @module database
 */

export { db, isDatabaseConfigured, withDb, sql, schema } from './client';
export type { Database } from './client';
export {
  articles,
  coins,
  prices,
  marketSnapshots,
  providerHealth,
  alerts,
  predictions,
  socialMetrics,
  articleSearchQuery,
  articleSearchRank,
} from './schema';
