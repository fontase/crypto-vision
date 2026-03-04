/**
 * Scene 5: Gas Station — the agent pays at each pump via x402.
 *
 * This is the hero scene. Each pump shows:
 * 1. The pump icon + name
 * 2. HTTP 402 → sign → pay flow visualized
 * 3. Green check + tx hash
 * 4. Running balance ticker
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { interpolate } from 'remotion';
import { PUMPS, AGENT, COLORS, FPS, TOTAL_GAS_COST, RECEIPTS } from '../data';
import { FULL_SCREEN, fadeIn, slideUp, formatUsd, EASE_OUT_QUAD, progressFill } from '../animations';

const FRAMES_PER_PUMP = Math.floor(12 * FPS / PUMPS.length); // ~72 frames per pump

interface PumpState {
  phase: 'waiting' | 'connecting' | '402' | 'signing' | 'paid' | 'done';
  phaseProgress: number;
}

function getPumpState(localFrame: number): PumpState {
  if (localFrame < 5) return { phase: 'waiting', phaseProgress: 0 };
  if (localFrame < 15) return { phase: 'connecting', phaseProgress: (localFrame - 5) / 10 };
  if (localFrame < 28) return { phase: '402', phaseProgress: (localFrame - 15) / 13 };
  if (localFrame < 42) return { phase: 'signing', phaseProgress: (localFrame - 28) / 14 };
  if (localFrame < 55) return { phase: 'paid', phaseProgress: (localFrame - 42) / 13 };
  return { phase: 'done', phaseProgress: 1 };
}

const PHASE_LABELS: Record<string, { text: string; color: string }> = {
  waiting: { text: '', color: COLORS.textDim },
  connecting: { text: 'Connecting...', color: COLORS.textDim },
  '402': { text: 'HTTP 402 → Payment Required', color: COLORS.yellow },
  signing: { text: 'Signing EIP-3009 USDC transfer...', color: COLORS.orange },
  paid: { text: '✓ Payment accepted', color: COLORS.green },
  done: { text: '✓ Data received', color: COLORS.green },
};

export const GasStationScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Header
  const headerAnim = slideUp(frame, 0);

  // Which pump is active
  const activePumpIndex = Math.min(
    Math.floor(frame / FRAMES_PER_PUMP),
    PUMPS.length - 1,
  );
  const pumpLocalFrame = frame - activePumpIndex * FRAMES_PER_PUMP;

  // Running balance
  let spent = 0;
  for (let i = 0; i < activePumpIndex; i++) {
    spent += PUMPS[i]!.priceUsd;
  }
  const currentPumpState = getPumpState(pumpLocalFrame);
  if (currentPumpState.phase === 'paid' || currentPumpState.phase === 'done') {
    spent += PUMPS[activePumpIndex]!.priceUsd;
  }
  const balance = AGENT.balanceUsdc - spent;

  // Overall progress
  const overallProgress = Math.min(1, (activePumpIndex + (currentPumpState.phase === 'done' ? 1 : 0.5)) / PUMPS.length);

  return (
    <div style={FULL_SCREEN}>
      <div style={{ width: 660 }}>
        {/* Header */}
        <div
          style={{
            ...headerAnim,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.text }}>
              ⛽ Gas Station
            </div>
            <div style={{ fontSize: 12, color: COLORS.textDim }}>
              x402 Micropayment Refueling
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>BALANCE</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.green }}>
              {formatUsd(balance)} <span style={{ fontSize: 12, color: COLORS.usdcBlue }}>USDC</span>
            </div>
          </div>
        </div>

        {/* Overall progress bar */}
        <div
          style={{
            width: '100%',
            height: 4,
            backgroundColor: COLORS.border,
            borderRadius: 2,
            marginBottom: 24,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${overallProgress * 100}%`,
              height: '100%',
              backgroundColor: COLORS.accent,
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        {/* Pump cards */}
        {PUMPS.map((pump, i) => {
          const isActive = i === activePumpIndex;
          const isDone = i < activePumpIndex;
          const isUpcoming = i > activePumpIndex;

          const pumpState = isActive ? currentPumpState : isDone
            ? { phase: 'done' as const, phaseProgress: 1 }
            : { phase: 'waiting' as const, phaseProgress: 0 };

          const phaseInfo = PHASE_LABELS[pumpState.phase] ?? PHASE_LABELS.waiting!;
          const receipt = RECEIPTS[i]!;

          const cardOpacity = isUpcoming ? 0.35 : 1;
          const borderColor = isActive ? COLORS.borderActive : isDone ? COLORS.greenDim : COLORS.border;

          return (
            <div
              key={pump.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                marginBottom: 8,
                padding: '10px 16px',
                backgroundColor: isActive ? COLORS.bgCardHover : COLORS.bgCard,
                border: `1px solid ${borderColor}`,
                borderRadius: 8,
                opacity: cardOpacity,
              }}
            >
              {/* Pump icon */}
              <div style={{ fontSize: 24, width: 36, textAlign: 'center', flexShrink: 0 }}>
                {pump.icon}
              </div>

              {/* Pump info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>
                  {pump.name}
                </div>
                <div style={{ fontSize: 12, color: phaseInfo.color, marginTop: 2 }}>
                  {isDone ? (
                    <>✓ Paid {formatUsd(pump.priceUsd)} — <span style={{ color: COLORS.textDim }}>{receipt.txHash}</span></>
                  ) : (
                    phaseInfo.text
                  )}
                </div>

                {/* Progress bar for active pump */}
                {isActive && pumpState.phase !== 'waiting' && (
                  <div
                    style={{
                      width: '100%',
                      height: 3,
                      backgroundColor: COLORS.border,
                      borderRadius: 1.5,
                      marginTop: 6,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${progressFill(pumpLocalFrame, 5, FRAMES_PER_PUMP - 15) * 100}%`,
                        height: '100%',
                        backgroundColor: pumpState.phase === 'paid' || pumpState.phase === 'done'
                          ? COLORS.green
                          : COLORS.accent,
                        borderRadius: 1.5,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Price */}
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: isDone ? COLORS.green : COLORS.textDim,
                  flexShrink: 0,
                }}
              >
                {formatUsd(pump.priceUsd)}
              </div>

              {/* Status icon */}
              <div style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>
                {isDone && '✅'}
                {isActive && pumpState.phase !== 'waiting' && pumpState.phase !== 'done' && (
                  <span style={{ opacity: fadeIn(pumpLocalFrame, 10) }}>⏳</span>
                )}
                {isActive && pumpState.phase === 'done' && '✅'}
              </div>
            </div>
          );
        })}

        {/* Spending ticker */}
        <div
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontSize: 13,
            color: COLORS.textDim,
          }}
        >
          Spent {formatUsd(spent)} / {formatUsd(TOTAL_GAS_COST)} — Pump {activePumpIndex + 1}/{PUMPS.length}
        </div>
      </div>
    </div>
  );
};
