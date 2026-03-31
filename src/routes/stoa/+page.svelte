<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/authClient';
  import StoaApp from '$lib/components/stoa/StoaApp.svelte';

  let { data } = $props();
  let accessResolved = $state(false);
  let accessAllowed = $state(false);

  async function resolveOwnerAccess(): Promise<void> {
    const token = await getIdToken();
    if (!token) {
      await goto('/early-access');
      return;
    }
    const response = await fetch('/api/admin/me', {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null);
    if (!response) {
      await goto('/access-denied');
      return;
    }
    if (response.status === 401) {
      await goto('/early-access');
      return;
    }
    if (!response.ok) {
      await goto('/access-denied');
      return;
    }
    const payload = (await response.json()) as { is_owner?: boolean };
    if (!payload.is_owner) {
      await goto('/access-denied');
      return;
    }
    accessAllowed = true;
    accessResolved = true;
  }

  onMount(() => {
    void resolveOwnerAccess();
  });
</script>

<svelte:head>
  <title>STOA Immersive | SOPHIA</title>
</svelte:head>

<main class="stoa-page">
  {#if accessAllowed}
    <StoaApp userId={data.userId} sessionId={data.sessionId} />
  {:else if !accessResolved}
    <div class="loading-state">Checking access…</div>
  {/if}
</main>

<style>
  .stoa-page {
    width: 100vw;
    min-height: 100dvh;
    background: #1a1917;
    overflow: hidden;
  }

  .loading-state {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-ui);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(239, 229, 208, 0.8);
  }
</style>

