<script lang="ts">
  import type { Claim, RelationBundle } from '$lib/types/references';
  import ClaimBadge from './ClaimBadge.svelte';
  import RelationTag from './RelationTag.svelte';

  interface Props {
    claim: Claim;
    relations?: RelationBundle;
  }

  let { claim, relations }: Props = $props();

  let expanded = $state(false);
</script>

<button
  class="claim-card"
  onclick={() => expanded = !expanded}
  aria-expanded={expanded}
  aria-controls={`claim-detail-${claim.id}`}
>
  <div class="card-header">
    <ClaimBadge variant={claim.badge} />
    <span class="source-line">{claim.source}</span>
  </div>

  <p class="card-body">{claim.text}</p>

  <div id={`claim-detail-${claim.id}`} class="detail-panel" class:is-expanded={expanded}>
    <p class="detail-text">{claim.detail}</p>
    <span class="detail-source">{claim.source}</span>
  </div>

  {#if relations && relations.relations.length > 0}
    <div class="relation-tags">
      {#each relations.relations as rel, i (rel.target)}
        <RelationTag type={rel.type} label={rel.label} delay={300 + i * 300} />
      {/each}
    </div>
  {/if}
</button>

<style>
  .claim-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: var(--space-3);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    animation: card-fade-in 400ms ease both;
    text-align: left;
    width: 100%;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .claim-card:hover {
    border-color: var(--color-sage-border);
    background: var(--color-surface-raised);
  }

  .claim-card:focus {
    outline: 2px solid var(--color-sage);
    outline-offset: 2px;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .source-line {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .card-body {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--text-body);
    line-height: var(--leading-body);
    letter-spacing: var(--tracking-body);
    color: var(--color-text);
    margin: 0;
  }

  .detail-panel {
    max-height: 0;
    overflow: hidden;
    transition: max-height 200ms ease;
  }

  .detail-panel.is-expanded {
    max-height: 200px;
  }

  .detail-text {
    font-family: var(--font-display);
    font-size: 0.95rem;
    line-height: 1.6;
    letter-spacing: var(--tracking-body);
    color: var(--color-muted);
    margin: 0 0 var(--space-2);
  }

  .detail-source {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .relation-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding-top: var(--space-1);
  }

  @keyframes card-fade-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  :global(html.reduce-motion) .claim-card {
    animation-duration: 0.01ms !important;
  }

  :global(html.reduce-motion) .detail-panel {
    transition: none !important;
  }
</style>
