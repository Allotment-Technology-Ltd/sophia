<script lang="ts">
  import type {
    GraphKitEdgeKind,
    GraphKitFocusMode,
    GraphKitNeighborhoodDepth,
    GraphKitNodeKind,
    GraphKitPhase,
    GraphKitScopeSummary
  } from '$lib/graph-kit/types';

  interface Props {
    search: string;
    phase: 'all' | GraphKitPhase;
    density: 'comfortable' | 'dense';
    focusMode: GraphKitFocusMode;
    neighborhoodDepth: GraphKitNeighborhoodDepth;
    showGhosts: boolean;
    nodeKinds: GraphKitNodeKind[];
    enabledNodeKinds: Set<GraphKitNodeKind>;
    edgeKinds: GraphKitEdgeKind[];
    enabledEdgeKinds: Set<GraphKitEdgeKind>;
    focusSummary?: GraphKitScopeSummary;
    summaryMetrics: Array<{ label: string; value: string }>;
    onSearchChange: (value: string) => void;
    onPhaseChange: (value: 'all' | GraphKitPhase) => void;
    onDensityChange: (value: 'comfortable' | 'dense') => void;
    onFocusModeChange: (value: GraphKitFocusMode) => void;
    onNeighborhoodDepthChange: (value: GraphKitNeighborhoodDepth) => void;
    onShowGhostsChange: (value: boolean) => void;
    onToggleNodeKind: (kind: GraphKitNodeKind) => void;
    onToggleEdgeKind: (kind: GraphKitEdgeKind) => void;
    onEnableAllNodeKinds: () => void;
    onEnableAllEdgeKinds: () => void;
    onFitView: () => void;
    onResetView: () => void;
  }

  let {
    search,
    phase,
    density,
    focusMode,
    neighborhoodDepth,
    showGhosts,
    nodeKinds,
    enabledNodeKinds,
    edgeKinds,
    enabledEdgeKinds,
    focusSummary,
    summaryMetrics,
    onSearchChange,
    onPhaseChange,
    onDensityChange,
    onFocusModeChange,
    onNeighborhoodDepthChange,
    onShowGhostsChange,
    onToggleNodeKind,
    onToggleEdgeKind,
    onEnableAllNodeKinds,
    onEnableAllEdgeKinds,
    onFitView,
    onResetView
  }: Props = $props();
</script>

<div class="toolbar">
  <div class="toolbar-main">
    <label class="field">
      <span>Search</span>
      <input
        type="search"
        value={search}
        placeholder="Search claims, sources, tags"
        oninput={(event) => onSearchChange((event.currentTarget as HTMLInputElement).value)}
      />
    </label>

    <label class="field">
      <span>Phase</span>
      <select value={phase} onchange={(event) => onPhaseChange((event.currentTarget as HTMLSelectElement).value as 'all' | GraphKitPhase)}>
        <option value="all">All phases</option>
        <option value="retrieval">Retrieval</option>
        <option value="analysis">Analysis</option>
        <option value="critique">Critique</option>
        <option value="synthesis">Synthesis</option>
      </select>
    </label>

    <label class="field">
      <span>Density</span>
      <select value={density} onchange={(event) => onDensityChange((event.currentTarget as HTMLSelectElement).value as 'comfortable' | 'dense')}>
        <option value="comfortable">Comfortable</option>
        <option value="dense">Dense</option>
      </select>
    </label>

    <label class="field">
      <span>Focus</span>
      <select value={focusMode} onchange={(event) => onFocusModeChange((event.currentTarget as HTMLSelectElement).value as GraphKitFocusMode)}>
        <option value="global">Global view</option>
        <option value="local-dim">Local focus</option>
        <option value="local-isolate">Isolate neighborhood</option>
      </select>
    </label>

    <label class="field">
      <span>Neighborhood</span>
      <select value={String(neighborhoodDepth)} onchange={(event) => onNeighborhoodDepthChange(Number((event.currentTarget as HTMLSelectElement).value) as GraphKitNeighborhoodDepth)}>
        <option value="1">1 hop</option>
        <option value="2">2 hops</option>
        <option value="3">3 hops</option>
      </select>
    </label>

    <label class="toggle">
      <input
        type="checkbox"
        checked={showGhosts}
        onchange={(event) => onShowGhostsChange((event.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show rejected candidates</span>
    </label>

    <div class="action-group" aria-label="Canvas controls">
      <button type="button" class="action-btn" onclick={onFitView}>Fit To View</button>
      <button type="button" class="action-btn" onclick={onResetView}>Reset View</button>
    </div>
  </div>

  <div class="toolbar-secondary">
    <div class="metric-row" aria-label="Workspace summary metrics">
      {#each summaryMetrics as metric}
        <span class="metric-chip">{metric.label}: {metric.value}</span>
      {/each}
      <span class="metric-chip">Layout: orbital v1</span>
      <span class="metric-chip todo">TODO playback</span>
      {#if focusSummary?.active}
        <span class="metric-chip emphasis">
          focus: {focusSummary.visibleNodes}/{focusSummary.totalNodes} nodes · {focusSummary.visibleEdges}/{focusSummary.totalEdges} edges
        </span>
      {/if}
    </div>

    <div class="filter-group" aria-label="Node type filters">
      <div class="filter-header">
        <span class="filter-label">Node Types</span>
        <button type="button" class="filter-reset" onclick={onEnableAllNodeKinds}>Show all</button>
      </div>
      <div class="filter-row">
        {#each nodeKinds as kind}
          <button
            type="button"
            class="relation-pill"
            class:is-active={enabledNodeKinds.has(kind)}
            onclick={() => onToggleNodeKind(kind)}
          >
            {kind}
          </button>
        {/each}
      </div>
    </div>

    <div class="filter-group" aria-label="Relation filters">
      <div class="filter-header">
        <span class="filter-label">Edge Types</span>
        <button type="button" class="filter-reset" onclick={onEnableAllEdgeKinds}>Show all</button>
      </div>
      <div class="filter-row">
      {#each edgeKinds as kind}
        <button
          type="button"
          class="relation-pill"
          class:is-active={enabledEdgeKinds.has(kind)}
          onclick={() => onToggleEdgeKind(kind)}
        >
          {kind}
        </button>
      {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .toolbar {
    display: grid;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--color-border);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent),
      color-mix(in srgb, var(--color-surface) 92%, var(--color-bg));
  }

  .toolbar-main {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: end;
  }

  .action-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .field {
    display: grid;
    gap: 6px;
    min-width: 180px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }

  .field input,
  .field select {
    min-height: 36px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-raised) 86%, transparent);
    color: var(--color-text);
    border-radius: var(--radius-md);
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface-raised) 82%, transparent);
  }

  .action-btn {
    min-height: 36px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-raised) 82%, transparent);
    color: var(--color-text);
    border-radius: var(--radius-md);
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    cursor: pointer;
  }

  .action-btn:hover {
    border-color: var(--color-sage-border);
  }

  .toolbar-secondary {
    display: grid;
    gap: 8px;
  }

  .metric-row,
  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-group {
    display: grid;
    gap: 6px;
  }

  .filter-header {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
  }

  .filter-label {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .metric-chip,
  .relation-pill {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 4px 8px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
  }

  .relation-pill {
    cursor: pointer;
    text-transform: lowercase;
  }

  .relation-pill.is-active {
    color: var(--color-text);
    border-color: var(--color-sage-border);
    background: var(--color-sage-bg);
  }

  .metric-chip.todo {
    color: var(--color-amber);
    border-color: var(--color-amber-border);
  }

  .metric-chip.emphasis {
    color: var(--color-blue);
    border-color: var(--color-blue-border);
  }

  .filter-reset {
    border: 0;
    background: transparent;
    color: var(--color-blue);
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  @media (max-width: 860px) {
    .toolbar-main {
      align-items: stretch;
    }

    .field {
      min-width: 0;
      flex: 1 1 180px;
    }
  }
</style>
