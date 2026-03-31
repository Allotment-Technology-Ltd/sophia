<script lang="ts">
  import type { GraphKitEvidenceItem } from '$lib/graph-kit/types';
  import SourceBadge from './SourceBadge.svelte';

  interface Props {
    item: GraphKitEvidenceItem;
    highlighted?: boolean;
  }

  let { item, highlighted = false }: Props = $props();
</script>

<article class="evidence-card" class:is-highlighted={highlighted}>
  <div class="evidence-header">
    <p class="evidence-kind">{item.kind}</p>
    {#if typeof item.confidence === 'number'}
      <span class="evidence-confidence">{Math.round(item.confidence * 100)}%</span>
    {/if}
  </div>
  <h4>{item.label}</h4>
  <p class="evidence-summary">{item.summary}</p>
  <div class="evidence-footer">
    {#if item.sourceTitle}
      <SourceBadge label={item.sourceTitle} />
    {/if}
    {#if item.provenanceId}
      <span class="evidence-meta">prov {item.provenanceId}</span>
    {/if}
  </div>
</article>

<style>
  .evidence-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 10px;
    background: color-mix(in srgb, var(--color-surface-raised) 84%, transparent);
    display: grid;
    gap: 8px;
  }

  .evidence-card.is-highlighted {
    border-color: var(--color-blue-border);
    box-shadow: 0 0 0 1px var(--color-blue-border);
  }

  .evidence-header,
  .evidence-footer {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .evidence-kind,
  .evidence-confidence,
  .evidence-meta {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
  }

  .evidence-kind {
    margin: 0;
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .evidence-confidence {
    color: var(--color-teal);
  }

  h4 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.95rem;
    color: var(--color-text);
  }

  .evidence-summary {
    margin: 0;
    color: var(--color-text);
    line-height: 1.65;
  }

  .evidence-meta {
    color: var(--color-muted);
  }
</style>
