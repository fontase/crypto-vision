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
 * IndexNow - Instant search engine notification for new content
 *
 * IndexNow allows instant notification of Bing, Yandex, and other
 * IndexNow-supported engines when new content is published.
 * @see https://www.indexnow.org/
 */

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'crypto-news-indexnow';
const HOST = 'cryptocurrency.cv';
const API_ENDPOINT = 'https://api.indexnow.org/indexnow';

import { logger } from '@/lib/logger';

/**
 * Notify IndexNow-supported search engines about new or updated URLs.
 *
 * Only fires in production. Always swallows errors so it never blocks
 * the main ingestion flow.
 *
 * @param urls - List of full URLs to submit (e.g. ["https://cryptocurrency.cv/en/article/abc123"])
 */
export async function notifyIndexNow(urls: string[]): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (!urls || urls.length === 0) {
    return;
  }

  try {
    const body = {
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
      urlList: urls,
    };

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    logger.info(
      `[IndexNow] Submitted ${urls.length} URL(s) — HTTP ${response.status}`
    );
  } catch (error) {
    logger.warn('[IndexNow] Notification failed (non-fatal)', { error: error instanceof Error ? error.message : String(error) });
  }
}
