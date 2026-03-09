<script lang="ts">
  import type { ReasoningEvaluation } from '$lib/types/verification';
  import { fade } from 'svelte/transition';

  interface Props {
    reasoningQuality?: ReasoningEvaluation | null;
  }

  let { reasoningQuality = null }: Props = $props();
  let expanded = $state(false);

  const scorePercent = $derived(
    reasoningQuality ? Math.round(reasoningQuality.overall_score * 100) : null
  );

  const circumference = 2 * Math.PI * 30;
  const progressOffset = $derived(
    scorePercent === null ? circumference : circumference * (1 - scorePercent / 100)
  );

  function dimensionLabel(id: string): string {
    return id.replace(/_/g, ' ');
  }
</script>

{#if reasoningQuality}
  <section class="quality-card" aria-label="Reasoning quality summary">
    <button class="headline" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
      <div class="ring" aria-hidden="true">
        <svg viewBox="0 0 80 80" width="68" height="68">
          <circle cx="40" cy="40" r="30" class="bg" />
          <circle
            cx="40"
            cy="40"
            r="30"
            class="fg"
            stroke-dasharray={circumference}
            stroke-dashoffset={progressOffset}
          />
        </svg>
        <span>{scorePercent}%</span>
      </div>
      <div class="summary">
        <p class="title">Reasoning quality</p>
        <p class="subtitle">6-dimension structural evaluation</p>
      </div>
      <span class="toggle">{expanded ? 'Hide detail' : 'Show detail'}</span>
    </button>

    {#if expanded}
      <div class="details" in:fade={{ duration: 180 }}>
        {#each reasoningQuality.dimensions as dimension}
          <div class="dimension-row">
            <span class="name">{dimensionLabel(dimension.dimension)}</span>
            <span class="value">{Math.round(dimension.score * 100)}%</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .quality-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: var(--space-3);
  }

  .headline {
    width: 100%;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-3);
    align-items: center;
    background: transparent;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .ring {
    position: relative;
    width: 68px;
    height: 68px;
    display: grid;
    place-items: center;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-text);
  }

  .ring svg {
    position: absolute;
    transform: rotate(-90deg);
  }

  .ring .bg {
    fill: none;
    stroke: var(--color-border);
    stroke-width: 6;
  }

  .ring .fg {
    fill: none;
    stroke: var(--color-sage);
    stroke-width: 6;
    stroke-linecap: round;
    transition: stroke-dashoffset var(--transition-slow);
  }

  .summary .title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.9rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text);
  }

  .summary .subtitle {
    margin: 4px 0 0;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--color-dim);
  }

  .toggle {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-blue);
  }

  .details {
    margin-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .dimension-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-family: var(--font-ui);
    font-size: 0.78rem;
    text-transform: capitalize;
    color: var(--color-muted);
  }

  .dimension-row .value {
    color: var(--color-text);
  }

  @media (max-width: 720px) {
    .headline {
      grid-template-columns: auto 1fr;
    }

    .toggle {
      grid-column: 1 / -1;
      justify-self: end;
    }
  }
</style>
