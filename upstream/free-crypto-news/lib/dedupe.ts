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
 * Request Deduplication
 * 
 * Prevents duplicate in-flight requests by tracking pending promises.
 * If the same request is made while one is in progress, returns the existing promise.
 */

const pendingRequests = new Map<string, Promise<unknown>>();

/**
 * Deduplicate async operations
 * If the same key is requested while a request is pending, return the pending promise
 */
export async function dedupe<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  // Check if there's already a pending request for this key
  const pending = pendingRequests.get(key) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }

  // Create new request and track it
  const promise = fn().finally(() => {
    // Remove from pending after completion (success or error)
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}

/**
 * Get number of pending requests
 */
export function getPendingCount(): number {
  return pendingRequests.size;
}

/**
 * Clear all pending requests (for testing)
 */
export function clearPending(): void {
  pendingRequests.clear();
}
