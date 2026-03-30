const AUDIO_PREF_KEY = 'sophia-landing-audio-enabled';

export interface LandingAudioApi {
  unlockAndEnable: () => Promise<void>;
  disable: () => void;
  setChapter: (chapter: number) => void;
  setDepth: (depth: number) => void;
  isEnabled: () => boolean;
  destroy: () => void;
}

function canUseAudioContext(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';
}

export function createLandingAudio(opts: { reducedMotion: boolean }): LandingAudioApi {
  const { reducedMotion } = opts;

  let enabled = false;
  let disposed = false;
  let chapterLevel = 0;
  let depthLevel = 0;
  let media: HTMLAudioElement | null = null;
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let chapterGain: GainNode | null = null;
  let oscA: OscillatorNode | null = null;
  let oscB: OscillatorNode | null = null;
  let noiseSource: AudioBufferSourceNode | null = null;
  let noiseGain: GainNode | null = null;

  const storedPref = typeof localStorage !== 'undefined'
    ? localStorage.getItem(AUDIO_PREF_KEY)
    : null;
  if (!reducedMotion && storedPref === '1') {
    enabled = true;
  }

  function persistPref(value: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AUDIO_PREF_KEY, value ? '1' : '0');
  }

  function ensureGraph(): void {
    if (ctx || !canUseAudioContext()) return;
    ctx = new window.AudioContext();

    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);

    chapterGain = ctx.createGain();
    chapterGain.gain.value = 0.4;
    chapterGain.connect(gain);

    oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = 72;

    oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 108;

    const oscAGain = ctx.createGain();
    oscAGain.gain.value = 0.22;
    const oscBGain = ctx.createGain();
    oscBGain.gain.value = 0.12;

    oscA.connect(oscAGain).connect(chapterGain);
    oscB.connect(oscBGain).connect(chapterGain);

    // Soft filtered noise for cave air movement.
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.2;
    }
    noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 380;

    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.06;

    noiseSource.connect(noiseFilter).connect(noiseGain).connect(chapterGain);
    oscA.start();
    oscB.start();
    noiseSource.start();
  }

  function ensureMedia(): void {
    if (media || typeof Audio === 'undefined') return;
    media = new Audio('/audio/cave-room-tone.wav');
    media.loop = true;
    media.preload = 'auto';
    media.crossOrigin = 'anonymous';
    media.volume = 0;
  }

  function updateMediaVolume(): void {
    if (!media) return;
    const target = enabled ? Math.max(0, Math.min(0.28, 0.08 + (chapterLevel * 0.1) + (depthLevel * 0.1))) : 0;
    media.volume = target;
  }

  async function unlockAndEnable(): Promise<void> {
    if (disposed || reducedMotion) return;
    ensureMedia();
    if (canUseAudioContext()) {
      ensureGraph();
    }
    if (ctx && gain) {
      if (ctx.state !== 'running') {
        await ctx.resume();
      }
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.8);
    }
    if (media) {
      try {
        await media.play();
      } catch {
        // Fallback remains the synth graph if media playback fails.
      }
    }
    enabled = true;
    persistPref(true);
    updateMediaVolume();
  }

  function disable(): void {
    if (!ctx || !gain) {
      enabled = false;
      persistPref(false);
      return;
    }
    enabled = false;
    persistPref(false);
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.linearRampToValueAtTime(0.0, now + 0.4);
    if (media) media.volume = 0;
  }

  function setChapter(chapter: number): void {
    if (!ctx || !chapterGain || !oscA || !oscB) return;
    const c = Math.max(0, Math.min(1, chapter));
    const now = ctx.currentTime;
    oscA.frequency.cancelScheduledValues(now);
    oscB.frequency.cancelScheduledValues(now);
    chapterGain.gain.cancelScheduledValues(now);
    oscA.frequency.linearRampToValueAtTime(72 + (c * 14), now + 0.7);
    oscB.frequency.linearRampToValueAtTime(108 + (c * 22), now + 0.7);
    chapterGain.gain.linearRampToValueAtTime(0.36 + (c * 0.17), now + 0.7);
    chapterLevel = c;
    updateMediaVolume();
  }

  function setDepth(depth: number): void {
    if (!ctx || !noiseGain) return;
    const d = Math.max(0, Math.min(1, depth));
    const now = ctx.currentTime;
    noiseGain.gain.cancelScheduledValues(now);
    noiseGain.gain.linearRampToValueAtTime(0.04 + (d * 0.08), now + 0.25);
    depthLevel = d;
    updateMediaVolume();
  }

  function destroy(): void {
    if (disposed) return;
    disposed = true;
    if (noiseSource) {
      try {
        noiseSource.stop();
      } catch {
        // no-op
      }
    }
    oscA?.stop();
    oscB?.stop();
    if (media) {
      media.pause();
      media.src = '';
      media = null;
    }
    ctx?.close();
    ctx = null;
  }

  return {
    unlockAndEnable,
    disable,
    setChapter,
    setDepth,
    isEnabled: () => enabled,
    destroy
  };
}
