/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * Client-side Push Notification helpers
 * Handles browser permission, subscription management, and local notifications.
 */

const PUSH_SUBSCRIPTION_KEY = "fcn-push-subscription";

/**
 * Check if push notifications are supported
 */
export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "Notification" in window && "serviceWorker" in navigator;
}

/**
 * Get current notification permission status
 */
export function getPermissionStatus(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Request browser notification permission
 * @returns true if permission was granted
 */
export async function requestPermission(): Promise<boolean> {
  if (!isPushSupported()) return false;

  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    // Safari fallback (callback-based)
    return new Promise((resolve) => {
      Notification.requestPermission((result) => {
        resolve(result === "granted");
      });
    });
  }
}

/**
 * Subscribe to push notifications via the Push API
 * Posts subscription to /api/push
 */
export async function subscribeToPush(
  subscription?: PushSubscription
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!subscription) {
      // Get SW registration and subscribe
      const registration = await navigator.serviceWorker.ready;

      // Fetch VAPID public key from server
      const vapidRes = await fetch("/api/push?action=vapid-key");
      if (!vapidRes.ok) {
        return { success: false, error: "Could not fetch VAPID key" };
      }
      const { publicKey } = await vapidRes.json();
      if (!publicKey) {
        return { success: false, error: "No VAPID public key configured" };
      }

      const applicationServerKey = urlBase64ToUint8Array(publicKey) as BufferSource;

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      }) as unknown as PushSubscription;
    }

    // Send subscription to server
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "subscribe",
        subscription: subscription.toJSON(),
      }),
    });

    if (!res.ok) {
      return { success: false, error: "Failed to register push subscription" };
    }

    // Store locally
    localStorage.setItem(PUSH_SUBSCRIPTION_KEY, JSON.stringify(subscription.toJSON()));

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();

      // Notify server
      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unsubscribe",
          endpoint: subscription.endpoint,
        }),
      });
    }

    localStorage.removeItem(PUSH_SUBSCRIPTION_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Show a local browser notification (not pushed from server)
 */
export function sendLocalNotification(
  title: string,
  body: string,
  icon?: string,
  options?: { tag?: string; url?: string }
): void {
  if (typeof window === "undefined") return;
  if (Notification.permission !== "granted") return;

  const notification = new Notification(title, {
    body,
    icon: icon || "/icons/icon-192x192.png",
    badge: "/icons/icon-72x72.png",
    tag: options?.tag,
    data: { url: options?.url },
  });

  notification.onclick = () => {
    window.focus();
    if (options?.url) {
      window.location.href = options.url;
    }
    notification.close();
  };
}

/**
 * Convert a VAPID public key from base64 string to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
