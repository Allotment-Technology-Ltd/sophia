<script lang="ts">
  import { renderMarkdown } from '$lib/utils/markdown';
  import { buildModelDiffResult, type PassId } from '$lib/utils/modelDiff';

  interface Props {
    geminiPasses: Partial<Record<PassId, string>>;
    claudePasses: Partial<Record<PassId, string>>;
  }

  let { geminiPasses, claudePasses }: Props = $props();

  const PASS_LABELS: Record<PassId, string> = {
    analysis: 'Analysis',
    critique: 'Critique',
    synthesis: 'Synthesis',
    verification: 'Verification'
  };

  let activePass = $state<PassId>('analysis');

  const availablePasses = $derived.by(() =>
    (['analysis', 'critique', 'synthesis', 'verification'] as const).filter(
      (pass) => (geminiPasses[pass] ?? '').trim().length > 0 || (claudePasses[pass] ?? '').trim().length > 0
    )
  );

  const diffResult = $derived(
    buildModelDiffResult({
      analysis: { gemini: geminiPasses.analysis ?? '', claude: claudePasses.analysis ?? '' },
      critique: { gemini: geminiPasses.critique ?? '', claude: claudePasses.critique ?? '' },
      synthesis: { gemini: geminiPasses.synthesis ?? '', claude: claudePasses.synthesis ?? '' },
      verification: { gemini: geminiPasses.verification ?? '', claude: claudePasses.verification ?? '' }
    })
  );

  const activePassDiff = $derived(diffResult.byPass[activePass] ?? null);

  $effect(() => {
    if (!availablePasses.includes(activePass) && availablePasses.length > 0) {
      activePass = availablePasses[0];
    }
  });

  function renderPass(text: string): string {
    return renderMarkdown(text.replace(/```sophia-meta[\s\S]*?```/g, '').trim());
  }
</script>

{#if availablePasses.length > 0}
  <section class="compare-panel" aria-label="Gemini vs Claude pass comparison">
    <header class="compare-header">
      <h3>Model Comparison</h3>
      <p>Pass-by-pass differences between Gemini and Claude outputs.</p>
    </header>

    <div class="compare-tabs" role="tablist" aria-label="Comparison pass tabs">
      {#each availablePasses as pass}
        <button
          class="tab-btn"
          class:active={activePass === pass}
          role="tab"
          aria-selected={activePass === pass}
          onclick={() => (activePass = pass)}
        >
          {PASS_LABELS[pass]}
        </button>
      {/each}
    </div>

    {#if activePassDiff}
      {@const passDiff = activePassDiff}
      <div class="metrics-row">
        <span class="metric">Overlap {(passDiff.overlapRatio * 100).toFixed(0)}%</span>
        <span class="metric">Gemini {passDiff.tokenCountGemini} tokens</span>
        <span class="metric">Claude {passDiff.tokenCountClaude} tokens</span>
        <span class="metric">Gemini {passDiff.sentenceCountGemini} points</span>
        <span class="metric">Claude {passDiff.sentenceCountClaude} points</span>
      </div>

      <div class="delta-grid">
        <div class="delta-card">
          <h4>Unique to Gemini</h4>
          {#if passDiff.uniqueToGemini.length}
            <ul>
              {#each passDiff.uniqueToGemini as sentence}
                <li>{sentence}</li>
              {/each}
            </ul>
          {:else}
            <p>Mostly aligned with Claude on this pass.</p>
          {/if}
        </div>
        <div class="delta-card">
          <h4>Unique to Claude</h4>
          {#if passDiff.uniqueToClaude.length}
            <ul>
              {#each passDiff.uniqueToClaude as sentence}
                <li>{sentence}</li>
              {/each}
            </ul>
          {:else}
            <p>Mostly aligned with Gemini on this pass.</p>
          {/if}
        </div>
      </div>
    {/if}

    <div class="side-by-side">
      <article class="model-card model-gemini">
        <div class="model-title">Gemini</div>
        <div class="model-content">
          {@html renderPass(geminiPasses[activePass] ?? '')}
        </div>
      </article>
      <article class="model-card model-claude">
        <div class="model-title">Claude</div>
        <div class="model-content">
          {@html renderPass(claudePasses[activePass] ?? '')}
        </div>
      </article>
    </div>
  </section>
{/if}

<style>
  .compare-panel {
    margin-top: var(--space-4);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 4px;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .compare-header h3 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .compare-header p {
    margin: 4px 0 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-dim);
  }

  .compare-tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .tab-btn {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-muted);
    border-radius: 999px;
    padding: 4px 10px;
    font-family: var(--font-ui);
    font-size: 0.64rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .tab-btn.active {
    border-color: var(--color-sage-border);
    color: var(--color-sage);
    background: color-mix(in srgb, var(--color-sage) 14%, transparent);
  }

  .metrics-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .metric {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 4px 8px;
    font-family: var(--font-ui);
    font-size: 0.62rem;
    color: var(--color-muted);
    background: var(--color-surface-raised);
  }

  .delta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .delta-card {
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 10px;
    background: var(--color-bg);
  }

  .delta-card h4 {
    margin: 0 0 8px;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .delta-card ul {
    margin: 0;
    padding-left: 16px;
  }

  .delta-card li,
  .delta-card p {
    margin: 0 0 6px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-dim);
    line-height: 1.4;
  }

  .side-by-side {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .model-card {
    border: 1px solid var(--color-border);
    border-radius: 3px;
    overflow: hidden;
    min-width: 0;
  }

  .model-title {
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
    font-family: var(--font-ui);
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted);
    background: var(--color-surface-raised);
  }

  .model-content {
    padding: 12px;
    max-height: 340px;
    overflow: auto;
    font-family: var(--font-display);
    font-size: 0.9rem;
    line-height: 1.65;
    color: var(--color-muted);
  }

  .model-content :global(p) {
    margin: 0 0 10px;
  }

  .model-content :global(h1),
  .model-content :global(h2),
  .model-content :global(h3),
  .model-content :global(h4) {
    margin: 0 0 8px;
    color: var(--color-text);
    font-family: var(--font-display);
  }

  .model-content :global(ul),
  .model-content :global(ol) {
    margin: 0 0 10px;
    padding-left: 18px;
  }

  @media (max-width: 1024px) {
    .delta-grid,
    .side-by-side {
      grid-template-columns: 1fr;
    }
  }
</style>
