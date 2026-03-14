<script lang="ts">
  import type { Claim, RelationBundle } from '@restormel/contracts/references';
  import ClaimBadge from './ClaimBadge.svelte';
  import RelationTag from './RelationTag.svelte';

  interface Props {
    claim: Claim;
    relations?: RelationBundle;
  }

  let { claim, relations }: Props = $props();

  let expanded = $state(false);

  // Format confidence as a readable label
  const confidenceLabel = $derived.by(() => {
    if (claim.confidence === undefined || claim.confidence === null) return null;
    if (claim.confidence >= 0.85) return 'High confidence';
    if (claim.confidence >= 0.65) return 'Moderate confidence';
    return 'Low confidence';
  });

  const isLowConfidence = $derived(
    claim.confidence !== undefined && claim.confidence < 0.65
  );

  const isInterpretive = $derived(claim.confidence === undefined);
</script>

<div
  id={`claim-card-${claim.id}`}
  class="claim-card"
  class:low-confidence={isLowConfidence}
  role="button"
  tabindex="0"
  aria-expanded={expanded}
  aria-controls={`claim-detail-${claim.id}`}
  onclick={() => expanded = !expanded}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expanded = !expanded; } }}
>
  <div class="card-header">
    <ClaimBadge variant={claim.badge} />
    {#if claim.sourceUrl}
      <a
        class="source-line source-link"
        href={claim.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        onclick={(e) => e.stopPropagation()}
        title="Open source"
      >{claim.source}</a>
    {:else}
      <span class="source-line">{claim.source}</span>
    {/if}

    {#if isInterpretive}
      <span class="confidence-badge interpretive" title="This is a philosophical interpretation or argumentative claim — not directly verifiable against factual sources.">
        Interpretive
      </span>
    {:else if isLowConfidence}
      <span class="confidence-badge low" title="This claim has low confidence — treat as a speculative or contested position.">
        Unverified
      </span>
    {/if}
  </div>

  <p class="card-body">{claim.text}</p>

  <div id={`claim-detail-${claim.id}`} class="detail-panel" class:is-expanded={expanded}>
    <p class="detail-text">{claim.detail}</p>
    <div class="detail-footer">
      {#if claim.sourceUrl}
        <a
          class="detail-source-link"
          href={claim.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          onclick={(e) => e.stopPropagation()}
        >{claim.source} ↗</a>
      {:else}
        <span class="detail-source">{claim.source}</span>
      {/if}
      {#if confidenceLabel}
        <span class="confidence-text">{confidenceLabel}: {((claim.confidence ?? 0) * 100).toFixed(0)}%</span>
      {:else}
        <span class="confidence-text interpretive-note">
          Interpretive — philosophical reasoning, not a factual assertion
        </span>
      {/if}
    </div>
  </div>

  {#if relations && relations.relations.length > 0}
    <div class="relation-tags">
      {#each relations.relations as rel, i (rel.target)}
        <RelationTag type={rel.type} label={rel.label} delay={300 + i * 300} />
      {/each}
    </div>
  {/if}
</div>

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

  .claim-card.low-confidence {
    border-left: 2px solid var(--color-copper-border);
  }

  .claim-card:focus {
    outline: 2px solid var(--color-sage);
    outline-offset: 2px;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .source-line {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-link {
    color: var(--color-blue);
    text-decoration: none;
    transition: color var(--transition-fast);
  }

  .source-link:hover {
    color: var(--color-text);
    text-decoration: underline;
  }

  .confidence-badge {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .confidence-badge.interpretive {
    background: var(--color-blue-bg);
    color: var(--color-blue);
    border: 1px solid var(--color-blue-border);
  }

  .confidence-badge.low {
    background: var(--color-copper-bg);
    color: var(--color-copper);
    border: 1px solid var(--color-copper-border);
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
    max-height: 300px;
  }

  .detail-text {
    font-family: var(--font-display);
    font-size: 0.95rem;
    line-height: 1.6;
    letter-spacing: var(--tracking-body);
    color: var(--color-muted);
    margin: 0 0 var(--space-2);
  }

  .detail-footer {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .detail-source {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .detail-source-link {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-blue);
    text-decoration: none;
  }

  .detail-source-link:hover {
    text-decoration: underline;
  }

  .confidence-text {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }

  .interpretive-note {
    color: var(--color-blue);
    font-style: italic;
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
