<script lang="ts">
  import type { CachedQueryResult } from '$lib/stores/history.svelte';
  import type { GraphKitCompareResult } from '$lib/graph-kit/types';

  interface Props {
    compareResult: GraphKitCompareResult | null;
    baselineOptions: CachedQueryResult[];
    selectedBaselineQuery?: string | null;
    onBaselineChange?: (query: string) => void;
    onClearBaseline?: () => void;
    onSelectNode?: (nodeId: string) => void;
  }

  let {
    compareResult,
    baselineOptions,
    selectedBaselineQuery = null,
    onBaselineChange,
    onClearBaseline,
    onSelectNode
  }: Props = $props();

  function shortDate(value?: string): string {
    if (!value) return 'n/a';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }
 </script>

<section class="compare-panel" aria-label="Compare mode">
  <div class="compare-header">
    <div>
      <p class="eyebrow">Compare Mode</p>
      <h2>Reasoning-state comparison</h2>
      <p class="compare-intro">
        Baseline selection is real. The diff model already tracks node, edge, confidence, contradiction, and evidence-set changes, while graph overlays and inspector diffs remain TODOs.
      </p>
    </div>

    <div class="compare-controls">
      <label class="field">
        <span>Baseline run</span>
        <select
          value={selectedBaselineQuery ?? ''}
          onchange={(event) => onBaselineChange?.((event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">No baseline</option>
          {#each baselineOptions as option}
            <option value={option.query}>
              {option.query} ({option.metadata.depth_mode ?? 'standard'})
            </option>
          {/each}
        </select>
      </label>

      <button type="button" class="clear-btn" onclick={() => onClearBaseline?.()}>
        Clear compare
      </button>
    </div>
  </div>

  {#if !compareResult}
    <div class="compare-empty">
      <p>Select a cached run as a baseline to compare graph states, claims, and evidence sets.</p>
      <p>TODO: explicit “compare two arbitrary runs” picker and dual-graph overlay.</p>
    </div>
  {:else}
    <div class="compare-summary">
      <span class="summary-chip">
        baseline: {compareResult.baselineRun.label} · {shortDate(compareResult.baselineRun.timestamp)}
      </span>
      <span class="summary-chip">
        current: {compareResult.currentRun.label} · {shortDate(compareResult.currentRun.timestamp)}
      </span>
      <span class="summary-chip emphasis">{compareResult.summary}</span>
    </div>

    <div class="compare-grid">
      <section class="compare-card">
        <h3>Graph States</h3>
        <dl>
          <div class="row">
            <dt>baseline graph</dt>
            <dd>{compareResult.baselineGraph.nodeCount} nodes · {compareResult.baselineGraph.edgeCount} edges</dd>
          </div>
          <div class="row">
            <dt>current graph</dt>
            <dd>{compareResult.currentGraph.nodeCount} nodes · {compareResult.currentGraph.edgeCount} edges</dd>
          </div>
          <div class="row">
            <dt>baseline snapshot</dt>
            <dd>{compareResult.baselineGraph.snapshotId ?? 'n/a'}</dd>
          </div>
          <div class="row">
            <dt>current snapshot</dt>
            <dd>{compareResult.currentGraph.snapshotId ?? 'n/a'}</dd>
          </div>
        </dl>
      </section>

      <section class="compare-card">
        <h3>Node And Edge Deltas</h3>
        <div class="delta-stack">
          <p>Added nodes: {compareResult.addedNodes.length}</p>
          <p>Removed nodes: {compareResult.removedNodes.length}</p>
          <p>Added edges: {compareResult.addedEdges.length}</p>
          <p>Removed edges: {compareResult.removedEdges.length}</p>
        </div>
      </section>

      <section class="compare-card">
        <h3>Confidence And Contradiction Changes</h3>
        <div class="delta-stack">
          <p>Confidence changes: {compareResult.changedConfidence.length}</p>
          <p>Contradiction changes: {compareResult.contradictionChanges.length}</p>
        </div>
      </section>
    </div>

    <div class="compare-grid compare-grid-deep">
      <section class="compare-card">
        <h3>Claim Diffs</h3>
        {#if compareResult.claimComparisons.length === 0}
          <p class="empty-copy">No claim-level confidence or evidence changes were detected.</p>
        {:else}
          <div class="diff-list">
            {#each compareResult.claimComparisons.slice(0, 6) as claim}
              <article class="diff-item">
                <div class="diff-item-header">
                  <strong>{claim.title}</strong>
                  {#if claim.currentNodeId}
                    <button type="button" class="jump-btn" onclick={() => onSelectNode?.(claim.currentNodeId!)}>
                      Inspect
                    </button>
                  {/if}
                </div>
                <p>
                  confidence:
                  {claim.baselineConfidence?.toFixed(2) ?? 'n/a'}
                  →
                  {claim.currentConfidence?.toFixed(2) ?? 'n/a'}
                </p>
                {#if claim.evidenceAdded.length > 0}
                  <p>evidence added: {claim.evidenceAdded.length}</p>
                {/if}
                {#if claim.evidenceRemoved.length > 0}
                  <p>evidence removed: {claim.evidenceRemoved.length}</p>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="compare-card">
        <h3>Evidence Set Diffs</h3>
        {#if compareResult.evidenceSetComparisons.length === 0}
          <p class="empty-copy">No evidence-set changes were detected for matched claims.</p>
        {:else}
          <div class="diff-list">
            {#each compareResult.evidenceSetComparisons.slice(0, 6) as evidenceSet}
              <article class="diff-item">
                <strong>{evidenceSet.ownerTitle}</strong>
                <p>added evidence: {evidenceSet.addedEvidence.length}</p>
                <p>removed evidence: {evidenceSet.removedEvidence.length}</p>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="compare-card">
        <h3>Implementation Notes</h3>
        <ul class="todo-list">
          {#each compareResult.todo as item}
            <li>{item}</li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</section>

<style>
  .compare-panel {
    display: grid;
    gap: 12px;
    padding: 16px;
    border-top: 1px solid var(--color-border);
    background:
      linear-gradient(180deg, rgba(111, 163, 212, 0.04), transparent),
      color-mix(in srgb, var(--color-surface) 94%, var(--color-bg));
  }

  .compare-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: start;
  }

  .eyebrow,
  .summary-chip,
  .field,
  .clear-btn,
  .jump-btn,
  dt,
  li {
    font-family: var(--font-ui);
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--color-purple);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .compare-header h2,
  .compare-card h3 {
    margin: 0;
    font-family: var(--font-display);
  }

  .compare-intro,
  .empty-copy,
  .diff-item p {
    margin: 8px 0 0;
    color: var(--color-muted);
  }

  .compare-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: end;
  }

  .field {
    display: grid;
    gap: 6px;
    min-width: 260px;
    color: var(--color-muted);
    font-size: var(--text-meta);
  }

  .field select,
  .clear-btn,
  .jump-btn {
    min-height: 36px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-raised) 88%, transparent);
    color: var(--color-text);
    padding: 0 10px;
    cursor: pointer;
  }

  .compare-summary,
  .diff-item-header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }

  .summary-chip {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 4px 8px;
    color: var(--color-muted);
    font-size: var(--text-meta);
  }

  .summary-chip.emphasis {
    color: var(--color-blue);
    border-color: var(--color-blue-border);
  }

  .compare-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .compare-grid-deep {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .compare-card,
  .compare-empty {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-raised) 84%, transparent);
    padding: 12px;
  }

  .diff-list,
  .delta-stack,
  .todo-list,
  dl {
    display: grid;
    gap: 8px;
  }

  .diff-item {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 10px;
    background: color-mix(in srgb, var(--color-surface) 90%, transparent);
  }

  .row {
    display: grid;
    gap: 4px;
  }

  dt {
    color: var(--color-dim);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  dd {
    margin: 0;
    color: var(--color-text);
  }

  .todo-list {
    margin: 0;
    padding-left: 18px;
  }

  @media (max-width: 1080px) {
    .compare-grid,
    .compare-grid-deep {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 860px) {
    .compare-header {
      flex-direction: column;
    }
  }
</style>
