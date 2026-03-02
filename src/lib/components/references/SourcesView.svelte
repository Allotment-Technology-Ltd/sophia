<script lang="ts">
  import { referencesStore } from '$lib/stores/references.svelte';
</script>

<div class="sources-view">
  {#if referencesStore.sources.length === 0}
    <div class="empty-state">
      <p class="empty-text">No retrieved sources yet. Run an analysis to populate this panel.</p>
    </div>
  {:else}
    {#each referencesStore.sources as source (source.id)}
      <div class="source-group">
        <div class="source-header">
          <div class="source-meta">
            <span class="source-name">{source.title}</span>
            <span class="source-authors">{source.author.length ? source.author.join(', ') : 'Unknown author'}</span>
          </div>
          <span class="claim-count">{source.claimCount}</span>
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .sources-view {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6) var(--space-4);
    min-height: 200px;
  }

  .empty-text {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-body);
    color: var(--color-dim);
    text-align: center;
    margin: 0;
  }

  .source-group {
    border-bottom: 1px solid var(--color-border);
  }

  .source-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3) 0;
    color: var(--color-text);
  }

  .source-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .source-name {
    font-family: var(--font-display);
    font-size: 0.9rem;
    color: var(--color-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-authors {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .claim-count {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
    background: var(--color-surface-raised);
    padding: 2px 8px;
    border-radius: 100px;
    flex-shrink: 0;
  }
</style>
