export interface SpatialConfig {
  rolloffFactor: number;
}

export interface AmbientLoopConfig {
  src: string;
  loop: true;
  volume: number;
  spatial: boolean;
  pannerAttr?: SpatialConfig;
}

export interface BirdsongConfig {
  src: string[];
  loop: false;
  volume: number;
  randomInterval: {
    min: number;
    max: number;
  };
}

export const SOUND_MANIFEST = {
  waves: {
    src: '/audio/ambient/aegean-waves-loop.mp3',
    loop: true,
    volume: 0.4,
    spatial: true,
    pannerAttr: { rolloffFactor: 0.5 }
  },
  birdsong: {
    src: [
      '/audio/ambient/swift-call-01.mp3',
      '/audio/ambient/swift-call-02.mp3',
      '/audio/ambient/swallow-loop.mp3'
    ],
    loop: false,
    volume: 0.25,
    randomInterval: { min: 8000, max: 25000 }
  },
  wind: {
    src: '/audio/ambient/column-wind-loop.mp3',
    loop: true,
    volume: 0.15,
    spatial: false
  },
  torchCrackle: {
    src: '/audio/ambient/torch-crackle-loop.mp3',
    loop: true,
    volume: 0.1,
    spatial: true
  }
} as const;

export type SoundManifest = typeof SOUND_MANIFEST;
