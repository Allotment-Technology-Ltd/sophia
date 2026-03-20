<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { auth, getIdToken, onAuthChange } from '$lib/firebase';
  import {
    listEnabledSharedRoutes,
    resolveRouteForStage,
    resolveStageRoutes
  } from '$lib/utils/ingestionRouting';

  interface AdminRouteRecord {
    id: string;
    name?: string | null;
    stage?: string | null;
    workload?: string | null;
    enabled?: boolean | null;
    version?: number | null;
    publishedVersion?: number | null;
    [key: string]: unknown;
  }

  interface AdminStepRecord {
    id?: string;
    orderIndex?: number | null;
    enabled?: boolean | null;
    providerPreference?: string | null;
    modelId?: string | null;
    switchCriteria?: Record<string, unknown> | null;
    retryPolicy?: Record<string, unknown> | null;
    costPolicy?: Record<string, unknown> | null;
    [key: string]: unknown;
  }

  interface AdminHistoryEntry {
    id?: string;
    version?: number | null;
    publishedVersion?: number | null;
    createdAt?: string | null;
    publishedAt?: string | null;
    updatedBy?: string | null;
    publishedBy?: string | null;
    changeSummary?: string | null;
    [key: string]: unknown;
  }

  interface ProvidersHealthPayload {
    providers?: Array<{
      providerType?: string | null;
      status?: string | null;
      source?: string | null;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }

  interface ContextError {
    status: number;
    code: string;
    detail: string;
    endpoint?: string;
  }

  interface ContextPayload {
    environmentId?: string;
    capabilities: { workloads?: string[]; stages?: string[] } | null;
    switchCriteria: Record<string, unknown> | null;
    providersHealth: ProvidersHealthPayload | null;
    routes: AdminRouteRecord[];
    errors: {
      capabilities: ContextError | null;
      switchCriteria: ContextError | null;
      providersHealth: ContextError | null;
      routes: ContextError | null;
    };
  }

  type PageState = 'loading' | 'ready' | 'forbidden';
  type RouteCoverageMode = 'dedicated' | 'shared' | 'missing';
  type BusyAction =
    | ''
    | 'context'
    | 'steps'
    | 'history'
    | 'save-route'
    | 'save-steps'
    | 'simulate'
    | 'resolve'
    | 'publish'
    | 'rollback';
  type EditorTab = 'configure' | 'simulate' | 'probe';

  const DEFAULT_ENVIRONMENT_ID = 'production';
  const STAGE_LABELS: Record<string, string> = {
    ingestion_extraction: 'Extraction',
    ingestion_relations: 'Relations',
    ingestion_grouping: 'Grouping',
    ingestion_validation: 'Validation',
    ingestion_embedding: 'Embedding',
    ingestion_json_repair: 'JSON Repair'
  };

  const STAGE_DESCRIPTIONS: Record<string, string> = {
    ingestion_extraction: 'Pull claims and source passages from the document.',
    ingestion_relations: 'Connect support, tension, and dependency relationships.',
    ingestion_grouping: 'Cluster arguments and recurring positions.',
    ingestion_validation: 'Check readiness, evidence quality, and confidence.',
    ingestion_embedding: 'Prepare retrieval vectors and lookup support.',
    ingestion_json_repair: 'Clean malformed model output before final storage.'
  };

  let pageState = $state<PageState>('loading');
  let currentUserEmail = $state<string | null>(null);
  let pageError = $state('');
  let pageMessage = $state('');
  let busyAction = $state<BusyAction>('');
  let editorTab = $state<EditorTab>('configure');

  let capabilities = $state<{ workloads?: string[]; stages?: string[] } | null>(null);
  let switchCriteria = $state<Record<string, unknown> | null>(null);
  let providersHealth = $state<ProvidersHealthPayload | null>(null);
  let routes = $state<AdminRouteRecord[]>([]);
  let routingEnvironmentId = $state(DEFAULT_ENVIRONMENT_ID);
  let contextErrors = $state<ContextPayload['errors']>({
    capabilities: null,
    switchCriteria: null,
    providersHealth: null,
    routes: null
  });

  let selectedStage = $state<string | null>(null);
  let selectedRouteId = $state<string | null>(null);
  let steps = $state<AdminStepRecord[]>([]);
  let history = $state<AdminHistoryEntry[]>([]);
  let stepsError = $state('');
  let historyError = $state('');

  let routeJsonDraft = $state('{}');
  let stepsJsonDraft = $state('[]');
  let simulateJsonDraft = $state('{}');
  let resolveJsonDraft = $state('{}');
  let simulationResult = $state<Record<string, unknown> | null>(null);
  let resolveResult = $state<Record<string, unknown> | null>(null);

  const selectedRoute = $derived(routes.find((route) => route.id === selectedRouteId) ?? null);
  const sharedRoutes = $derived.by(() => listEnabledSharedRoutes(routes));
  const providerHealthEntries = $derived.by(() => providersHealth?.providers ?? []);
  const stageList = $derived.by(
    () => capabilities?.stages ?? Object.keys(STAGE_LABELS)
  );
  const sortedSteps = $derived.by(
    () => [...steps].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
  );
  const validHistory = $derived.by(() =>
    history
      .map((entry) => ({
        ...entry,
        effectiveAt: entry.publishedAt ?? entry.createdAt ?? null
      }))
      .filter((entry) => hasValidDate(entry.effectiveAt))
  );

  const routeStageCoverage = $derived.by(() => {
    return resolveStageRoutes(routes, stageList, selectedRouteId).map((entry) => ({
      stage: entry.stage,
      title: stageTitle(entry.stage),
      description: stageDescription(entry.stage),
      route: entry.route,
      mode: entry.mode as RouteCoverageMode
    }));
  });

  const selectedCoverageEntry = $derived.by(() => {
    if (selectedStage) {
      return routeStageCoverage.find((entry) => entry.stage === selectedStage) ?? null;
    }
    if (selectedRoute?.stage) {
      return routeStageCoverage.find((entry) => entry.stage === selectedRoute.stage) ?? null;
    }
    return routeStageCoverage[0] ?? null;
  });

  function stageTitle(stage: string | null | undefined): string {
    if (!stage) return 'Shared route';
    return STAGE_LABELS[stage] ?? stage.replace(/^ingestion_/, '').replaceAll('_', ' ');
  }

  function stageDescription(stage: string | null | undefined): string {
    if (!stage) return 'Reusable route for stages without dedicated coverage.';
    return STAGE_DESCRIPTIONS[stage] ?? 'Stage detail not yet documented.';
  }

  function formatDate(value: string | null | undefined): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function hasValidDate(value: string | null | undefined): boolean {
    return formatDate(value).length > 0;
  }

  function formatContextError(error: ContextError | null): string {
    if (!error) return '';
    return `[${error.status} ${error.code}] ${error.detail}${error.endpoint ? ` (${error.endpoint})` : ''}`;
  }

  function routeModeLabel(mode: RouteCoverageMode): string {
    switch (mode) {
      case 'dedicated':
        return 'Dedicated route';
      case 'shared':
        return 'Shared route';
      default:
        return 'Needs routing';
    }
  }

  function routeModeTone(mode: RouteCoverageMode): string {
    switch (mode) {
      case 'dedicated':
        return 'border-sophia-dark-sage/35 bg-sophia-dark-sage/10 text-sophia-dark-sage';
      case 'shared':
        return 'border-sophia-dark-blue/35 bg-sophia-dark-blue/10 text-sophia-dark-blue';
      default:
        return 'border-sophia-dark-copper/35 bg-sophia-dark-copper/10 text-sophia-dark-copper';
    }
  }

  function providerTone(status: string | null | undefined): string {
    const value = (status ?? '').toLowerCase();
    if (value === 'healthy' || value === 'ready') {
      return 'border-sophia-dark-sage/35 bg-sophia-dark-sage/10 text-sophia-dark-sage';
    }
    if (value === 'degraded' || value === 'warning') {
      return 'border-sophia-dark-amber/35 bg-sophia-dark-amber/10 text-sophia-dark-amber';
    }
    if (value === 'failed' || value === 'unhealthy') {
      return 'border-sophia-dark-coral/35 bg-sophia-dark-coral/10 text-sophia-dark-coral';
    }
    return 'border-sophia-dark-border bg-sophia-dark-surface-raised text-sophia-dark-text';
  }

  function routeStatusSummary(route: AdminRouteRecord | null): string {
    if (!route) return 'No route configured';
    return `Draft v${route.version ?? '—'} · Published v${route.publishedVersion ?? '—'}`;
  }

  function routeOptionLabel(route: AdminRouteRecord): string {
    const shortId = route.id.slice(0, 8);
    return route.name?.trim() ? `${route.name} · ${shortId}` : route.id;
  }

  function modelLabel(step: AdminStepRecord): string {
    const provider = step.providerPreference?.trim();
    const model = step.modelId?.trim();
    if (!provider && !model) return 'Model not configured';
    if (!provider) return model ?? 'Model not configured';
    if (!model) return provider;
    return `${provider} · ${model}`;
  }

  function fieldValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'Not configured';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'Not configured';
    return JSON.stringify(value);
  }

  function stepDetailFields(step: AdminStepRecord): Array<{ label: string; value: string }> {
    const fallbackOn = step['fallbackOn'];
    const timeoutMs = step['timeoutMs'];

    return [
      { label: 'Enabled', value: step.enabled === false ? 'Disabled' : 'Enabled' },
      { label: 'Fallback on', value: fieldValue(fallbackOn) },
      { label: 'Switch criteria', value: step.switchCriteria ? 'Configured' : 'Not configured' },
      { label: 'Retry policy', value: step.retryPolicy ? 'Configured' : 'Not configured' },
      { label: 'Cost policy', value: step.costPolicy ? 'Configured' : 'Not configured' },
      { label: 'Timeout', value: fieldValue(timeoutMs) }
    ];
  }

  function switchCriteriaRows(payload: Record<string, unknown> | null): Array<{ key: string; values: string[] }> {
    if (!payload) return [];

    return Object.entries(payload).map(([key, value]) => {
      const values = Array.isArray(value)
        ? value.map((item) => String(item))
        : value && typeof value === 'object'
          ? Object.keys(value as Record<string, unknown>)
          : [String(value)];
      return { key, values };
    });
  }

  async function authorizedJson(url: string, init?: RequestInit): Promise<any> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required');
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body?.restormel) {
        const detail = body.restormel as ContextError;
        throw new Error(formatContextError(detail));
      }
      throw new Error(typeof body?.error === 'string' ? body.error : `status ${response.status}`);
    }
    return body;
  }

  function buildDefaultRouteDraft(stage: string | null): Record<string, unknown> {
    return {
      name: stage ? `${stageTitle(stage)} Route` : 'Shared ingestion route',
      stage,
      workload: 'ingestion',
      enabled: true
    };
  }

  function buildDefaultScenario(route: AdminRouteRecord | null, stageOverride: string | null): Record<string, unknown> {
    const stage = stageOverride ?? route?.stage ?? 'ingestion_extraction';
    const scenario: Record<string, unknown> = {
      environmentId: route?.environmentId ?? routingEnvironmentId,
      routeId: route?.id ?? undefined,
      workload: route?.workload ?? 'ingestion',
      stage,
      task: stage === 'ingestion_embedding' ? 'embedding' : 'completion',
      attempt: 1,
      estimatedInputTokens: 12000,
      estimatedInputChars: 48000,
      complexity: 'medium',
      constraints: {
        latency: 'balanced',
        maxCost: 0.25
      }
    };

    return scenario;
  }

  function syncDraftsFromRoute(route: AdminRouteRecord | null, stageOverride: string | null): void {
    routeJsonDraft = JSON.stringify(route ?? buildDefaultRouteDraft(stageOverride), null, 2);
    simulateJsonDraft = JSON.stringify(buildDefaultScenario(route, stageOverride), null, 2);
    resolveJsonDraft = JSON.stringify(buildDefaultScenario(route, stageOverride), null, 2);
  }

  function resetDraft(kind: 'route' | 'steps' | 'simulate' | 'resolve'): void {
    if (kind === 'route') {
      syncDraftsFromRoute(selectedRoute, selectedStage);
      return;
    }
    if (kind === 'steps') {
      stepsJsonDraft = JSON.stringify(steps, null, 2);
      return;
    }
    if (kind === 'simulate') {
      simulateJsonDraft = JSON.stringify(buildDefaultScenario(selectedRoute, selectedStage), null, 2);
      return;
    }
    resolveJsonDraft = JSON.stringify(buildDefaultScenario(selectedRoute, selectedStage), null, 2);
  }

  async function loadRouteArtifacts(routeId: string): Promise<void> {
    busyAction = 'steps';
    stepsError = '';
    historyError = '';
    try {
      const [stepsBody, historyBody] = await Promise.all([
        authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/steps`),
        authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/history`)
      ]);
      steps = Array.isArray(stepsBody.steps) ? stepsBody.steps : [];
      history = Array.isArray(historyBody.history) ? historyBody.history : [];
      stepsJsonDraft = JSON.stringify(steps, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load route artifacts';
      stepsError = message;
      historyError = message;
      steps = [];
      history = [];
      stepsJsonDraft = '[]';
    } finally {
      busyAction = '';
    }
  }

  async function selectRoute(routeId: string, stageOverride: string | null = selectedStage): Promise<void> {
    selectedRouteId = routeId;
    if (stageOverride !== undefined) selectedStage = stageOverride;
    const route = routes.find((entry) => entry.id === routeId) ?? null;
    syncDraftsFromRoute(route, stageOverride);
    simulationResult = null;
    resolveResult = null;
    await loadRouteArtifacts(routeId);
  }

  async function chooseStage(stage: string): Promise<void> {
    selectedStage = stage;
    const coverage =
      routeStageCoverage.find((entry) => entry.stage === stage) ??
      null;

    if (coverage?.route?.id) {
      await selectRoute(coverage.route.id, stage);
      return;
    }

    selectedRouteId = null;
    steps = [];
    history = [];
    stepsJsonDraft = '[]';
    simulationResult = null;
    resolveResult = null;
    syncDraftsFromRoute(null, stage);
  }

  async function loadRoutingContext(): Promise<void> {
    busyAction = 'context';
    pageError = '';
    pageMessage = '';

    try {
      const body = (await authorizedJson('/api/admin/ingestion-routing/context')) as ContextPayload;
      const nextRoutes = Array.isArray(body.routes) ? body.routes : [];
      const nextStages = body.capabilities?.stages ?? Object.keys(STAGE_LABELS);
      const nextSelectedStage =
        selectedStage && nextStages.includes(selectedStage)
          ? selectedStage
          : nextStages[0] ?? nextRoutes.find((route) => route.stage)?.stage ?? null;
      const routeForStage =
        resolveRouteForStage(nextRoutes, nextSelectedStage, selectedRouteId) ?? nextRoutes[0] ?? null;

      capabilities = body.capabilities;
      switchCriteria = body.switchCriteria;
      providersHealth = body.providersHealth;
      routes = nextRoutes;
      routingEnvironmentId =
        typeof body.environmentId === 'string' && body.environmentId.trim().length > 0
          ? body.environmentId
          : DEFAULT_ENVIRONMENT_ID;
      contextErrors = body.errors ?? contextErrors;
      selectedStage = nextSelectedStage;
      selectedRouteId = routeForStage?.id ?? null;
      syncDraftsFromRoute(routeForStage, nextSelectedStage);

      if (routeForStage?.id) {
        await loadRouteArtifacts(routeForStage.id);
      } else {
        steps = [];
        history = [];
        stepsJsonDraft = '[]';
      }
    } finally {
      busyAction = '';
    }
  }

  async function loadAdminContext(): Promise<void> {
    const token = await getIdToken();
    if (!token) {
      pageState = 'forbidden';
      throw new Error('Authentication required');
    }

    const response = await fetch('/api/admin/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 403 || body.is_admin === false) {
      pageState = 'forbidden';
      currentUserEmail = body.user?.email ?? auth?.currentUser?.email ?? null;
      return;
    }

    if (!response.ok) {
      throw new Error(body.error ?? `status ${response.status}`);
    }

    currentUserEmail = body.user?.email ?? auth?.currentUser?.email ?? null;
    pageState = body.is_admin ? 'ready' : 'forbidden';
    if (pageState === 'ready') {
      await loadRoutingContext();
    }
  }

  async function saveRouteDraft(): Promise<void> {
    if (!selectedRoute) return;
    busyAction = 'save-route';
    pageError = '';
    pageMessage = '';
    try {
      const payload = JSON.parse(routeJsonDraft) as Record<string, unknown>;
      const body = await authorizedJson('/api/admin/ingestion-routing/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      pageMessage = `Route ${body.route?.id ?? selectedRoute.id} saved.`;
      await loadRoutingContext();
      if (body.route?.id) {
        await selectRoute(String(body.route.id), selectedStage);
      }
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to save route';
    } finally {
      busyAction = '';
    }
  }

  async function saveStepsDraft(): Promise<void> {
    if (!selectedRouteId) return;
    busyAction = 'save-steps';
    pageError = '';
    pageMessage = '';
    try {
      const payload = JSON.parse(stepsJsonDraft) as Record<string, unknown>;
      await authorizedJson(`/api/admin/ingestion-routing/routes/${selectedRouteId}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      pageMessage = `Steps saved for ${selectedRouteId}.`;
      await loadRouteArtifacts(selectedRouteId);
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to save steps';
    } finally {
      busyAction = '';
    }
  }

  async function simulateRoute(): Promise<void> {
    if (!selectedRouteId) return;
    busyAction = 'simulate';
    pageError = '';
    pageMessage = '';
    simulationResult = null;
    try {
      const payload = JSON.parse(simulateJsonDraft) as Record<string, unknown>;
      const body = await authorizedJson(`/api/admin/ingestion-routing/routes/${selectedRouteId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      simulationResult = body.simulation ?? null;
      pageMessage = `Simulation completed for ${selectedRouteId}.`;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to simulate route';
    } finally {
      busyAction = '';
    }
  }

  async function resolveRouteDecision(): Promise<void> {
    busyAction = 'resolve';
    pageError = '';
    pageMessage = '';
    resolveResult = null;
    try {
      const payload = JSON.parse(resolveJsonDraft) as Record<string, unknown>;
      const body = await authorizedJson('/api/admin/ingestion-routing/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      resolveResult = body.resolve ?? null;
      pageMessage = 'Resolve probe completed.';
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to resolve route';
    } finally {
      busyAction = '';
    }
  }

  async function publishRoute(): Promise<void> {
    if (!selectedRouteId) return;
    busyAction = 'publish';
    pageError = '';
    pageMessage = '';
    try {
      await authorizedJson(`/api/admin/ingestion-routing/routes/${selectedRouteId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentId: routingEnvironmentId })
      });
      pageMessage = `Publish requested for ${selectedRouteId}.`;
      await loadRouteArtifacts(selectedRouteId);
      await loadRoutingContext();
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to publish route';
    } finally {
      busyAction = '';
    }
  }

  async function rollbackRoute(toVersion?: number | null): Promise<void> {
    if (!selectedRouteId) return;
    busyAction = 'rollback';
    pageError = '';
    pageMessage = '';
    try {
      await authorizedJson(`/api/admin/ingestion-routing/routes/${selectedRouteId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environmentId: routingEnvironmentId,
          ...(toVersion ? { toVersion } : {})
        })
      });
      pageMessage = toVersion
        ? `Rollback requested to version ${toVersion}.`
        : `Rollback requested for ${selectedRouteId}.`;
      await loadRouteArtifacts(selectedRouteId);
      await loadRoutingContext();
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to rollback route';
    } finally {
      busyAction = '';
    }
  }

  onMount(() => {
    if (!browser) return;

    const sync = async () => {
      if (!auth?.currentUser) {
        pageState = 'forbidden';
        await goto('/auth');
        return;
      }

      try {
        await loadAdminContext();
      } catch (error) {
        pageError =
          error instanceof Error ? error.message : 'Failed to load administrator context';
      }
    };

    void sync();
    const unsubscribe = onAuthChange((user) => {
      if (!user) {
        pageState = 'forbidden';
        void goto('/auth');
        return;
      }
      void sync();
    });

    return () => {
      unsubscribe();
    };
  });
</script>

<div class="min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
  <div class="mx-auto max-w-[75rem] px-8 py-8 space-y-8">
    <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-8 md:p-10">
      <div class="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
        <div class="space-y-5">
          <div class="flex flex-wrap items-center gap-3">
            <span class="rounded-full border border-sophia-dark-purple/35 bg-sophia-dark-purple/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-purple">
              Admin Ingestion
            </span>
            <span class="rounded-full border border-sophia-dark-border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">
              Control plane
            </span>
          </div>

          <div>
            <h1 class="text-[2.1rem] font-serif leading-[1.08] text-sophia-dark-text md:text-[2.6rem]">
              Ingestion Routing
            </h1>
            <p class="mt-3 max-w-3xl text-[0.98rem] leading-7 text-sophia-dark-muted">
              Inspect stage coverage, edit route drafts, simulate decisions, and verify live resolve behavior without dropping into raw endpoint logs.
            </p>
          </div>

          <nav class="flex flex-wrap items-center gap-6">
            <a href="/admin/operations" class="px-0 py-1 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:text-sophia-dark-text">
              Operations Workbench
            </a>
            <a href="/admin/ingestion-routing" class="px-0 py-1 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text">
              Ingestion Routing
            </a>
            <a href="/admin/review" class="px-0 py-1 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:text-sophia-dark-text">
              Review Queue
            </a>
          </nav>
        </div>

        <div class="flex shrink-0 flex-wrap gap-3">
          <button
            type="button"
            class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface"
            onclick={loadRoutingContext}
            disabled={busyAction !== ''}
          >
            {busyAction === 'context' ? 'Refreshing…' : 'Refresh control plane'}
          </button>
          <a
            href="/admin"
            class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface"
          >
            Back to admin
          </a>
        </div>
      </div>
    </section>

    {#if pageState === 'loading'}
      <div class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 font-mono text-sm text-sophia-dark-muted">
        Loading administrator context…
      </div>
    {:else if pageState === 'forbidden'}
      <div class="rounded-2xl border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-6">
        <h2 class="text-lg font-serif text-sophia-dark-copper">Administrator access required</h2>
        <p class="mt-2 font-mono text-sm text-sophia-dark-copper">
          {currentUserEmail ?? 'This account'} does not currently hold the `administrator` role.
        </p>
      </div>
    {:else}
      {#if pageError}
        <div class="rounded-2xl border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-5 py-4 font-mono text-sm text-sophia-dark-copper">
          {pageError}
        </div>
      {/if}

      {#if pageMessage}
        <div class="rounded-2xl border border-sophia-dark-sage/40 bg-sophia-dark-sage/10 px-5 py-4 font-mono text-sm text-sophia-dark-sage">
          {pageMessage}
        </div>
      {/if}

      <div class="grid gap-6 xl:grid-cols-[1.08fr,0.92fr]">
        <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 md:p-8">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
                Runtime surface
              </div>
              <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                Provider health, coverage, and control-plane metadata for the current Restormel project.
              </p>
            </div>
          </div>

          <div class="mt-6 grid gap-4 md:grid-cols-2">
            <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted">Providers health</div>
              {#if contextErrors.providersHealth}
                <div class="mt-4 rounded-xl border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                  {formatContextError(contextErrors.providersHealth)}
                </div>
              {:else if providerHealthEntries.length > 0}
                <div class="mt-4 flex flex-wrap gap-2">
                  {#each providerHealthEntries as provider}
                    <span class={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${providerTone(provider.status)}`}>
                      {provider.providerType ?? 'provider'} · {provider.status ?? 'unknown'}
                    </span>
                  {/each}
                </div>
              {:else}
                <div class="mt-4 rounded-xl border border-sophia-dark-amber/35 bg-sophia-dark-amber/10 px-4 py-3">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-amber">Warning</div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                    No provider bindings are visible for this project, so operator guidance is weaker than it should be.
                  </p>
                </div>
              {/if}
            </div>

            <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted">Capabilities</div>
              {#if contextErrors.capabilities}
                <div class="mt-4 rounded-xl border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                  {formatContextError(contextErrors.capabilities)}
                </div>
              {:else}
                <div class="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Workloads</div>
                    <div class="mt-2 flex flex-wrap gap-2">
                      {#each capabilities?.workloads ?? [] as workload}
                        <span class="rounded-full border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-text">
                          {workload}
                        </span>
                      {/each}
                    </div>
                  </div>
                  <div>
                    <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Stages</div>
                    <div class="mt-2 font-mono text-sm text-sophia-dark-text">{stageList.length}</div>
                  </div>
                </div>
              {/if}
            </div>
          </div>

          <div class="mt-6 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted">Stage coverage</div>
            <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
              Select a stage to inspect the route, steps, and history below.
            </p>

            {#if contextErrors.routes}
              <div class="mt-4 rounded-xl border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                {formatContextError(contextErrors.routes)}
              </div>
            {:else}
              <div class="mt-5 grid gap-3 md:grid-cols-2">
                {#each routeStageCoverage as entry}
                  <button
                    type="button"
                    class={`rounded-xl border px-4 py-4 text-left transition-colors ${
                      selectedCoverageEntry?.stage === entry.stage
                        ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/10'
                        : 'border-sophia-dark-border bg-sophia-dark-surface-raised/30 hover:bg-sophia-dark-surface-raised/50'
                    }`}
                    onclick={() => void chooseStage(entry.stage)}
                  >
                    <div class="flex items-start justify-between gap-4">
                      <div>
                        <div class="font-serif text-xl text-sophia-dark-text">{entry.title}</div>
                        <p class="mt-1 text-sm leading-6 text-sophia-dark-muted">{entry.description}</p>
                      </div>
                      <span class={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${routeModeTone(entry.mode)}`}>
                        {routeModeLabel(entry.mode)}
                      </span>
                    </div>
                    <div class="mt-4 flex items-center justify-between gap-4 border-t border-sophia-dark-border pt-4">
                      <div>
                        <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route</div>
                        <div class="mt-1 font-mono text-sm text-sophia-dark-text">
                          {entry.route ? entry.route.name ?? entry.route.id : 'No route currently returned'}
                        </div>
                        <div class="mt-1 font-mono text-xs text-sophia-dark-dim">
                          {routeStatusSummary(entry.route)}
                        </div>
                      </div>
                      <div class="font-mono text-sm text-sophia-dark-muted">→</div>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <details class="mt-6 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
            <summary class="cursor-pointer font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted">
              Switch criteria enums
            </summary>
            {#if contextErrors.switchCriteria}
              <div class="mt-4 rounded-xl border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                {formatContextError(contextErrors.switchCriteria)}
              </div>
            {:else}
              <div class="mt-4 space-y-3">
                {#each switchCriteriaRows(switchCriteria) as row}
                  <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/25 px-4 py-3">
                    <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">{row.key}</div>
                    <div class="mt-2 flex flex-wrap gap-2">
                      {#each row.values as value}
                        <span class="rounded-full border border-sophia-dark-border bg-sophia-dark-surface px-3 py-1 font-mono text-[0.68rem] text-sophia-dark-text">
                          {value}
                        </span>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </details>
        </section>

        <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 md:p-8">
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
                  Route workspace
                </div>
                <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                  Currently inspecting the route and lifecycle for the selected stage.
                </p>
              </div>

              <label class="space-y-2">
                <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route selector</span>
                <select
                  value={selectedRouteId ?? ''}
                  class="w-full min-w-[16rem] rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
                  onchange={(event) => {
                    const nextId = (event.currentTarget as HTMLSelectElement).value;
                    if (nextId) {
                      void selectRoute(nextId, routes.find((route) => route.id === nextId)?.stage ?? selectedStage);
                    }
                  }}
                >
                  {#each routes as route}
                    <option value={route.id}>{routeOptionLabel(route)}</option>
                  {/each}
                </select>
              </label>
            </div>

            {#if sharedRoutes.length > 1}
              <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-4">
                <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Shared route coverage</div>
                <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                  Multiple shared Restormel routes are available. The route selector above determines which shared route the stage cards use when a stage has no dedicated binding.
                </p>
              </div>
            {/if}

            <div class="grid gap-4 md:grid-cols-3">
              <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Currently inspecting</div>
                <div class="mt-2 font-serif text-2xl text-sophia-dark-text">{selectedRoute?.name ?? 'No route selected'}</div>
                <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                  {selectedRoute ? selectedRoute.id : 'Choose a route or stage to begin.'}
                </p>
              </div>
              <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Stage</div>
                <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                  {selectedCoverageEntry ? selectedCoverageEntry.title : 'No stage selected'}
                </div>
                <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                  {selectedCoverageEntry ? selectedCoverageEntry.description : 'Select a stage card to bind this workspace.'}
                </p>
              </div>
              <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Versions</div>
                <div class="mt-2 font-mono text-sm text-sophia-dark-text">{routeStatusSummary(selectedRoute)}</div>
                <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                  Draft and published versions for the selected route.
                </p>
              </div>
            </div>

            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                onclick={() => selectedRouteId && loadRouteArtifacts(selectedRouteId)}
                disabled={!selectedRouteId || busyAction !== ''}
              >
                {busyAction === 'steps' || busyAction === 'history' ? 'Refreshing…' : 'Refresh steps + history'}
              </button>
              <button
                type="button"
                class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-purple/24"
                onclick={publishRoute}
                disabled={!selectedRouteId || busyAction !== ''}
              >
                {busyAction === 'publish' ? 'Publishing…' : 'Publish route'}
              </button>
              <button
                type="button"
                class="rounded border border-sophia-dark-copper/40 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-copper hover:bg-sophia-dark-copper/10"
                onclick={() => void rollbackRoute()}
                disabled={!selectedRouteId || busyAction !== ''}
              >
                {busyAction === 'rollback' ? 'Rolling back…' : 'Rollback route'}
              </button>
            </div>
          </div>
        </section>
      </div>

      <div class="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
        <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 md:p-8">
          <div>
            <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
              Steps and history
            </div>
            <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
              Structured route steps, fallback flow, and publish history for the selected stage.
            </p>
          </div>

          {#if selectedRoute}
            <div class="mt-6 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
              <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Fallback chain</div>
              {#if sortedSteps.length > 0}
                <div class="mt-4 space-y-3">
                  {#each sortedSteps as step, index}
                    <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/25 px-4 py-4">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Step {index + 1}</div>
                          <div class="mt-2 font-mono text-sm text-sophia-dark-text">{modelLabel(step)}</div>
                        </div>
                        <span class={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${step.enabled === false ? 'border-sophia-dark-copper/35 bg-sophia-dark-copper/10 text-sophia-dark-copper' : 'border-sophia-dark-sage/35 bg-sophia-dark-sage/10 text-sophia-dark-sage'}`}>
                          {step.enabled === false ? 'Disabled' : 'Enabled'}
                        </span>
                      </div>
                      {#if index < sortedSteps.length - 1}
                        <div class="mt-3 font-mono text-xs text-sophia-dark-blue">fallback →</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="mt-4 rounded-xl border border-dashed border-sophia-dark-border px-4 py-6 text-center font-mono text-sm text-sophia-dark-muted">
                  No steps returned for this route.
                </div>
              {/if}
            </div>

            {#if stepsError}
              <div class="mt-6 rounded-xl border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-4 font-mono text-xs text-sophia-dark-copper">
                {stepsError}
              </div>
            {/if}

            <div class="mt-6 space-y-4">
              {#each sortedSteps as step, index}
                <article class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                  <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Step {index + 1}</div>
                      <h3 class="mt-2 font-serif text-2xl text-sophia-dark-text">{modelLabel(step)}</h3>
                    </div>
                    <span class={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${step.enabled === false ? 'border-sophia-dark-copper/35 bg-sophia-dark-copper/10 text-sophia-dark-copper' : 'border-sophia-dark-sage/35 bg-sophia-dark-sage/10 text-sophia-dark-sage'}`}>
                      {step.enabled === false ? 'Disabled' : 'Enabled'}
                    </span>
                  </div>

                  <div class="mt-5 grid gap-3 sm:grid-cols-2">
                    {#each stepDetailFields(step) as field}
                      <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                        <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">{field.label}</div>
                        <div class="mt-2 font-mono text-sm text-sophia-dark-text">{field.value}</div>
                      </div>
                    {/each}
                  </div>

                  <details class="mt-5 rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/12 p-4">
                    <summary class="cursor-pointer font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted">
                      Show raw JSON
                    </summary>
                    <pre class="mt-4 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-sophia-dark-border bg-sophia-dark-surface px-4 py-4 font-mono text-xs text-sophia-dark-text">{JSON.stringify(step, null, 2)}</pre>
                  </details>
                </article>
              {/each}
            </div>

            <div class="mt-6 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
              <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route history</div>
              {#if historyError}
                <div class="mt-4 rounded-xl border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                  {historyError}
                </div>
              {:else if validHistory.length > 0}
                <div class="mt-4 space-y-3">
                  {#each validHistory as entry}
                    <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/25 px-4 py-4">
                      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div class="font-mono text-xs text-sophia-dark-text">
                            Version {entry.version ?? '—'} · published {entry.publishedVersion ?? '—'}
                          </div>
                          <div class="mt-2 font-mono text-xs text-sophia-dark-dim">
                            {formatDate(entry.effectiveAt)}{entry.publishedBy || entry.updatedBy ? ` · ${entry.publishedBy ?? entry.updatedBy}` : ''}
                          </div>
                          {#if entry.changeSummary}
                            <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{entry.changeSummary}</p>
                          {/if}
                        </div>
                        <button
                          type="button"
                          class="rounded border border-sophia-dark-copper/40 px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-copper hover:bg-sophia-dark-copper/10"
                          onclick={() => void rollbackRoute(entry.version ?? null)}
                          disabled={busyAction !== '' || !(entry.version ?? null)}
                        >
                          Restore this version
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="mt-4 rounded-xl border border-dashed border-sophia-dark-border px-4 py-6 text-center font-mono text-sm text-sophia-dark-muted">
                  No valid route history is available yet.
                </div>
              {/if}
            </div>
          {:else}
            <div class="mt-6 rounded-xl border border-dashed border-sophia-dark-border px-4 py-10 text-center font-mono text-sm text-sophia-dark-muted">
              No route is currently selectable from the Restormel project.
            </div>
          {/if}
        </section>

        <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 md:p-8">
          <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
                Editing and probes
              </div>
              <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                Save route drafts, test simulation, and verify resolve responses with structured input templates.
              </p>
            </div>

            <div class="inline-flex rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-1">
              <button
                type="button"
                class={`rounded-lg px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] ${editorTab === 'configure' ? 'bg-sophia-dark-purple/16 text-sophia-dark-text' : 'text-sophia-dark-muted'}`}
                onclick={() => (editorTab = 'configure')}
              >
                Configure
              </button>
              <button
                type="button"
                class={`rounded-lg px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] ${editorTab === 'simulate' ? 'bg-sophia-dark-purple/16 text-sophia-dark-text' : 'text-sophia-dark-muted'}`}
                onclick={() => (editorTab = 'simulate')}
              >
                Simulate
              </button>
              <button
                type="button"
                class={`rounded-lg px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] ${editorTab === 'probe' ? 'bg-sophia-dark-purple/16 text-sophia-dark-text' : 'text-sophia-dark-muted'}`}
                onclick={() => (editorTab = 'probe')}
              >
                Probe
              </button>
            </div>
          </div>

          {#if editorTab === 'configure'}
            <div class="mt-6 space-y-5">
              <section class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route configuration</div>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                      Save the selected route draft with the current stage binding and version metadata.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    onclick={() => resetDraft('route')}
                  >
                    Reset to template
                  </button>
                </div>
                <textarea bind:value={routeJsonDraft} rows="12" class="mt-4 min-h-[14rem] w-full overflow-y-auto rounded-xl border border-sophia-dark-border bg-sophia-dark-surface px-4 py-4 font-mono text-xs text-sophia-dark-text"></textarea>
                <div class="mt-4 flex justify-end">
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-purple/24"
                    onclick={saveRouteDraft}
                    disabled={!selectedRoute || busyAction !== ''}
                  >
                    {busyAction === 'save-route' ? 'Saving route…' : 'Save route draft'}
                  </button>
                </div>
              </section>

              <section class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Steps configuration</div>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                      Update the ordered step chain for the selected route.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    onclick={() => resetDraft('steps')}
                  >
                    Reset to template
                  </button>
                </div>
                <textarea bind:value={stepsJsonDraft} rows="14" class="mt-4 min-h-[16rem] w-full overflow-y-auto rounded-xl border border-sophia-dark-border bg-sophia-dark-surface px-4 py-4 font-mono text-xs text-sophia-dark-text"></textarea>
                <div class="mt-4 flex justify-end">
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-purple/24"
                    onclick={saveStepsDraft}
                    disabled={!selectedRouteId || busyAction !== ''}
                  >
                    {busyAction === 'save-steps' ? 'Saving steps…' : 'Save steps draft'}
                  </button>
                </div>
              </section>
            </div>
          {:else if editorTab === 'simulate'}
            <div class="mt-6 space-y-5">
              <section class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Simulation request</div>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                      Test the likely selected step, fallback candidates, and estimated cost without mutating the route.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    onclick={() => resetDraft('simulate')}
                  >
                    Reset to template
                  </button>
                </div>
                <textarea bind:value={simulateJsonDraft} rows="12" class="mt-4 min-h-[14rem] w-full overflow-y-auto rounded-xl border border-sophia-dark-border bg-sophia-dark-surface px-4 py-4 font-mono text-xs text-sophia-dark-text"></textarea>
                <div class="mt-4 flex justify-end">
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-blue/40 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
                    onclick={simulateRoute}
                    disabled={!selectedRouteId || busyAction !== ''}
                  >
                    {busyAction === 'simulate' ? 'Simulating…' : 'Simulate route'}
                  </button>
                </div>
              </section>

              <section class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Simulation result</div>
                {#if simulationResult}
                  <div class="mt-4 grid gap-3 sm:grid-cols-2">
                    <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                      <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Selected step</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">{simulationResult.selectedStepId ?? '—'}</div>
                    </div>
                    <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                      <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Estimated cost</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">{simulationResult.estimatedCostUsd ?? '—'}</div>
                    </div>
                  </div>
                  <pre class="mt-4 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-sophia-dark-border bg-sophia-dark-surface px-4 py-4 font-mono text-xs text-sophia-dark-text">{JSON.stringify(simulationResult, null, 2)}</pre>
                {:else}
                  <div class="mt-4 rounded-xl border border-dashed border-sophia-dark-border px-4 py-6 text-center font-mono text-sm text-sophia-dark-muted">
                    Run a simulation to inspect the output here.
                  </div>
                {/if}
              </section>
            </div>
          {:else}
            <div class="mt-6 space-y-5">
              <section class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Resolve probe</div>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                      Probe the live resolve surface to inspect machine-readable routing metadata.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    onclick={() => resetDraft('resolve')}
                  >
                    Reset to template
                  </button>
                </div>
                <textarea bind:value={resolveJsonDraft} rows="12" class="mt-4 min-h-[14rem] w-full overflow-y-auto rounded-xl border border-sophia-dark-border bg-sophia-dark-surface px-4 py-4 font-mono text-xs text-sophia-dark-text"></textarea>
                <div class="mt-4 flex justify-end">
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-blue/40 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
                    onclick={resolveRouteDecision}
                    disabled={busyAction !== ''}
                  >
                    {busyAction === 'resolve' ? 'Resolving…' : 'Run resolve probe'}
                  </button>
                </div>
              </section>

              <section class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
                <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Resolve result</div>
                {#if resolveResult}
                  <div class="mt-4 grid gap-3 sm:grid-cols-2">
                    <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                      <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Selected step</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">{resolveResult.selectedStepId ?? '—'}</div>
                    </div>
                    <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                      <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Order / switch</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">{resolveResult.selectedOrderIndex ?? '—'} / {resolveResult.switchReasonCode ?? '—'}</div>
                    </div>
                    <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                      <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Provider / model</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">{resolveResult.providerType ?? '—'} / {resolveResult.modelId ?? '—'}</div>
                    </div>
                    <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                      <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Estimated cost</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">{resolveResult.estimatedCostUsd ?? '—'}</div>
                    </div>
                  </div>
                  <pre class="mt-4 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-sophia-dark-border bg-sophia-dark-surface px-4 py-4 font-mono text-xs text-sophia-dark-text">{JSON.stringify(resolveResult, null, 2)}</pre>
                {:else}
                  <div class="mt-4 rounded-xl border border-dashed border-sophia-dark-border px-4 py-6 text-center font-mono text-sm text-sophia-dark-muted">
                    Run a resolve probe to inspect the output here.
                  </div>
                {/if}
              </section>
            </div>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</div>
