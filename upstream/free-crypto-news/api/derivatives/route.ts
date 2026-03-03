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
 * Derivatives API Route - Futures & perpetual contract data
 * GET /api/derivatives
 */

import { NextResponse } from 'next/server';
import { getDerivativesTickers } from '@/lib/market-data';

export async function GET() {
  try {
    const data = await getDerivativesTickers();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch derivatives data' }, { status: 500 });
  }
}
