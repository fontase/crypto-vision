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
 * Inngest Functions — Background Job Definitions
 *
 * DEPRECATED: This file is a re-export shim.
 * All functions have been split into individual modules under ./functions/.
 *
 * @see ./functions/index.ts for the canonical exports
 */

export {
  archiveArticlesCron,
  archiveArticleOnPublish,
  dailyDigest,
  sentimentAnalysis,
  coverageGapDetection,
  predictions,
  tagScoreRecalculation,
  enrichArticlesCron,
  enrichArticleOnEvent,
  allFunctions,
} from './functions/index';
