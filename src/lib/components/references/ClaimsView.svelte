<script lang="ts">
  import type { AnalysisPhase } from '$lib/types/references';
  import { referencesStore } from '$lib/stores/references.svelte';
  import ClaimCard from './ClaimCard.svelte';

  const PHASE_LABELS: Record<AnalysisPhase, string> = {
    analysis: 'Foundations',
    critique: 'Challenges',
    synthesis: 'Resolution',
  };

  // Group claims by phase, preserving phase order
  let groupedClaims = $derived(() => {
    const phases: AnalysisPhase[] = ['analysis', 'critique', 'synthesis'];
    return phases
      .filter(p => referencesStore.activeClaims.some(c => c.phase === p))
      .map(phase => ({
        phase,
        label: PHASE_LABELS[phase],
        claims: referencesStore.activeClaims.filter(c => c.phase === phase),
      }));
  });

  // Find relations for a given claim
  function getRelations(claimId: string) {
    return referencesStore.relations.find(r => r.claimId === claimId);
  }

  // Stagger claims via animation-delay based on index
  let container: HTMLDivElement | undefined = $state();

  // Smooth scroll when new claims arrive
  $effect(() => {
    const count = referencesStore.claimCount;
    if (count > 0 && container) {
      requestAnimationFrame(() => {
        container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      });
    }
  });
</script>

<div class="claims-view" bind:this={container} aria-live="polite">
  {#if referencesStore.activeClaims.length > 0}
    <div class="claims-notice">
      Claims are AI-generated from the knowledge base and live web search. Run <strong>Scholarly Review</strong> to cross-check factual claims against academic consensus. <em>Interpretive</em> claims represent philosophical reasoning and are not directly verifiable.
    </div>
  {/if}

  {#if referencesStore.activeClaims.length === 0}
    <div class="empty-state">
      <p class="empty-text">No claims yet. Foundations will appear here once reasoning begins.</p>
    </div>
  {:else}
    {#each groupedClaims() as group (group.phase)}
      <div class="phase-section">
        <p class="phase-eyebrow">{group.label}</p>
        <div class="phase-claims">
          {#each group.claims as claim, i (`${group.phase}:${claim.id}:${i}`)}
            <div style="animation-delay: {i * 16}ms">
              <ClaimCard {claim} relations={getRelations(claim.id)} />
            </div>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .claims-view {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .claims-notice {
    font-family: var(--font-display);
    font-size: 0.8rem;
    line-height: 1.55;
    color: var(--color-dim);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    background: var(--color-surface);
  }

  .claims-notice strong {
    font-weight: 600;
    color: var(--color-muted);
    font-style: normal;
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
    font-style: normal;
    font-size: var(--text-body);
    line-height: var(--leading-body);
    letter-spacing: var(--tracking-body);
    color: var(--color-dim);
    text-align: center;
    margin: 0;
  }

  .phase-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .phase-eyebrow {
    font-family: var(--font-ui);
    font-size: var(--text-label);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-dim);
    margin: 0;
  }

  .phase-claims {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
