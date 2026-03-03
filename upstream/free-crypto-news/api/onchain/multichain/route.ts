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
import { getUniswapMultichain, getAaveMultichain } from '@/lib/apis/thegraph';

export const runtime = 'edge';
export const revalidate = 300;

const CORS_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  'Access-Control-Allow-Origin': '*',
};

/**
 * GET /api/onchain/multichain
 * Multi-chain protocol data. 
 *   ?protocol=uniswap — Uniswap V3 across all chains
 *   ?protocol=aave    — Aave V3 across all chains
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const protocol = request.nextUrl.searchParams.get('protocol') || 'uniswap';

  try {
    switch (protocol) {
      case 'uniswap': {
        const data = await getUniswapMultichain();
        return NextResponse.json({
          protocol: 'Uniswap V3',
          chains: data,
          totalTvl: data.reduce((s, d) => s + d.tvl, 0),
          timestamp: new Date().toISOString(),
        }, { headers: CORS_HEADERS });
      }

      case 'aave': {
        const data = await getAaveMultichain();
        return NextResponse.json({
          protocol: 'Aave V3',
          chains: data,
          totalTvl: data.reduce((s, d) => s + d.tvl, 0),
          timestamp: new Date().toISOString(),
        }, { headers: CORS_HEADERS });
      }

      default:
        return NextResponse.json({
          error: `Unknown protocol: ${protocol}`,
          available: ['uniswap', 'aave'],
        }, { status: 400, headers: CORS_HEADERS });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to fetch multichain data' }, { status: 500 });
  }
}
