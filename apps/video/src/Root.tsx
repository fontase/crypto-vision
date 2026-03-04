/**
 * GasStation Remotion Composition
 *
 * Sequences all scenes together with proper timing.
 */
import React from 'react';
import { Composition } from 'remotion';
import { GasStationVideo } from './GasStationVideo';
import { FPS, TOTAL_FRAMES } from './data';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="GasStation"
        component={GasStationVideo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
      {/* Landscape variant for desktop / YouTube */}
      <Composition
        id="GasStationLandscape"
        component={GasStationVideo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
    </>
  );
};
