<script lang="ts">
  import { goto } from '$app/navigation';
  import GraphWorkspace from '$lib/graph-kit/components/GraphWorkspace.svelte';
  import GraphComparePanel from '$lib/graph-kit/components/GraphComparePanel.svelte';
  import {
    buildSophiaWorkspaceFromCachedResult,
    buildSophiaWorkspaceFromCurrentSession
  } from '$lib/graph-kit/adapters/sophiaWorkspaceBuilder';
  import { buildWorkspaceCompareResult } from '$lib/graph-kit/state/compare';
  import { conversation } from '$lib/stores/conversation.svelte';
  import { comparisonStore } from '$lib/stores/comparison.svelte';
  import { graphStore } from '$lib/stores/graph.svelte';
  import { historyStore } from '$lib/stores/history.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';

  interface Props {
    onOpenReferences?: (nodeId: string) => void;
  }

  let { onOpenReferences }: Props = $props();

  let selectedNodeId = $state<string | null>(null);

  const latestUserMessage = $derived(
    [...conversation.messages].reverse().find((message) => message.role === 'user') ?? null
  );

  const latestAssistantMessage = $derived(
    [...conversation.messages].reverse().find((message) => message.role === 'assistant') ?? null
  );

  const workspace = $derived.by(() =>
    buildSophiaWorkspaceFromCurrentSession({
      nodes: graphStore.rawNodes,
      edges: graphStore.rawEdges,
      meta: graphStore.snapshotMeta,
      enrichmentStatus: graphStore.enrichmentStatus,
      activeClaims: referencesStore.activeClaims,
      relations: referencesStore.relations,
      latestUserMessage,
      latestAssistantMessage
    })
  );

  const baselineOptions = $derived.by(() =>
    historyStore.cachedResults.filter((entry) => entry.graphSnapshot || entry.claimsByPass.length > 0)
  );

  const compareResult = $derived.by(() => {
    const baseline = comparisonStore.baseline;
    if (!baseline) return null;

    const baselineWorkspace = buildSophiaWorkspaceFromCachedResult(baseline.cached);
    return buildWorkspaceCompareResult(
      {
        label: baseline.label,
        query: baseline.cached.query,
        queryRunId: baseline.cached.metadata.query_run_id,
        timestamp: baseline.cached.cachedAt,
        meta: baseline.cached.graphSnapshot?.meta,
        workspace: baselineWorkspace
      },
      {
        label: 'Current session',
        query: latestUserMessage?.content ?? latestAssistantMessage?.content ?? undefined,
        queryRunId: graphStore.snapshotMeta?.query_run_id ?? latestAssistantMessage?.metadata?.query_run_id,
        timestamp: latestAssistantMessage?.timestamp?.toISOString?.() ?? graphStore.snapshotMeta?.retrievalTimestamp,
        meta: graphStore.snapshotMeta,
        workspace
      }
    );
  });

  async function openStandaloneWorkspace(): Promise<void> {
    await goto('/map/workspace', {
      replaceState: false,
      noScroll: false,
      keepFocus: true,
      invalidateAll: false
    });
  }

  function handleBaselineChange(query: string): void {
    if (!query) {
      comparisonStore.clear();
      return;
    }

    const cached = historyStore.findCachedResult(query);
    if (!cached) return;

    comparisonStore.setBaselineFromCached(
      cached,
      `${cached.query} · ${cached.metadata.depth_mode ?? 'standard'}`
    );
  }

  function handleClearBaseline(): void {
    comparisonStore.clear();
  }

  function openSelectedNodeReferences(): void {
    if (!selectedNodeId || !onOpenReferences) return;
    onOpenReferences(selectedNodeId);
  }
</script>

<section class="map-tab-shell" aria-label="Graph workspace in SOPHIA map tab">
  <header class="map-tab-header">
    <div>
      <p class="eyebrow">Restormel Graph Kit v1</p>
      <h2>Reasoning workspace</h2>
      <p class="lede">
        The legacy SOPHIA map surface has been replaced here by the Graph Kit workspace. Compare mode is scaffolded below using cached runs as baselines.
      </p>
    </div>

    <div class="actions">
      {#if onOpenReferences && selectedNodeId}
        <button type="button" class="ghost-btn" onclick={openSelectedNodeReferences}>
          Open Selected In References
        </button>
      {/if}
      <button type="button" class="ghost-btn" onclick={openStandaloneWorkspace}>
        Open Full Workspace
      </button>
    </div>
  </header>

  <div class="workspace-shell">
    <GraphWorkspace
      {workspace}
      {selectedNodeId}
      onSelectedNodeChange={(nodeId) => selectedNodeId = nodeId}
    />
  </div>

  <GraphComparePanel
    {compareResult}
    {baselineOptions}
    selectedBaselineQuery={comparisonStore.baseline?.query ?? null}
    onBaselineChange={handleBaselineChange}
    onClearBaseline={handleClearBaseline}
    onSelectNode={(nodeId) => selectedNodeId = nodeId}
  />
</section>

<style>
  .map-tab-shell {
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 12px;
    padding: 12px;
    background:
      linear-gradient(180deg, rgba(111, 163, 212, 0.04), transparent 14%),
      var(--color-bg);
    overflow: auto;
  }

  .map-tab-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: start;
  }

  .eyebrow,
  .ghost-btn {
    font-family: var(--font-ui);
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--color-amber);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .map-tab-header h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.45rem;
  }

  .lede {
    margin: 8px 0 0;
    max-width: 72ch;
    color: var(--color-muted);
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ghost-btn {
    min-height: 38px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-raised) 88%, transparent);
    color: var(--color-text);
    padding: 0 12px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .workspace-shell {
    min-height: 720px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface);
  }

  @media (max-width: 960px) {
    .map-tab-header {
      flex-direction: column;
    }

    .workspace-shell {
      min-height: 620px;
    }
  }
</style>
