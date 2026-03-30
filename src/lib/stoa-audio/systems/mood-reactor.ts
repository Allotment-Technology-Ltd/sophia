import type { StanceType } from '$lib/types/stoa';

import type { HowlerManager } from '../ambient/howler-manager';
import type { ToneEngine } from '../generative/tone-engine';

export class MoodReactor {
  private previousStance: StanceType = 'hold';

  constructor(
    private readonly howler: HowlerManager,
    private readonly tone: ToneEngine
  ) {}

  setStance(stance: StanceType): void {
    if (this.previousStance !== stance) {
      console.debug(`[StoaAudio] stance transition ${this.previousStance} -> ${stance}`);
      this.previousStance = stance;
    }

    this.howler.setStance(stance);
    this.tone.setStance(stance);
  }
}
