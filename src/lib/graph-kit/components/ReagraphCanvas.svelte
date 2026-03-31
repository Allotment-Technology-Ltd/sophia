<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy, onMount } from 'svelte';
  import { createElement } from 'react';
  import { createRoot } from 'react-dom/client';
  import ReagraphCanvasReact, { type ReagraphCanvasProps } from './ReagraphCanvasReact';

  let props: ReagraphCanvasProps = $props();
  let containerEl = $state<HTMLDivElement | null>(null);
  let root = $state<ReturnType<typeof createRoot> | null>(null);

  function renderRoot(): void {
    if (!root) return;
    root.render(createElement(ReagraphCanvasReact, props));
  }

  onMount(() => {
    if (!browser || !containerEl) return;
    root = createRoot(containerEl);
    renderRoot();
  });

  onDestroy(() => {
    if (!root) return;
    root.unmount();
    root = null;
  });

  $effect(() => {
    if (!root) return;
    renderRoot();
  });
</script>

<div class="reagraph-mount" bind:this={containerEl}></div>

<style>
  .reagraph-mount {
    width: 100%;
    height: 100%;
  }
</style>
