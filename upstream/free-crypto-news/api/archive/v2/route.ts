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

export const runtime = 'edge';

/**
 * GET /api/archive/v2 - Redirects to /api/archive
 * 
 * This endpoint is deprecated. Use /api/archive instead.
 * All v2 features are now available on the main archive endpoint.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = searchParams.toString();
  const redirectUrl = `/api/archive${params ? `?${params}` : ''}`;
  
  // Return redirect response
  return NextResponse.redirect(new URL(redirectUrl, request.url), {
    status: 308, // Permanent redirect
    headers: {
      'X-Deprecation-Notice': 'This endpoint is deprecated. Use /api/archive instead.',
    },
  });
}
