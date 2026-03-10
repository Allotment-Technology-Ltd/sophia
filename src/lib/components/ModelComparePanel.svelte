<script lang="ts">
  import { renderMarkdown } from '$lib/utils/markdown';
  import { buildModelDiffResult, type PassId } from '$lib/utils/modelDiff';

  type ComparisonMetadata = {
    claims_retrieved?: number;
    arguments_retrieved?: number;
    depth_mode?: 'quick' | 'standard' | 'deep';
    selected_model_provider?: 'auto' | 'vertex' | 'anthropic';
    selected_model_id?: string;
    user_links_count?: number;
    runtime_links_processed?: number;
    nightly_queue_enqueued?: number;
  };

  interface Props {
    leftLabel: string;
    rightLabel: string;
    leftPasses: Partial<Record<PassId, string>>;
    rightPasses: Partial<Record<PassId, string>>;
    leftMeta?: ComparisonMetadata;
    rightMeta?: ComparisonMetadata;
  }

  let {
    leftLabel,
    rightLabel,
    leftPasses,
    rightPasses,
    leftMeta,
    rightMeta
  }: Props = $props();

  const PASS_LABELS: Record<PassId, string> = {
    analysis: 'Analysis',
    critique: 'Critique',
    synthesis: 'Synthesis',
    verification: 'Verification'
  };

  let activePass = $state<PassId>('analysis');

  const availablePasses = $derived.by(() =>
    (['analysis', 'critique', 'synthesis', 'verification'] as const).filter(
      (pass) => (leftPasses[pass] ?? '').trim().length > 0 || (rightPasses[pass] ?? '').trim().length > 0
    )
  );

  const diffResult = $derived(
    buildModelDiffResult({
      analysis: { gemini: leftPasses.analysis ?? '', claude: rightPasses.analysis ?? '' },
      critique: { gemini: leftPasses.critique ?? '', claude: rightPasses.critique ?? '' },
      synthesis: { gemini: leftPasses.synthesis ?? '', claude: rightPasses.synthesis ?? '' },
      verification: { gemini: leftPasses.verification ?? '', claude: rightPasses.verification ?? '' }
    })
  );

  const activePassDiff = $derived(diffResult.byPass[activePass] ?? null);

  const retrievalStats = $derived.by(() => {
    const leftClaims = leftMeta?.claims_retrieved;
    const rightClaims = rightMeta?.claims_retrieved;
    const leftArguments = leftMeta?.arguments_retrieved;
    const rightArguments = rightMeta?.arguments_retrieved;
    const leftLinks = leftMeta?.runtime_links_processed;
    const rightLinks = rightMeta?.runtime_links_processed;
    const leftQueued = leftMeta?.nightly_queue_enqueued;
    const rightQueued = rightMeta?.nightly_queue_enqueued;
    return [
      typeof leftClaims === 'number' || typeof rightClaims === 'number'
        ? {
            label: 'Claims retrieved',
            left: leftClaims ?? 0,
            right: rightClaims ?? 0
          }
        : null,
      typeof leftArguments === 'number' || typeof rightArguments === 'number'
        ? {
            label: 'Arguments retrieved',
            left: leftArguments ?? 0,
            right: rightArguments ?? 0
          }
        : null,
      typeof leftLinks === 'number' || typeof rightLinks === 'number'
        ? {
            label: 'Runtime links processed',
            left: leftLinks ?? 0,
            right: rightLinks ?? 0
          }
        : null,
      typeof leftQueued === 'number' || typeof rightQueued === 'number'
        ? {
            label: 'Nightly queued links',
            left: leftQueued ?? 0,
            right: rightQueued ?? 0
          }
        : null
    ].filter((item): item is { label: string; left: number; right: number } => item !== null);
  });

  $effect(() => {
    if (!availablePasses.includes(activePass) && availablePasses.length > 0) {
      activePass = availablePasses[0];
    }
  });

  function renderPass(text: string): string {
    return renderMarkdown(text.replace(/```sophia-meta[\s\S]*?```/g, '').trim());
  }

  function formatDeltaSentence(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';

    // When compare output includes serialized JSON blobs, surface the claim text instead.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const textMatch = trimmed.match(/"text"\s*:\s*"([^"]+)"/i);
      const sourceMatch = trimmed.match(/"source"\s*:\s*"([^"]+)"/i);
      if (textMatch?.[1]) {
        const sourceSuffix = sourceMatch?.[1] ? ` (${sourceMatch[1]})` : '';
        return `${textMatch[1]}${sourceSuffix}`;
      }
    }

    return trimmed.length > 320 ? `${trimmed.slice(0, 320)}...` : trimmed;
  }

  function formatSignedDelta(value: number): string {
    if (value === 0) return '0';
    return value > 0 ? `+${value}` : `${value}`;
  }
</script>

{#if availablePasses.length > 0}
  <section class="compare-panel" aria-label="Run comparison panel">
    <header class="compare-header">
      <h3>Run Comparison</h3>
      <p>Differences between your previous run and your current run.</p>
    </header>

    {#if retrievalStats.length > 0}
      <div class="retrieval-row" aria-label="Retrieval and traversal deltas">
        {#each retrievalStats as stat}
          {@const delta = stat.right - stat.left}
          <span class="metric">
            <strong>{stat.label}</strong> {stat.left} → {stat.right} ({formatSignedDelta(delta)})
          </span>
        {/each}
      </div>
    {/if}

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
        <span class="metric">{leftLabel} {passDiff.tokenCountGemini} tokens</span>
        <span class="metric">{rightLabel} {passDiff.tokenCountClaude} tokens</span>
        <span class="metric">{leftLabel} {passDiff.sentenceCountGemini} points</span>
        <span class="metric">{rightLabel} {passDiff.sentenceCountClaude} points</span>
      </div>

      <div class="delta-grid">
        <div class="delta-card">
          <h4>Unique To {leftLabel}</h4>
          {#if passDiff.uniqueToGemini.length}
            <ul>
              {#each passDiff.uniqueToGemini as sentence}
                <li>{formatDeltaSentence(sentence)}</li>
              {/each}
            </ul>
          {:else}
            <p>Mostly aligned on this pass.</p>
          {/if}
        </div>
        <div class="delta-card">
          <h4>Unique To {rightLabel}</h4>
          {#if passDiff.uniqueToClaude.length}
            <ul>
              {#each passDiff.uniqueToClaude as sentence}
                <li>{formatDeltaSentence(sentence)}</li>
              {/each}
            </ul>
          {:else}
            <p>Mostly aligned on this pass.</p>
          {/if}
        </div>
      </div>
    {/if}

    <div class="side-by-side">
      <article class="model-card">
        <div class="model-title">{leftLabel}</div>
        <div class="model-content">
          {@html renderPass(leftPasses[activePass] ?? '')}
        </div>
      </article>
      <article class="model-card">
        <div class="model-title">{rightLabel}</div>
        <div class="model-content">
          {@html renderPass(rightPasses[activePass] ?? '')}
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

  .metrics-row,
  .retrieval-row {
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

  .metric strong {
    color: var(--color-text);
    font-weight: 600;
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
    overflow-wrap: anywhere;
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
    overflow-wrap: anywhere;
    word-break: break-word;
    hyphens: auto;
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
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .model-content :global(p) {
    margin: 0 0 10px;
  }

  @media (max-width: 920px) {
    .delta-grid,
    .side-by-side {
      grid-template-columns: 1fr;
    }
  }
</style>
