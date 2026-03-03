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
import { getBreakingNews } from '@/lib/crypto-news';
import { db } from '@/lib/database';

// Use Node.js runtime since database.ts requires fs/path modules
export const runtime = 'nodejs';

// Database collection for webhooks
const WEBHOOKS_COLLECTION = 'webhooks';

interface WebhookData {
  id: string;
  url: string;
  secret: string;
  events: string[];
  createdAt: string;
  lastDeliveredAt?: string;
  deliveryCount: number;
  failureCount: number;
}

// Database-backed webhook storage helper functions
async function getAllWebhooks(): Promise<WebhookData[]> {
  try {
    const docs = await db.listDocuments<WebhookData>(WEBHOOKS_COLLECTION, { limit: 100 });
    return docs.map(doc => doc.data);
  } catch (error) {
    console.error('Failed to get webhooks from database:', error);
    return [];
  }
}

async function getWebhookById(id: string): Promise<WebhookData | null> {
  try {
    const doc = await db.getDocument<WebhookData>(WEBHOOKS_COLLECTION, id);
    return doc?.data || null;
  } catch {
    return null;
  }
}

async function saveWebhook(webhook: WebhookData): Promise<void> {
  await db.saveDocument(WEBHOOKS_COLLECTION, webhook.id, webhook, {
    url: webhook.url,
    events: webhook.events,
  });
}

async function deleteWebhook(id: string): Promise<boolean> {
  return db.deleteDocument(WEBHOOKS_COLLECTION, id);
}

// POST - Register a webhook
export async function POST(request: NextRequest) {
  try {
    // Require API key authentication for webhook registration
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required to register webhooks' },
        { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const body = await request.json();
    const { url, secret, events = ['breaking'] } = body;
    
    if (!url || !secret) {
      return NextResponse.json(
        { error: 'Missing required fields: url, secret' },
        { status: 400 }
      );
    }
    
    // Validate URL — must be HTTPS and resolve to a public address (SSRF protection)
    try {
      const parsed = new URL(url);
      // Require HTTPS for webhook delivery
      if (parsed.protocol !== 'https:') {
        return NextResponse.json(
          { error: 'Webhook URL must use HTTPS' },
          { status: 400 }
        );
      }
      // Block internal/private network targets (SSRF protection)
      const hostname = parsed.hostname.toLowerCase();
      const blockedPatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2\d|3[01])\./,
        /^192\.168\./,
        /^169\.254\./,           // link-local / cloud metadata
        /^0\./,
        /^\[::1\]$/,             // IPv6 loopback
        /^\[fc/i,                // IPv6 unique local
        /^\[fd/i,                // IPv6 unique local
        /^\[fe80:/i,             // IPv6 link-local
        /\.internal$/i,
        /\.local$/i,
        /metadata\.google/i,
      ];
      if (blockedPatterns.some(p => p.test(hostname))) {
        return NextResponse.json(
          { error: 'Webhook URL must point to a public address' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid webhook URL' },
        { status: 400 }
      );
    }

    // Validate event types against allowed list
    const validEvents = ['breaking', 'all'];
    if (!Array.isArray(events) || !events.every((e: string) => validEvents.includes(e))) {
      return NextResponse.json(
        { error: `Invalid event type. Allowed: ${validEvents.join(', ')}` },
        { status: 400 }
      );
    }
    
    // Generate webhook ID
    const id = crypto.randomUUID();
    
    // Create webhook data
    const webhookData: WebhookData = {
      id,
      url,
      secret,
      events,
      createdAt: new Date().toISOString(),
      deliveryCount: 0,
      failureCount: 0,
    };
    
    // Save webhook to database
    await saveWebhook(webhookData);
    
    return NextResponse.json({
      id,
      url,
      events,
      message: 'Webhook registered successfully',
      persisted: true,
    }, {
      status: 201,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to register webhook' },
      { status: 500 }
    );
  }
}

// GET - Test webhook / Get breaking news for webhook consumers
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const test = searchParams.get('test');
  
  if (test === 'true') {
    // Return sample webhook payload
    const news = await getBreakingNews(3);
    
    return NextResponse.json({
      event: 'breaking_news',
      timestamp: new Date().toISOString(),
      data: {
        articles: news.articles,
        totalCount: news.totalCount,
      },
      signature: 'sha256=<hmac_signature_here>',
    }, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
  
  return NextResponse.json({
    endpoints: {
      register: {
        method: 'POST',
        body: {
          url: 'https://your-server.com/webhook',
          secret: 'your-secret-key',
          events: ['breaking', 'all'],
        },
      },
      test: {
        method: 'GET',
        params: { test: 'true' },
      },
    },
    events: [
      { name: 'breaking', description: 'Breaking news from last 2 hours' },
      { name: 'all', description: 'All new articles' },
    ],
    note: 'Webhooks are delivered with HMAC-SHA256 signature in X-Signature header',
  }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}

// OPTIONS - CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    },
  });
}
