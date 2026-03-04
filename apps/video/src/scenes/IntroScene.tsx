/**
 * Scene 1: Intro — "give your agent access to money"
 *
 * Dark screen → title fades in with a blue glow → subtitle types out.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { COLORS, FPS } from '../data';
import { FULL_SCREEN, fadeIn, slideUp, typewriterCount, pulseGlow } from '../animations';

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleAnim = slideUp(frame, 10, 25);
  const subtitleDelay = 40;
  const subtitle = 'give your agent access to money.';
  const subtitleChars = typewriterCount(frame, subtitle.length, subtitleDelay, 1.5);
  const subtitleOpacity = fadeIn(frame - subtitleDelay + 5, 10);

  const cursorBlink = Math.floor(frame / (FPS * 0.4)) % 2 === 0;
  const showCursor = frame > subtitleDelay && subtitleChars < subtitle.length;

  return (
    <div style={FULL_SCREEN}>
      {/* Subtle radial glow behind title */}
      <div
        style={{
          position: 'absolute',
          top: '40%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 600,
          height: 400,
          background: `radial-gradient(ellipse, ${COLORS.accentGlow} 0%, transparent 70%)`,
          opacity: fadeIn(frame, 30) * 0.6,
        }}
      />

      <div style={{ ...titleAnim, textAlign: 'center', zIndex: 1 }}>
        <div
          style={{
            fontSize: 28,
            fontWeight: 600,
            color: COLORS.textDim,
            letterSpacing: 4,
            textTransform: 'uppercase',
            marginBottom: 16,
          }}
        >
          x402 Protocol
        </div>

        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: COLORS.text,
            letterSpacing: -1,
            textShadow: frame > 15 ? pulseGlow(frame, 0.05) : 'none',
            lineHeight: 1.1,
          }}
        >
          Gas Station
        </div>
      </div>

      <div
        style={{
          marginTop: 48,
          opacity: subtitleOpacity,
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontSize: 24,
            color: COLORS.cyan,
            fontStyle: 'italic',
          }}
        >
          {subtitle.slice(0, subtitleChars)}
          {showCursor && (
            <span style={{ opacity: cursorBlink ? 1 : 0, color: COLORS.accent }}>|</span>
          )}
        </span>
      </div>
    </div>
  );
};
