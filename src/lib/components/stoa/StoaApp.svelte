<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { getAudioEngine } from '$lib/stoa-audio';
  import type { StanceType, StoaProgressState, StoaZone, ThinkerProfile } from '$lib/types/stoa';
  import { stoaSessionStore } from '$lib/stores/stoa-session.svelte';
  import { STOA_THINKER_MAP } from '$lib/stoa/thinkers';

  import AudioControls from './AudioControls.svelte';
  import DialogueOverlay from './DialogueOverlay.svelte';
  import ProgressHUD from './ProgressHUD.svelte';
  import QuestJournal from './QuestJournal.svelte';
  import SceneCanvas from './SceneCanvas.svelte';
  import StanceIndicator from './StanceIndicator.svelte';
  import ThinkerUnlockNotification from './ThinkerUnlockNotification.svelte';

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
  let journalOpen = $state(false);
  let progress = $state<StoaProgressState | null>(null);

  // Notification queue state
  let notificationQueue = $state<ThinkerProfile[]>([]);
  let currentNotification = $state<ThinkerProfile | null>(null);
  let isShowingNotification = $state(false);

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

  function toggleJournal(): void {
    journalOpen = !journalOpen;
  }

  function closeJournal(): void {
    journalOpen = false;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'j' || event.key === 'J') {
      // Only toggle if not typing in an input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      event.preventDefault();
      toggleJournal();
    }
  }

  function handleProgressUpdate(event: CustomEvent<StoaProgressState>): void {
    progress = event.detail;
  }

  function handleDialogueProgressUpdate(
    event: CustomEvent<{ xpGained: number; newUnlocks: string[]; questsCompleted: string[] }>
  ): void {
    const { newUnlocks } = event.detail;

    // Add newly unlocked thinkers to the notification queue
    for (const thinkerId of newUnlocks) {
      const thinker = STOA_THINKER_MAP.get(thinkerId);
      if (thinker) {
        // Create a copy with isUnlocked set to true for the notification
        notificationQueue = [...notificationQueue, { ...thinker, isUnlocked: true }];
      }
    }

    // Refresh progress to get updated unlocks
    void loadProgress();
  }

  function processNotificationQueue(): void {
    if (isShowingNotification || notificationQueue.length === 0) {
      return;
    }

    const [next, ...rest] = notificationQueue;
    currentNotification = next;
    isShowingNotification = true;
    notificationQueue = rest;
  }

  function handleNotificationComplete(): void {
    isShowingNotification = false;
    currentNotification = null;

    // Process next notification after a short delay
    if (notificationQueue.length > 0) {
      setTimeout(() => processNotificationQueue(), 500);
    }
  }

  // Watch for new notifications in the queue
  $effect(() => {
    if (!isShowingNotification && notificationQueue.length > 0) {
      processNotificationQueue();
    }
  });

  async function loadProgress(): Promise<void> {
    try {
      const response = await fetch('/api/stoa/progress');
      if (!response.ok) {
        console.warn('[StoaApp] Failed to load progress:', response.status);
        return;
      }
      progress = await response.json() as StoaProgressState;
    } catch (error) {
      console.warn('[StoaApp] Error loading progress:', error instanceof Error ? error.message : String(error));
    }
  }

  onMount(() => {
    stoaSessionStore.hydrate();
    if (sessionId && sessionId !== stoaSessionStore.sessionId) {
      stoaSessionStore.setSessionId(sessionId);
    }
    stoaSessionStore.setZone(currentZone);
    stoaSessionStore.setStance(currentStance);

    // Load progress on mount
    void loadProgress();
  });

  $effect(() => {
    stoaSessionStore.setZone(currentZone);
    if (audioReady) audioEngine.setZone(currentZone);
  });

  onDestroy(() => {
    audioEngine.fadeOut(1200);
  });
</script>

<svelte:window onpointerdown={initializeAudio} onkeydown={handleKeydown} />

<div class="stoa-app" data-user={userId}>
  <SceneCanvas zone={currentZone} on:sceneReady={handleSceneReady} />
  <DialogueOverlay
    stance={currentStance}
    sessionId={stoaSessionStore.sessionId}
    on:stanceChange={handleStanceChange}
    on:progressUpdate={handleProgressUpdate}
    on:dialogueProgressUpdate={handleDialogueProgressUpdate}
  />
  <StanceIndicator stance={currentStance} />
  <AudioControls {audioReady} />
  <ProgressHUD {progress} onClick={toggleJournal} />
  <QuestJournal open={journalOpen} {userId} onclose={closeJournal} />
  <ThinkerUnlockNotification
    thinker={currentNotification}
    onComplete={handleNotificationComplete}
  />

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
