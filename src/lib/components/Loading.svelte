<script lang="ts">
  import DialecticalTriangle from './DialecticalTriangle.svelte';

  interface Props {
    currentPass?: string;
    statusText?: string;
    completedPasses?: string[];
    depthMode?: 'quick' | 'standard' | 'deep';
    completionReady?: boolean;
    passLabel?: string;
    depthLabel?: string;
    modelLabel?: string;
    workingLines?: string[];
  }

  let {
    currentPass = '',
    statusText = 'Thinking…',
    completedPasses = [],
    depthMode = 'standard',
    completionReady = false,
    passLabel = 'Analysis',
    depthLabel = 'Standard',
    modelLabel = 'Auto',
    workingLines = []
  }: Props = $props();
</script>

<div class="loading-screen" aria-live="polite" aria-label="Analysis in progress">
  <DialecticalTriangle
    mode="loading"
    {currentPass}
    {completedPasses}
    {depthMode}
    {completionReady}
    size={240}
  />

  <p class="status-text">{statusText}</p>
  <div class="loading-meta" aria-live="off">
    <span class="meta-pill"><strong>Pass</strong> {passLabel}</span>
    <span class="meta-pill"><strong>Depth</strong> {depthLabel}</span>
    <span class="meta-pill"><strong>Model</strong> {modelLabel}</span>
  </div>
  {#if workingLines.length > 0}
    <div class="working-notes" aria-live="polite">
      {#each workingLines as line}
        <p>{line}</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - var(--nav-height));
    padding: var(--space-5);
  }

  .status-text {
    margin-top: 32px;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 1rem;
    color: var(--color-muted);
    text-align: center;
  }

  .loading-meta {
    margin-top: 14px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .meta-pill {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    color: var(--color-dim);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 999px;
    padding: 5px 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .meta-pill strong {
    color: var(--color-muted);
    font-weight: 600;
  }

  .working-notes {
    margin-top: 18px;
    max-width: 560px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .working-notes p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    letter-spacing: 0.02em;
    color: var(--color-dim);
    text-align: center;
  }
</style>
