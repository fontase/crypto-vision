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
 * DeFi Dashboard API — TVL, yields, fees, DEX volumes, stablecoins, bridges
 * GET /api/data-sources/defi/dashboard — full DeFi snapshot
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getDeFiDashboard } from '@/lib/data-sources/defi';

export const runtime = 'edge';
export const revalidate = 300;

export async function GET(_request: NextRequest) {
  try {
    const dashboard = await getDeFiDashboard();

    return NextResponse.json({
      status: 'ok',
      data: dashboard,
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch DeFi dashboard', details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : 'Internal server error' },
      { status: 500 },
    );
  }
}
