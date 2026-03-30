<script lang="ts">
  import { onDestroy, onMount, createEventDispatcher } from 'svelte';

  import { StoaScene } from '$lib/stoa-scene';
  import type { StoaZone } from '$lib/types/stoa';

  interface Props {
    zone: StoaZone;
  }

  const dispatch = createEventDispatcher<{ sceneReady: boolean }>();
  let { zone }: Props = $props();

  let containerElement: HTMLDivElement | null = null;
  let canvasElement: HTMLCanvasElement | null = null;
  let scene: StoaScene | null = null;
  let observer: ResizeObserver | null = null;

  async function loadZone(nextZone: StoaZone): Promise<void> {
    if (!scene) return;
    await scene.loadZone(nextZone);
  }

  onMount(() => {
    if (!canvasElement || !containerElement) return;

    scene = new StoaScene(canvasElement);
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
  });

  $effect(() => {
    if (!scene) return;
    void scene.loadZone(zone);
  });

  onDestroy(() => {
    observer?.disconnect();
    observer = null;
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
