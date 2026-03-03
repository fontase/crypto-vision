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
import type { NextRequest } from 'next/server';
import { isAdminAuthorized } from '@/lib/admin-auth';
import { toPrometheusText } from '@/lib/observability/metrics';

export const runtime = 'edge';

/**
 * Prometheus Metrics Endpoint
 *
 * GET /api/providers/metrics
 *
 * Returns metrics in Prometheus text format for scraping.
 * Admin key required.
 */
export async function GET(request: NextRequest) {
  // Require admin authentication (header only — no query param for security)
  if (!isAdminAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const text = toPrometheusText();

  return new NextResponse(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
