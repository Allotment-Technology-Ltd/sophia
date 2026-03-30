<script lang="ts">
  import { Howler } from 'howler';

  interface Props {
    audioReady: boolean;
  }

  let { audioReady }: Props = $props();

  let muted = $state(false);
  let volume = $state(0.7);

  function toggleMute(): void {
    muted = !muted;
    Howler.mute(muted);
  }

  function handleVolumeInput(event: Event): void {
    const next = Number((event.currentTarget as HTMLInputElement).value);
    volume = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : volume;
    Howler.volume(volume);
  }
</script>

<div class="audio-controls">
  <button type="button" class="audio-btn" onclick={toggleMute} disabled={!audioReady}>
    {muted ? 'Unmute' : 'Mute'}
  </button>
  <label class="volume">
    <span>Vol</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={volume}
      oninput={handleVolumeInput}
      disabled={!audioReady}
      aria-label="Audio volume"
    />
  </label>
</div>

<style>
  .audio-controls {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid rgba(196, 164, 112, 0.28);
    background: rgba(26, 25, 23, 0.58);
    backdrop-filter: blur(6px);
    font-family: var(--font-ui);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: rgba(224, 216, 200, 0.82);
  }

  .audio-btn {
    min-height: 32px;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid rgba(214, 194, 164, 0.32);
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
  }

  .audio-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .volume {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .volume input {
    width: 90px;
    accent-color: #b7784d;
  }
</style>
