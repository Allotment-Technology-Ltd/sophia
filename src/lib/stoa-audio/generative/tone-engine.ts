import * as Tone from 'tone';

import type { StanceType } from '$lib/types/stoa';

import {
  D_DORIAN,
  LYRE_SYNTH_CONFIG,
  REVERB_CONFIG,
  STANCE_MUSIC_PARAMS,
  type IntervalMode,
  type NoteDensity,
  type StanceMusicParams
} from './scales';

const SECONDS_PER_MS = 1000;

export class ToneEngine {
  private synth: Tone.Synth | null = null;
  private reverb: Tone.Reverb | null = null;
  private filter: Tone.Filter | null = null;
  private output: Tone.Gain | null = null;
  private loop: Tone.Loop | null = null;
  private initialized = false;
  private currentStance: StanceType = 'hold';
  private currentNoteIndex = Math.floor(D_DORIAN.length / 2);

  async init(): Promise<void> {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    this.output = new Tone.Gain(0);
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 1200, Q: 0.5 });
    this.reverb = new Tone.Reverb(REVERB_CONFIG);
    await this.reverb.ready;

    this.synth = new Tone.Synth(LYRE_SYNTH_CONFIG);
    this.synth.connect(this.filter);
    this.filter.connect(this.reverb);
    this.reverb.connect(this.output);
    this.output.toDestination();

    this.loop = new Tone.Loop((time) => {
      this.playPhrase(time);
    }, '2n');
    this.loop.start(0);

    const transport = Tone.getTransport();
    transport.bpm.value = STANCE_MUSIC_PARAMS.hold.tempo;
    transport.start();

    this.initialized = true;
  }

  setStance(stance: StanceType): void {
    if (!this.initialized) {
      return;
    }

    this.currentStance = stance;
    this.rampTo(STANCE_MUSIC_PARAMS[stance], 2);
  }

  setAtmosphere(hour: number): void {
    if (!this.initialized || !this.filter || !this.reverb) {
      return;
    }

    const clampedHour = Math.max(0, Math.min(24, hour));
    const nightDistance = Math.abs(clampedHour - 12) / 12;
    const targetFilterHz = 700 + (1 - nightDistance) * 1200;
    const targetWet = Math.min(0.95, REVERB_CONFIG.wet + nightDistance * 0.25);

    this.filter.frequency.rampTo(targetFilterHz, 2);
    this.reverb.wet.rampTo(targetWet, 2);
  }

  fadeIn(duration = 3000): void {
    if (!this.output) {
      return;
    }

    this.output.gain.rampTo(1, duration / SECONDS_PER_MS);
  }

  fadeOut(duration = 2000): void {
    if (!this.output) {
      return;
    }

    this.output.gain.rampTo(0, duration / SECONDS_PER_MS);
  }

  destroy(): void {
    this.loop?.stop();
    this.loop?.dispose();
    this.synth?.dispose();
    this.filter?.dispose();
    this.reverb?.dispose();
    this.output?.dispose();

    Tone.getTransport().stop();

    this.loop = null;
    this.synth = null;
    this.filter = null;
    this.reverb = null;
    this.output = null;
    this.initialized = false;
  }

  private rampTo(params: StanceMusicParams, transitionSeconds: number): void {
    if (!this.reverb) {
      return;
    }

    this.reverb.wet.rampTo(params.reverbWet, transitionSeconds);
    Tone.getTransport().bpm.rampTo(params.tempo, transitionSeconds);
  }

  private playPhrase(time: number): void {
    if (!this.synth) {
      return;
    }

    const params = STANCE_MUSIC_PARAMS[this.currentStance];
    if (params.noteDensity === 'silent') {
      return;
    }

    if (Math.random() > this.getDensityProbability(params.noteDensity)) {
      return;
    }

    const stepSeconds = Tone.Time('8n').toSeconds();
    for (let phraseIndex = 0; phraseIndex < params.phraseLength; phraseIndex += 1) {
      const nextNote = this.getNextNote(params.intervals);
      this.synth.triggerAttackRelease(nextNote, '8n', time + phraseIndex * stepSeconds);
    }
  }

  private getDensityProbability(density: NoteDensity): number {
    switch (density) {
      case 'sparse':
        return 0.2;
      case 'moderate':
        return 0.45;
      case 'regular':
        return 0.7;
      case 'drone':
        return 1;
      case 'silent':
      default:
        return 0;
    }
  }

  private getNextNote(intervalMode: IntervalMode): string {
    const maxIndex = D_DORIAN.length - 1;

    switch (intervalMode) {
      case 'consonant': {
        const offsets = [-3, 0, 3, 5];
        const nextIndex = this.clamp(this.currentNoteIndex + this.pick(offsets), 0, maxIndex);
        this.currentNoteIndex = nextIndex;
        break;
      }
      case 'tense': {
        const offsets = [-1, 1, 2, 6];
        const nextIndex = this.clamp(this.currentNoteIndex + this.pick(offsets), 0, maxIndex);
        this.currentNoteIndex = nextIndex;
        break;
      }
      case 'ascending': {
        const offsets = [1, 1, 2, 3];
        const nextIndex = this.clamp(this.currentNoteIndex + this.pick(offsets), 0, maxIndex);
        this.currentNoteIndex = nextIndex;
        break;
      }
      case 'stepwise': {
        const offsets = [-1, 1];
        const nextIndex = this.clamp(this.currentNoteIndex + this.pick(offsets), 0, maxIndex);
        this.currentNoteIndex = nextIndex;
        break;
      }
      case 'unison':
      default:
        break;
    }

    return D_DORIAN[this.currentNoteIndex] ?? 'D3';
  }

  private pick(options: number[]): number {
    return options[Math.floor(Math.random() * options.length)] ?? 0;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
