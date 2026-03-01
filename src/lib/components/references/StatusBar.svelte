<script lang="ts">
  import type { AnalysisPhase } from '$lib/types/references';
  import { referencesStore } from '$lib/stores/references.svelte';

  const PHASE_MESSAGES: Record<AnalysisPhase, string> = {
    analysis: 'Mapping the landscape\u2026',
    critique: 'Finding weaknesses\u2026',
    synthesis: 'Integrating tensions\u2026',
  };

  let hidden = $state(false);

  let message = $derived(
    referencesStore.currentPhase
      ? PHASE_MESSAGES[referencesStore.currentPhase]
      : 'Analysis complete'
  );

  let isActive = $derived(referencesStore.isLive && referencesStore.currentPhase !== null);

  // Auto-hide 2.2s after completion
  $effect(() => {
    if (!referencesStore.isLive && referencesStore.claimCount > 0) {
      const timer = setTimeout(() => { hidden = true; }, 2200);
      return () => clearTimeout(timer);
    }
    hidden = false;
  });
</script>

{#if !hidden && (referencesStore.isLive || referencesStore.claimCount > 0)}
  <div class="status-bar" class:is-complete={!isActive}>
    <span class="status-dot" class:is-pulsing={isActive} aria-hidden="true"></span>
    <span class="status-text">{message}</span>
  </div>
{/if}

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    flex-shrink: 0;
  }

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-sage);
    flex-shrink: 0;
  }

  .status-dot.is-pulsing {
    animation: symbol-breathe 2s ease-in-out infinite;
  }

  .status-text {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-sage);
  }

  :global(html.reduce-motion) .status-dot {
    animation-duration: 0.01ms !important;
  }
</style>
