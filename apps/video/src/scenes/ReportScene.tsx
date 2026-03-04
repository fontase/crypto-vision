/**
 * Scene 7: Intelligence Report — the agent's findings with real data.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import {
  MARKET_DATA, TOP_OPPORTUNITY, WHALE_ALERTS, SENTIMENT, DEFI_PROTOCOLS,
  COLORS,
} from '../data';
import { FULL_SCREEN, slideUp, fadeIn, formatUsd, formatLargeNumber, sparklinePath } from '../animations';

export const ReportScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div style={{ ...FULL_SCREEN, justifyContent: 'flex-start', paddingTop: 30, paddingBottom: 20 }}>
      <div style={{ width: 680 }}>
        {/* Header */}
        <div style={{ ...slideUp(frame, 0), textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text, letterSpacing: 2, textTransform: 'uppercase' }}>
            📊 Intelligence Report
          </div>
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Left column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Market Overview */}
            <div
              style={{
                ...slideUp(frame, 10),
                backgroundColor: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: '12px 16px',
              }}
            >
              <div style={{ fontSize: 12, color: COLORS.cyan, fontWeight: 600, marginBottom: 8, letterSpacing: 1 }}>
                MARKET OVERVIEW
              </div>
              {MARKET_DATA.slice(0, 4).map((coin, i) => {
                const isUp = coin.change24h >= 0;
                return (
                  <div
                    key={coin.symbol}
                    style={{
                      ...slideUp(frame, 15 + i * 5),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: COLORS.text, fontWeight: 600, width: 45 }}>{coin.symbol}</span>
                    <span style={{ color: COLORS.text, width: 90, textAlign: 'right' }}>
                      ${coin.price < 1 ? coin.price.toFixed(4) : coin.price.toLocaleString()}
                    </span>
                    {/* Mini sparkline */}
                    <svg width={50} height={16} style={{ marginLeft: 6, marginRight: 6 }}>
                      <path
                        d={sparklinePath(coin.sparkline.slice(-12), 50, 16)}
                        fill="none"
                        stroke={isUp ? COLORS.green : COLORS.red}
                        strokeWidth={1.5}
                      />
                    </svg>
                    <span style={{ color: isUp ? COLORS.green : COLORS.red, fontWeight: 600, width: 55, textAlign: 'right' }}>
                      {isUp ? '▲' : '▼'} {Math.abs(coin.change24h).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Whale Activity */}
            <div
              style={{
                ...slideUp(frame, 40),
                backgroundColor: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: '12px 16px',
              }}
            >
              <div style={{ fontSize: 12, color: COLORS.magenta, fontWeight: 600, marginBottom: 8, letterSpacing: 1 }}>
                🐋 WHALE ACTIVITY
              </div>
              {WHALE_ALERTS.map((alert, i) => (
                <div
                  key={i}
                  style={{
                    ...slideUp(frame, 45 + i * 6),
                    marginBottom: 6,
                    fontSize: 12,
                  }}
                >
                  <div style={{ color: COLORS.text, fontWeight: 500 }}>
                    {alert.type} — {alert.label}
                  </div>
                  <div style={{ color: COLORS.textDim, marginTop: 1 }}>
                    {formatLargeNumber(alert.valueUsd)} {alert.asset}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Top Opportunity */}
            <div
              style={{
                ...slideUp(frame, 20),
                backgroundColor: COLORS.bgCard,
                border: `1px solid ${COLORS.greenDim}`,
                borderRadius: 8,
                padding: '12px 16px',
              }}
            >
              <div style={{ fontSize: 12, color: COLORS.green, fontWeight: 600, marginBottom: 8, letterSpacing: 1 }}>
                🎯 TOP OPPORTUNITY
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: COLORS.text }}>
                  {TOP_OPPORTUNITY.asset}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#000',
                    backgroundColor: COLORS.green,
                    padding: '2px 8px',
                    borderRadius: 4,
                  }}
                >
                  {TOP_OPPORTUNITY.action}
                </span>
              </div>
              <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 4 }}>
                Confidence: <span style={{ fontWeight: 700, color: COLORS.green }}>{(TOP_OPPORTUNITY.confidence * 100).toFixed(0)}%</span>
              </div>
              <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 2 }}>
                Target: ${TOP_OPPORTUNITY.targetPrice.toLocaleString()} · Stop: ${TOP_OPPORTUNITY.stopLoss.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: COLORS.textDim }}>
                Timeframe: {TOP_OPPORTUNITY.timeframe}
              </div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6, fontStyle: 'italic' }}>
                {TOP_OPPORTUNITY.reasoning}
              </div>
            </div>

            {/* Sentiment */}
            <div
              style={{
                ...slideUp(frame, 55),
                backgroundColor: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: '12px 16px',
              }}
            >
              <div style={{ fontSize: 12, color: COLORS.blue, fontWeight: 600, marginBottom: 8, letterSpacing: 1 }}>
                📊 SENTIMENT
              </div>
              <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 4 }}>
                Overall: <span style={{ color: COLORS.green, fontWeight: 600 }}>
                  {SENTIMENT.overall.label}
                </span> ({(SENTIMENT.overall.score * 100).toFixed(0)}/100)
              </div>
              <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 4 }}>
                Fear/Greed: <span style={{ color: COLORS.yellow, fontWeight: 600 }}>
                  {SENTIMENT.fearGreed.value} — {SENTIMENT.fearGreed.label}
                </span>
              </div>
              <div style={{ fontSize: 12, color: COLORS.textDim }}>
                {SENTIMENT.sourcesAnalyzed.toLocaleString()} sources analyzed
              </div>
            </div>

            {/* DeFi Yields */}
            <div
              style={{
                ...slideUp(frame, 65),
                backgroundColor: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: '12px 16px',
              }}
            >
              <div style={{ fontSize: 12, color: COLORS.yellow, fontWeight: 600, marginBottom: 8, letterSpacing: 1 }}>
                🌾 BEST YIELDS
              </div>
              {DEFI_PROTOCOLS.slice(0, 3).map((p, i) => (
                <div
                  key={p.name}
                  style={{
                    ...slideUp(frame, 70 + i * 5),
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 3,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: COLORS.text }}>{p.name}</span>
                  <span style={{ color: COLORS.green, fontWeight: 600 }}>{p.topPool.apy}% APY</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
