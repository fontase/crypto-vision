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
import {
  conductResearch,
  flashResearch,
  getProgress,
  listSessions,
} from '@/lib/agent-orchestrator';
import type { ResearchDepth } from '@/lib/agent-orchestrator';
import { jsonResponse, errorResponse, withTiming, CACHE_CONTROL } from '@/lib/api-utils';

export const runtime = 'edge';

/**
 * GET /api/ai/agent/orchestrator
 * Returns API documentation and session list
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session');

  // Return session progress if session ID provided
  if (sessionId) {
    const progress = getProgress(sessionId);
    if (!progress) {
      return errorResponse('Session not found', undefined, 404);
    }
    return jsonResponse(withTiming({ success: true, progress }, startTime), {
      cacheControl: CACHE_CONTROL.realtime,
    });
  }

  // Return API docs + active sessions
  const sessions = listSessions();

  return jsonResponse(withTiming({
    endpoint: '/api/ai/agent/orchestrator',
    description: 'Multi-agent research orchestrator — autonomous parallel investigation of crypto topics',
    methods: {
      GET: {
        description: 'Get API info, session list, or session progress',
        params: {
          session: 'Session ID to get progress for',
        },
      },
      POST: {
        description: 'Start a new research investigation',
        body: {
          query: 'Research question (required)',
          depth: 'flash | standard | deep | exhaustive (default: standard)',
        },
      },
    },
    architecture: {
      phases: ['planning', 'investigation', 'cross-reference', 'synthesis', 'critique', 'follow-up', 'finalization'],
      agents: ['orchestrator', 'source-analyst', 'market-analyst', 'social-analyst', 'onchain-analyst', 'fact-checker', 'contrarian', 'timeline-builder', 'synthesis', 'critic'],
      features: [
        'DAG-based task decomposition',
        'Parallel agent execution in waves',
        'Cross-reference verification',
        'Self-critique with confidence scoring',
        'Automatic follow-up on low-confidence findings',
        'Transparent reasoning chains',
      ],
    },
    activeSessions: sessions,
  }, startTime), {
    cacheControl: CACHE_CONTROL.realtime,
  });
}

/**
 * POST /api/ai/agent/orchestrator
 * Start a new multi-agent research investigation
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { query, depth = 'standard' } = body as { query?: string; depth?: ResearchDepth };

    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      return errorResponse('Query is required (min 3 characters)', undefined, 400);
    }

    const validDepths: ResearchDepth[] = ['flash', 'standard', 'deep', 'exhaustive'];
    if (!validDepths.includes(depth)) {
      return errorResponse(`Invalid depth. Must be one of: ${validDepths.join(', ')}`, undefined, 400);
    }

    // Flash research is synchronous and fast
    if (depth === 'flash') {
      const result = await flashResearch(query.trim());
      return jsonResponse(withTiming({
        success: true,
        type: 'flash',
        query: query.trim(),
        ...result,
      }, startTime), {
        cacheControl: CACHE_CONTROL.ai,
      });
    }

    // Full research pipeline
    const report = await conductResearch(query.trim(), { depth });

    return jsonResponse(withTiming({
      success: true,
      type: 'research-report',
      report,
    }, startTime), {
      cacheControl: CACHE_CONTROL.ai,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research failed';
    return errorResponse(message, undefined, 500);
  }
}
