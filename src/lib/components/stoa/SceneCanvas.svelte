<script lang="ts">
  import { onDestroy, onMount, createEventDispatcher } from 'svelte';

  import { StoaScene } from '$lib/stoa-scene';
  import type { StoaZone, WorldMapNode, WorldMapResponse } from '$lib/types/stoa';

  interface Props {
    zone: StoaZone;
    unlockedThinkers?: string[];
    shrineIlluminateThinkerId?: string | null;
    worldMapData?: WorldMapResponse;
    selectedWorldMapNodeId?: string | null;
  }

  const dispatch = createEventDispatcher<{
    sceneReady: boolean;
    thinkerSelected: { thinkerId: string };
    worldMapNodeSelected: { node: WorldMapNode };
  }>();
  let {
    zone,
    unlockedThinkers = ['marcus'],
    shrineIlluminateThinkerId = null,
    worldMapData = { nodes: [], edges: [] },
    selectedWorldMapNodeId = null
  }: Props = $props();

  let containerElement: HTMLDivElement | null = null;
  let canvasElement: HTMLCanvasElement | null = null;
  let scene: StoaScene | null = null;
  let observer: ResizeObserver | null = null;
  let thinkerSelectedHandler: ((event: Event) => void) | null = null;
  let worldMapNodeSelectedHandler: ((event: Event) => void) | null = null;

  async function loadZone(nextZone: StoaZone): Promise<void> {
    if (!scene) return;
    await scene.loadZone(nextZone);
  }

  onMount(() => {
    if (!canvasElement || !containerElement) return;

    scene = new StoaScene(canvasElement);
    scene.setUnlockedThinkers(unlockedThinkers);
    scene.setWorldMapData(worldMapData);
    const { width, height } = containerElement.getBoundingClientRect();
    scene.resize(width, height);

    scene.start();
    void loadZone(zone);
    dispatch('sceneReady', true);

    observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (!size || !scene) return;
      scene.resize(size.width, size.height);
    });
    observer.observe(containerElement);

    thinkerSelectedHandler = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      const thinkerId = (event.detail as { thinkerId?: string } | undefined)?.thinkerId;
      if (!thinkerId) {
        return;
      }
      dispatch('thinkerSelected', { thinkerId });
    };
    scene.addEventListener('thinkerSelected', thinkerSelectedHandler);
    worldMapNodeSelectedHandler = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const node = (event.detail as { node?: WorldMapNode } | undefined)?.node;
      if (!node) return;
      dispatch('worldMapNodeSelected', { node });
    };
    scene.addEventListener('worldMapNodeSelected', worldMapNodeSelectedHandler);
  });

  $effect(() => {
    if (!scene) return;
    void scene.loadZone(zone);
  });

  $effect(() => {
    if (!scene) return;
    scene.setUnlockedThinkers(unlockedThinkers);
  });

  $effect(() => {
    if (!scene) return;
    scene.setWorldMapData(worldMapData);
    if (zone === 'world-map') {
      void scene.loadZone(zone);
    }
  });

  $effect(() => {
    if (!scene) return;
    scene.setWorldMapSelection(selectedWorldMapNodeId);
  });

  $effect(() => {
    if (!scene || !shrineIlluminateThinkerId) return;
    scene.illuminateShrine(shrineIlluminateThinkerId);
  });

  onDestroy(() => {
    observer?.disconnect();
    observer = null;
    if (scene && thinkerSelectedHandler) {
      scene.removeEventListener('thinkerSelected', thinkerSelectedHandler);
    }
    if (scene && worldMapNodeSelectedHandler) {
      scene.removeEventListener('worldMapNodeSelected', worldMapNodeSelectedHandler);
    }
    thinkerSelectedHandler = null;
    worldMapNodeSelectedHandler = null;
    scene?.destroy();
    scene = null;
  });
</script>

<div class="scene-canvas" bind:this={containerElement}>
  <canvas bind:this={canvasElement}></canvas>
</div>

<style>
  .scene-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
</style>
