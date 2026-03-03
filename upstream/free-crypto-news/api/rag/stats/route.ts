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
 * RAG Stats API
 * 
 * GET /api/rag/stats
 * Get vector store statistics.
 */

import { NextResponse } from 'next/server';
import { vectorStore } from '@/lib/rag';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stats = await vectorStore.getStats();
    const count = await vectorStore.count();

    return NextResponse.json({
      ...stats,
      totalDocuments: count,
      embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
      dimensions: 384,
    });
  } catch (error) {
    console.error('RAG stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
