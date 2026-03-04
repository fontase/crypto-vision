/**
 * Scene 8: Receipt — gas station receipt showing what the agent bought.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import {
  RECEIPTS, AGENT, TOTAL_GAS_COST, COLORS,
} from '../data';
import { FULL_SCREEN, CARD, slideUp, fadeIn, formatUsd, countUp } from '../animations';

export const ReceiptScene: React.FC = () => {
  const frame = useCurrentFrame();

  const headerAnim = slideUp(frame, 5);
  const totalSpentAnimated = countUp(frame, TOTAL_GAS_COST, 20, 25);
  const balanceAnimated = AGENT.balanceUsdc - countUp(frame, TOTAL_GAS_COST, 20, 25);

  return (
    <div style={FULL_SCREEN}>
      <div style={{ ...CARD, width: 480 }}>
        {/* Header */}
        <div style={{ ...headerAnim, textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 24 }}>🧾</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text, letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 }}>
            Gas Station Receipt
          </div>
        </div>

        {/* Line items */}
        {RECEIPTS.map((r, i) => {
          const delay = 12 + i * 8;
          return (
            <div
              key={r.pumpId}
              style={{
                ...slideUp(frame, delay),
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: `1px solid ${COLORS.border}`,
                fontSize: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: COLORS.green }}>✓</span>
                <span>{r.pumpIcon} {r.pumpName}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ color: COLORS.cyan, fontWeight: 600 }}>{formatUsd(r.priceUsd)}</span>
                <span style={{ color: COLORS.textDim, fontSize: 11 }}>({r.latencyMs}ms)</span>
              </div>
            </div>
          );
        })}

        {/* Totals */}
        <div
          style={{
            ...slideUp(frame, 60),
            marginTop: 16,
            paddingTop: 12,
            borderTop: `2px solid ${COLORS.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}>
            <span style={{ fontWeight: 600 }}>TOTAL SPENT</span>
            <span style={{ fontWeight: 800, color: COLORS.text }}>{formatUsd(totalSpentAnimated)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}>
            <span style={{ fontWeight: 600 }}>WALLET BALANCE</span>
            <span style={{ fontWeight: 700, color: COLORS.green }}>{formatUsd(balanceAnimated)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: COLORS.textDim }}>
            <span>DATA SOURCES</span>
            <span style={{ color: COLORS.cyan }}>{RECEIPTS.length}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: COLORS.textDim }}>
            <span>NETWORK</span>
            <span style={{ color: COLORS.blue }}>{AGENT.networkLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
