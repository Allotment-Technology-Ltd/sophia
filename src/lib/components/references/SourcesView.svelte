<script lang="ts">
  import { referencesStore } from '$lib/stores/references.svelte';
  import ClaimRow from './ClaimRow.svelte';

  // Group claims by source
  let groups = $derived(() => {
    const map = new Map<string, typeof referencesStore.activeClaims>();
    for (const claim of referencesStore.activeClaims) {
      const existing = map.get(claim.source) ?? [];
      existing.push(claim);
      map.set(claim.source, existing);
    }
    return Array.from(map.entries()).map(([source, claims]) => ({ source, claims }));
  });

  // Track which groups are expanded
  let expandedSources = $state<Set<string>>(new Set());

  function toggleGroup(source: string) {
    const next = new Set(expandedSources);
    if (next.has(source)) {
      next.delete(source);
    } else {
      next.add(source);
    }
    expandedSources = next;
  }

  function getRelations(claimId: string) {
    return referencesStore.relations.find(r => r.claimId === claimId);
  }
</script>

<div class="sources-view">
  {#if referencesStore.activeClaims.length === 0}
    <div class="empty-state">
      <p class="empty-text">No sources yet. Analysis will populate this panel.</p>
    </div>
  {:else}
    {#each groups() as group (group.source)}
      <div class="source-group">
        <button
          class="source-header"
          aria-expanded={expandedSources.has(group.source)}
          onclick={() => toggleGroup(group.source)}
        >
          <span class="source-name">{group.source}</span>
          <span class="claim-count">{group.claims.length}</span>
          <svg
            class="chevron"
            class:is-expanded={expandedSources.has(group.source)}
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <div class="source-claims" class:is-expanded={expandedSources.has(group.source)}>
          {#each group.claims as claim (claim.id)}
            <ClaimRow {claim} relations={getRelations(claim.id)} />
          {/each}
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
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--color-text);
  }

  .source-name {
    font-family: var(--font-display);
    font-size: 0.9rem;
    color: var(--color-muted);
    flex: 1;
    min-width: 0;
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

  .chevron {
    color: var(--color-dim);
    flex-shrink: 0;
    transition: transform var(--transition-base);
  }

  .chevron.is-expanded {
    transform: rotate(180deg);
  }

  .source-claims {
    max-height: 0;
    overflow: hidden;
    transition: max-height 200ms ease;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0;
  }

  .source-claims.is-expanded {
    max-height: 2000px;
    padding-bottom: var(--space-3);
  }

  :global(html.reduce-motion) .chevron,
  :global(html.reduce-motion) .source-claims {
    transition: none !important;
  }
</style>
