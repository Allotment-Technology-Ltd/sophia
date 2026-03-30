<script lang="ts">
  import StoaApp from '$lib/components/stoa/StoaApp.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>STOA Immersive | SOPHIA</title>
</svelte:head>

<main class="stoa-page">
  <StoaApp userId={data.userId} sessionId={data.sessionId} />
</main>

<style>
  .stoa-page {
    width: 100vw;
    min-height: 100dvh;
    background: #1a1917;
    overflow: hidden;
  }
</style>

