/**
 * Scene 3: Mission — user sends the agent a task.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { AGENT, COLORS } from '../data';
import { FULL_SCREEN, slideUp, typewriterCount } from '../animations';

export const MissionScene: React.FC = () => {
  const frame = useCurrentFrame();

  const labelAnim = slideUp(frame, 5);

  const userMsg = '"Find me the best crypto opportunity right now."';
  const userChars = typewriterCount(frame, userMsg.length, 20, 1.8);

  const agentMsg = '"On it. Let me plan my route..."';
  const agentChars = typewriterCount(frame, agentMsg.length, 55, 1.5);

  return (
    <div style={FULL_SCREEN}>
      <div style={{ width: 620, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Mission label */}
        <div style={{ ...labelAnim, textAlign: 'center' }}>
          <span
            style={{
              fontSize: 14,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: COLORS.yellow,
              fontWeight: 600,
            }}
          >
            📨 Mission Received
          </span>
        </div>

        {/* User message */}
        <div
          style={{
            ...slideUp(frame, 15),
            backgroundColor: COLORS.bgCard,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: '16px 24px',
          }}
        >
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>User</div>
          <div style={{ fontSize: 22, color: COLORS.text, fontWeight: 500 }}>
            {userMsg.slice(0, userChars)}
          </div>
        </div>

        {/* Agent response */}
        {frame > 50 && (
          <div
            style={{
              ...slideUp(frame, 50),
              backgroundColor: COLORS.bgCard,
              border: `1px solid ${COLORS.borderActive}`,
              borderRadius: 12,
              padding: '16px 24px',
            }}
          >
            <div style={{ fontSize: 12, color: COLORS.cyan, marginBottom: 6 }}>{AGENT.name}</div>
            <div style={{ fontSize: 20, color: COLORS.cyan, fontWeight: 500 }}>
              {agentMsg.slice(0, agentChars)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
