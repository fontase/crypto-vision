/**
 * Scene 4: Route Plan — agent maps out which gas station pumps to visit.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { PUMPS, COLORS } from '../data';
import { FULL_SCREEN, slideUp, fadeIn, formatUsd } from '../animations';

const ROUTE_LABELS = [
  'Get current market prices & trends',
  'Check what smart money is doing',
  'Scan DeFi yields & TVL flows',
  'Read the social sentiment pulse',
  'Run AI analysis on all data',
];

export const RoutePlanScene: React.FC = () => {
  const frame = useCurrentFrame();

  const headerAnim = slideUp(frame, 5);

  return (
    <div style={FULL_SCREEN}>
      <div style={{ width: 600 }}>
        {/* Header */}
        <div style={{ ...headerAnim, marginBottom: 28, textAlign: 'center' }}>
          <span
            style={{
              fontSize: 14,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: COLORS.textDim,
              fontWeight: 600,
            }}
          >
            🗺️ Route Planned
          </span>
        </div>

        {/* Route items */}
        {PUMPS.map((pump, i) => {
          const delay = 15 + i * 10;
          const itemAnim = slideUp(frame, delay);
          const visible = frame > delay - 5;
          const checkOpacity = fadeIn(frame - delay - 8, 8);

          if (!visible) return null;

          return (
            <div
              key={pump.id}
              style={{
                ...itemAnim,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                marginBottom: 12,
                padding: '10px 16px',
                backgroundColor: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
              }}
            >
              {/* Step number */}
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: COLORS.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>

              {/* Description */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, color: COLORS.text, fontWeight: 500 }}>
                  {ROUTE_LABELS[i]}
                </div>
                <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>
                  {pump.icon} {pump.name} — {formatUsd(pump.priceUsd)}
                </div>
              </div>

              {/* Check */}
              <span style={{ fontSize: 16, opacity: checkOpacity, color: COLORS.green }}>✓</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
