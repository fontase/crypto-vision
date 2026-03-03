# Performance Strategy Guide

> Lessons learned from [Pump.fun's 10x React Native startup improvement](https://medium.com/@pumpfun) and how they apply to crypto-vision.

## Table of Contents

1. [The Problem](#the-problem)
2. [Server-Side: WebSocket Broadcast Throttling](#server-side-websocket-broadcast-throttling)
3. [Mobile: Replace Polling with WebSocket + Client-Side Throttling](#mobile-replace-polling-with-websocket--client-side-throttling)
4. [Mobile: Memoize StyleSheet Creation](#mobile-memoize-stylesheet-creation)
5. [Mobile: Performance Telemetry](#mobile-performance-telemetry)
6. [Dashboard: Tailwind Class Validation](#dashboard-tailwind-class-validation)
7. [Architecture Principles](#architecture-principles)
8. [Checklist for New Features](#checklist-for-new-features)

---

## The Problem

Real-time crypto apps face a specific performance challenge: **high-frequency data meets expensive rendering**. Pump.fun documented receiving ~1,000 trades/second per coin, with screens showing 10+ coins simultaneously — potentially 10,000 events/second.

Our crypto-vision platform faces the same class of problem:
- CoinCap WebSocket emits continuous price ticks for 10+ coins
- The mobile app shows 50 coins on the Markets screen
- The dashboard shows real-time prices, charts, and sentiment

### What Pump.fun Found

| Metric | Before | After |
|--------|--------|-------|
| CSS interop CPU usage | 3.5% | 0.01% |
| App startup (iOS) | 1.5s | 110ms |
| Route change speed | baseline | ~10% faster |

Their key insight: **runtime style computation was the dominant cost**, and moving it to build-time eliminated it entirely.

---

## Server-Side: WebSocket Broadcast Throttling

**File:** `src/lib/ws.ts`

### What We Changed

CoinCap sends price ticks as fast as they arrive. Previously, every tick was immediately broadcast to all connected clients. Now, price updates are **buffered and flushed at 5 Hz** (200ms intervals):

```
CoinCap tick (100+/sec) → pendingPrices buffer → flush at 5Hz → per-client filtered broadcast
```

### Why 5 Hz?

Pump.fun determined that 5 updates/second is the sweet spot:
- Human perception of numeric changes tops out around 4-8 Hz
- React/React Native can comfortably render at this rate without frame drops
- Even with 10 coins visible, that's only 50 state updates/second

### How It Works

```typescript
// Latest price per coin is accumulated (last-write-wins)
const pendingPrices = new Map<string, string>();

// Every 200ms, flush all accumulated prices as one batch
setInterval(() => {
  if (pendingPrices.size === 0) return;
  const batch = Object.fromEntries(pendingPrices);
  pendingPrices.clear();
  broadcastRaw("prices", JSON.stringify({ type: "price", data: batch, ... }));
}, 200);
```

This reduces downstream client processing from hundreds of messages/second to exactly 5, regardless of upstream volume.

---

## Mobile: Replace Polling with WebSocket + Client-Side Throttling

**File:** `apps/news/mobile/src/hooks/useWebSocket.ts`

### Before

The mobile app used `setInterval` polling at fixed rates:
- Market coins: 30s polling (`useMarketCoins`)
- Coin price: 10s polling (`useCoinPrice`)
- Fear & Greed: 60s polling (`useFearGreed`)

This means prices could be **up to 30 seconds stale** and every poll makes a full HTTP round-trip.

### After

The `useWebSocket` hook provides:

1. **Persistent WebSocket connection** — single TCP connection, instant updates
2. **Client-side throttle buffer** — accumulates data, flushes to React state at configurable Hz
3. **Exponential backoff reconnection** — with jitter, up to 30s max delay
4. **Heartbeat monitoring** — detects stale connections within 45s

```typescript
// Subscribe to live prices for visible coins
const { data: prices, status } = useLivePrices(['bitcoin', 'ethereum', 'solana']);

// prices updates at most 5 times/second — React re-renders are bounded
```

### Specialized Hook

`useLivePrices(coins)` wraps the generic `useWebSocket` with the correct URL and message parsing for the `/ws/prices` endpoint.

---

## Mobile: Memoize StyleSheet Creation

**File:** `apps/news/mobile/src/hooks/useStyles.ts`

### The Problem

Every component used this pattern:

```typescript
function CoinCard({ coin }) {
  const isDark = useColorScheme() === 'dark';
  const styles = createStyles(isDark); // ← StyleSheet.create() on EVERY render
  // ...
}
```

For a FlatList of 50 CoinCards, this means **50 × StyleSheet.create() calls per scroll frame**. This is the same problem Pump.fun found with Nativewind's `cssInterop` consuming 3.5% of CPU.

### The Fix

```typescript
function CoinCard({ coin }) {
  const styles = useStyles(coinCardStyles); // ← Memoized, only recomputes on theme change
  // ...
}
```

`useStyles` wraps `useMemo` so `StyleSheet.create()` is only called when the color scheme actually changes (light ↔ dark), not on every render.

### Theme Tokens

Centralized theme values eliminate scattered ternaries:

```typescript
const t = getTheme(isDark);
// t.card, t.text, t.textSecondary, t.border, t.positive, t.negative
```

---

## Mobile: Performance Telemetry

**File:** `apps/news/mobile/src/hooks/usePerformanceMonitor.ts`

### What It Captures

| Metric | How | Why |
|--------|-----|-----|
| JS FPS | `requestAnimationFrame` counting | Detect frame drops like Pump.fun's 20 FPS observations |
| Average FPS | 10-sample rolling window | Smooth out spikes |
| Render count | Ref counter in hook | Track excessive re-renders |
| Slow render warnings | Timestamp diff | Catch renders >16ms (1 frame budget) |
| Screen attribution | `screenName` parameter | Know *which* screen is slow |

### Usage

```typescript
function MarketsScreen() {
  const perf = usePerformanceMonitor('MarketsScreen');

  // In dev, slow renders auto-warn in console
  // perf.isLowFPS === true when JS thread is struggling
}
```

### Telemetry Pipeline

Samples accumulate in a buffer and flush when full (100 samples) or on unmount:

```typescript
setPerformanceTelemetryHandler((samples) => {
  // Send to DataDog, Sentry, or your analytics backend
  fetch('/api/telemetry', {
    method: 'POST',
    body: JSON.stringify({ perf: samples }),
  });
});
```

### Utility Functions

- `throttle(fn, hz)` — Cap callback frequency (e.g., price update handlers)
- `debounce(fn, ms)` — Wait for silence (e.g., search input)

---

## Dashboard: Tailwind Class Validation

**File:** `apps/dashboard/eslint.config.mjs`

### What Pump.fun Discovered

> "We had about a dozen classes that flat out didn't exist and even more 'in use' that didn't actually apply to React Native."

The same problem exists in web apps — typos in class names silently do nothing.

### ESLint Rules Added

| Rule | Purpose |
|------|---------|
| `tailwindcss/no-custom-classname` | Flags classes that don't exist in tailwind config |
| `tailwindcss/no-contradicting-classname` | Catches `p-2 p-4` on same element |
| `tailwindcss/classnames-order` | Enforces consistent ordering |
| `tailwindcss/no-unnecessary-arbitrary-value` | Prefers utilities over `[value]` syntax |

Our custom design-token classes (CSS variable based) are whitelisted to avoid false positives.

### Setup

```bash
cd apps/dashboard
npm install -D eslint-plugin-tailwindcss
```

---

## Architecture Principles

These are the general principles from Pump.fun's article applied to our codebase:

### 1. Push Work to Build Time
- **Pump.fun**: Nativewind (runtime) → React Native Tailwind (build-time)
- **Us**: If we adopt Tailwind for mobile, start with build-time compilation (RNT)
- **General**: Anything computable at build time should NOT run at render time

### 2. Throttle at Every Layer
```
Upstream source (1000/sec)
  → Server throttle (5 Hz flush)
    → Client throttle (5 Hz state updates)
      → UI rendering (batched by React)
```

### 3. Measure Before Optimizing
- Use release-build profiling (not dev mode)
- Add telemetry to every screen — attribute performance to specific routes
- Track JS FPS, not just network latency

### 4. Validate at Lint Time
- Catch invalid/unused CSS classes before they ship
- Block web-only classes from mobile code
- Enforce consistent patterns with ESLint

### 5. Memoize Expensive Computations
- `StyleSheet.create()` results should be cached
- Parse JSON once, not per-client
- Use `useMemo` for derived data

---

## Checklist for New Features

When adding a new screen or component:

- [ ] Does it receive real-time data? → Use `useWebSocket` with throttle, not polling
- [ ] Does it create styles? → Use `useStyles()` hook, not inline `createStyles()`
- [ ] Does it use Tailwind classes? → Run `npm run lint` to validate class names
- [ ] Is it a heavy screen? → Add `usePerformanceMonitor('ScreenName')`
- [ ] Does it render a list? → Use `FlatList` with `keyExtractor`, not `.map()`
- [ ] Does it process frequent events? → Use `throttle(fn, 5)` to cap at 5 Hz
- [ ] Is the component pure? → Wrap with `React.memo()` to skip unnecessary re-renders
