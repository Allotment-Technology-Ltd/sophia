import { Howler } from 'howler';
import * as Tone from 'tone';

import type { StanceType, StoaZone } from '$lib/types/stoa';

import { HowlerManager } from './ambient/howler-manager';
import { ToneEngine } from './generative/tone-engine';
import { MoodReactor } from './systems/mood-reactor';

export class AudioEngine {
  private readonly howler: HowlerManager;
  private readonly tone: ToneEngine;
  private readonly reactor: MoodReactor;
  private initialized = false;

  constructor() {
    this.howler = new HowlerManager();
    this.tone = new ToneEngine();
    this.reactor = new MoodReactor(this.howler, this.tone);
  }

  async init(): Promise<void> {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    // Must be called from a user gesture to unlock mobile audio contexts.
    await Tone.start();
    Howler.autoUnlock = true;

    await this.howler.preload();
    await this.tone.init();

    this.reactor.setStance('hold');
    this.initialized = true;
  }

  setZone(zone: StoaZone): void {
    if (!this.initialized) {
      return;
    }
    this.howler.setZone(zone);
  }

  setStance(stance: StanceType): void {
    if (!this.initialized) {
      return;
    }
    this.reactor.setStance(stance);
  }

  setTimeOfDay(hour: number): void {
    if (!this.initialized) {
      return;
    }
    this.howler.setTimeOfDay(hour);
    this.tone.setAtmosphere(hour);
  }

  fadeIn(duration = 3000): void {
    if (!this.initialized) {
      return;
    }
    this.howler.fadeIn(duration);
    this.tone.fadeIn(duration);
  }

  fadeOut(duration = 2000): void {
    if (!this.initialized) {
      return;
    }
    this.howler.fadeOut(duration);
    this.tone.fadeOut(duration);
  }

  destroy(): void {
    this.howler.destroy();
    this.tone.destroy();
    this.initialized = false;
  }
}

let audioEngineSingleton: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!audioEngineSingleton) {
    audioEngineSingleton = new AudioEngine();
  }
  return audioEngineSingleton;
}
