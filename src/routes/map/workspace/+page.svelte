<script lang="ts">
  import { goto } from '$app/navigation';
  import GraphWorkspace from '$lib/graph-kit/components/GraphWorkspace.svelte';
  import ReasoningLineagePanel from '$lib/graph-kit/components/ReasoningLineagePanel.svelte';
  import { buildSophiaWorkspaceBundleFromCurrentSession } from '$lib/graph-kit/adapters/sophiaWorkspaceBuilder';
  import {
    buildReasoningLineageReport,
    renderReasoningLineageMarkdown
  } from '@restormel/graph-core/lineage';
  import { conversation } from '$lib/stores/conversation.svelte';
  import { graphStore } from '$lib/stores/graph.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';

  const latestUserMessage = $derived(
    [...conversation.messages].reverse().find((message) => message.role === 'user') ?? null
  );

  const latestAssistantMessage = $derived(
    [...conversation.messages].reverse().find((message) => message.role === 'assistant') ?? null
  );

  const workspaceBundle = $derived.by(() => {
    return buildSophiaWorkspaceBundleFromCurrentSession({
      nodes: graphStore.rawNodes,
      edges: graphStore.rawEdges,
      meta: graphStore.snapshotMeta,
      enrichmentStatus: graphStore.enrichmentStatus,
      activeClaims: referencesStore.activeClaims,
      relations: referencesStore.relations,
      sources: referencesStore.sources,
      groundingSources: referencesStore.groundingSources,
      latestUserMessage,
      latestAssistantMessage
    });
  });

  const workspace = $derived(workspaceBundle.workspace);
  const lineageReport = $derived.by(() =>
    buildReasoningLineageReport({
      snapshot: workspaceBundle.snapshot,
      title: 'Restormel decision-lineage report'
    })
  );
  const lineageMarkdown = $derived(renderReasoningLineageMarkdown(lineageReport));

  async function goToWorkspace(): Promise<void> {
    const url = new URL(window.location.href);
    url.pathname = '/app';
    url.searchParams.set('panelTab', 'map');
    await goto(url.toString(), { keepFocus: true, noScroll: false, invalidateAll: false });
  }
</script>

<section class="page-shell">
  <header class="page-header">
    <div>
      <p class="eyebrow">Restormel Graph Kit v1</p>
      <h1>Graph Inspection Workspace</h1>
      <p class="lede">
        Full-page Graph Kit workspace for SOPHIA: controls, canvas, inspector, trace timeline, and extraction-oriented architecture.
      </p>
    </div>
    <div class="actions">
      <button type="button" class="ghost-btn" onclick={goToWorkspace}>Back To SOPHIA</button>
    </div>
  </header>

  <div class="workspace-shell">
    <GraphWorkspace {workspace} />
  </div>

  <ReasoningLineagePanel
    report={lineageReport}
    markdown={lineageMarkdown}
    title="Decision-lineage report"
  />
</section>

<style>
  .page-shell {
    min-height: calc(100vh - var(--nav-height));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    padding: 12px;
  }

  .page-header {
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
    margin: 0 0 8px;
    color: var(--color-amber);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  h1 {
    margin: 0;
    font-size: clamp(2rem, 3vw, 2.8rem);
    line-height: 1;
  }

  .lede {
    margin: 10px 0 0;
    max-width: 72ch;
    color: var(--color-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .ghost-btn {
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    color: var(--color-text);
    border-radius: var(--radius-md);
    min-height: 38px;
    padding: 0 12px;
    cursor: pointer;
    font-size: var(--text-ui);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .workspace-shell {
    min-height: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  @media (max-width: 860px) {
    .page-header {
      flex-direction: column;
    }
  }
</style>
