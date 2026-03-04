/**
 * Scene 9: Closing — agent summary + tagline.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { AGENT, TOTAL_GAS_COST, RECEIPTS, COLORS, FPS } from '../data';
import { FULL_SCREEN, slideUp, typewriterCount, fadeIn, formatUsd, pulseGlow } from '../animations';

export const ClosingScene: React.FC = () => {
  const frame = useCurrentFrame();

  const agentMsg = `"Mission complete. Spent ${formatUsd(TOTAL_GAS_COST)} across ${RECEIPTS.length} data sources. Your best play is ETH \u2014 87% confidence, target $4,200. The whales agree."`;
  const msgChars = typewriterCount(frame, agentMsg.length, 10, 1.8);

  const taglineDelay = 55;
  const tagline = 'give your agent access to money.';
  const taglineOpacity = fadeIn(frame - taglineDelay, 20);

  return (
    <div style={FULL_SCREEN}>
      <div style={{ width: 560, textAlign: 'center' }}>
        {/* Agent avatar */}
        <div style={{ ...slideUp(frame, 0), marginBottom: 20 }}>
          <span style={{ fontSize: 48 }}>🤖</span>
        </div>

        {/* Agent message */}
        <div
          style={{
            ...slideUp(frame, 5),
            backgroundColor: COLORS.bgCard,
            border: `1px solid ${COLORS.borderActive}`,
            borderRadius: 12,
            padding: '20px 28px',
            textAlign: 'left',
            marginBottom: 32,
          }}
        >
          <div style={{ fontSize: 12, color: COLORS.cyan, marginBottom: 8 }}>{AGENT.name}</div>
          <div style={{ fontSize: 17, color: COLORS.text, lineHeight: 1.5 }}>
            {agentMsg.slice(0, msgChars)}
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            opacity: taglineOpacity,
            fontSize: 28,
            fontWeight: 700,
            color: COLORS.cyan,
            fontStyle: 'italic',
            textShadow: frame > taglineDelay + 10 ? pulseGlow(frame, 0.04) : 'none',
          }}
        >
          {tagline}
        </div>
      </div>
    </div>
  );
};
