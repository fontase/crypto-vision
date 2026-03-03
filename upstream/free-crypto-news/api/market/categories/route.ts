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
import { getCategories, type Category } from '@/lib/market-data';

export const runtime = 'edge';
export const revalidate = 3600;

/**
 * GET /api/market/categories
 * 
 * Get list of all cryptocurrency categories (DeFi, Gaming, L1, L2, etc.)
 * 
 * @example
 * GET /api/market/categories
 */
export async function GET(
  _request: NextRequest
): Promise<NextResponse<Category[] | { error: string; message: string }>> {
  try {
    const data = await getCategories();
    
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in categories route:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories', message: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
