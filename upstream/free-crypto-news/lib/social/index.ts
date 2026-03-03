/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

// Re-export from metrics, excluding SocialAlert to avoid duplicate with channels
export {
  getSocialMetrics,
  getSocialAlerts as getMetricsSocialAlerts,
  type SocialMetrics,
} from './metrics';

// Re-export from channels (primary SocialAlert definition)
export * from './channels';
