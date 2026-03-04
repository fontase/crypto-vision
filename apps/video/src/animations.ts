/**
 * Shared animation helpers for the Gas Station video.
 */
import type { CSSProperties } from 'react';
import { interpolate, Easing } from 'remotion';
import { COLORS } from './data';

// ─── Easing presets ─────────────────────────────────────────────

export const EASE_OUT_QUAD = Easing.bezier(0.25, 0.46, 0.45, 0.94);
export const EASE_OUT_EXPO = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);

// ─── Common layout styles ──────────────────────────────────────

export const FULL_SCREEN: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: COLORS.bg,
  fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", monospace',
  color: COLORS.text,
  overflow: 'hidden',
};

export const CARD: CSSProperties = {
  backgroundColor: COLORS.bgCard,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 12,
  padding: '20px 28px',
};

// ─── Animation helpers ─────────────────────────────────────────

/** Fade in over N frames from the start of a local sequence. */
export function fadeIn(frame: number, duration = 15): number {
  return interpolate(frame, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_OUT_QUAD,
  });
}

/** Slide up while fading in. */
export function slideUp(frame: number, delay = 0, duration = 18): { opacity: number; transform: string } {
  const f = Math.max(0, frame - delay);
  const opacity = interpolate(f, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_OUT_QUAD,
  });
  const y = interpolate(f, [0, duration], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_OUT_EXPO,
  });
  return { opacity, transform: `translateY(${y}px)` };
}

/** Typewriter: returns how many chars to show at a given frame. */
export function typewriterCount(frame: number, totalChars: number, delay = 0, charsPerFrame = 1.2): number {
  const f = Math.max(0, frame - delay);
  return Math.min(totalChars, Math.floor(f * charsPerFrame));
}

/** Pulse glow animation for active elements. */
export function pulseGlow(frame: number, speed = 0.08): string {
  const intensity = 0.3 + 0.15 * Math.sin(frame * speed);
  return `0 0 20px rgba(59, 130, 246, ${intensity.toFixed(3)}), 0 0 40px rgba(59, 130, 246, ${(intensity * 0.5).toFixed(3)})`;
}

/** Progress bar fill (0-1). */
export function progressFill(frame: number, startFrame: number, duration: number): number {
  return interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_IN_OUT,
  });
}

/** Scale in (bounce). */
export function scaleIn(frame: number, delay = 0, duration = 15): { opacity: number; transform: string } {
  const f = Math.max(0, frame - delay);
  const opacity = interpolate(f, [0, duration * 0.6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(f, [0, duration * 0.7, duration], [0.5, 1.05, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_OUT_EXPO,
  });
  return { opacity, transform: `scale(${scale})` };
}

/** Number counter animation. */
export function countUp(frame: number, target: number, delay = 0, duration = 20): number {
  const f = Math.max(0, frame - delay);
  return interpolate(f, [0, duration], [0, target], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_OUT_EXPO,
  });
}

/** Format USD with variable precision. */
export function formatUsd(amount: number, decimals = 3): string {
  return `$${amount.toFixed(decimals)}`;
}

/** Format large numbers with K/M/B suffixes. */
export function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Mini sparkline as SVG path. */
export function sparklinePath(data: number[], width: number, height: number): string {
  if (data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  return data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
