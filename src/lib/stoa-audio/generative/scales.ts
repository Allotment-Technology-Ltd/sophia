import type { StanceType } from '$lib/types/stoa';

export const D_DORIAN = ['D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4'] as const;

export type NoteDensity = 'sparse' | 'moderate' | 'regular' | 'silent' | 'drone';
export type IntervalMode = 'consonant' | 'tense' | 'ascending' | 'stepwise' | 'unison';

export interface StanceMusicParams {
  noteDensity: NoteDensity;
  intervals: IntervalMode;
  tempo: number;
  reverbWet: number;
  phraseLength: number;
}

export type StanceMusicKey = StanceType | 'escalating';

export const STANCE_MUSIC_PARAMS = {
  hold: {
    noteDensity: 'sparse',
    intervals: 'consonant',
    tempo: 40,
    reverbWet: 0.8,
    phraseLength: 2
  },
  challenge: {
    noteDensity: 'moderate',
    intervals: 'tense',
    tempo: 72,
    reverbWet: 0.5,
    phraseLength: 4
  },
  guide: {
    noteDensity: 'moderate',
    intervals: 'ascending',
    tempo: 60,
    reverbWet: 0.6,
    phraseLength: 3
  },
  teach: {
    noteDensity: 'regular',
    intervals: 'stepwise',
    tempo: 66,
    reverbWet: 0.55,
    phraseLength: 4
  },
  sit_with: {
    noteDensity: 'silent',
    intervals: 'consonant',
    tempo: 30,
    reverbWet: 0.9,
    phraseLength: 1
  },
  escalating: {
    noteDensity: 'drone',
    intervals: 'unison',
    tempo: 20,
    reverbWet: 0.95,
    phraseLength: 1
  }
} as const satisfies Record<StanceMusicKey, StanceMusicParams>;

export const LYRE_SYNTH_CONFIG = {
  oscillator: { type: 'triangle' as const },
  envelope: { attack: 0.001, decay: 0.9, sustain: 0.0, release: 1.4 }
} as const;

export const REVERB_CONFIG = { decay: 3.5, wet: 0.6 } as const;
