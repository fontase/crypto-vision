/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

import { NextResponse } from 'next/server';
import { newsCache, aiCache, translationCache } from '@/lib/cache';

export const runtime = 'edge';

export async function GET() {
  const stats = {
    caches: {
      news: newsCache.stats(),
      ai: aiCache.stats(),
      translation: translationCache.stats(),
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(stats, {
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function DELETE() {
  // Clear all caches
  newsCache.clear();
  aiCache.clear();
  translationCache.clear();

  return NextResponse.json({
    message: 'All caches cleared',
    timestamp: new Date().toISOString(),
  });
}
