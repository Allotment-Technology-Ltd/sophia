<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { auth, getIdToken, onAuthChange } from '$lib/firebase';

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

  const DEFAULT_ENVIRONMENT_ID = 'production';

  let pageState = $state<PageState>('loading');
  let currentUserEmail = $state<string | null>(null);
  let pageError = $state('');
  let pageMessage = $state('');
  let busyAction = $state<BusyAction>('');

  let capabilities = $state<{ workloads?: string[]; stages?: string[] } | null>(null);
  let switchCriteria = $state<Record<string, unknown> | null>(null);
  let providersHealth = $state<ProvidersHealthPayload | null>(null);
  let routes = $state<AdminRouteRecord[]>([]);
  let contextErrors = $state<ContextPayload['errors']>({
    capabilities: null,
    switchCriteria: null,
    providersHealth: null,
    routes: null
  });

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

  const selectedRoute = $derived(
    routes.find((route) => route.id === selectedRouteId) ?? null
  );

  const routeStageCoverage = $derived.by(() => {
    const stages = capabilities?.stages ?? [];
    return stages.map((stage) => ({
      stage,
      route: routes.find((route) => route.stage === stage) ?? null
    }));
  });

  function formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatContextError(error: ContextError | null): string {
    if (!error) return '';
    return `[${error.status} ${error.code}] ${error.detail}${error.endpoint ? ` (${error.endpoint})` : ''}`;
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

  function buildDefaultScenario(route: AdminRouteRecord | null): Record<string, unknown> {
    const stage = route?.stage ?? 'ingestion_extraction';
    return {
      environmentId: DEFAULT_ENVIRONMENT_ID,
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
  }

  function syncDraftsFromRoute(route: AdminRouteRecord | null): void {
    routeJsonDraft = JSON.stringify(route ?? {}, null, 2);
    simulateJsonDraft = JSON.stringify(buildDefaultScenario(route), null, 2);
    resolveJsonDraft = JSON.stringify(buildDefaultScenario(route), null, 2);
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

  async function selectRoute(routeId: string): Promise<void> {
    selectedRouteId = routeId;
    const route = routes.find((entry) => entry.id === routeId) ?? null;
    syncDraftsFromRoute(route);
    simulationResult = null;
    resolveResult = null;
    await loadRouteArtifacts(routeId);
  }

  async function loadRoutingContext(): Promise<void> {
    busyAction = 'context';
    pageError = '';
    pageMessage = '';
    const body = (await authorizedJson('/api/admin/ingestion-routing/context')) as ContextPayload;
    capabilities = body.capabilities;
    switchCriteria = body.switchCriteria;
    providersHealth = body.providersHealth;
    routes = Array.isArray(body.routes) ? body.routes : [];
    contextErrors = body.errors ?? contextErrors;

    const nextRouteId =
      selectedRouteId && routes.some((route) => route.id === selectedRouteId)
        ? selectedRouteId
        : routes[0]?.id ?? null;
    selectedRouteId = nextRouteId;
    syncDraftsFromRoute(routes.find((route) => route.id === nextRouteId) ?? null);

    if (nextRouteId) {
      await loadRouteArtifacts(nextRouteId);
    } else {
      steps = [];
      history = [];
      stepsJsonDraft = '[]';
    }
    busyAction = '';
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
        await selectRoute(String(body.route.id));
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
        body: JSON.stringify({ environmentId: DEFAULT_ENVIRONMENT_ID })
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

  async function rollbackRoute(): Promise<void> {
    if (!selectedRouteId) return;
    busyAction = 'rollback';
    pageError = '';
    pageMessage = '';
    try {
      await authorizedJson(`/api/admin/ingestion-routing/routes/${selectedRouteId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentId: DEFAULT_ENVIRONMENT_ID })
      });
      pageMessage = `Rollback requested for ${selectedRouteId}.`;
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
  <div class="mx-auto max-w-7xl px-6 py-8 space-y-8">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="mb-1 text-3xl font-serif text-sophia-dark-text">Ingestion Routing</h1>
        <p class="font-mono text-sm text-sophia-dark-muted">
          Live Restormel control plane for ingestion routes, steps, simulation, lifecycle, and resolve probes.
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20"
          onclick={loadRoutingContext}
          disabled={busyAction !== ''}
        >
          {busyAction === 'context' ? 'Refreshing…' : 'Refresh control plane'}
        </button>
        <a
          href="/admin/operations"
          class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2 font-mono text-sm hover:bg-sophia-dark-surface"
        >
          Operations Workbench
        </a>
        <a
          href="/admin"
          class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2 font-mono text-sm hover:bg-sophia-dark-surface"
        >
          ← Back to Admin
        </a>
      </div>
    </div>

    {#if pageState === 'loading'}
      <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6 font-mono text-sm text-sophia-dark-muted">
        Loading administrator context…
      </div>
    {:else if pageState === 'forbidden'}
      <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-6">
        <h2 class="mb-2 text-lg font-serif text-sophia-dark-copper">Administrator access required</h2>
        <p class="font-mono text-sm text-sophia-dark-copper">
          {currentUserEmail ?? 'This account'} does not currently hold the `administrator` role.
        </p>
      </div>
    {:else}
      {#if pageError}
        <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
          {pageError}
        </div>
      {/if}
      {#if pageMessage}
        <div class="rounded border border-sophia-dark-sage/40 bg-sophia-dark-sage/10 p-4 font-mono text-sm text-sophia-dark-sage">
          {pageMessage}
        </div>
      {/if}

      <div class="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
          <div>
            <div class="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
              Runtime surface
            </div>
            <p class="text-sm text-sophia-dark-muted">
              Health, stage coverage, and exact upstream endpoint failures are surfaced directly from Sophia’s current Restormel project.
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
              <div class="mb-2 font-mono text-xs text-sophia-dark-muted">Providers health</div>
              {#if contextErrors.providersHealth}
                <div class="font-mono text-xs text-sophia-dark-copper">{formatContextError(contextErrors.providersHealth)}</div>
              {:else if (providersHealth?.providers?.length ?? 0) > 0}
                <div class="flex flex-wrap gap-2">
                  {#each providersHealth?.providers ?? [] as provider}
                    <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-text">
                      {provider.providerType ?? 'provider'} · {provider.status ?? 'unknown'}
                    </span>
                  {/each}
                </div>
              {:else}
                <div class="font-mono text-xs text-sophia-dark-muted">No provider bindings reported.</div>
              {/if}
            </div>

            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
              <div class="mb-2 font-mono text-xs text-sophia-dark-muted">Capabilities</div>
              {#if contextErrors.capabilities}
                <div class="font-mono text-xs text-sophia-dark-copper">{formatContextError(contextErrors.capabilities)}</div>
              {:else}
                <div class="space-y-2 font-mono text-xs text-sophia-dark-text">
                  <div>Workloads: {(capabilities?.workloads ?? []).join(', ') || '—'}</div>
                  <div>Stages: {(capabilities?.stages ?? []).length}</div>
                </div>
              {/if}
            </div>
          </div>

          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="mb-3 font-mono text-xs text-sophia-dark-muted">Stage coverage</div>
            {#if contextErrors.routes}
              <div class="font-mono text-xs text-sophia-dark-copper">{formatContextError(contextErrors.routes)}</div>
            {:else}
              <div class="grid gap-3 md:grid-cols-2">
                {#each routeStageCoverage as entry}
                  <button
                    type="button"
                    class="rounded border px-3 py-3 text-left font-mono text-xs transition-colors {entry.route?.id === selectedRouteId ? 'border-sophia-dark-blue/40 bg-sophia-dark-blue/10 text-sophia-dark-blue' : 'border-sophia-dark-border bg-sophia-dark-surface-raised text-sophia-dark-text hover:bg-sophia-dark-surface'}"
                    onclick={() => entry.route && selectRoute(entry.route.id)}
                    disabled={!entry.route}
                  >
                    <div class="mb-1 uppercase tracking-[0.08em] text-sophia-dark-muted">{entry.stage}</div>
                    {#if entry.route}
                      <div>{entry.route.name ?? entry.route.id}</div>
                      <div class="mt-1 text-sophia-dark-dim">v{entry.route.version ?? '—'} / published {entry.route.publishedVersion ?? '—'}</div>
                    {:else}
                      <div class="text-sophia-dark-copper">No route currently returned</div>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="mb-2 font-mono text-xs text-sophia-dark-muted">Switch criteria enums</div>
            {#if contextErrors.switchCriteria}
              <div class="font-mono text-xs text-sophia-dark-copper">{formatContextError(contextErrors.switchCriteria)}</div>
            {:else}
              <pre class="overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-sophia-dark-text">{JSON.stringify(switchCriteria ?? {}, null, 2)}</pre>
            {/if}
          </div>
        </section>

        <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
          <div>
            <div class="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
              Route workspace
            </div>
            <p class="text-sm text-sophia-dark-muted">
              Inspect steps, run simulation, exercise lifecycle actions, and preserve exact upstream failures.
            </p>
          </div>

          {#if selectedRoute}
            <div class="grid gap-4 md:grid-cols-3">
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
                <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Route</div>
                <div class="font-mono text-sm text-sophia-dark-text">{selectedRoute.name ?? selectedRoute.id}</div>
              </div>
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
                <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Stage</div>
                <div class="font-mono text-sm text-sophia-dark-text">{selectedRoute.stage ?? '—'}</div>
              </div>
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
                <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Versions</div>
                <div class="font-mono text-sm text-sophia-dark-text">draft {selectedRoute.version ?? '—'} / published {selectedRoute.publishedVersion ?? '—'}</div>
              </div>
            </div>

            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
                onclick={() => loadRouteArtifacts(selectedRoute.id)}
                disabled={busyAction !== ''}
              >
                {busyAction === 'steps' || busyAction === 'history' ? 'Refreshing…' : 'Refresh steps + history'}
              </button>
              <button
                type="button"
                class="rounded border border-sophia-dark-sage/40 px-3 py-2 font-mono text-xs text-sophia-dark-sage hover:bg-sophia-dark-sage/10"
                onclick={publishRoute}
                disabled={busyAction !== ''}
              >
                {busyAction === 'publish' ? 'Publishing…' : 'Publish route'}
              </button>
              <button
                type="button"
                class="rounded border border-sophia-dark-copper/40 px-3 py-2 font-mono text-xs text-sophia-dark-copper hover:bg-sophia-dark-copper/10"
                onclick={rollbackRoute}
                disabled={busyAction !== ''}
              >
                {busyAction === 'rollback' ? 'Rolling back…' : 'Rollback route'}
              </button>
            </div>
          {:else}
            <div class="rounded border border-dashed border-sophia-dark-border px-4 py-8 text-center font-mono text-sm text-sophia-dark-muted">
              No route is currently selectable from the Restormel project.
            </div>
          {/if}
        </section>
      </div>

      {#if selectedRoute}
        <div class="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
            <div>
              <div class="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
                Steps and history
              </div>
              <p class="text-sm text-sophia-dark-muted">
                Machine-readable route steps, switch criteria, and lifecycle history from Restormel.
              </p>
            </div>

            {#if stepsError}
              <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-4 font-mono text-xs text-sophia-dark-copper">
                {stepsError}
              </div>
            {/if}

            <div class="space-y-3">
              {#each steps as step}
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
                  <div class="mb-2 flex flex-wrap items-center gap-2">
                    <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
                      order {step.orderIndex ?? '—'}
                    </span>
                    <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-text">
                      {step.providerPreference ?? 'provider?'} · {step.modelId ?? 'model?'}
                    </span>
                    <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-text">
                      {step.enabled === false ? 'disabled' : 'enabled'}
                    </span>
                  </div>
                  <pre class="overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-sophia-dark-text">{JSON.stringify(step, null, 2)}</pre>
                </div>
              {:else}
                <div class="rounded border border-dashed border-sophia-dark-border px-4 py-6 text-center font-mono text-sm text-sophia-dark-muted">
                  No steps returned for this route.
                </div>
              {/each}
            </div>

            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
              <div class="mb-2 font-mono text-xs text-sophia-dark-muted">Route history</div>
              {#if historyError}
                <div class="font-mono text-xs text-sophia-dark-copper">{historyError}</div>
              {:else if history.length > 0}
                <div class="space-y-3">
                  {#each history as entry}
                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised p-3">
                      <div class="font-mono text-xs text-sophia-dark-text">version {entry.version ?? '—'} / published {entry.publishedVersion ?? '—'}</div>
                      <div class="mt-1 font-mono text-xs text-sophia-dark-muted">updated {formatDate(entry.createdAt)} · published {formatDate(entry.publishedAt)}</div>
                      {#if entry.changeSummary}
                        <div class="mt-2 text-sm text-sophia-dark-text">{entry.changeSummary}</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="font-mono text-xs text-sophia-dark-muted">No route history returned.</div>
              {/if}
            </div>
          </section>

          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
            <div>
              <div class="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
                Editing and probes
              </div>
              <p class="text-sm text-sophia-dark-muted">
                Advanced mode for saving draft JSON, simulating stage decisions, and verifying live resolve metadata.
              </p>
            </div>

            <label class="block space-y-2">
              <span class="font-mono text-xs text-sophia-dark-muted">Route draft JSON</span>
              <textarea bind:value={routeJsonDraft} rows="10" class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-xs text-sophia-dark-text"></textarea>
            </label>
            <button
              type="button"
              class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-xs text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
              onclick={saveRouteDraft}
              disabled={busyAction !== ''}
            >
              {busyAction === 'save-route' ? 'Saving route…' : 'Save route draft'}
            </button>

            <label class="block space-y-2">
              <span class="font-mono text-xs text-sophia-dark-muted">Steps draft JSON</span>
              <textarea bind:value={stepsJsonDraft} rows="12" class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-xs text-sophia-dark-text"></textarea>
            </label>
            <button
              type="button"
              class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-xs text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
              onclick={saveStepsDraft}
              disabled={busyAction !== ''}
            >
              {busyAction === 'save-steps' ? 'Saving steps…' : 'Save steps draft'}
            </button>

            <label class="block space-y-2">
              <span class="font-mono text-xs text-sophia-dark-muted">Simulation request JSON</span>
              <textarea bind:value={simulateJsonDraft} rows="10" class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-xs text-sophia-dark-text"></textarea>
            </label>
            <button
              type="button"
              class="rounded border border-sophia-dark-sage/40 px-4 py-2 font-mono text-xs text-sophia-dark-sage hover:bg-sophia-dark-sage/10"
              onclick={simulateRoute}
              disabled={busyAction !== ''}
            >
              {busyAction === 'simulate' ? 'Simulating…' : 'Simulate route'}
            </button>
            {#if simulationResult}
              <pre class="overflow-auto whitespace-pre-wrap break-words rounded border border-sophia-dark-border bg-sophia-dark-bg p-4 font-mono text-xs text-sophia-dark-text">{JSON.stringify(simulationResult, null, 2)}</pre>
            {/if}

            <label class="block space-y-2">
              <span class="font-mono text-xs text-sophia-dark-muted">Resolve probe JSON</span>
              <textarea bind:value={resolveJsonDraft} rows="10" class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-xs text-sophia-dark-text"></textarea>
            </label>
            <button
              type="button"
              class="rounded border border-sophia-dark-sage/40 px-4 py-2 font-mono text-xs text-sophia-dark-sage hover:bg-sophia-dark-sage/10"
              onclick={resolveRouteDecision}
              disabled={busyAction !== ''}
            >
              {busyAction === 'resolve' ? 'Resolving…' : 'Run resolve probe'}
            </button>
            {#if resolveResult}
              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
                  <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Selected step</div>
                  <div class="font-mono text-sm text-sophia-dark-text">{resolveResult.selectedStepId ?? '—'}</div>
                </div>
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
                  <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Order / switch</div>
                  <div class="font-mono text-sm text-sophia-dark-text">{resolveResult.selectedOrderIndex ?? '—'} / {resolveResult.switchReasonCode ?? '—'}</div>
                </div>
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
                  <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Provider / model</div>
                  <div class="font-mono text-sm text-sophia-dark-text">{resolveResult.providerType ?? '—'} / {resolveResult.modelId ?? '—'}</div>
                </div>
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
                  <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Estimated cost</div>
                  <div class="font-mono text-sm text-sophia-dark-text">{resolveResult.estimatedCostUsd ?? '—'}</div>
                </div>
              </div>
              <pre class="overflow-auto whitespace-pre-wrap break-words rounded border border-sophia-dark-border bg-sophia-dark-bg p-4 font-mono text-xs text-sophia-dark-text">{JSON.stringify(resolveResult, null, 2)}</pre>
            {/if}
          </section>
        </div>
      {/if}
    {/if}
  </div>
</div>
