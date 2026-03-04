/**
 * GasStationVideo — the main composition that sequences all scenes.
 */
import React from 'react';
import { Series } from 'remotion';
import { SCENE_DURATIONS } from './data';

import { IntroScene } from './scenes/IntroScene';
import { WalletScene } from './scenes/WalletScene';
import { MissionScene } from './scenes/MissionScene';
import { RoutePlanScene } from './scenes/RoutePlanScene';
import { GasStationScene } from './scenes/GasStationScene';
import { AnalysisScene } from './scenes/AnalysisScene';
import { ReportScene } from './scenes/ReportScene';
import { ReceiptScene } from './scenes/ReceiptScene';
import { ClosingScene } from './scenes/ClosingScene';

export const GasStationVideo: React.FC = () => {
  return (
    <Series>
      <Series.Sequence durationInFrames={SCENE_DURATIONS.intro}>
        <IntroScene />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DURATIONS.wallet}>
        <WalletScene />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DURATIONS.mission}>
        <MissionScene />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DURATIONS.routePlan}>
        <RoutePlanScene />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DURATIONS.gasStation}>
        <GasStationScene />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DURATIONS.analysis}>
        <AnalysisScene />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DURATIONS.report}>
        <ReportScene />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DURATIONS.receipt}>
        <ReceiptScene />
      </Series.Sequence>

      <Series.Sequence durationInFrames={SCENE_DURATIONS.closing}>
        <ClosingScene />
      </Series.Sequence>
    </Series>
  );
};
