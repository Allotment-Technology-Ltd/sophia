<script lang="ts">
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="stoa-layout">
  {@render children()}
</div>

<style>
  .stoa-layout {
    min-height: 100dvh;
  }

  :global(html:has(.stoa-layout)) {
    background: #1a1917;
  }
</style>
