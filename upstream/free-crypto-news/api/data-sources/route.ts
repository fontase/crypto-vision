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
 * Data Sources Health + Registry API
 * GET /api/data-sources — list all data sources
 * GET /api/data-sources?action=health — run health checks
 * GET /api/data-sources?category=defi — filter by category
 */

import { type NextRequest, NextResponse } from 'next/server';
import { listDataSources, listDataSourcesByCategory, healthCheckAll, type DataSourceCategory } from '@/lib/data-sources/index';

export const runtime = 'edge';
export const revalidate = 60;

const CATEGORIES: DataSourceCategory[] = [
  'market-data', 'defi', 'onchain', 'social', 'derivatives',
  'nft', 'blockchain-explorer', 'news-aggregator', 'research',
  'governance', 'stablecoins', 'bridges', 'yields', 'whale-tracking', 'developer',
];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const category = searchParams.get('category') as DataSourceCategory | null;

  try {
    // Health check endpoint
    if (action === 'health') {
      const health = await healthCheckAll();
      const healthy = health.filter((h: { ok: boolean }) => h.ok).length;
      return NextResponse.json({
        status: 'ok',
        totalSources: health.length,
        healthy,
        unhealthy: health.length - healthy,
        sources: health,
        timestamp: new Date().toISOString(),
      }, {
        headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
      });
    }

    // Filter by category
    if (category) {
      if (!CATEGORIES.includes(category)) {
        return NextResponse.json(
          { error: 'Invalid category', valid: CATEGORIES },
          { status: 400 },
        );
      }
      const sources = listDataSourcesByCategory(category);
      return NextResponse.json({
        category,
        count: sources.length,
        sources,
        timestamp: new Date().toISOString(),
      }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    }

    // Default: list all
    const sources = listDataSources();
    const byCategory = CATEGORIES.reduce((acc, cat) => {
      const catSources = sources.filter((s: { category: string }) => s.category === cat);
      if (catSources.length > 0) acc[cat] = catSources.length;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      totalSources: sources.length,
      categories: byCategory,
      sources,
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to retrieve data sources', details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : 'Internal server error' },
      { status: 500 },
    );
  }
}
