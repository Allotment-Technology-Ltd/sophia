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
    margin-top: calc(-1 * var(--nav-height));
  }

  :global(.top-bar),
  :global(.site-footer),
  :global(.skip-link) {
    display: none !important;
  }

  :global(html),
  :global(body) {
    overflow: hidden;
    background: #1a1917;
  }
</style>
