<script lang="ts">
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/authClient';
  import type { JournalEntry } from '$lib/server/stoa/types';

  let entries = $state<JournalEntry[]>([]);
  let isLoading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const token = await getIdToken();
      const response = await fetch('/api/stoa/journal?limit=100', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        throw new Error(`Failed (${response.status})`);
      }
      const payload = await response.json();
      entries = Array.isArray(payload.items) ? payload.items : [];
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>STOA Journal | SOPHIA</title>
</svelte:head>

<main class="journal-page">
  <header>
    <h1>STOA Journal</h1>
    <p>Short reflections from your sessions and rituals.</p>
  </header>

  {#if isLoading}
    <p>Loading journal...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if entries.length === 0}
    <p class="empty">No journal entries yet. Finish a STOA session to add your first reflection.</p>
  {:else}
    <section class="journal-list">
      {#each entries as entry (entry.id)}
        <article class="journal-entry">
          <p>{entry.entryText}</p>
          <footer>
            <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown time'}</span>
            {#if entry.themes.length > 0}
              <span>{entry.themes.join(' | ')}</span>
            {/if}
          </footer>
        </article>
      {/each}
    </section>
  {/if}
</main>

<style>
  .journal-page {
    max-width: 840px;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
    display: grid;
    gap: var(--space-4);
  }

  .journal-page h1,
  .journal-page p {
    margin: 0;
  }

  .journal-list {
    display: grid;
    gap: var(--space-3);
  }

  .journal-entry {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--color-surface);
    display: grid;
    gap: var(--space-2);
  }

  .journal-entry footer {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--color-muted);
    font-size: var(--text-meta);
  }

  .error {
    color: var(--color-coral);
  }

  .empty {
    color: var(--color-muted);
  }
</style>
