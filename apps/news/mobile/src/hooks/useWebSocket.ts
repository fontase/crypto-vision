/**
 * useWebSocket — Real-time WebSocket hook with client-side throttling
 *
 * Replaces polling-based data fetching with a persistent WebSocket
 * connection. Applies client-side throttling to prevent excessive
 * re-renders on high-frequency data streams.
 *
 * Inspired by Pump.fun's approach: they receive ~1000 trades/sec per coin
 * but throttle UI updates to 5 Hz because the human eye can't perceive
 * faster changes and React Native can't render them efficiently.
 *
 * @see https://medium.com/@pumpfun — "How we 10x improved our React Native app startup time"
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Configuration ───────────────────────────────────────────

/** Max UI updates per second per topic. 5 Hz matches Pump.fun's optimal rate. */
const DEFAULT_THROTTLE_HZ = 5;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 45_000; // Expect a ping within this window

// ─── Types ───────────────────────────────────────────────────

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface UseWebSocketOptions<T> {
  /** WebSocket URL to connect to */
  url: string;
  /** Parse incoming message into the desired shape */
  onMessage: (event: MessageEvent) => T | null;
  /** Throttle Hz (default: 5) — set to 0 for no throttle */
  throttleHz?: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Connection enabled (default: true) — set false to pause */
  enabled?: boolean;
}

interface UseWebSocketResult<T> {
  data: T | null;
  status: ConnectionStatus;
  error: string | null;
  /** Send a message to the server */
  send: (msg: string) => void;
  /** Force reconnect */
  reconnect: () => void;
}

// ─── Hook ────────────────────────────────────────────────────

export function useWebSocket<T>({
  url,
  onMessage,
  throttleHz = DEFAULT_THROTTLE_HZ,
  autoReconnect = true,
  enabled = true,
}: UseWebSocketOptions<T>): UseWebSocketResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Throttle buffer: accumulate latest data, flush at throttleHz
  const pendingData = useRef<T | null>(null);
  const throttleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startThrottle = useCallback(() => {
    if (throttleHz <= 0 || throttleTimer.current) return;
    const intervalMs = 1000 / throttleHz;
    throttleTimer.current = setInterval(() => {
      if (pendingData.current !== null) {
        setData(pendingData.current);
        pendingData.current = null;
      }
    }, intervalMs);
  }, [throttleHz]);

  const stopThrottle = useCallback(() => {
    if (throttleTimer.current) {
      clearInterval(throttleTimer.current);
      throttleTimer.current = null;
    }
    pendingData.current = null;
  }, []);

  const resetHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
    heartbeatTimer.current = setTimeout(() => {
      // No heartbeat received — assume connection is stale
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close(4000, 'Heartbeat timeout');
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    setError(null);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        reconnectAttempts.current = 0;
        resetHeartbeat();
        startThrottle();
      };

      ws.onmessage = (event: MessageEvent) => {
        resetHeartbeat();

        // Skip server pings
        try {
          const raw = JSON.parse(event.data as string);
          if (raw?.type === 'ping') return;
        } catch {
          // Not JSON — let onMessage handle it
        }

        const parsed = onMessage(event);
        if (parsed === null) return;

        if (throttleHz <= 0) {
          // No throttling — update immediately
          setData(parsed);
        } else {
          // Buffer for next throttle flush
          pendingData.current = parsed;
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
        stopThrottle();
        if (autoReconnect && enabled) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStatus('disconnected');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled]);

  const scheduleReconnect = useCallback(() => {
    const attempts = reconnectAttempts.current++;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** attempts + Math.random() * 500,
      RECONNECT_MAX_MS
    );
    setStatus('reconnecting');
    reconnectTimer.current = setTimeout(connect, delay);
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (heartbeatTimer.current) {
      clearTimeout(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
    stopThrottle();
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent auto-reconnect
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, [stopThrottle]);

  const send = useCallback((msg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    }
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttempts.current = 0;
    connect();
  }, [disconnect, connect]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }
    return disconnect;
  }, [enabled, connect, disconnect]);

  return { data, status, error, send, reconnect };
}

// ─── Specialized hooks ──────────────────────────────────────

interface PriceTick {
  type: 'price';
  data: Record<string, string>;
  timestamp: string;
}

/**
 * Subscribe to real-time price updates via WebSocket.
 * Prices are throttled to 5 Hz — optimal for mobile rendering.
 */
export function useLivePrices(
  coins: string[],
  baseUrl: string = 'wss://cryptocurrency.cv'
) {
  const coinParam = coins.join(',');
  const url = `${baseUrl}/ws/prices?coins=${coinParam}`;

  return useWebSocket<Record<string, string>>({
    url,
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data as string) as PriceTick;
        if (msg.type === 'price' && msg.data) {
          return msg.data;
        }
      } catch {
        // Ignore malformed messages
      }
      return null;
    },
    throttleHz: 5,
    enabled: coins.length > 0,
  });
}
