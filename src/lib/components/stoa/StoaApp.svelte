<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { getAudioEngine } from '$lib/stoa-audio';
  import type { StanceType, StoaZone } from '$lib/types/stoa';
  import { stoaSessionStore } from '$lib/stores/stoa-session.svelte';

  import AudioControls from './AudioControls.svelte';
  import DialogueOverlay from './DialogueOverlay.svelte';
  import SceneCanvas from './SceneCanvas.svelte';
  import StanceIndicator from './StanceIndicator.svelte';

  interface Props {
    userId: string;
    sessionId: string;
  }

  let { userId, sessionId }: Props = $props();

  const audioEngine = getAudioEngine();

  let currentZone = $state<StoaZone>('colonnade');
  let currentStance = $state<StanceType>('hold');
  let audioReady = $state(false);
  let sceneReady = $state(false);
  let hasInitializedAudio = $state(false);

  async function initializeAudio(): Promise<void> {
    if (hasInitializedAudio) return;
    hasInitializedAudio = true;
    await audioEngine.init();
    audioEngine.setZone(currentZone);
    audioEngine.setStance(currentStance);
    audioEngine.fadeIn(2400);
    audioReady = true;
    stoaSessionStore.setAudioInitialized(true);
  }

  function handleSceneReady(): void {
    sceneReady = true;
    stoaSessionStore.setSceneReady(true);
  }

  function handleStanceChange(event: CustomEvent<{ stance: StanceType }>): void {
    currentStance = event.detail.stance;
    stoaSessionStore.setStance(currentStance);
    audioEngine.setStance(currentStance);
  }

  onMount(() => {
    stoaSessionStore.hydrate();
    if (sessionId && sessionId !== stoaSessionStore.sessionId) {
      stoaSessionStore.setSessionId(sessionId);
    }
    stoaSessionStore.setZone(currentZone);
    stoaSessionStore.setStance(currentStance);
  });

  $effect(() => {
    stoaSessionStore.setZone(currentZone);
    if (audioReady) audioEngine.setZone(currentZone);
  });

  onDestroy(() => {
    audioEngine.fadeOut(1200);
  });
</script>

<svelte:window onpointerdown={initializeAudio} />

<div class="stoa-app" data-user={userId}>
  <SceneCanvas zone={currentZone} on:sceneReady={handleSceneReady} />
  <DialogueOverlay stance={currentStance} sessionId={stoaSessionStore.sessionId} on:stanceChange={handleStanceChange} />
  <StanceIndicator stance={currentStance} />
  <AudioControls {audioReady} />

  {#if !audioReady}
    <div class="audio-hint">Tap anywhere to begin soundscape</div>
  {/if}
  {#if !sceneReady}
    <div class="scene-status">Entering the academy...</div>
  {/if}
</div>

<style>
  .stoa-app {
    position: relative;
    width: 100%;
    min-height: 100dvh;
    background: #1a1917;
    overflow: hidden;
  }

  .audio-hint,
  .scene-status {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    border: 1px solid rgba(190, 162, 118, 0.3);
    border-radius: 999px;
    background: rgba(26, 25, 23, 0.82);
    color: rgba(239, 229, 208, 0.84);
    font-family: var(--font-ui);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 8px 16px;
    z-index: 19;
  }

  .audio-hint {
    top: 24px;
  }

  .scene-status {
    bottom: 32px;
  }
</style>
