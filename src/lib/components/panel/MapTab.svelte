<script lang="ts">
  import GraphCanvas from '$lib/components/visualization/GraphCanvas.svelte';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { graphStore } from '$lib/stores/graph.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { panelStore } from '$lib/stores/panel.svelte';
  import type { GraphEdge, GraphNode } from '$lib/types/api';
  import { trackEvent } from '$lib/utils/analytics';
  import { formatTraceTag, getNodeTraceTags } from '$lib/utils/graphTrace';
  import { onMount } from 'svelte';
  import type { AnalysisPhase, RelationBundle } from '$lib/types/references';

  interface Props {
    onOpenReferences?: (nodeId: string) => void;
  }

  interface MapFixture {
    nodes: GraphNode[];
    edges: GraphEdge[];
    meta?: {
      seedNodeIds?: string[];
      traversedNodeIds?: string[];
      relationTypeCounts?: Partial<Record<GraphEdge['type'], number>>;
      maxHops?: number;
      contextSufficiency?: 'strong' | 'moderate' | 'sparse';
      retrievalTimestamp?: string;
    };
  }

  interface ReasoningScores {
    logical_structure?: number;
    evidence_grounding?: number;
    counterargument_coverage?: number;
    scope_calibration?: number;
    assumption_transparency?: number;
    internal_consistency?: number;
  }

  type ViewMode = 'structure' | 'flow' | 'trust';
  type LensMode = 'all' | 'seed' | 'traversed';
  type DensityMode = 'beginner' | 'expert';
  type TimelinePhase = 'all' | 'retrieval' | 'analysis' | 'critique' | 'synthesis';
  type ConfidenceBand = 'high' | 'medium' | 'low';

  let { onOpenReferences }: Props = $props();

  const RELATION_TYPES: GraphEdge['type'][] = [
    'contains',
    'supports',
    'contradicts',
    'responds-to',
    'depends-on',
    'qualifies',
    'assumes',
    'resolves'
  ];
  const ALL_TIMELINE_PHASES: TimelinePhase[] = ['retrieval', 'analysis', 'critique', 'synthesis'];
  const ALL_CONFIDENCE_BANDS: ConfidenceBand[] = ['high', 'medium', 'low'];

  const RELATION_LABELS: Record<GraphEdge['type'], string> = {
    contains: 'Contains',
    supports: 'Supports',
    contradicts: 'Contradicts',
    'responds-to': 'Responds To',
    'depends-on': 'Depends On',
    qualifies: 'Qualifies',
    assumes: 'Assumes',
    resolves: 'Resolves'
  };

  let containerEl = $state<HTMLDivElement | null>(null);
  let viewportWidth = $state(720);
  let viewportHeight = $state(460);
  let isFullscreen = $state(false);
  let shareStatus = $state<'idle' | 'copied' | 'failed'>('idle');
  let includeSensitiveInShare = $state(false);
  let pendingSelectedNodeId = $state<string | null>(null);
  let syncingFromUrl = false;
  let hasHydrated = false;
  let lastSyncedUrl = $state<string | null>(null);
  let didAutoHydrateFromReferences = false;
  let lastDegradedReason = $state<string | null>(null);

  let viewMode = $state<ViewMode>('structure');
  let lensMode = $state<LensMode>('all');
  let densityMode = $state<DensityMode>('beginner');
  let timelinePhase = $state<TimelinePhase>('all');
  let showRejectedLayer = $state(true);

  let passFilter = $state<Set<TimelinePhase>>(new Set(ALL_TIMELINE_PHASES));
  let sourceFilter = $state<Set<string>>(new Set());
  let domainFilter = $state<Set<string>>(new Set());
  let confidenceFilter = $state<Set<ConfidenceBand>>(new Set(ALL_CONFIDENCE_BANDS));
  let pinnedNodeIds = $state<Set<string>>(new Set());
  let pathStartId = $state<string | null>(null);
  let pathEndId = $state<string | null>(null);
  let reasoningScores = $state<ReasoningScores | null>(null);

  const enabledTypes = $derived(Array.from(graphStore.relationFilter));
  const hasGraph = $derived(graphStore.nodes.length > 0 || graphStore.rawNodes.length > 0);
  const isFullPageRoute = $derived(page.url.pathname === '/map');
  const selectedNodeId = $derived(graphStore.selectedNodeId);
  const selectedNode = $derived(graphStore.rawNodes.find((node) => node.id === selectedNodeId) ?? null);
  const a11ySummary = $derived.by(() => {
    const reason = retrievalExplainability.degraded
      ? `Degraded mode active${retrievalExplainability.degradedReason ? `: ${retrievalExplainability.degradedReason}` : ''}.`
      : 'Graph ready.';
    return `Map has ${filteredGraph.nodes.length} nodes and ${filteredGraph.edges.length} edges. ${reason} ` +
      `View mode ${viewMode}. Density ${densityMode}. Lens ${lensMode}.`;
  });

  const availableSources = $derived.by(() =>
    [...new Set(graphStore.rawNodes.map((n) => n.sourceTitle).filter((v): v is string => !!v))].sort()
  );
  const availableDomains = $derived.by(() =>
    [...new Set(graphStore.rawNodes.map((n) => n.domain).filter((v): v is string => !!v))].sort()
  );

  const modeLegend = $derived.by(() => {
    if (viewMode === 'structure') {
      return [
        'Highlights relation topology and source-claim structure.',
        'Best for understanding graph shape and contradiction density.'
      ];
    }
    if (viewMode === 'flow') {
      return [
        'Emphasizes pass progression (retrieval -> analysis -> critique -> synthesis).',
        'Best for tracing how reasoning evolves through dialectical stages.'
      ];
    }
    return [
      'Emphasizes confidence bands, uncertainty, and contradiction hotspots.',
      'Best for assessing trust and where to run deeper verification.'
    ];
  });

  const retrievalExplainability = $derived.by(() => {
    const meta = graphStore.snapshotMeta;
    const seedCount = meta?.seedNodeIds?.length ?? 0;
    const traversedCount = meta?.traversedNodeIds?.length ?? 0;
    const claimNodes = graphStore.rawNodes.filter((node) => node.type === 'claim');
    const depthValues = claimNodes
      .map((node) => node.traversalDepth)
      .filter((depth): depth is number => typeof depth === 'number');
    const avgDepth = depthValues.length > 0
      ? depthValues.reduce((sum, depth) => sum + depth, 0) / depthValues.length
      : 0;
    return {
      seedCount,
      traversedCount,
      avgDepth,
      maxHops: meta?.maxHops ?? 0,
      contextSufficiency: meta?.contextSufficiency ?? 'moderate',
      degraded: meta?.retrievalDegraded ?? false,
      degradedReason: meta?.retrievalDegradedReason ?? '',
      trace: meta?.retrievalTrace
    };
  });

  const enrichmentExplainability = $derived.by(() => graphStore.enrichmentStatus);
  const rejectedGhostNodes = $derived.by(() => graphStore.snapshotMeta?.rejectedNodes ?? []);
  const rejectedGhostEdges = $derived.by(() =>
    (graphStore.snapshotMeta?.rejectedEdges ?? []).filter((edge) => graphStore.relationFilter.has(edge.type))
  );
  const rejectedReasonSummary = $derived.by(() => {
    const reasonCounts = new Map<string, number>();
    for (const node of rejectedGhostNodes) {
      reasonCounts.set(node.reasonCode, (reasonCounts.get(node.reasonCode) ?? 0) + 1);
    }
    for (const edge of rejectedGhostEdges) {
      reasonCounts.set(edge.reasonCode, (reasonCounts.get(edge.reasonCode) ?? 0) + 1);
    }
    return [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => `${formatTraceTag(reason)} (${count})`);
  });

  const contradictionHotspots = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const edge of filteredGraph.edges) {
      if (edge.type !== 'contradicts') continue;
      counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
      counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([nodeId, count]) => ({ nodeId, count, label: getNodeLabel(nodeId) }));
  });

  const uncertaintyHotspots = $derived.by(() =>
    filteredGraph.nodes
      .filter((node) => node.type === 'claim' && node.confidenceBand === 'low')
      .slice(0, 5)
      .map((node) => ({ nodeId: node.id, label: node.label }))
  );

  const analysisSupportChain = $derived.by(() => strongestChain(
    (edge) => edge.phaseOrigin === 'analysis' && edge.type === 'supports'
  ));
  const critiqueAttackChain = $derived.by(() => strongestChain(
    (edge) => edge.phaseOrigin === 'critique' && edge.type === 'contradicts'
  ));

  const synthesisResolution = $derived.by(() => {
    const contradictions = filteredGraph.edges.filter((edge) => edge.type === 'contradicts');
    const responses = filteredGraph.edges.filter((edge) => edge.type === 'responds-to');
    let resolved = 0;
    for (const contradiction of contradictions) {
      const hasResponse = responses.some((response) =>
        response.from === contradiction.from ||
        response.to === contradiction.to ||
        response.from === contradiction.to ||
        response.to === contradiction.from
      );
      if (hasResponse) resolved += 1;
    }
    return {
      total: contradictions.length,
      resolved,
      unresolved: Math.max(contradictions.length - resolved, 0)
    };
  });

  function isClaimNode(node: GraphNode): boolean {
    return node.type === 'claim';
  }

  function parseCsvSet<T extends string>(param: string | null, allowed: T[]): Set<T> {
    if (!param) return new Set(allowed);
    const values = param
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is T => allowed.includes(value as T));
    return values.length > 0 ? new Set(values) : new Set(allowed);
  }

  function parseTextSet(param: string | null): Set<string> {
    if (!param) return new Set();
    const values = param
      .split(',')
      .map((value) => decodeURIComponent(value.trim()))
      .filter((value) => value.length > 0);
    return new Set(values);
  }

  function serializeSet(values: Set<string>): string {
    return [...values].sort().map((v) => encodeURIComponent(v)).join(',');
  }

  function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  function maybeLoadFixture(url: URL): void {
    if (typeof window === 'undefined') return;
    if (url.searchParams.get('mapFixture') !== '1') return;
    const fixture = (window as Window & { __SOPHIA_MAP_FIXTURE__?: MapFixture }).__SOPHIA_MAP_FIXTURE__;
    if (!fixture) return;
    graphStore.setGraph(fixture.nodes, fixture.edges, fixture.meta, 1);
  }

  function maybeLoadReasoningScores(): void {
    if (typeof window === 'undefined') return;
    const scores = (window as Window & { __SOPHIA_REASONING_SCORES__?: ReasoningScores }).__SOPHIA_REASONING_SCORES__;
    if (scores) reasoningScores = scores;
  }

  function syncFromUrl(): void {
    if (typeof window === 'undefined') return;
    syncingFromUrl = true;

    const url = new URL(window.location.href);
    lastSyncedUrl = url.toString();
    maybeLoadFixture(url);
    maybeLoadReasoningScores();

    const relationSet = parseCsvSet(url.searchParams.get('mapRel'), RELATION_TYPES);
    if (!setsEqual(new Set(graphStore.relationFilter), relationSet)) {
      graphStore.applyRelationFilter([...relationSet]);
    }
    pendingSelectedNodeId = url.searchParams.get('mapNode');
    const nextPinned = parseTextSet(url.searchParams.get('mapPinned'));
    if (!setsEqual(pinnedNodeIds, nextPinned)) pinnedNodeIds = nextPinned;

    const mode = url.searchParams.get('mapView');
    const lens = url.searchParams.get('mapLens');
    const density = url.searchParams.get('mapDensity');
    const phase = url.searchParams.get('mapPhase');
    viewMode = mode === 'flow' || mode === 'trust' ? mode : 'structure';
    lensMode = lens === 'seed' || lens === 'traversed' ? lens : 'all';
    densityMode = density === 'expert' ? 'expert' : 'beginner';
    timelinePhase = phase && ALL_TIMELINE_PHASES.includes(phase as TimelinePhase) ? (phase as TimelinePhase) : 'all';

    const nextPass = parseCsvSet(url.searchParams.get('mapPass'), ALL_TIMELINE_PHASES);
    const nextConf = parseCsvSet(url.searchParams.get('mapConf'), ALL_CONFIDENCE_BANDS);
    const nextSource = parseTextSet(url.searchParams.get('mapSource'));
    const nextDomain = parseTextSet(url.searchParams.get('mapDomain'));
    if (!setsEqual(passFilter, nextPass)) passFilter = nextPass;
    if (!setsEqual(confidenceFilter, nextConf)) confidenceFilter = nextConf;
    if (!setsEqual(sourceFilter, nextSource)) sourceFilter = nextSource;
    if (!setsEqual(domainFilter, nextDomain)) domainFilter = nextDomain;

    hasHydrated = true;
    syncingFromUrl = false;
  }

  function applyMapParamsToUrl(url: URL, includeSensitive: boolean): void {
    url.searchParams.set('panelTab', 'map');

    const relationParam = serializeSet(new Set([...graphStore.relationFilter]));
    const allRelations = [...RELATION_TYPES].sort().join(',');
    if (relationParam === allRelations) url.searchParams.delete('mapRel');
    else url.searchParams.set('mapRel', relationParam);

    if (selectedNodeId) url.searchParams.set('mapNode', selectedNodeId);
    else url.searchParams.delete('mapNode');

    if (pinnedNodeIds.size > 0) url.searchParams.set('mapPinned', serializeSet(pinnedNodeIds));
    else url.searchParams.delete('mapPinned');

    if (viewMode !== 'structure') url.searchParams.set('mapView', viewMode);
    else url.searchParams.delete('mapView');
    if (lensMode !== 'all') url.searchParams.set('mapLens', lensMode);
    else url.searchParams.delete('mapLens');
    if (densityMode !== 'beginner') url.searchParams.set('mapDensity', densityMode);
    else url.searchParams.delete('mapDensity');
    if (timelinePhase !== 'all') url.searchParams.set('mapPhase', timelinePhase);
    else url.searchParams.delete('mapPhase');

    const allPass = [...ALL_TIMELINE_PHASES].sort().join(',');
    const passParam = serializeSet(new Set([...passFilter]));
    if (passParam !== allPass) url.searchParams.set('mapPass', passParam);
    else url.searchParams.delete('mapPass');

    const allConf = [...ALL_CONFIDENCE_BANDS].sort().join(',');
    const confParam = serializeSet(new Set([...confidenceFilter]));
    if (confParam !== allConf) url.searchParams.set('mapConf', confParam);
    else url.searchParams.delete('mapConf');

    if (includeSensitive) {
      url.searchParams.delete('mapShare');
      if (sourceFilter.size > 0) url.searchParams.set('mapSource', serializeSet(sourceFilter));
      else url.searchParams.delete('mapSource');
      if (domainFilter.size > 0) url.searchParams.set('mapDomain', serializeSet(domainFilter));
      else url.searchParams.delete('mapDomain');
    } else {
      url.searchParams.delete('mapSource');
      url.searchParams.delete('mapDomain');
      url.searchParams.set('mapShare', 'safe');
    }
  }

  function syncToUrl(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    applyMapParamsToUrl(url, true);
    const next = url.toString();
    if (next === window.location.href || next === lastSyncedUrl) return;
    lastSyncedUrl = next;
    replaceState(next, page.state);
  }

  function openFullPageMap(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    applyMapParamsToUrl(url, true);
    url.pathname = '/map';
    url.searchParams.delete('panelTab');
    void goto(url.toString(), { replaceState: false, noScroll: true, keepFocus: true, invalidateAll: false });
  }

  function openPanelMap(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    applyMapParamsToUrl(url, true);
    url.pathname = '/';
    url.searchParams.set('panelTab', 'map');
    void goto(url.toString(), { replaceState: false, noScroll: true, keepFocus: true, invalidateAll: false });
  }

  async function toggleFullscreen(): Promise<void> {
    if (typeof document === 'undefined' || !containerEl) return;
    try {
      if (document.fullscreenElement === containerEl) {
        await document.exitFullscreen();
      } else {
        await containerEl.requestFullscreen();
      }
    } catch {
      // browser denied fullscreen request (e.g. unsupported or blocked by policy)
    }
  }

  function toggleRelationType(type: GraphEdge['type']): void {
    const next = new Set(graphStore.relationFilter);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    graphStore.applyRelationFilter(Array.from(next));
  }

  function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function claimPassesFilters(node: GraphNode): boolean {
    if (!isClaimNode(node)) return true;
    if (lensMode === 'seed' && !node.isSeed) return false;
    if (lensMode === 'traversed' && !node.isTraversed) return false;
    if (!passFilter.has((node.phase as TimelinePhase) ?? 'retrieval')) return false;
    if (sourceFilter.size > 0 && (!node.sourceTitle || !sourceFilter.has(node.sourceTitle))) return false;
    if (domainFilter.size > 0 && (!node.domain || !domainFilter.has(node.domain))) return false;
    if (node.confidenceBand && !confidenceFilter.has(node.confidenceBand)) return false;
    return true;
  }

  const filteredGraph = $derived.by(() => {
    const nodes = graphStore.nodes;
    const edges = graphStore.edges;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    let filteredEdges = edges.filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to));

    if (timelinePhase !== 'all') {
      filteredEdges = filteredEdges.filter((edge) => edge.phaseOrigin === timelinePhase || edge.type === 'contains');
    }

    filteredEdges = filteredEdges.filter((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return false;
      return claimPassesFilters(from) && claimPassesFilters(to);
    });

    if (densityMode === 'beginner') {
      const hasNonContains = filteredEdges.some((edge) => edge.type !== 'contains');
      if (hasNonContains) {
        filteredEdges = filteredEdges.filter((edge) => edge.type !== 'contains');
      }
    }

    const visibleNodeIds = new Set<string>();
    filteredEdges.forEach((edge) => {
      visibleNodeIds.add(edge.from);
      visibleNodeIds.add(edge.to);
    });
    if (selectedNodeId) visibleNodeIds.add(selectedNodeId);
    pinnedNodeIds.forEach((id) => visibleNodeIds.add(id));

    if (visibleNodeIds.size === 0) {
      const claimCandidates = nodes.filter((node) => isClaimNode(node) && claimPassesFilters(node));
      const claimCandidateIds = new Set(claimCandidates.map((node) => node.id));
      for (const claimId of claimCandidateIds) visibleNodeIds.add(claimId);
      // Keep source context visible for isolated claims.
      for (const edge of graphStore.rawEdges) {
        if (edge.type !== 'contains') continue;
        if (claimCandidateIds.has(edge.to)) visibleNodeIds.add(edge.from);
      }
    }

    const filteredNodes = nodes.filter((node) => {
      if (!visibleNodeIds.has(node.id)) return false;
      return claimPassesFilters(node);
    });

    return { nodes: filteredNodes, edges: filteredEdges };
  });

  function buildPath(startId: string, endId: string): string[] {
    if (startId === endId) return [startId];
    const adjacency = new Map<string, Set<string>>();
    for (const edge of graphStore.rawEdges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
      adjacency.get(edge.from)?.add(edge.to);
      adjacency.get(edge.to)?.add(edge.from);
    }

    const queue: string[] = [startId];
    const visited = new Set<string>([startId]);
    const prev = new Map<string, string>();

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) break;
      if (node === endId) break;
      for (const next of adjacency.get(node) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        prev.set(next, node);
        queue.push(next);
      }
    }

    if (!visited.has(endId)) return [];
    const path: string[] = [];
    let current: string | undefined = endId;
    while (current) {
      path.push(current);
      current = prev.get(current);
    }
    return path.reverse();
  }

  const pathNodeIds = $derived.by(() => {
    if (!pathStartId || !pathEndId) return [];
    return buildPath(pathStartId, pathEndId);
  });

  const pathEdges = $derived.by(() => {
    const result: Array<{ from: string; to: string }> = [];
    if (pathNodeIds.length < 2) return result;
    for (let i = 0; i < pathNodeIds.length - 1; i += 1) {
      result.push({ from: pathNodeIds[i], to: pathNodeIds[i + 1] });
    }
    return result;
  });

  function getNodeLabel(nodeId: string): string {
    return graphStore.rawNodes.find((node) => node.id === nodeId)?.label ?? nodeId;
  }

  function getNodeTraceSummary(node: GraphNode): string {
    const tags = getNodeTraceTags(node).slice(0, 5);
    return tags.length > 0 ? tags.map((tag) => formatTraceTag(tag)).join(' · ') : 'n/a';
  }

  function strongestChain(edgeFilter: (edge: GraphEdge) => boolean): string[] {
    const edges = filteredGraph.edges.filter(edgeFilter);
    if (edges.length === 0) return [];
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
    let current = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!current) return [];

    const chain = [current];
    const visited = new Set<string>([current]);
    for (let i = 0; i < 4; i += 1) {
      const nextCandidates = edges
        .filter((edge) => edge.from === current || edge.to === current)
        .map((edge) => edge.from === current ? edge.to : edge.from)
        .filter((nodeId) => !visited.has(nodeId))
        .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));
      const next = nextCandidates[0];
      if (!next) break;
      chain.push(next);
      visited.add(next);
      current = next;
    }
    return chain;
  }

  function scrollPassForNode(node: GraphNode | null): void {
    if (!node || !node.phase || node.phase === 'retrieval') return;
    document.getElementById(`pass-${node.phase}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openNodeInReferences(nodeId: string): void {
    if (onOpenReferences) {
      onOpenReferences(nodeId);
      return;
    }
    panelStore.openPanel();
    const normalized = nodeId.startsWith('claim:') ? nodeId.replace('claim:', '') : nodeId;
    setTimeout(() => {
      const claimEl = document.getElementById(`claim-card-${normalized}`) ?? document.getElementById(`claim-card-${nodeId}`);
      claimEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      claimEl?.focus?.();
    }, 120);
  }

  function handleNodeSelect(nodeId: string): void {
    graphStore.selectNode(nodeId);
    const selected = graphStore.rawNodes.find((node) => node.id === nodeId) ?? null;
    if (selected) {
      trackEvent('map_node_selected', { node_type: selected.type });
    }
    scrollPassForNode(selected);
  }

  function pinSelectedNode(): void {
    if (!selectedNodeId) return;
    pinnedNodeIds = toggleSetValue(pinnedNodeIds, selectedNodeId);
  }

  function setPathStart(): void {
    if (!selectedNodeId) return;
    pathStartId = selectedNodeId;
  }

  function setPathEnd(): void {
    if (!selectedNodeId) return;
    pathEndId = selectedNodeId;
  }

  function clearPath(): void {
    pathStartId = null;
    pathEndId = null;
  }

  function applyBeginnerPreset(): void {
    densityMode = 'beginner';
    viewMode = 'structure';
    lensMode = 'all';
    timelinePhase = 'all';
    graphStore.applyRelationFilter(['supports', 'contradicts', 'responds-to']);
    passFilter = new Set(ALL_TIMELINE_PHASES);
    sourceFilter = new Set();
    domainFilter = new Set();
    confidenceFilter = new Set(ALL_CONFIDENCE_BANDS);
  }

  function applyExpertPreset(): void {
    densityMode = 'expert';
    graphStore.resetFilters();
    passFilter = new Set(ALL_TIMELINE_PHASES);
    confidenceFilter = new Set(ALL_CONFIDENCE_BANDS);
  }

  function rebuildGraphFromSession(): void {
    const claims = referencesStore.activeClaims;
    if (claims.length === 0) return;

    const claimsByPhase: Record<AnalysisPhase, typeof claims> = {
      analysis: [],
      critique: [],
      synthesis: []
    };

    for (const claim of claims) {
      claimsByPhase[claim.phase].push(claim);
    }

    const claimPhase = new Map<string, AnalysisPhase>();
    for (const claim of claims) {
      claimPhase.set(claim.id, claim.phase);
    }

    const relationsByPhase: Record<AnalysisPhase, RelationBundle[]> = {
      analysis: [],
      critique: [],
      synthesis: []
    };

    for (const bundle of referencesStore.relations) {
      const phase = claimPhase.get(bundle.claimId) ?? 'analysis';
      relationsByPhase[phase].push(bundle);
    }

    graphStore.reset();
    for (const phase of ['analysis', 'critique', 'synthesis'] as const) {
      graphStore.addFromClaims(phase, claimsByPhase[phase], relationsByPhase[phase]);
    }
  }

  async function copyShareLink(): Promise<void> {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    applyMapParamsToUrl(url, includeSensitiveInShare);
    try {
      await navigator.clipboard.writeText(url.toString());
      shareStatus = 'copied';
      trackEvent('map_share_link_copied', { safe_mode: !includeSensitiveInShare });
    } catch {
      shareStatus = 'failed';
    }
    setTimeout(() => { shareStatus = 'idle'; }, 1500);
  }

  onMount(() => {
    syncFromUrl();
    const onPopState = () => syncFromUrl();
    const onFullscreenChange = () => {
      isFullscreen = typeof document !== 'undefined' && document.fullscreenElement === containerEl;
    };
    window.addEventListener('popstate', onPopState);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  });

  $effect(() => {
    if (!containerEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      viewportWidth = Math.max(320, Math.floor(entry.contentRect.width));
      viewportHeight = Math.max(320, Math.floor(entry.contentRect.height));
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!pendingSelectedNodeId || !hasGraph) return;
    if (graphStore.rawNodes.some((node) => node.id === pendingSelectedNodeId)) {
      graphStore.selectNode(pendingSelectedNodeId);
      pendingSelectedNodeId = null;
    }
  });

  $effect(() => {
    if (hasGraph) {
      didAutoHydrateFromReferences = false;
      return;
    }
    if (didAutoHydrateFromReferences) return;
    if (referencesStore.activeClaims.length === 0) return;
    rebuildGraphFromSession();
    didAutoHydrateFromReferences = true;
  });

  $effect(() => {
    if (!hasHydrated || syncingFromUrl) return;
    syncToUrl();
  });

  $effect(() => {
    if (!retrievalExplainability.degraded) {
      lastDegradedReason = null;
      return;
    }
    const reason = retrievalExplainability.degradedReason || 'degraded';
    if (reason === lastDegradedReason) return;
    trackEvent('map_degraded_state', { reason });
    lastDegradedReason = reason;
  });
</script>

<section class="map-tab" aria-label="Argument map" data-testid="map-root">
  <div class="map-header">
    <h3>Map</h3>
    <p>Structure, reasoning flow, and trust overlays for argument exploration.</p>
  </div>

  <div class="map-metrics">
    <span>{filteredGraph.nodes.length} nodes</span>
    <span>{filteredGraph.edges.length} edges</span>
    <span>{rejectedGhostNodes.length} rejected nodes</span>
    <span>{rejectedGhostEdges.length} rejected edges</span>
    <span>{graphStore.snapshotMeta?.seedNodeIds?.length ?? 0} seed nodes</span>
    <span>sufficiency: {retrievalExplainability.contextSufficiency}</span>
    <span>v{graphStore.snapshotVersion}</span>
    {#if !hasGraph && referencesStore.activeClaims.length > 0}
      <button type="button" class="mini-btn" onclick={rebuildGraphFromSession}>
        Load Graph From Analysis
      </button>
    {/if}
  </div>

  <div class="mode-row" role="tablist" aria-label="Map view modes">
    <button class="mode-btn" class:is-active={viewMode === 'structure'} data-testid="mode-structure" onclick={() => { viewMode = 'structure'; trackEvent('map_mode_changed', { mode: 'structure' }); }}>Structure</button>
    <button class="mode-btn" class:is-active={viewMode === 'flow'} data-testid="mode-flow" onclick={() => { viewMode = 'flow'; trackEvent('map_mode_changed', { mode: 'flow' }); }}>Reasoning Flow</button>
    <button class="mode-btn" class:is-active={viewMode === 'trust'} data-testid="mode-trust" onclick={() => { viewMode = 'trust'; trackEvent('map_mode_changed', { mode: 'trust' }); }}>Trust</button>
  </div>

  <div class="legend-card">
    <p class="legend-title">{viewMode === 'structure' ? 'Structure Legend' : viewMode === 'flow' ? 'Flow Legend' : 'Trust Legend'}</p>
    {#each modeLegend as line}
      <p class="legend-line">{line}</p>
    {/each}
  </div>

  <div class="map-controls">
    {#each RELATION_TYPES as type}
      <button
        type="button"
        class="filter-pill"
        class:is-active={enabledTypes.includes(type)}
        onclick={() => toggleRelationType(type)}
      >
        {RELATION_LABELS[type]}
      </button>
    {/each}
    <button type="button" class="filter-pill" onclick={() => graphStore.resetFilters()}>Reset</button>
    <button type="button" class="filter-pill share" data-testid="share-view" onclick={copyShareLink}>
      {shareStatus === 'copied' ? 'Copied' : shareStatus === 'failed' ? 'Copy Failed' : 'Share View'}
    </button>
    {#if isFullPageRoute}
      <button type="button" class="filter-pill" data-testid="toggle-fullscreen" onclick={toggleFullscreen}>
        {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      </button>
      <button type="button" class="filter-pill" onclick={openPanelMap}>Open In Panel</button>
    {:else}
      <button type="button" class="filter-pill is-active" onclick={openFullPageMap}>Open Full Page</button>
    {/if}
    <label class="share-safe-toggle">
      <input type="checkbox" bind:checked={includeSensitiveInShare} />
      Include source/domain filters in share URL
    </label>
  </div>

  <div class="storyline-row">
    <label>
      Timeline
      <select bind:value={timelinePhase}>
        <option value="all">All phases</option>
        <option value="retrieval">Retrieval</option>
        <option value="analysis">Analysis</option>
        <option value="critique">Critique</option>
        <option value="synthesis">Synthesis</option>
      </select>
    </label>

    <label>
      Lens
      <select bind:value={lensMode}>
        <option value="all">All nodes</option>
        <option value="seed">Seed only</option>
        <option value="traversed">Traversed only</option>
      </select>
    </label>

    <label>
      Density
      <select bind:value={densityMode}>
        <option value="beginner">Beginner</option>
        <option value="expert">Expert</option>
      </select>
    </label>

    <button type="button" class="preset-btn" onclick={applyBeginnerPreset}>Beginner Preset</button>
    <button type="button" class="preset-btn" onclick={applyExpertPreset}>Expert Preset</button>
    <button
      type="button"
      class="preset-btn"
      class:is-active={showRejectedLayer}
      onclick={() => showRejectedLayer = !showRejectedLayer}
      title="Show candidates considered by retrieval but gated out"
    >
      {showRejectedLayer ? 'Hide Rejected Layer' : 'Show Rejected Layer'}
    </button>
  </div>

  <div class="expert-row">
    <div class="chip-group">
      <span class="chip-label">Pass</span>
      {#each ALL_TIMELINE_PHASES as phase}
        <button
          class="chip-btn"
          class:is-active={passFilter.has(phase)}
          onclick={() => passFilter = toggleSetValue(passFilter, phase)}
        >
          {phase}
        </button>
      {/each}
    </div>

    <div class="chip-group">
      <span class="chip-label">Confidence</span>
      {#each ALL_CONFIDENCE_BANDS as band}
        <button
          class="chip-btn"
          class:is-active={confidenceFilter.has(band)}
          onclick={() => confidenceFilter = toggleSetValue(confidenceFilter, band)}
        >
          {band}
        </button>
      {/each}
    </div>
  </div>

  <div class="expert-row">
    <div class="chip-group">
      <span class="chip-label">Source</span>
      {#if availableSources.length === 0}
        <span class="chip-empty">No source facets yet</span>
      {:else}
        {#each availableSources as source}
          <button
            class="chip-btn"
            class:is-active={sourceFilter.has(source)}
            onclick={() => sourceFilter = toggleSetValue(sourceFilter, source)}
          >
            {source}
          </button>
        {/each}
      {/if}
    </div>

    <div class="chip-group">
      <span class="chip-label">Domain</span>
      {#if availableDomains.length === 0}
        <span class="chip-empty">No domain facets yet</span>
      {:else}
        {#each availableDomains as domain}
          <button
            class="chip-btn"
            class:is-active={domainFilter.has(domain)}
            onclick={() => domainFilter = toggleSetValue(domainFilter, domain)}
          >
            {domain}
          </button>
        {/each}
      {/if}
    </div>
  </div>

  <div class="map-canvas-wrap" class:is-fullscreen={isFullscreen} class:is-resizable={isFullPageRoute} bind:this={containerEl}>
    {#if !isFullPageRoute}
      <div class="map-panel-guidance" role="note" aria-live="polite">
        <p class="map-panel-guidance-title">Graph Preview Disabled In Side Panel</p>
        <p>Use full page mode for readable labels, interaction detail, and shortest-path exploration.</p>
        <button type="button" class="mini-btn" onclick={openFullPageMap}>Open Full Page Map</button>
      </div>
    {:else if hasGraph && filteredGraph.nodes.length > 0}
      <GraphCanvas
        nodes={filteredGraph.nodes}
        edges={filteredGraph.edges}
        ghostNodes={rejectedGhostNodes}
        ghostEdges={rejectedGhostEdges}
        showGhostLayer={showRejectedLayer}
        width={viewportWidth}
        height={viewportHeight}
        {isFullscreen}
        pinnedNodeIds={[...pinnedNodeIds]}
        pathNodeIds={pathNodeIds}
        pathEdges={pathEdges}
        onToggleFullscreen={toggleFullscreen}
        onNodeSelect={handleNodeSelect}
        onJumpToReferences={(nodeId) => openNodeInReferences(nodeId)}
      />
    {:else if hasGraph}
      <div class="map-empty">
        <p>No nodes match the current filters.</p>
        <p>Try enabling <code>depends-on</code> and/or switching to Expert density.</p>
        <div class="insight-actions">
          <button class="mini-btn" type="button" onclick={() => graphStore.resetFilters()}>Reset relations</button>
          <button class="mini-btn" type="button" onclick={applyExpertPreset}>Expert preset</button>
        </div>
      </div>
    {:else if graphStore.lifecycle === 'loading'}
      <p class="map-empty">Building graph snapshot…</p>
    {:else if graphStore.lifecycle === 'degraded'}
      <div class="map-empty degraded" role="status" aria-live="polite">
        <p>Graph visualization is in degraded mode.</p>
        <p>Reason: {retrievalExplainability.degradedReason || graphStore.error || 'Graph context unavailable for this query.'}</p>
        <button class="mini-btn" type="button" onclick={() => openNodeInReferences(selectedNodeId ?? '')} disabled={!selectedNodeId}>
          Open selected node in References
        </button>
      </div>
    {:else}
      <div class="map-empty">
        <p>Map is empty for this session.</p>
        <p>How to load it:</p>
        <ol>
          <li>Run a new analysis query from the main prompt.</li>
          <li>Wait for the synthesis pass to complete.</li>
          <li>Return to the Map tab (or open <code>/map</code>).</li>
        </ol>
      </div>
    {/if}
  </div>

  <div class="insight-grid">
    <div class="insight-card">
      <p class="insight-title">Shortest Path</p>
      <div class="insight-actions">
        <button class="mini-btn" data-testid="set-path-start" onclick={setPathStart} disabled={!selectedNodeId}>Set Start</button>
        <button class="mini-btn" data-testid="set-path-end" onclick={setPathEnd} disabled={!selectedNodeId}>Set End</button>
        <button class="mini-btn" onclick={clearPath} disabled={!pathStartId && !pathEndId}>Clear</button>
      </div>
      {#if pathStartId}<p class="insight-row">Start: {getNodeLabel(pathStartId)}</p>{/if}
      {#if pathEndId}<p class="insight-row">End: {getNodeLabel(pathEndId)}</p>{/if}
      {#if pathNodeIds.length > 1}
        <p class="insight-row" data-testid="path-length">Path length: {pathNodeIds.length - 1} hops</p>
      {:else if pathStartId && pathEndId}
        <p class="insight-row">No path found in current graph.</p>
      {/if}
    </div>

    <div class="insight-card">
      <p class="insight-title">Why This Node?</p>
      {#if selectedNode}
        <p class="insight-row"><strong>Label:</strong> {selectedNode.label}</p>
        <p class="insight-row"><strong>Type:</strong> {selectedNode.type}</p>
        <p class="insight-row"><strong>Phase:</strong> {selectedNode.phase ?? 'unknown'}</p>
        <p class="insight-row"><strong>Trace tags:</strong> {getNodeTraceSummary(selectedNode)}</p>
        <p class="insight-row"><strong>Traversal depth:</strong> {selectedNode.traversalDepth ?? 'n/a'}</p>
        <p class="insight-row"><strong>Seed/Traversed:</strong> {selectedNode.isSeed ? 'Seed' : selectedNode.isTraversed ? 'Traversed' : 'N/A'}</p>
        <p class="insight-row"><strong>Confidence:</strong> {selectedNode.confidenceBand ?? 'n/a'}</p>
        <p class="insight-row"><strong>Domain:</strong> {selectedNode.domain ?? 'n/a'}</p>
        <p class="insight-row"><strong>Provenance:</strong> {selectedNode.provenance_id ?? 'n/a'}</p>
        <p class="insight-row"><strong>Tension cluster:</strong> {selectedNode.unresolved_tension_id ?? 'n/a'}</p>
        <div class="insight-actions">
          <button class="mini-btn" onclick={pinSelectedNode}>{pinnedNodeIds.has(selectedNode.id) ? 'Unpin' : 'Pin'}</button>
          <button class="mini-btn" data-testid="open-in-references" onclick={() => openNodeInReferences(selectedNode.id)}>Open in References</button>
        </div>
      {:else}
        <p class="insight-row">Select a node to inspect provenance and relation rationale.</p>
      {/if}
    </div>
  </div>

  <div class="insight-grid">
    <div class="insight-card">
      <p class="insight-title">Retrieval Explainability</p>
      <p class="insight-row">Seed nodes: {retrievalExplainability.seedCount}</p>
      <p class="insight-row">Traversed nodes: {retrievalExplainability.traversedCount}</p>
      <p class="insight-row">Avg traversal depth: {retrievalExplainability.avgDepth.toFixed(2)}</p>
      <p class="insight-row">Max hops: {retrievalExplainability.maxHops}</p>
      <p class="insight-row">Context sufficiency: {retrievalExplainability.contextSufficiency}</p>
      <p class="insight-row">Rejected nodes (gated): {rejectedGhostNodes.length}</p>
      <p class="insight-row">Rejected edges (gated): {rejectedGhostEdges.length}</p>
      {#if retrievalExplainability.trace}
        <p class="insight-subtitle">Traversal ledger</p>
        <p class="insight-row">Seed pool examined: {retrievalExplainability.trace.seedPoolCount}</p>
        <p class="insight-row">Seeds selected: {retrievalExplainability.trace.selectedSeedCount}</p>
        <p class="insight-row">Claims discovered by traversal: {retrievalExplainability.trace.traversedClaimCount}</p>
        <p class="insight-row">Relation candidates checked: {retrievalExplainability.trace.relationCandidateCount}</p>
        <p class="insight-row">Relations retained: {retrievalExplainability.trace.relationKeptCount}</p>
        <p class="insight-row">Arguments checked: {retrievalExplainability.trace.argumentCandidateCount}</p>
        <p class="insight-row">Arguments retained: {retrievalExplainability.trace.argumentKeptCount}</p>
        <p class="insight-row">Rejected claim candidates: {retrievalExplainability.trace.rejectedClaimCount ?? 0}</p>
        <p class="insight-row">Rejected relation candidates: {retrievalExplainability.trace.rejectedRelationCount ?? 0}</p>
      {/if}
      {#if rejectedReasonSummary.length > 0}
        <p class="insight-subtitle">Top rejection reasons</p>
        {#each rejectedReasonSummary as row}
          <p class="insight-row">{row}</p>
        {/each}
      {/if}
      {#if retrievalExplainability.degraded}
        <p class="insight-row warning">Degraded retrieval: {retrievalExplainability.degradedReason || 'unknown'}</p>
      {/if}
      {#if enrichmentExplainability}
        <p class="insight-subtitle">Enrichment gating</p>
        <p class="insight-row">Status: {enrichmentExplainability.status}</p>
        <p class="insight-row">Staged candidates: {enrichmentExplainability.stagedCount ?? 0}</p>
        <p class="insight-row">Promoted to canonical: {enrichmentExplainability.promotedCount ?? 0}</p>
        {#if enrichmentExplainability.reason}
          <p class="insight-row">Suppression/decision reason: {enrichmentExplainability.reason}</p>
        {/if}
      {/if}
    </div>

    <div class="insight-card">
      <p class="insight-title">Trust Hotspots</p>
      <p class="insight-subtitle">Contradiction hotspots</p>
      {#if contradictionHotspots.length === 0}
        <p class="insight-row">No contradiction hotspots in filtered graph.</p>
      {:else}
        {#each contradictionHotspots as hotspot}
          <p class="insight-row">{hotspot.label} ({hotspot.count})</p>
        {/each}
      {/if}
      <p class="insight-subtitle">Low-confidence claims</p>
      {#if uncertaintyHotspots.length === 0}
        <p class="insight-row">No low-confidence hotspots in filtered graph.</p>
      {:else}
        {#each uncertaintyHotspots as hotspot}
          <p class="insight-row">{hotspot.label}</p>
        {/each}
      {/if}
    </div>
  </div>

  <div class="insight-grid">
    <div class="insight-card">
      <p class="insight-title">Comparative Insight</p>
      <p class="insight-subtitle">Analysis support chain</p>
      {#if analysisSupportChain.length > 0}
        <p class="insight-row">{analysisSupportChain.map(getNodeLabel).join(' -> ')}</p>
      {:else}
        <p class="insight-row">No analysis support chain detected yet.</p>
      {/if}
      <p class="insight-subtitle">Critique attack chain</p>
      {#if critiqueAttackChain.length > 0}
        <p class="insight-row">{critiqueAttackChain.map(getNodeLabel).join(' -> ')}</p>
      {:else}
        <p class="insight-row">No critique attack chain detected yet.</p>
      {/if}
    </div>

    <div class="insight-card">
      <p class="insight-title">Synthesis Resolution Map</p>
      <p class="insight-row">Contradictions: {synthesisResolution.total}</p>
      <p class="insight-row">Resolved by responses: {synthesisResolution.resolved}</p>
      <p class="insight-row">Unresolved tensions: {synthesisResolution.unresolved}</p>

      <p class="insight-subtitle">Reasoning quality (when available)</p>
      {#if reasoningScores}
        <p class="insight-row">Logical structure: {(reasoningScores.logical_structure ?? 0).toFixed(2)}</p>
        <p class="insight-row">Evidence grounding: {(reasoningScores.evidence_grounding ?? 0).toFixed(2)}</p>
        <p class="insight-row">Counterargument coverage: {(reasoningScores.counterargument_coverage ?? 0).toFixed(2)}</p>
        <p class="insight-row">Scope calibration: {(reasoningScores.scope_calibration ?? 0).toFixed(2)}</p>
        <p class="insight-row">Assumption transparency: {(reasoningScores.assumption_transparency ?? 0).toFixed(2)}</p>
        <p class="insight-row">Internal consistency: {(reasoningScores.internal_consistency ?? 0).toFixed(2)}</p>
      {:else}
        <p class="insight-row">No reasoning score payload available in this session.</p>
      {/if}
    </div>
  </div>

  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {a11ySummary}
  </div>
</section>

<style>
  .map-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    min-height: 0;
    padding: var(--space-3);
  }

  .map-header h3 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .map-header p, .map-metrics, .chip-empty, .insight-row, .legend-line {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    color: var(--color-muted);
    line-height: 1.45;
  }

  .map-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .legend-card {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .legend-title, .chip-label, .insight-title, .insight-subtitle {
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    text-transform: uppercase;
    color: var(--color-text);
    letter-spacing: 0.06em;
    margin: 0;
  }

  .mode-row, .map-controls, .storyline-row, .expert-row, .insight-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
  }

  .share-safe-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    color: var(--color-muted);
  }

  .mode-btn, .filter-pill, .preset-btn, .chip-btn, .mini-btn {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-muted);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
  }

  .mode-btn:hover, .filter-pill:hover, .preset-btn:hover, .chip-btn:hover, .mini-btn:hover {
    color: var(--color-text);
    border-color: var(--color-muted);
  }

  .mode-btn.is-active, .chip-btn.is-active, .filter-pill.is-active, .preset-btn.is-active {
    color: var(--color-text);
    border-color: var(--color-sage-border);
  }

  .storyline-row label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    color: var(--color-muted);
  }

  .storyline-row select {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    padding: 5px 7px;
  }

  .chip-group {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    flex-wrap: wrap;
  }

  .map-canvas-wrap {
    height: clamp(420px, 62vh, 920px);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    overflow: hidden;
  }

  .map-canvas-wrap.is-resizable {
    resize: vertical;
    overflow: auto;
    min-height: 420px;
    max-height: 90vh;
  }

  .map-canvas-wrap.is-fullscreen {
    height: 100vh;
    border-radius: 0;
  }

  .map-empty {
    margin: 0;
    padding: var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    color: var(--color-muted);
  }

  .map-panel-guidance {
    margin: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--color-sage-border);
    background: linear-gradient(180deg, rgba(135, 176, 153, 0.08), rgba(135, 176, 153, 0.02));
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--color-dim);
    font-family: var(--font-ui);
    font-size: var(--text-ui);
  }

  .map-panel-guidance-title {
    margin: 0;
    color: var(--color-text);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: var(--text-ui);
  }

  .map-empty p {
    margin: 0 0 6px 0;
  }

  .map-empty ol {
    margin: 0;
    padding-left: 18px;
    font-size: var(--text-ui);
  }

  .map-empty.degraded {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--color-copper-border);
    background: var(--color-copper-bg);
    margin: var(--space-2);
    border-radius: var(--radius-md);
  }

  .insight-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .insight-card {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .mini-btn {
    font-size: 0.68rem;
    padding: 4px 6px;
  }

  .warning {
    color: var(--color-copper);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  @media (max-width: 767px) {
    .insight-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
