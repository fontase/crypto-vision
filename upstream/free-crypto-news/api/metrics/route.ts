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
 * Metrics Endpoint
 * 
 * Provides comprehensive API usage metrics:
 * - Request counts by endpoint, method, status
 * - Response times (avg, p95, p99)
 * - Rate limit statistics with IP tracking
 * - Error tracking by code
 * - API key usage by tier
 */

import { type NextRequest, NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-error';
import { isAdminAuthorized } from '@/lib/admin-auth';
import { getMetrics, getAllEndpointMetrics, type AggregatedMetrics } from '@/lib/api-metrics';

export const runtime = 'edge';

interface MetricsResponse extends AggregatedMetrics {
  timestamp: string;
  topEndpoints?: Array<{
    endpoint: string;
    totalRequests: number;
    avgResponseTime: number;
    errorRate: number;
  }>;
}

/**
 * GET /api/metrics
 * 
 * Query params:
 * - period: 1h, 24h, 7d (default: 1h)
 * - admin_key: Required for access
 * - include_endpoints: true/false (default: false) - include per-endpoint breakdown
 */
export async function GET(request: NextRequest) {
  // Require admin authentication (header only — no query param for security)
  if (!isAdminAuthorized(request)) {
    return ApiError.unauthorized('Admin authentication required');
  }

  const period = request.nextUrl.searchParams.get('period') || '1h';
  const includeEndpoints = request.nextUrl.searchParams.get('include_endpoints') === 'true';
  
  // Calculate time window
  const windows: Record<string, number> = {
    '1h': 3600 * 1000,
    '24h': 24 * 3600 * 1000,
    '7d': 7 * 24 * 3600 * 1000,
  };
  
  const windowMs = windows[period] || windows['1h'];

  try {
    // Fetch comprehensive metrics
    const metrics = await getMetrics(windowMs);
    
    const response: MetricsResponse = {
      timestamp: new Date().toISOString(),
      ...metrics,
    };
    
    // Optionally include per-endpoint breakdown
    if (includeEndpoints) {
      const endpointMetrics = await getAllEndpointMetrics();
      response.topEndpoints = endpointMetrics.slice(0, 20).map(ep => ({
        endpoint: ep.endpoint,
        totalRequests: ep.totalRequests,
        avgResponseTime: Math.round(ep.avgResponseTime * 100) / 100,
        errorRate: ep.totalRequests > 0 
          ? Math.round((ep.errorCount / ep.totalRequests) * 10000) / 100 
          : 0,
      }));
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    return ApiError.internal('Failed to fetch metrics', error);
  }
}
