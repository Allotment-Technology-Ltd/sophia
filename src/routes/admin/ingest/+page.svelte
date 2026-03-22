<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getIdToken } from '$lib/firebase';
  import { isEmbeddingModelEntry } from '$lib/ingestionModelCatalogMerge';
  import { resolveRouteForStage } from '$lib/utils/ingestionRouting';

  type StageStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';
  type FlowState = 'setup' | 'running' | 'awaiting_sync' | 'done';

  type Stage = {
    key: string;
    label: string;
    description: string;
    status: StageStatus;
    result?: string;
  };

  interface AdminRouteRecord {
    id: string;
    stage?: string | null;
    enabled?: boolean | null;
    [key: string]: unknown;
  }

  interface CatalogEntry {
    label: string;
    provider: string;
    modelId: string;
  }

  const SOURCE_TYPES = [
    { value: 'sep_entry', label: 'Stanford Encyclopedia of Philosophy' },
    { value: 'iep_entry', label: 'Internet Encyclopedia of Philosophy' },
    { value: 'journal_article', label: 'Academic paper / journal article' },
    { value: 'book', label: 'Book (Project Gutenberg or plain text)' },
    { value: 'web_article', label: 'General web source' }
  ] as const;

  const RESTORMEL_STAGES: {
    key: string;
    label: string;
    description: string;
    embed: boolean;
  }[] = [
    {
      key: 'ingestion_extraction',
      label: 'Extraction',
      description: 'Structured claims and passages from the source.',
      embed: false
    },
    {
      key: 'ingestion_relations',
      label: 'Relations',
      description: 'Support, tension, and dependency links.',
      embed: false
    },
    {
      key: 'ingestion_grouping',
      label: 'Grouping',
      description: 'Argument clusters and positions.',
      embed: false
    },
    {
      key: 'ingestion_validation',
      label: 'Validation',
      description: 'Quality and confidence checks.',
      embed: false
    },
    {
      key: 'ingestion_embedding',
      label: 'Embedding',
      description: 'Vectors for retrieval.',
      embed: true
    },
    {
      key: 'ingestion_json_repair',
      label: 'JSON repair',
      description: 'Repair malformed model output.',
      embed: false
    }
  ];

  const STAGE_TEMPLATE: Stage[] = [
    { key: 'fetch', label: 'Fetch & parse', description: 'Download and normalize the source.', status: 'idle' },
    { key: 'extract', label: 'Extract', description: 'Structured claims from passages.', status: 'idle' },
    { key: 'relate', label: 'Relate', description: 'Link claims by support and tension.', status: 'idle' },
    { key: 'group', label: 'Group', description: 'Cluster into arguments.', status: 'idle' },
    { key: 'embed', label: 'Embed', description: 'Embedding vectors for claims.', status: 'idle' },
    { key: 'validate', label: 'Validate', description: 'Optional cross-model validation.', status: 'idle' },
    {
      key: 'store',
      label: 'SurrealDB',
      description: 'Write graph and records (use Sync when prepare finishes).',
      status: 'idle'
    }
  ];

  let flowState = $state<FlowState>('setup');
  let sourceUrl = $state('');
  let sourceType = $state<(typeof SOURCE_TYPES)[number]['value']>('sep_entry');
  let runValidate = $state(false);
  let starting = $state(false);
  let syncing = $state(false);
  let runId = $state('');
  let runError = $state('');
  let urlError = $state('');
  let runLog = $state<string[]>([]);
  let stages = $state<Stage[]>(cloneStages());
  let pollingInterval: ReturnType<typeof setInterval> | null = null;

  let routingBusy = $state(false);
  let routingMessage = $state('');
  let routingError = $state('');
  let routes = $state<AdminRouteRecord[]>([]);
  let catalogEntries = $state<CatalogEntry[]>([]);
  let catalogError = $state('');
  let catalogNotice = $state('');
  let stageModelIds = $state<Record<string, string>>({
    ingestion_extraction: '',
    ingestion_relations: '',
    ingestion_grouping: '',
    ingestion_validation: '',
    ingestion_embedding: '',
    ingestion_json_repair: ''
  });

  let chatModels = $derived(catalogEntries.filter((e) => !isEmbeddingModelEntry(e)));
  let embeddingModels = $derived(catalogEntries.filter((e) => isEmbeddingModelEntry(e)));

  let syncDurationLabel = $state('');
  let completionMessage = $state('');

  function stableModelId(e: Pick<CatalogEntry, 'provider' | 'modelId'>): string {
    return `${e.provider}__${e.modelId}`.replace(/\//g, '-');
  }

  function getCatalogEntryByStableId(id: string): CatalogEntry | undefined {
    if (!id.trim()) return undefined;
    return catalogEntries.find((e) => stableModelId(e) === id);
  }

  function modelsForStage(row: (typeof RESTORMEL_STAGES)[number]): CatalogEntry[] {
    return row.embed ? embeddingModels : chatModels;
  }

  function applyDefaultStageSelections(): void {
    if (catalogEntries.length === 0) {
      stageModelIds = Object.fromEntries(RESTORMEL_STAGES.map((r) => [r.key, ''])) as Record<string, string>;
      return;
    }
    const next: Record<string, string> = {};
    for (const row of RESTORMEL_STAGES) {
      const list = catalogEntries.filter((e) =>
        row.embed ? isEmbeddingModelEntry(e) : !isEmbeddingModelEntry(e)
      );
      next[row.key] = list[0] ? stableModelId(list[0]) : '';
    }
    stageModelIds = next;
  }

  function ingestionModelsReady(): boolean {
    if (catalogEntries.length === 0) return false;
    for (const row of RESTORMEL_STAGES) {
      const id = stageModelIds[row.key]?.trim() ?? '';
      if (!id) return false;
      if (!getCatalogEntryByStableId(id)) return false;
      if (modelsForStage(row).length === 0) return false;
    }
    return true;
  }

  function cloneStages(): Stage[] {
    return STAGE_TEMPLATE.map((stage) => ({
      ...stage,
      result: undefined,
      status: stage.key === 'validate' ? (runValidate ? 'idle' : 'skipped') : 'idle'
    }));
  }

  async function authorizedJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required. Sign in again and retry.');
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`
      }
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`);
    }
    return body;
  }

  async function loadRoutingContext(): Promise<void> {
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/context');
      routes = Array.isArray(body.routes) ? (body.routes as AdminRouteRecord[]) : [];
    } catch {
      routes = [];
    }
  }

  async function loadModelCatalog(): Promise<void> {
    catalogError = '';
    catalogNotice = '';
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/model-catalog');
      catalogEntries = Array.isArray(body.entries) ? (body.entries as CatalogEntry[]) : [];
      const sync = body.catalogSync as { status?: string; reason?: string } | undefined;
      if (sync?.status === 'unavailable') {
        catalogError = sync.reason ?? 'Restormel model list is not available.';
      } else if (catalogEntries.length > 0) {
        catalogNotice = `${catalogEntries.length} models from Restormel Keys.`;
      }
      applyDefaultStageSelections();
    } catch (e) {
      catalogEntries = [];
      catalogError = e instanceof Error ? e.message : 'Failed to load models from Restormel.';
      applyDefaultStageSelections();
    }
  }

  async function hydrateSelectionsFromRoutes(): Promise<void> {
    if (catalogEntries.length === 0) return;
    const next = { ...stageModelIds };
    for (const row of RESTORMEL_STAGES) {
      const route = resolveRouteForStage(routes, row.key);
      if (!route?.id) continue;
      try {
        const body = await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/steps`);
        const steps = Array.isArray(body.steps) ? body.steps : [];
        const ordered = [...steps].sort(
          (a, b) => (Number((a as { orderIndex?: number }).orderIndex) || 0) - (Number((b as { orderIndex?: number }).orderIndex) || 0)
        );
        const first = ordered[0] as { providerPreference?: string | null; modelId?: string | null } | undefined;
        const pid = first?.providerPreference?.trim() ?? '';
        const mid = first?.modelId?.trim() ?? '';
        if (!pid || !mid) continue;
        const entry = catalogEntries.find((e) => e.provider === pid && e.modelId === mid);
        if (!entry) continue;
        const sid = stableModelId(entry);
        const list = modelsForStage(row);
        if (list.some((e) => stableModelId(e) === sid)) {
          next[row.key] = sid;
        }
      } catch {
        /* ignore */
      }
    }
    stageModelIds = next;
  }

  async function refreshModelsAndRoutes(): Promise<void> {
    await loadModelCatalog();
    await loadRoutingContext();
    await hydrateSelectionsFromRoutes();
  }

  async function applyStageRouting(): Promise<void> {
    routingBusy = true;
    routingError = '';
    routingMessage = '';
    try {
      await loadRoutingContext();
      for (const row of RESTORMEL_STAGES) {
        const route = resolveRouteForStage(routes, row.key);
        if (!route?.id) {
          routingError = `No Restormel route is available for “${row.label}”. Configure routes in Restormel Keys, then refresh.`;
          return;
        }
        const sid = stageModelIds[row.key];
        const opt = getCatalogEntryByStableId(sid);
        if (!opt) {
          routingError = `Choose a Restormel model for “${row.label}”.`;
          return;
        }
        await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/steps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              orderIndex: 0,
              enabled: true,
              providerPreference: opt.provider,
              modelId: opt.modelId
            }
          ])
        });
      }
      routingMessage = 'Saved model routing for all six ingestion stages.';
    } catch (e) {
      routingError = e instanceof Error ? e.message : 'Failed to save routing';
    } finally {
      routingBusy = false;
    }
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) {
      throw new Error('Authentication required. Sign in again and retry.');
    }
    return { Authorization: `Bearer ${token}` };
  }

  function validateSource(): boolean {
    urlError = '';
    if (!sourceUrl.trim()) {
      urlError = 'Source URL is required.';
      return false;
    }
    try {
      new URL(sourceUrl.trim());
      return true;
    } catch {
      urlError = 'Enter a valid URL.';
      return false;
    }
  }

  function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
  }

  async function startIngestion(): Promise<void> {
    if (starting || !validateSource()) return;
    if (!ingestionModelsReady()) {
      runError =
        'Select a Restormel model for every stage (and ensure your project lists both chat and embedding models where required).';
      return;
    }
    starting = true;
    runError = '';
    runLog = [];
    completionMessage = '';
    syncDurationLabel = '';
    stages = cloneStages();

    try {
      const response = await fetch('/api/admin/ingest/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders())
        },
        body: JSON.stringify({
          source_url: sourceUrl.trim(),
          source_type: sourceType,
          validate: runValidate,
          stop_before_store: true,
          embedding_model: stageModelIds.ingestion_embedding,
          model_chain: {
            extract: stageModelIds.ingestion_extraction,
            relate: stageModelIds.ingestion_relations,
            group: stageModelIds.ingestion_grouping,
            validate: stageModelIds.ingestion_validation
          }
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to start ingestion run.');
      }

      const body = await response.json();
      const id = typeof body?.run_id === 'string' ? body.run_id : '';
      if (!id) throw new Error('Run ID missing from start response.');

      runId = id;
      flowState = 'running';
      runLog = [`Run started: ${runId}`];
      const params = new URLSearchParams(window.location.search);
      params.set('monitor', '1');
      params.set('runId', runId);
      window.history.replaceState({}, '', `/admin/ingest?${params.toString()}`);
      startPolling();
    } catch (error) {
      runError = error instanceof Error ? error.message : 'Failed to start ingestion.';
      flowState = 'setup';
    } finally {
      starting = false;
    }
  }

  async function syncToSurreal(): Promise<void> {
    if (!runId || syncing) return;
    syncing = true;
    runError = '';
    completionMessage = '';
    syncDurationLabel = '';
    try {
      const response = await fetch(`/api/admin/ingest/run/${runId}/sync-surreal`, {
        method: 'POST',
        headers: await authHeaders()
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Sync request failed.');
      }
      flowState = 'running';
      startPolling();
    } catch (e) {
      runError = e instanceof Error ? e.message : 'Sync failed.';
    } finally {
      syncing = false;
    }
  }

  function applyStatusBody(body: Record<string, unknown>): void {
    if (body?.stages && typeof body.stages === 'object') {
      stages = STAGE_TEMPLATE.map((stage) => ({
        ...stage,
        status: ((body.stages as Record<string, { status?: StageStatus }>)[stage.key]?.status ??
          stage.status) as StageStatus,
        result: typeof (body.stages as Record<string, { summary?: string }>)[stage.key]?.summary === 'string'
          ? (body.stages as Record<string, { summary?: string }>)[stage.key].summary
          : undefined
      }));
    }
    if (Array.isArray(body?.logLines)) {
      runLog = body.logLines as string[];
    }

    const awaitingSync = body?.awaitingSync === true || body?.status === 'awaiting_sync';
    const syncStart = typeof body?.syncStartedAt === 'number' ? body.syncStartedAt : undefined;
    const syncEnd = typeof body?.syncCompletedAt === 'number' ? body.syncCompletedAt : undefined;
    if (syncStart != null && syncEnd != null) {
      syncDurationLabel = formatDuration(syncEnd - syncStart);
    }

    if (body?.status === 'done') {
      flowState = 'done';
      completionMessage =
        syncEnd != null
          ? `Job completed. SurrealDB sync finished in ${syncDurationLabel || formatDuration((syncEnd ?? 0) - (syncStart ?? 0))}.`
          : 'Job completed. Ingestion finished successfully.';
      clearPolling();
    } else if (awaitingSync) {
      flowState = 'awaiting_sync';
    } else if (body?.status === 'error') {
      runError = typeof body?.error === 'string' ? body.error : 'Ingestion failed.';
      clearPolling();
    }
  }

  async function fetchRunStatus(): Promise<void> {
    if (!runId) return;
    try {
      const response = await fetch(`/api/admin/ingest/run/${runId}/status`, {
        headers: await authHeaders()
      });
      if (!response.ok) {
        if (response.status === 404) {
          runError = `Run ${runId} not found.`;
          clearPolling();
        }
        return;
      }
      const body = await response.json();
      applyStatusBody(body);
    } catch {
      /* transient */
    }
  }

  function startPolling(): void {
    if (!runId) return;
    if (pollingInterval) clearInterval(pollingInterval);

    void fetchRunStatus();

    pollingInterval = setInterval(() => {
      void fetchRunStatus();
    }, 1500);
  }

  function clearPolling(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function resetFlow(): void {
    clearPolling();
    flowState = 'setup';
    runId = '';
    runError = '';
    runLog = [];
    completionMessage = '';
    syncDurationLabel = '';
    stages = cloneStages();
    const params = new URLSearchParams(window.location.search);
    params.delete('monitor');
    params.delete('runId');
    const query = params.toString();
    window.history.replaceState({}, '', query ? `/admin/ingest?${query}` : '/admin/ingest');
  }

  onMount(() => {
    void (async () => {
      await loadModelCatalog();
      await loadRoutingContext();
      await hydrateSelectionsFromRoutes();
    })();

    const params = new URLSearchParams(window.location.search);
    const monitor = params.get('monitor');
    const existingRunId = params.get('runId');
    if (monitor === '1' && existingRunId) {
      runId = existingRunId;
      flowState = 'running';
      runLog = [`Monitoring run: ${runId}`];
      startPolling();
    }
  });

  onDestroy(() => clearPolling());
</script>

<svelte:head>
  <title>Ingestion — Expand</title>
</svelte:head>

<div class="mx-auto w-full max-w-4xl px-6 py-8 sm:px-8 lg:px-10">
  <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 sm:p-8">
    <header class="border-b border-sophia-dark-border pb-6">
      <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Expand</p>
      <h1 class="mt-2 font-serif text-3xl text-sophia-dark-text">Ingestion</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-sophia-dark-muted">
        Set the source URL, choose models for each ingestion stage from your Restormel Keys project list, run the pipeline,
        then sync results to SurrealDB in one step when prepare is complete.
      </p>
    </header>

    <div class="mt-8 space-y-10">
      <!-- Source -->
      <div class="space-y-4">
        <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">1. Source</h2>
        <label class="block space-y-2">
          <span class="text-sm text-sophia-dark-muted">URL</span>
          <input
            bind:value={sourceUrl}
            type="url"
            disabled={flowState !== 'setup'}
            placeholder="https://plato.stanford.edu/entries/ethics-deontology/"
            class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text disabled:opacity-60"
          />
          {#if urlError}
            <span class="font-mono text-xs text-sophia-dark-copper">{urlError}</span>
          {/if}
        </label>
        <label class="block space-y-2">
          <span class="text-sm text-sophia-dark-muted">Source type</span>
          <select
            bind:value={sourceType}
            disabled={flowState !== 'setup'}
            class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text disabled:opacity-60"
          >
            {#each SOURCE_TYPES as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="flex cursor-pointer items-center gap-2 text-sm text-sophia-dark-muted">
          <input type="checkbox" bind:checked={runValidate} disabled={flowState !== 'setup'} class="rounded border-sophia-dark-border" />
          Run optional cross-model validation (slower, higher cost)
        </label>
      </div>

      <!-- Routing -->
      <div class="space-y-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
            2. Model routing (six stages)
          </h2>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={flowState !== 'setup'}
              onclick={() => void refreshModelsAndRoutes()}
              class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
            >
              Refresh models
            </button>
            <button
              type="button"
              disabled={routingBusy || flowState !== 'setup' || catalogEntries.length === 0}
              onclick={() => void applyStageRouting()}
              class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
            >
              {routingBusy ? 'Saving…' : 'Apply routing'}
            </button>
          </div>
        </div>
        <p class="text-sm text-sophia-dark-muted">
          Choices are loaded from Restormel Keys (project model index). Primary model per stage is written to Restormel as step 0.
        </p>
        {#if catalogNotice}
          <p class="font-mono text-xs text-sophia-dark-sage">{catalogNotice}</p>
        {/if}
        {#if catalogError}
          <p class="font-mono text-xs text-sophia-dark-copper" role="alert">{catalogError}</p>
        {/if}
        {#if routingMessage}
          <p class="font-mono text-xs text-sophia-dark-sage">{routingMessage}</p>
        {/if}
        {#if routingError}
          <p class="font-mono text-xs text-sophia-dark-copper">{routingError}</p>
        {/if}
        <div class="space-y-3">
          {#each RESTORMEL_STAGES as row}
            <div class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/40 px-4 py-3">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div class="font-serif text-lg text-sophia-dark-text">{row.label}</div>
                  <p class="text-sm text-sophia-dark-muted">{row.description}</p>
                </div>
                <select
                  bind:value={stageModelIds[row.key]}
                  disabled={flowState !== 'setup' || modelsForStage(row).length === 0}
                  class="min-w-[14rem] rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                >
                  {#if modelsForStage(row).length === 0}
                    <option value="">No models in Restormel for this slot</option>
                  {:else}
                    {#each modelsForStage(row) as m}
                      <option value={stableModelId(m)}>{m.label}</option>
                    {/each}
                  {/if}
                </select>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Run -->
      <div class="space-y-4">
        <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">3. Run</h2>
        {#if flowState === 'setup'}
          <button
            type="button"
            onclick={() => void startIngestion()}
            class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20 disabled:opacity-50"
            disabled={starting || !ingestionModelsReady()}
          >
            {starting ? 'Starting…' : 'Run ingestion'}
          </button>
        {:else}
          <div class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/60 px-4 py-3 font-mono text-xs text-sophia-dark-muted">
            Run ID: <span class="text-sophia-dark-text">{runId || '—'}</span>
          </div>

          <div class="grid gap-3">
            {#each stages as stage}
              <article class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/40 px-4 py-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="font-serif text-lg text-sophia-dark-text">{stage.label}</h3>
                  <span
                    class="rounded-full border px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em]
                    {stage.status === 'done'
                      ? 'border-sophia-dark-sage/40 bg-sophia-dark-sage/10 text-sophia-dark-sage'
                      : stage.status === 'running'
                        ? 'border-sophia-dark-blue/40 bg-sophia-dark-blue/10 text-sophia-dark-blue'
                        : stage.status === 'error'
                          ? 'border-sophia-dark-copper/40 bg-sophia-dark-copper/10 text-sophia-dark-copper'
                          : stage.status === 'skipped'
                            ? 'border-sophia-dark-border text-sophia-dark-dim'
                            : 'border-sophia-dark-border text-sophia-dark-muted'}"
                  >
                    {stage.status}
                  </span>
                </div>
                <p class="mt-1 text-sm text-sophia-dark-muted">{stage.description}</p>
                {#if stage.result}
                  <p class="mt-2 font-mono text-xs text-sophia-dark-dim">{stage.result}</p>
                {/if}
              </article>
            {/each}
          </div>

          {#if runLog.length > 0}
            <details class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/50 px-4 py-3" open={flowState === 'running'}>
              <summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">
                Activity ({runLog.length})
              </summary>
              <pre class="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-sophia-dark-muted">{runLog.join('\n')}</pre>
            </details>
          {/if}

          {#if flowState === 'running' && !runError}
            <p class="text-sm text-sophia-dark-muted" aria-live="polite">Running… you can leave this page open.</p>
          {/if}

          {#if flowState === 'awaiting_sync'}
            <div class="rounded-lg border border-sophia-dark-sage/35 bg-sophia-dark-sage/10 px-4 py-4" role="status">
              <p class="font-serif text-lg text-sophia-dark-text">Prepare complete</p>
              <p class="mt-1 text-sm text-sophia-dark-muted">
                Stages through validation (and optional cross-check) are finished. Sync writes the graph to SurrealDB.
              </p>
              <button
                type="button"
                onclick={() => void syncToSurreal()}
                disabled={syncing}
                class="mt-4 w-full rounded border border-sophia-dark-sage/55 bg-sophia-dark-sage/20 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/28 disabled:opacity-50 sm:w-auto"
              >
                {syncing ? 'Starting sync…' : 'Sync to SurrealDB'}
              </button>
            </div>
          {/if}

          {#if flowState === 'running' && syncDurationLabel}
            <p class="font-mono text-xs text-sophia-dark-muted">Last sync duration: {syncDurationLabel}</p>
          {/if}

          {#if flowState === 'done' && completionMessage}
            <div class="rounded-lg border border-sophia-dark-sage/40 bg-sophia-dark-sage/12 px-4 py-3 text-sm text-sophia-dark-text" role="status">
              {completionMessage}
            </div>
          {/if}

          {#if runError}
            <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper" role="alert">
              <strong class="block font-sans text-sm text-sophia-dark-copper">Issue</strong>
              {runError}
              <p class="mt-2 text-sophia-dark-muted">
                The server retries transient failures once automatically. Check the activity log, fix configuration if needed, then start again.
              </p>
            </div>
          {/if}

          {#if flowState === 'done' || flowState === 'awaiting_sync' || runError}
            <button
              type="button"
              onclick={resetFlow}
              class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
            >
              Start another source
            </button>
          {/if}
        {/if}
      </div>
    </div>
  </section>
</div>
