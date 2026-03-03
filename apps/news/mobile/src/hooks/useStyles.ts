/**
 * useStyles — Memoized StyleSheet factory
 *
 * Every component in the mobile app uses `createStyles(isDark)` which calls
 * `StyleSheet.create()` on EVERY render. This is the same class of problem
 * Pump.fun identified: runtime style computation eating CPU.
 *
 * Their fix was build-time compilation (Nativewind → React Native Tailwind).
 * Since we use pure StyleSheet (not Tailwind), our equivalent optimisation is
 * to memoize StyleSheet.create() calls so they only recompute when the theme
 * actually changes — not on every render of every component.
 *
 * For a FlatList of 50 CoinCards, this eliminates 50 × StyleSheet.create()
 * calls per re-render cycle.
 */

import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

type NamedStyles<T> = { [P in keyof T]: object };

/**
 * Memoizes a style factory so StyleSheet.create() is only called when
 * the color scheme changes — not on every render.
 *
 * @example
 * function CoinCard({ coin }: Props) {
 *   const styles = useStyles(createCoinCardStyles);
 *   // ...
 * }
 *
 * const createCoinCardStyles = (isDark: boolean) => ({
 *   card: { backgroundColor: isDark ? '#1a1a1a' : '#fff' },
 * });
 */
export function useStyles<T extends NamedStyles<T>>(
  factory: (isDark: boolean) => T
): StyleSheet.NamedStyles<T> {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return useMemo(
    () => StyleSheet.create(factory(isDark)),
    [isDark, factory]
  );
}

/**
 * Same as useStyles but accepts extra args for factories that need
 * additional parameters (e.g., `compact` mode).
 *
 * @example
 * const styles = useStylesWithArgs(createNewsCardStyles, compact);
 */
export function useStylesWithArgs<T extends NamedStyles<T>, A extends unknown[]>(
  factory: (isDark: boolean, ...args: A) => T,
  ...args: A
): StyleSheet.NamedStyles<T> {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(
    () => StyleSheet.create(factory(isDark, ...args)),
    // Stringify args for stable deps — args are simple primitives
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDark, factory, JSON.stringify(args)]
  );
}

// ─── Pre-built theme tokens ─────────────────────────────────
// Avoids repeated ternaries in every style factory.

export const THEME = {
  dark: {
    bg: '#0a0a0a',
    card: '#1a1a1a',
    surface: '#2a2a2a',
    text: '#ffffff',
    textSecondary: '#888888',
    border: '#2a2a2a',
    accent: '#f7931a',
    positive: 'rgba(34, 197, 94, 0.15)',
    negative: 'rgba(239, 68, 68, 0.15)',
  },
  light: {
    bg: '#f5f5f5',
    card: '#ffffff',
    surface: '#f0f0f0',
    text: '#000000',
    textSecondary: '#666666',
    border: '#e0e0e0',
    accent: '#f7931a',
    positive: 'rgba(34, 197, 94, 0.15)',
    negative: 'rgba(239, 68, 68, 0.15)',
  },
} as const;

export function getTheme(isDark: boolean) {
  return isDark ? THEME.dark : THEME.light;
}
