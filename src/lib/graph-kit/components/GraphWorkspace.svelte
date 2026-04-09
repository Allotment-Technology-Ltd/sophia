<script lang="ts">
  import { goto } from '$app/navigation';
  import { adaptGraphViewModelToLegacyCanvas } from '$lib/graph-kit/adapters/legacyCanvasAdapter';
  import { buildGraphSemanticStyles } from '$lib/graph-kit/rendering/graphSemantics';
  import GraphCanvas from '$lib/components/visualization/GraphCanvas.svelte';
  import {
    buildNodeInspectorPayload,
    buildWorkspaceInspectorPayload,
    collectEdgeKinds,
    collectNodeKinds,
    filterTraceEvents,
    filterWorkspaceData
  } from '$lib/graph-kit/state/query';
  import {
    collectNeighborhoodScope,
    isolateGraphToScope
  } from '$lib/graph-kit/state/focus';
  import {
    buildTracePathFocus,
    findTraceEvent,
    getDefaultTraceEventId,
    resolveTraceFocusSelection,
    stepTraceEvent
  } from '$lib/graph-kit/state/trace';
  import {
    buildFocusSummary,
    buildReadabilityWarnings,
    buildSelectionPathFocus,
    defaultNeighborhoodDepth,
    mergePathFocuses,
    reconcileKindSelection,
    sortEdgeKinds,
    sortNodeKinds,
    toggleKindSelection
  } from '$lib/graph-kit/state/workspace';
  import type {
    GraphKitEdgeKind,
    GraphKitFocusMode,
    GraphKitInspectorSectionFocus,
    GraphKitNeighborhoodDepth,
    GraphKitNodeKind,
    GraphKitPhase,
    GraphKitWorkspaceData
  } from '$lib/graph-kit/types';
  import GraphWorkspaceInspector from '$lib/graph-kit/components/GraphWorkspaceInspector.svelte';
  import GraphWorkspaceToolbar from '$lib/graph-kit/components/GraphWorkspaceToolbar.svelte';
  import GraphWorkspaceTracePanel from '$lib/graph-kit/components/GraphWorkspaceTracePanel.svelte';

  interface Props {
    workspace: GraphKitWorkspaceData;
    selectedNodeId?: string | null;
    onSelectedNodeChange?: (nodeId: string | null) => void;
    /** When true (e.g. map tab), fill the parent panel instead of forcing viewport min-height. */
    embedded?: boolean;
  }

  let {
    workspace,
    selectedNodeId: selectedNodeIdProp = undefined,
    onSelectedNodeChange,
    embedded = false
  }: Props = $props();

  let search = $state('');
  let phase = $state<'all' | GraphKitPhase>('all');
  let density = $state<'comfortable' | 'dense'>('comfortable');
  let focusMode = $state<GraphKitFocusMode>('global');
  let neighborhoodDepth = $state<GraphKitNeighborhoodDepth>(defaultNeighborhoodDepth());
  let showGhosts = $state(true);
  let localSelectedNodeId = $state<string | null>(null);
  let highlightSelectedPath = $state(false);
  let selectedTraceEventId = $state<string | null>(null);
  let focusedInspectorSection = $state<GraphKitInspectorSectionFocus | null>(null);
  let enabledNodeKinds = $state<Set<GraphKitNodeKind>>(new Set());
  let enabledEdgeKinds = $state<Set<GraphKitEdgeKind>>(new Set());
  let viewportCommandNonce = $state(0);
  let viewportCommand = $state<{ type: 'fit' | 'reset-layout'; nonce: number } | null>(null);

  const selectedNodeId = $derived(
    selectedNodeIdProp !== undefined ? selectedNodeIdProp : localSelectedNodeId
  );

  function setSelectedNodeId(nextNodeId: string | null): void {
    if (selectedNodeIdProp === undefined) {
      localSelectedNodeId = nextNodeId;
    }
    onSelectedNodeChange?.(nextNodeId);
  }

  $effect(() => {
    enabledNodeKinds = reconcileKindSelection(enabledNodeKinds, collectNodeKinds(workspace.graph.nodes));
    enabledEdgeKinds = reconcileKindSelection(enabledEdgeKinds, collectEdgeKinds(workspace.graph.edges));
  });

  const availableNodeKinds = $derived(collectNodeKinds(workspace.graph.nodes));
  const availableEdgeKinds = $derived(collectEdgeKinds(workspace.graph.edges));

  const orderedNodeKinds = $derived(sortNodeKinds(availableNodeKinds));

  const orderedEdgeKinds = $derived(sortEdgeKinds(availableEdgeKinds));

  const filtered = $derived.by(() =>
    filterWorkspaceData(
      workspace,
      {
        search,
        phase,
        density,
        nodeKinds: enabledNodeKinds,
        edgeKinds: enabledEdgeKinds,
        showGhosts
      },
      selectedNodeId
    )
  );

  const effectiveFocusMode = $derived(
    selectedNodeId ? focusMode : 'global'
  );
  const focusScope = $derived(
    collectNeighborhoodScope(filtered.graph, selectedNodeId, neighborhoodDepth)
  );
  const workspaceView = $derived.by(() =>
    effectiveFocusMode === 'local-isolate'
      ? {
          ...filtered,
          graph: isolateGraphToScope(filtered.graph, focusScope)
        }
      : filtered
  );

  const baseInspectorPayload = $derived.by(() =>
    selectedNodeId
      ? (buildNodeInspectorPayload(filtered, selectedNodeId) ?? buildWorkspaceInspectorPayload(filtered))
      : buildWorkspaceInspectorPayload(filtered)
  );

  const inspectorPayload = $derived.by(() => ({
    ...baseInspectorPayload,
    actions: selectedNodeId
      ? [
          {
            id: 'highlight-path',
            label: highlightSelectedPath ? 'Clear Highlight Path' : 'Highlight Path'
          },
          {
            id: 'local-focus',
            label: focusMode === 'local-dim' ? 'Clear Local Focus' : 'Local Focus'
          },
          {
            id: 'isolate-neighborhood',
            label: focusMode === 'local-isolate' ? 'Show Whole Graph' : 'Isolate Neighborhood'
          },
          { id: 'show-evidence', label: 'Show Evidence' },
          ...(baseInspectorPayload.actions ?? [])
        ]
      : baseInspectorPayload.actions
  }));

  const visibleTraceEvents = $derived(filterTraceEvents(workspaceView.traceEvents, phase));
  const activeTraceEvent = $derived(findTraceEvent(visibleTraceEvents, selectedTraceEventId));
  const focusSummary = $derived.by(() =>
    buildFocusSummary({
      focusMode: effectiveFocusMode,
      scopeNodeIds: focusScope.nodeIds,
      scopeEdgeIds: focusScope.edgeIds,
      totalNodes: filtered.graph.nodes.length,
      totalEdges: filtered.graph.edges.length
    })
  );
  const readabilityWarnings = $derived(buildReadabilityWarnings(filtered.graph));

  function toggleNodeKind(kind: GraphKitNodeKind): void {
    enabledNodeKinds = toggleKindSelection(enabledNodeKinds, kind, availableNodeKinds);
  }

  function toggleEdgeKind(kind: GraphKitEdgeKind): void {
    enabledEdgeKinds = toggleKindSelection(enabledEdgeKinds, kind, availableEdgeKinds);
  }

  function issueViewportCommand(type: 'fit' | 'reset-layout'): void {
    viewportCommandNonce += 1;
    viewportCommand = { type, nonce: viewportCommandNonce };
  }

  function enableAllNodeKinds(): void {
    enabledNodeKinds = new Set(availableNodeKinds);
  }

  function enableAllEdgeKinds(): void {
    enabledEdgeKinds = new Set(availableEdgeKinds);
  }

  const legacyCanvas = $derived(adaptGraphViewModelToLegacyCanvas(workspaceView.graph));
  const semanticStyles = $derived(buildGraphSemanticStyles(workspaceView.graph));
  const selectedNode = $derived(
    selectedNodeId
      ? filtered.graph.nodes.find((node) => node.id === selectedNodeId) ?? null
      : null
  );
  const selectionPath = $derived(
    buildSelectionPathFocus(filtered.graph, selectedNodeId, highlightSelectedPath)
  );
  const traceEventPath = $derived(buildTracePathFocus(activeTraceEvent, workspaceView.graph));
  const semanticPath = $derived(mergePathFocuses(selectionPath, traceEventPath));

  $effect(() => {
    if (visibleTraceEvents.length === 0) {
      selectedTraceEventId = null;
      return;
    }
    if (!selectedTraceEventId || !visibleTraceEvents.some((event) => event.id === selectedTraceEventId)) {
      selectedTraceEventId = getDefaultTraceEventId(visibleTraceEvents);
    }
  });

  $effect(() => {
    if (!selectedNodeId) {
      focusedInspectorSection = null;
      highlightSelectedPath = false;
    }
  });

  function handleSelectTraceEvent(eventId: string): void {
    selectedTraceEventId = eventId;
    const event = findTraceEvent(visibleTraceEvents, eventId);
    const traceFocus = resolveTraceFocusSelection(event, workspaceView.graph);
    if (traceFocus.selectedNodeId) {
      setSelectedNodeId(traceFocus.selectedNodeId);
    }
    if (traceFocus.focusedSection) {
      focusedInspectorSection = traceFocus.focusedSection;
    }
  }

  function handleStepTraceEvent(direction: -1 | 1): void {
    const nextEventId = stepTraceEvent(visibleTraceEvents, selectedTraceEventId, direction);
    if (!nextEventId) return;
    handleSelectTraceEvent(nextEventId);
  }

  async function handleInspectorAction(actionId: string): Promise<void> {
    if (actionId === 'highlight-path') {
      highlightSelectedPath = !highlightSelectedPath;
      focusedInspectorSection = null;
      return;
    }
    if (actionId === 'local-focus') {
      focusMode = focusMode === 'local-dim' ? 'global' : 'local-dim';
      focusedInspectorSection = null;
      return;
    }
    if (actionId === 'isolate-neighborhood') {
      focusMode = focusMode === 'local-isolate' ? 'global' : 'local-isolate';
      focusedInspectorSection = null;
      return;
    }
    if (actionId === 'show-evidence') {
      focusedInspectorSection = 'evidence';
      return;
    }
    if (actionId !== 'open-references' || !selectedNodeId) return;
    const url = new URL(window.location.href);
    url.pathname = '/app';
    url.searchParams.set('panelTab', 'references');
    url.searchParams.set('mapNode', selectedNodeId);
    await goto(url.toString(), { keepFocus: true, noScroll: false, invalidateAll: false });
  }
</script>

<section
  class="workspace"
  class:workspace--embedded={embedded}
  aria-label="Restormel graph workspace"
>
  <GraphWorkspaceToolbar
    {search}
    {phase}
    {density}
    {focusMode}
    {neighborhoodDepth}
    {showGhosts}
    nodeKinds={orderedNodeKinds}
    enabledNodeKinds={enabledNodeKinds}
    edgeKinds={orderedEdgeKinds}
    enabledEdgeKinds={enabledEdgeKinds}
    {focusSummary}
    summaryMetrics={workspaceView.summary.metrics}
    onSearchChange={(value) => search = value}
    onPhaseChange={(value) => phase = value}
    onDensityChange={(value) => density = value}
    onFocusModeChange={(value) => focusMode = value}
    onNeighborhoodDepthChange={(value) => neighborhoodDepth = value}
    onShowGhostsChange={(value) => showGhosts = value}
    onToggleNodeKind={toggleNodeKind}
    onToggleEdgeKind={toggleEdgeKind}
    onEnableAllNodeKinds={enableAllNodeKinds}
    onEnableAllEdgeKinds={enableAllEdgeKinds}
    onFitView={() => issueViewportCommand('fit')}
    onResetView={() => issueViewportCommand('reset-layout')}
  />

  <div class="workspace-main">
    <div class="canvas-shell">
      <div class="canvas-header">
        <div>
          <p class="eyebrow">Graph Canvas</p>
          <h2>Reasoning structure</h2>
        </div>
        <div class="canvas-header-meta">
          <span>{workspaceView.graph.nodes.length} visible nodes</span>
          <span>{workspaceView.graph.edges.length} visible edges</span>
          {#if activeTraceEvent}
            <span class="selection-pill is-trace">event {activeTraceEvent.sequence}: {activeTraceEvent.title}</span>
          {/if}
          {#if selectedNode}
            <span class="selection-pill">selected: {selectedNode.title}</span>
          {:else}
            <span class="selection-pill is-muted">select a node to inspect reasoning details</span>
          {/if}
        </div>
      </div>

      <div class="canvas-frame">
        {#if workspaceView.graph.nodes.length > 0}
          <GraphCanvas
            nodes={legacyCanvas.nodes}
            edges={legacyCanvas.edges}
            ghostNodes={legacyCanvas.ghostNodes}
            ghostEdges={legacyCanvas.ghostEdges}
            showGhostLayer={showGhosts}
            showInlineDetail={false}
            showStatusChip={false}
            showViewportControls={false}
            {viewportCommand}
            nodeSemanticStyles={semanticStyles.nodeStyles}
            edgeSemanticStyles={semanticStyles.edgeStyles}
            pinnedNodeIds={selectedNodeId ? [selectedNodeId] : []}
            pathNodeIds={semanticPath.nodeIds}
            pathEdges={semanticPath.edges}
            focusNodeIds={effectiveFocusMode === 'local-dim' ? focusScope.nodeIds : []}
            focusEdgeIds={effectiveFocusMode === 'local-dim' ? focusScope.edgeIds : []}
            dimOutOfScope={effectiveFocusMode === 'local-dim'}
            selectedNodeId={selectedNodeId}
            onSelectedNodeChange={setSelectedNodeId}
            onJumpToReferences={(nodeId) => {
              setSelectedNodeId(nodeId);
              handleInspectorAction('open-references');
            }}
          />
        {:else}
          <div class="canvas-empty">
            <p>No nodes match the current workspace filters.</p>
            <p>Try widening phase scope, relation filters, or search terms.</p>
          </div>
        {/if}
      </div>
      <div class="canvas-footer-note">
        <span>This screen uses the SOPHIA SVG graph canvas behind the Graph Kit adapter. Evidence and provenance are only as deep as the current SOPHIA snapshot data.</span>
        {#if focusSummary.active}
          <span>Local focus is active at {neighborhoodDepth} hop{neighborhoodDepth === 1 ? '' : 's'} around the selected node.</span>
        {/if}
        {#each readabilityWarnings as warning}
          <span>{warning}</span>
        {/each}
      </div>
    </div>

    <GraphWorkspaceInspector
      payload={inspectorPayload}
      focusedSection={focusedInspectorSection}
      onAction={handleInspectorAction}
    />
  </div>

  <GraphWorkspaceTracePanel
    events={visibleTraceEvents}
    selectedEventId={selectedTraceEventId}
    playback={workspace.playback}
    onSelectEvent={handleSelectTraceEvent}
    onStepEvent={handleStepTraceEvent}
  />
</section>

<style>
  .workspace {
    min-height: calc(100vh - var(--nav-height));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background:
      linear-gradient(180deg, rgba(111, 163, 212, 0.04) 0%, transparent 14%),
      var(--color-bg);
  }

  .workspace--embedded {
    min-height: 0;
    height: 100%;
  }

  .workspace-main {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
  }

  .canvas-shell {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .canvas-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: end;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  }

  .eyebrow,
  .canvas-header-meta span {
    font-family: var(--font-ui);
  }

  .selection-pill.is-muted {
    color: var(--color-muted);
  }

  .selection-pill.is-trace {
    border-color: color-mix(in srgb, var(--color-blue) 48%, var(--color-border));
    color: var(--color-blue);
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--color-sage);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .canvas-header h2 {
    margin: 0;
    font-size: 1.15rem;
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
  }

  .canvas-header-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .canvas-header-meta span {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 4px 8px;
    color: var(--color-muted);
    font-size: var(--text-meta);
  }

  .canvas-frame {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 520px;
    background:
      radial-gradient(circle at 20% 20%, rgba(127, 163, 131, 0.06), transparent 28%),
      radial-gradient(circle at 80% 20%, rgba(111, 163, 212, 0.05), transparent 30%),
      var(--color-bg);
  }

  .canvas-frame :global(.graph-canvas-container) {
    flex: 1 1 auto;
    min-height: 400px;
  }

  .canvas-footer-note {
    padding: 10px 16px 12px;
    border-top: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    color: var(--color-muted);
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    letter-spacing: 0.02em;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .canvas-footer-note span {
    max-width: 62ch;
  }

  .canvas-empty {
    height: 100%;
    display: grid;
    place-items: center;
    text-align: center;
    padding: 24px;
    color: var(--color-muted);
  }

  @media (max-width: 960px) {
    .workspace-main {
      grid-template-columns: 1fr;
    }

    .canvas-frame {
      min-height: 420px;
    }
  }
</style>
