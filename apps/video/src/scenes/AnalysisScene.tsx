/**
 * Scene 6: Analysis — agent crunching data with animated steps.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { COLORS, FPS } from '../data';
import { FULL_SCREEN, slideUp, fadeIn, typewriterCount } from '../animations';

const ANALYSIS_STEPS = [
  'Cross-referencing market data with whale movements...',
  'Scoring DeFi protocols by risk-adjusted yield...',
  'Overlaying sentiment data for confirmation bias check...',
  'Running AI opportunity detection model...',
  'Generating final report...',
];

export const AnalysisScene: React.FC = () => {
  const frame = useCurrentFrame();

  const headerAnim = slideUp(frame, 5);
  const framesPerStep = Math.floor(3 * FPS / ANALYSIS_STEPS.length); // ~18 frames per step

  return (
    <div style={FULL_SCREEN}>
      <div style={{ width: 560 }}>
        {/* Header */}
        <div style={{ ...headerAnim, textAlign: 'center', marginBottom: 28 }}>
          <span style={{ fontSize: 32 }}>🧠</span>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: COLORS.text,
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginTop: 8,
            }}
          >
            Analyzing Data
          </div>
        </div>

        {/* Steps */}
        {ANALYSIS_STEPS.map((step, i) => {
          const stepStart = 15 + i * framesPerStep;
          const visible = frame > stepStart;
          const chars = typewriterCount(frame, step.length, stepStart, 2.5);
          const checkDelay = stepStart + step.length / 2.5 + 3;
          const checkOpacity = fadeIn(frame - checkDelay, 8);

          if (!visible) return null;

          return (
            <div
              key={i}
              style={{
                ...slideUp(frame, stepStart),
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 10,
                padding: '8px 12px',
              }}
            >
              <span style={{ color: COLORS.green, opacity: checkOpacity, fontSize: 14, flexShrink: 0 }}>
                {checkOpacity > 0.5 ? '✓' : '→'}
              </span>
              <span style={{ fontSize: 14, color: COLORS.textDim }}>
                {step.slice(0, chars)}
              </span>
            </div>
          );
        })}

        {/* Spinner */}
        {frame > 15 && frame < 70 && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <div
              style={{
                display: 'inline-block',
                width: 24,
                height: 24,
                border: `2px solid ${COLORS.border}`,
                borderTopColor: COLORS.accent,
                borderRadius: '50%',
                transform: `rotate(${frame * 12}deg)`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
