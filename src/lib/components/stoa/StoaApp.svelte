<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { getAudioEngine } from '$lib/stoa-audio';
  import type {
    ThinkerProfile,
    StanceType,
    StoaProgressState,
    StoaZone,
    WorldMapNode,
    WorldMapResponse
  } from '$lib/types/stoa';
  import { stoaSessionStore } from '$lib/stores/stoa-session.svelte';

  import AudioControls from './AudioControls.svelte';
  import DialogueOverlay from './DialogueOverlay.svelte';
  import ProgressHUD from './ProgressHUD.svelte';
  import QuestJournal from './QuestJournal.svelte';
  import SceneCanvas from './SceneCanvas.svelte';
  import StanceIndicator from './StanceIndicator.svelte';
  import ThinkerUnlockNotification from './ThinkerUnlockNotification.svelte';
  import WorldMapOverlay from './WorldMapOverlay.svelte';

  interface Props {
    userId: string;
    sessionId: string;
  }

  let { userId, sessionId }: Props = $props();

  const audioEngine = getAudioEngine();

  let currentZone = $state<StoaZone>('colonnade');
  let currentStance = $state<StanceType>('hold');
  let unlockedThinkers = $state<string[]>(['marcus']);
  let audioReady = $state(false);
  let sceneReady = $state(false);
  let hasInitializedAudio = $state(false);
  let questJournalOpen = $state(false);
  let worldMapOpen = $state(false);
  let zoneBeforeWorldMap = $state<StoaZone>('colonnade');
  let worldMapData = $state<WorldMapResponse>({ nodes: [], edges: [] });
  let selectedWorldMapNodeId = $state<string | null>(null);
  let unlockNotificationQueue = $state<ThinkerProfile[]>([]);
  let activeUnlockNotification = $state<ThinkerProfile | null>(null);
  let shrineIlluminateThinkerId = $state<string | null>(null);
  let progress = $state<StoaProgressState>({
    xp: 0,
    level: 1,
    unlockedThinkers: ['marcus'],
    masteredFrameworks: [],
    activeQuestIds: [],
    completedQuestIds: []
  });

  const THINKER_PROFILES: Record<string, ThinkerProfile> = {
    marcus: {
      id: 'marcus',
      name: 'Marcus Aurelius',
      dates: '121-180 CE',
      zone: 'colonnade',
      isUnlocked: true,
      spritePath: '/stoa/thinkers/marcus.png',
      voiceSignature: 'reflective-imperial'
    },
    epictetus: {
      id: 'epictetus',
      name: 'Epictetus',
      dates: '50-135 CE',
      zone: 'shrines',
      isUnlocked: true,
      spritePath: '/stoa/thinkers/epictetus.png',
      voiceSignature: 'direct-discipline'
    },
    seneca: {
      id: 'seneca',
      name: 'Seneca',
      dates: '4 BCE-65 CE',
      zone: 'shrines',
      isUnlocked: true,
      spritePath: '/stoa/thinkers/seneca.png',
      voiceSignature: 'measured-rhetorical'
    },
    chrysippus: {
      id: 'chrysippus',
      name: 'Chrysippus',
      dates: '279-206 BCE',
      zone: 'library',
      isUnlocked: true,
      spritePath: '/stoa/thinkers/chrysippus.png',
      voiceSignature: 'logical-analytic'
    },
    zeno: {
      id: 'zeno',
      name: 'Zeno of Citium',
      dates: '334-262 BCE',
      zone: 'shrines',
      isUnlocked: true,
      spritePath: '/stoa/thinkers/zeno.png',
      voiceSignature: 'foundational-calm'
    }
  };

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

  function handleThinkerSelected(event: CustomEvent<{ thinkerId: string }>): void {
    const thinkerId = event.detail.thinkerId;
    if (!thinkerId) {
      return;
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<{ thinkerId: string }>('stoa:thinker-selected', {
          detail: { thinkerId }
        })
      );
    }
  }

  function handleWorldMapNodeSelected(event: CustomEvent<{ node: WorldMapNode }>): void {
    selectedWorldMapNodeId = event.detail.node.id;
  }

  async function refreshWorldMap(): Promise<void> {
    try {
      const response = await fetch('/api/stoa/world-map');
      if (!response.ok) return;
      const payload = (await response.json()) as WorldMapResponse;
      worldMapData = {
        nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
        edges: Array.isArray(payload.edges) ? payload.edges : []
      };
      if (selectedWorldMapNodeId) {
        const stillExists = worldMapData.nodes.some((node) => node.id === selectedWorldMapNodeId);
        if (!stillExists) {
          selectedWorldMapNodeId = null;
        }
      }
    } catch {
      // Keep map optional when API is unavailable.
    }
  }

  async function refreshProgress(): Promise<void> {
    try {
      const response = await fetch('/api/stoa/progress');
      if (!response.ok) {
        return;
      }
      const next = (await response.json()) as StoaProgressState;
      progress = next;
      unlockedThinkers = next.unlockedThinkers.length > 0 ? next.unlockedThinkers : ['marcus'];
    } catch {
      // Avoid interrupting scene/dialogue experience when progress fetch fails.
    }
  }

  function enqueueUnlockNotifications(thinkerIds: string[]): void {
    const incomingProfiles = thinkerIds
      .map((id) => THINKER_PROFILES[id])
      .filter((profile): profile is ThinkerProfile => Boolean(profile));
    if (incomingProfiles.length === 0) {
      return;
    }

    unlockNotificationQueue = [...unlockNotificationQueue, ...incomingProfiles];
    if (!activeUnlockNotification) {
      showNextUnlockNotification();
    }
  }

  function showNextUnlockNotification(): void {
    if (activeUnlockNotification || unlockNotificationQueue.length === 0) {
      return;
    }
    const [next, ...rest] = unlockNotificationQueue;
    unlockNotificationQueue = rest;
    activeUnlockNotification = next;
    shrineIlluminateThinkerId = next.id;
  }

  function handleUnlockNotificationDismissed(): void {
    activeUnlockNotification = null;
    shrineIlluminateThinkerId = null;
    showNextUnlockNotification();
  }

  function handleProgressUpdate(event: Event): void {
    if (event instanceof CustomEvent) {
      const detail = (event.detail ?? {}) as { newUnlocks?: string[] };
      if (Array.isArray(detail.newUnlocks) && detail.newUnlocks.length > 0) {
        enqueueUnlockNotifications(detail.newUnlocks);
      }
    }
    void refreshProgress();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    const isTypingTarget =
      event.target instanceof HTMLElement &&
      (event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.isContentEditable);
    if (isTypingTarget) return;
    if (event.key.toLowerCase() === 'j') {
      event.preventDefault();
      questJournalOpen = !questJournalOpen;
      return;
    }
    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      void toggleWorldMap();
    }
  }

  async function toggleWorldMap(): Promise<void> {
    if (!worldMapOpen) {
      zoneBeforeWorldMap = currentZone;
      await refreshWorldMap();
      currentZone = 'world-map';
      worldMapOpen = true;
      if (!selectedWorldMapNodeId) {
        selectedWorldMapNodeId =
          worldMapData.nodes.find((node) => node.isCurrentPosition)?.id ??
          worldMapData.nodes[0]?.id ??
          null;
      }
      return;
    }
    closeWorldMap();
  }

  function closeWorldMap(): void {
    worldMapOpen = false;
    currentZone = zoneBeforeWorldMap;
  }

  function handleExploreWithStoa(event: CustomEvent<{ topic: string; nodeId: string }>): void {
    selectedWorldMapNodeId = event.detail.nodeId;
    closeWorldMap();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('stoa:seed-dialogue-topic', {
          detail: { topic: event.detail.topic }
        })
      );
    }
  }

  function openQuestJournal(): void {
    questJournalOpen = true;
  }

  onMount(() => {
    stoaSessionStore.hydrate();
    if (sessionId && sessionId !== stoaSessionStore.sessionId) {
      stoaSessionStore.setSessionId(sessionId);
    }
    stoaSessionStore.setZone(currentZone);
    stoaSessionStore.setStance(currentStance);
    void refreshProgress();

    if (typeof window !== 'undefined') {
      window.addEventListener('stoa:progress-update', handleProgressUpdate);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('stoa:progress-update', handleProgressUpdate);
      }
    };
  });

  $effect(() => {
    stoaSessionStore.setZone(currentZone);
    if (audioReady) audioEngine.setZone(currentZone);
  });

  onDestroy(() => {
    audioEngine.fadeOut(1200);
  });
</script>

<svelte:window onpointerdown={initializeAudio} onkeydown={handleWindowKeydown} />

<div class="stoa-app" data-user={userId}>
  <SceneCanvas
    zone={currentZone}
    {unlockedThinkers}
    {shrineIlluminateThinkerId}
    {worldMapData}
    {selectedWorldMapNodeId}
    on:sceneReady={handleSceneReady}
    on:thinkerSelected={handleThinkerSelected}
    on:worldMapNodeSelected={handleWorldMapNodeSelected}
  />
  <DialogueOverlay stance={currentStance} sessionId={stoaSessionStore.sessionId} on:stanceChange={handleStanceChange} />
  <StanceIndicator stance={currentStance} />
  <ProgressHUD {progress} on:openJournal={openQuestJournal} />
  <QuestJournal bind:open={questJournalOpen} {userId} />
  <AudioControls {audioReady} />
  <ThinkerUnlockNotification thinker={activeUnlockNotification} on:dismissed={handleUnlockNotificationDismissed} />
  <WorldMapOverlay
    open={worldMapOpen}
    data={worldMapData}
    selectedNodeId={selectedWorldMapNodeId}
    on:close={closeWorldMap}
    on:explore={handleExploreWithStoa}
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
