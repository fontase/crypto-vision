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
 * Web Push Notifications Service
 * 
 * Implements the Web Push API for browser notifications.
 * Requires VAPID keys for authentication.
 */

// Types
export interface PushSubscription {
  id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userId?: string;
  categories: string[];
  sources: string[];
  createdAt: string;
  lastPushAt?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  image?: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
}

// In-memory store (replace with DB in production)
const subscriptions = new Map<string, PushSubscription>();

// Generate ID using Web Crypto API (Edge-compatible)
import { generateId as generateUniqueId } from '@/lib/utils/id';

function generateId(): string {
  return generateUniqueId('push');
}

/**
 * Generate VAPID keys (run once, then store in env)
 * 
 * To generate: 
 *   npx web-push generate-vapid-keys
 */
export function getVapidKeys(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    return null;
  }

  return { publicKey, privateKey };
}

/**
 * Get VAPID public key for client
 */
export function getPublicVapidKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Save push subscription
 */
export async function saveSubscription(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  options: {
    userId?: string;
    categories?: string[];
    sources?: string[];
  } = {}
): Promise<{ success: boolean; id: string }> {
  // Check if subscription already exists
  const existing = Array.from(subscriptions.values()).find(
    s => s.endpoint === subscription.endpoint
  );

  if (existing) {
    // Update existing
    existing.categories = options.categories || existing.categories;
    existing.sources = options.sources || existing.sources;
    subscriptions.set(existing.id, existing);
    return { success: true, id: existing.id };
  }

  const newSub: PushSubscription = {
    id: generateId(),
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    userId: options.userId,
    categories: options.categories || [],
    sources: options.sources || [],
    createdAt: new Date().toISOString(),
  };

  subscriptions.set(newSub.id, newSub);
  return { success: true, id: newSub.id };
}

/**
 * Remove push subscription
 */
export async function removeSubscription(endpoint: string): Promise<boolean> {
  const sub = Array.from(subscriptions.values()).find(s => s.endpoint === endpoint);
  if (sub) {
    subscriptions.delete(sub.id);
    return true;
  }
  return false;
}

/**
 * Send push notification to a single subscription
 * 
 * Implements RFC 8291 (Message Encryption for Web Push) and
 * RFC 8292 (VAPID) using Web Crypto API for edge runtime compatibility.
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<boolean> {
  const vapid = getVapidKeys();
  if (!vapid) {
    console.error('VAPID keys not configured');
    return false;
  }

  try {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

    // --- VAPID JWT (RFC 8292) ---
    const endpointUrl = new URL(subscription.endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
    const vapidToken = await createVapidJWT(audience, vapid.privateKey, vapid.publicKey);

    // --- ECE Encryption (RFC 8291 / aes128gcm) ---
    const encrypted = await encryptPayload(
      payloadBytes,
      subscription.keys.p256dh,
      subscription.keys.auth,
    );

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': String(encrypted.byteLength),
        'TTL': '86400',
        'Authorization': `vapid t=${vapidToken.token}, k=${vapidToken.publicKey}`,
        'Urgency': 'high',
      },
      body: encrypted,
    });

    if (response.status === 410 || response.status === 404) {
      // Subscription expired, remove it
      subscriptions.delete(subscription.id);
      return false;
    }

    // Update last push time
    subscription.lastPushAt = new Date().toISOString();
    subscriptions.set(subscription.id, subscription);

    return response.ok;
  } catch (error) {
    console.error('Push notification error:', error);
    return false;
  }
}

// =============================================================================
// VAPID JWT (RFC 8292) — Edge-compatible using Web Crypto API
// =============================================================================

/** Base64url encode */
function b64url(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url decode */
function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Create a VAPID JWT signed with ES256 (P-256 / SHA-256).
 */
async function createVapidJWT(
  audience: string,
  privateKeyB64: string,
  publicKeyB64: string,
): Promise<{ token: string; publicKey: string }> {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    aud: audience,
    exp: now + 12 * 3600, // 12 hours
    sub: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claimSet)));

  // Import the VAPID private key (raw 32-byte P-256 scalar)
  const rawPrivate = b64urlDecode(privateKeyB64);
  // Build JWK for the private key
  // VAPID keys: publicKey = 65 bytes uncompressed, privateKey = 32 bytes
  const rawPublic = b64urlDecode(publicKeyB64);
  const x = b64url(rawPublic.slice(1, 33));
  const y = b64url(rawPublic.slice(33, 65));
  const d = b64url(rawPrivate);

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signingInput,
  );

  // Convert from DER to raw r||s (64 bytes) — Web Crypto returns raw for P-256
  const sig = b64url(sigBuf);
  const token = `${header}.${payload}.${sig}`;

  return { token, publicKey: publicKeyB64 };
}

// =============================================================================
// ECE Payload Encryption (RFC 8291 / aes128gcm)
// =============================================================================

/**
 * Encrypt push payload using AES-128-GCM with ECDH key agreement.
 * Implements RFC 8291 (Message Encryption for Web Push).
 */
async function encryptPayload(
  plaintext: Uint8Array,
  clientPublicKeyB64: string,
  clientAuthSecretB64: string,
): Promise<ArrayBuffer> {
  // Decode client keys
  const clientPublicKeyRaw = b64urlDecode(clientPublicKeyB64);
  const authSecret = b64urlDecode(clientAuthSecretB64);

  // Generate ephemeral ECDH key pair for this message
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  // Import client public key
  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKeyRaw as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // ECDH key agreement
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey },
    localKeyPair.privateKey,
    256,
  );

  // Export local public key (uncompressed, 65 bytes)
  const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
  const localPublicKeyBytes = new Uint8Array(localPublicKeyRaw);

  // Generate 16-byte random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // -- Key derivation per RFC 8291 --
  // PRK = HKDF-Extract(auth_secret, ecdh_secret)
  const prkKey = await crypto.subtle.importKey('raw', authSecret as BufferSource, { name: 'HKDF' }, false, ['deriveBits']);
  // IKM for the info-keyed HKDF
  const ikmBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(sharedSecret) as BufferSource, info: buildInfo('WebPush: info', clientPublicKeyRaw, localPublicKeyBytes) as BufferSource },
    prkKey,
    256,
  );
  const ikm = new Uint8Array(ikmBits);

  // Derive content encryption key (CEK) and nonce
  const prkForCEK = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const cekBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: buildCEKInfo('Content-Encoding: aes128gcm') as BufferSource },
    prkForCEK,
    128,
  );
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: buildCEKInfo('Content-Encoding: nonce') as BufferSource },
    prkForCEK,
    96,
  );

  // Add padding delimiter (0x02 for final record)
  const paddedPlaintext = new Uint8Array(plaintext.length + 1);
  paddedPlaintext.set(plaintext);
  paddedPlaintext[plaintext.length] = 0x02; // Final record delimiter

  // AES-128-GCM encrypt
  const cek = await crypto.subtle.importKey('raw', cekBits, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBits, tagLength: 128 },
    cek,
    paddedPlaintext,
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1 + localPublicKeyBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = localPublicKeyBytes.length;
  header.set(localPublicKeyBytes, 21);

  // Combine header + encrypted data
  const result = new Uint8Array(header.length + encrypted.byteLength);
  result.set(header, 0);
  result.set(new Uint8Array(encrypted), header.length);

  return result.buffer;
}

/** Build RFC 8291 info parameter: \"WebPush: info\\0\" + client_public + server_public */
function buildInfo(label: string, clientKey: Uint8Array | ArrayBuffer, serverKey: Uint8Array): Uint8Array {
  const clientBytes = clientKey instanceof ArrayBuffer ? new Uint8Array(clientKey) : clientKey;
  const labelBytes = new TextEncoder().encode(label + '\\0');
  const info = new Uint8Array(labelBytes.length + clientBytes.length + serverKey.length);
  info.set(labelBytes, 0);
  info.set(clientBytes, labelBytes.length);
  info.set(serverKey, labelBytes.length + clientBytes.length);
  return info;
}

/** Build Content-Encoding info: label + \\0 */
function buildCEKInfo(label: string): Uint8Array {
  const bytes = new TextEncoder().encode(label);
  const info = new Uint8Array(bytes.length + 1);
  info.set(bytes, 0);
  info[bytes.length] = 0x00;
  return info;
}

/**
 * Broadcast notification to all subscriptions
 */
export async function broadcastNotification(
  payload: PushPayload,
  filter?: {
    categories?: string[];
    sources?: string[];
  }
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const [, subscription] of subscriptions) {
    // Apply filters
    if (filter) {
      const matchesCategory = !filter.categories || 
        filter.categories.length === 0 ||
        subscription.categories.length === 0 ||
        subscription.categories.some(c => filter.categories!.includes(c));

      const matchesSource = !filter.sources ||
        filter.sources.length === 0 ||
        subscription.sources.length === 0 ||
        subscription.sources.some(s => filter.sources!.includes(s));

      if (!matchesCategory || !matchesSource) {
        continue;
      }
    }

    const success = await sendPushNotification(subscription, payload);
    if (success) {
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Send breaking news notification
 */
export async function sendBreakingNewsNotification(article: {
  title: string;
  link: string;
  source: string;
  category: string;
}): Promise<{ sent: number; failed: number }> {
  const payload: PushPayload = {
    title: '🚨 Breaking News',
    body: article.title,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: 'breaking-news',
    url: article.link,
    data: {
      source: article.source,
      category: article.category,
    },
  };

  return broadcastNotification(payload, {
    categories: [article.category],
    sources: [article.source.toLowerCase()],
  });
}

/**
 * Get subscription stats
 */
export function getSubscriptionStats(): {
  total: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
} {
  const all = Array.from(subscriptions.values());
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};

  all.forEach(sub => {
    sub.categories.forEach(cat => {
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    sub.sources.forEach(src => {
      bySource[src] = (bySource[src] || 0) + 1;
    });
  });

  return {
    total: all.length,
    byCategory,
    bySource,
  };
}

/**
 * Cleanup expired subscriptions
 */
export async function cleanupExpiredSubscriptions(): Promise<number> {
  let cleaned = 0;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const [id, sub] of subscriptions) {
    const createdAt = new Date(sub.createdAt).getTime();
    const lastPushAt = sub.lastPushAt ? new Date(sub.lastPushAt).getTime() : createdAt;

    // Remove if no activity in 30 days
    if (lastPushAt < thirtyDaysAgo) {
      subscriptions.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}
