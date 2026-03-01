<script lang="ts">
  import '../app.css';
  import TopBar from '$lib/components/shell/TopBar.svelte';
  import { conversation } from '$lib/stores/conversation.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { panelStore } from '$lib/stores/panel.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  // Context query: the most recent user message (shown centred in TopBar on results/loading screens)
  let contextQuery = $derived(
    conversation.messages.findLast(m => m.role === 'user')?.content ?? undefined
  );

  // Streaming pass label (shown right of context query during analysis)
  let streamingPass = $derived(
    conversation.isLoading && conversation.currentPass
      ? `Pass ${['analysis', 'critique', 'synthesis'].indexOf(conversation.currentPass) + 1} of 3`
      : undefined
  );

  let menuDotVisible = $derived(referencesStore.isLive);
</script>

<svelte:head>
  <title>SOPHIA — Philosophical Reasoning Engine</title>
  <meta name="description" content="Apply structured philosophical reasoning to any question, dilemma, or argument" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<TopBar
  {contextQuery}
  {streamingPass}
  {menuDotVisible}
  panelOpen={panelStore.open}
  onMenuToggle={() => panelStore.toggle()}
  onNew={() => conversation.clear()}
/>

<div id="main" style="padding-top: var(--nav-height);">
  {@render children()}
</div>
