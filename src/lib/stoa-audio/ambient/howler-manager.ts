import { Howl } from 'howler';

import type { StanceType, StoaZone } from '$lib/types/stoa';
import { resolveAudioSrc } from '$lib/tauri/audio-resolver';

import { SOUND_MANIFEST } from './sound-manifest';

type LoopSoundKey = 'waves' | 'wind' | 'torchCrackle';

const LOOP_SOUND_KEYS: LoopSoundKey[] = ['waves'];

const ZONE_POSITIONS: Record<StoaZone, { wavesX: number; torchX: number }> = {
  colonnade: { wavesX: -0.3, torchX: 0.35 },
  'sea-terrace': { wavesX: -1.2, torchX: 0.15 },
  shrines: { wavesX: -0.2, torchX: 0.6 },
  library: { wavesX: -0.1, torchX: 0.45 },
  garden: { wavesX: -0.8, torchX: 0.25 },
  'world-map': { wavesX: -0.5, torchX: 0.1 }
};

export class HowlerManager {
  private loops: Partial<Record<LoopSoundKey, Howl>> = {};
  private birdsong: Howl[] = [];
  private birdsongTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private birdsongChance = 0.8;
  private ambientMultiplier = 1;

  async preload(): Promise<void> {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    await Promise.all([
      this.loadLoop('waves'),
      ...SOUND_MANIFEST.birdsong.src.map(async (src) => this.loadBirdsong(src))
    ]);

    this.startBirdsongTimer();
    this.initialized = true;
  }

  setZone(zone: StoaZone): void {
    const positions = ZONE_POSITIONS[zone];
    this.loops.waves?.pos(positions.wavesX, 0, -0.5);
    this.loops.torchCrackle?.pos(positions.torchX, 0, 0.2);
  }

  setTimeOfDay(hour: number): void {
    const clampedHour = Math.max(0, Math.min(24, hour));
    const isDaylight = clampedHour >= 6 && clampedHour <= 18;
    this.birdsongChance = isDaylight ? 0.85 : 0.25;
    this.applyLoopVolumes(900);
  }

  setStance(stance: StanceType): void {
    switch (stance) {
      case 'challenge':
        this.ambientMultiplier = 1.1;
        break;
      case 'sit_with':
        this.ambientMultiplier = 0.85;
        break;
      case 'teach':
      case 'guide':
      case 'hold':
      default:
        this.ambientMultiplier = 1;
        break;
    }

    this.applyLoopVolumes(1200);
  }

  fadeIn(duration = 3000): void {
    this.applyLoopVolumes(duration);
  }

  fadeOut(duration = 2000): void {
    for (const loopKey of LOOP_SOUND_KEYS) {
      const howl = this.loops[loopKey];
      if (!howl) {
        continue;
      }
      howl.fade(howl.volume(), 0, duration);
    }
  }

  destroy(): void {
    if (this.birdsongTimer) {
      clearInterval(this.birdsongTimer);
      this.birdsongTimer = null;
    }

    for (const loopKey of LOOP_SOUND_KEYS) {
      this.loops[loopKey]?.unload();
    }
    for (const bird of this.birdsong) {
      bird.unload();
    }

    this.loops = {};
    this.birdsong = [];
    this.initialized = false;
  }

  private async loadLoop(key: LoopSoundKey): Promise<void> {
    const config = SOUND_MANIFEST[key];
    const resolvedSrc = await resolveAudioSrc(config.src);
    const howl = new Howl({
      src: [resolvedSrc],
      loop: config.loop,
      volume: 0,
      preload: true,
      html5: false
    });

    if (config.spatial) {
      const spatialConfig = 'pannerAttr' in config ? config.pannerAttr : undefined;
      howl.pannerAttr(spatialConfig ?? { rolloffFactor: 1 });
    }

    await this.awaitLoad(howl);
    this.loops[key] = howl;
    howl.play();
  }

  private async loadBirdsong(src: string): Promise<void> {
    const resolvedSrc = await resolveAudioSrc(src);
    const bird = new Howl({
      src: [resolvedSrc],
      loop: false,
      volume: SOUND_MANIFEST.birdsong.volume,
      preload: true,
      html5: false
    });
    await this.awaitLoad(bird);
    this.birdsong.push(bird);
  }

  private awaitLoad(howl: Howl): Promise<void> {
    return new Promise((resolve) => {
      if (howl.state() === 'loaded') {
        resolve();
        return;
      }

      howl.once('load', () => resolve());
      howl.once('loaderror', () => resolve());
    });
  }

  private applyLoopVolumes(durationMs: number): void {
    for (const loopKey of LOOP_SOUND_KEYS) {
      const howl = this.loops[loopKey];
      if (!howl) {
        continue;
      }

      const baseVolume = SOUND_MANIFEST[loopKey].volume;
      const targetVolume = Math.max(0, Math.min(1, baseVolume * this.ambientMultiplier));

      if (!howl.playing()) {
        howl.play();
      }
      howl.fade(howl.volume(), targetVolume, durationMs);
    }
  }

  private startBirdsongTimer(): void {
    this.resetBirdsongTimer();
  }

  private resetBirdsongTimer(): void {
    if (this.birdsongTimer) {
      clearInterval(this.birdsongTimer);
      this.birdsongTimer = null;
    }

    const { min, max } = SOUND_MANIFEST.birdsong.randomInterval;
    const nextDelay = Math.floor(Math.random() * (max - min + 1)) + min;
    this.birdsongTimer = setInterval(() => {
      this.playRandomBirdsong();
      this.resetBirdsongTimer();
    }, nextDelay);
  }

  private playRandomBirdsong(): void {
    if (!this.initialized || this.birdsong.length === 0) {
      return;
    }

    if (Math.random() > this.birdsongChance) {
      return;
    }

    const bird = this.birdsong[Math.floor(Math.random() * this.birdsong.length)];
    if (!bird) {
      return;
    }

    bird.volume(Math.max(0, Math.min(1, SOUND_MANIFEST.birdsong.volume * this.ambientMultiplier)));
    bird.play();
  }
}
