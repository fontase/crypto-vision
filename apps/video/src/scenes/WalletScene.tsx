/**
 * Scene 2: Agent Wallet — shows the agent booting up with a funded wallet.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { AGENT, COLORS, FPS } from '../data';
import { FULL_SCREEN, CARD, slideUp, fadeIn, countUp, formatUsd, pulseGlow } from '../animations';

export const WalletScene: React.FC = () => {
  const frame = useCurrentFrame();

  const headerAnim = slideUp(frame, 5);
  const walletAnim = slideUp(frame, 15);
  const balanceAnim = slideUp(frame, 25);
  const networkAnim = slideUp(frame, 35);
  const animatedBalance = countUp(frame, AGENT.balanceUsdc, 25, 30);

  const statusDot = Math.floor(frame / (FPS * 0.5)) % 2 === 0;

  return (
    <div style={FULL_SCREEN}>
      <div
        style={{
          ...CARD,
          width: 560,
          boxShadow: frame > 20 ? pulseGlow(frame, 0.06) : 'none',
        }}
      >
        {/* Header */}
        <div style={{ ...headerAnim, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <span style={{ fontSize: 36 }}>🤖</span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.text }}>{AGENT.name}</div>
            <div style={{ fontSize: 13, color: COLORS.textDim }}>
              Autonomous Crypto Intelligence Agent
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: COLORS.green,
                  marginLeft: 8,
                  opacity: statusDot ? 1 : 0.4,
                  verticalAlign: 'middle',
                }}
              />
            </div>
          </div>
        </div>

        {/* Wallet address */}
        <div style={{ ...walletAnim, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
            Wallet
          </div>
          <div style={{ fontSize: 16, color: COLORS.cyan, fontFamily: 'monospace' }}>
            💳 {AGENT.wallet}
          </div>
        </div>

        {/* Balance */}
        <div style={{ ...balanceAnim, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
            Balance
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 40, fontWeight: 800, color: COLORS.green }}>
              {formatUsd(animatedBalance)}
            </span>
            <span style={{ fontSize: 18, color: COLORS.usdcBlue, fontWeight: 600 }}>USDC</span>
          </div>
        </div>

        {/* Network */}
        <div style={{ ...networkAnim }}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
            Network
          </div>
          <div style={{ fontSize: 16, color: COLORS.blue }}>
            🔗 {AGENT.networkLabel} <span style={{ color: COLORS.textDim }}>({AGENT.network})</span>
          </div>
        </div>
      </div>
    </div>
  );
};
