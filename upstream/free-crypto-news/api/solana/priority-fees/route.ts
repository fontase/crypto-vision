/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getPriorityFeeEstimate } from '@/lib/apis/helius';

export const runtime = 'edge';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * GET /api/solana/priority-fees
 *
 * Estimate priority fees for Solana transactions.
 *
 *   ?accounts=<addr1>,<addr2>  — account addresses to estimate fees for
 *
 * Returns fee estimates at different priority levels (min, low, medium, high, veryHigh, unsafeMax).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountsParam = searchParams.get('accounts');

    const accounts = accountsParam ? accountsParam.split(',').map(a => a.trim()).filter(Boolean) : [];

    if (accounts.length === 0) {
      return NextResponse.json({
        error: 'Missing required parameter: accounts (comma-separated addresses)',
        usage: '/api/solana/priority-fees?accounts=<addr1>,<addr2>',
      }, { status: 400, headers: CORS_HEADERS });
    }

    const data = await getPriorityFeeEstimate(accounts);

    return NextResponse.json({
      accounts,
      fees: data,
      source: 'helius',
      timestamp: new Date().toISOString(),
    }, {
      headers: { ...CORS_HEADERS, 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to estimate priority fees' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}
