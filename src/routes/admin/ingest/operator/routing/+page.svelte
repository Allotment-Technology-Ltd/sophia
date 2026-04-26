<script lang="ts">
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/authClient';
  import {
    INGESTION_PHASE_COLUMN_ORDER,
    INGESTION_PHASE_TABLE_HEADING,
    type IngestionPipelineStageKey
  } from '$lib/ingestionPipelineModelRequirements';
  import {
    defaultOperatorPhasePins,
    loadOperatorPhasePinsFromStorage,
    type OperatorPhaseKey,
    type OperatorPhasePinsState,
    saveOperatorPhasePinsToStorage
  } from '$lib/ingestion/operatorPhasePins';
  import { resolveRouteForStage, type IngestionRouteLike } from '$lib/utils/ingestionRouting';
  import { INGESTION_PIPELINE_PRESET, type IngestionLlmStageKey } from '$lib/ingestionCanonicalPipeline';

  let { data } = $props();
  const restormelEnvironmentId = $derived(data.restormelEnvironmentId ?? 'production');
  const embeddingRuntime = $derived(
    data.embeddingRuntime as
      | { providerName: string; documentModel: string; modelLabel: string; dimensions: number }
      | undefined
  );

  type RouteRow = IngestionRouteLike & {
    name?: string | null;
    workload?: string | null;
    stage?: string | null;
    isPublished?: boolean | null;
  };
  type StepRow = {
    orderIndex?: number | null;
    enabled?: boolean | null;
    providerPreference?: string | null;
    modelId?: string | null;
  };
  type CatalogEntry = {
    provider: string;
    modelId: string;
    label?: string;
    pricing?: { inputPerMillion?: number; outputPerMillion?: number };
  };

  /** Restormel `stage` field → worker `INGEST_PIN_*` suffix (see `scripts/ingest.ts`). */
  const PIN_SUFFIX: Partial<Record<string, string>> = {
    ingestion_extraction: 'EXTRACTION',
    ingestion_relations: 'RELATIONS',
    ingestion_grouping: 'GROUPING',
    ingestion_validation: 'VALIDATION',
    ingestion_remediation: 'REMEDIATION',
    ingestion_json_repair: 'JSON_REPAIR'
  };

  const pipelineStages: { key: string; label: string }[] = [
    ...INGESTION_PHASE_COLUMN_ORDER.map((k: IngestionPipelineStageKey) => ({
      key: k,
      label: INGESTION_PHASE_TABLE_HEADING[k]
    })),
    { key: 'ingestion_remediation', label: 'Remediate' }
  ];

  const PRESET_LLM_ORDER: IngestionLlmStageKey[] = [
    'extraction',
    'relations',
    'grouping',
    'validation',
    'remediation',
    'json_repair'
  ];
  const PRESET_LLM_LABEL: Record<IngestionLlmStageKey, string> = {
    extraction: 'Extract',
    relations: 'Relate',
    grouping: 'Group',
    validation: 'Validate',
    remediation: 'Remediate',
    json_repair: 'JSON repair'
  };

  let loading = $state(true);
  let err = $state('');
  let routes = $state<RouteRow[]>([]);
  let catalog = $state<CatalogEntry[]>([]);
  let stepsByRouteId = $state<Record<string, StepRow[]>>({});

  let createName = $state('');
  let createStage = $state('');
  /** Optional description sent to Keys (route metadata). */
  let createDescription = $state('');
  let createBusy = $state(false);
  let createFeedback = $state('');

  const createStageOptions: { value: string; label: string }[] = [
    { value: '', label: 'Shared ingestion fallback (no stage)' },
    { value: 'ingestion_extraction', label: 'ingestion_extraction' },
    { value: 'ingestion_relations', label: 'ingestion_relations' },
    { value: 'ingestion_grouping', label: 'ingestion_grouping' },
    { value: 'ingestion_validation', label: 'ingestion_validation' },
    { value: 'ingestion_remediation', label: 'ingestion_remediation' },
    { value: 'ingestion_embedding', label: 'ingestion_embedding' },
    { value: 'ingestion_json_repair', label: 'ingestion_json_repair' }
  ];

  /** Select value when no Neon override — workers use Keys route metadata + env, then discover. */
  const ROUTE_AUTO = '__auto__';

  /** Neon-persisted route UUID per admin stage key, or null = auto. */
  let routeBindingOverrideByStage = $state<Record<string, string | null>>({});
  let routeBindingsDbAvailable = $state(true);
  let routeBindingsMessage = $state('');

  const PHASE_PIN_ROWS: { key: OperatorPhaseKey; label: string; hint: string }[] = [
    { key: 'EXTRACTION', label: 'Extraction', hint: 'Use auto to follow Restormel resolve + pins below for OpenAI-compatible FT.' },
    { key: 'RELATIONS', label: 'Relations', hint: '' },
    { key: 'GROUPING', label: 'Grouping', hint: '' },
    { key: 'VALIDATION', label: 'Validation', hint: '' },
    { key: 'REMEDIATION', label: 'Remediation', hint: '' },
    { key: 'JSON_REPAIR', label: 'JSON repair', hint: '' }
  ];

  let phasePins = $state<OperatorPhasePinsState>(defaultOperatorPhasePins());
  let phasePinsMessage = $state('');
  let phasePinsDirty = $state(false);

  type GatewaySummary = {
    source: 'database' | 'environment' | 'none';
    last4: string | null;
    configured: boolean;
    hasDatabaseRow: boolean;
    storageDecryptFailed?: boolean;
    storageDecryptError?: string | null;
    databaseReadFailed?: boolean;
    ignoredEnvironmentKeyLast4?: string | null;
  };
  let gatewaySummary = $state<GatewaySummary | null>(null);
  /** Pinned / resolved route UUIDs not in the last routes list (wrong project or stale bindings). */
  let routeAlignmentWarning = $state('');
  type OrphanRouteBinding = { stageKey: string; label: string; routeId: string };
  let orphanRouteBindings = $state<OrphanRouteBinding[]>([]);

  type AppAiDefaultsSummary = {
    databaseAvailable: boolean;
    defaultRestormelSharedRouteId: string | null;
    degradedPrimaryProvider: string | null;
    degradedReasoningModelStandard: string | null;
    degradedReasoningModelDeep: string | null;
    degradedExtractionModel: string | null;
    defaultOpenaiKeyConfigured: boolean;
    defaultOpenaiKeyLast4: string | null;
    openaiDecryptFailed: boolean;
  };
  let appAiSummary = $state<AppAiDefaultsSummary | null>(null);
  let appDefaultSharedRouteInput = $state('');
  let appDegPrimaryInput = $state('');
  let appDegReasonStdInput = $state('');
  let appDegReasonDeepInput = $state('');
  let appDegExtInput = $state('');
  let appOpenaiKeyInput = $state('');
  let appAiBusy = $state(false);
  let appAiMessage = $state('');

  function hydrateAppAiFormFromSummary(s: AppAiDefaultsSummary) {
    appDefaultSharedRouteInput = s.defaultRestormelSharedRouteId ?? '';
    appDegPrimaryInput = s.degradedPrimaryProvider ?? '';
    appDegReasonStdInput = s.degradedReasoningModelStandard ?? '';
    appDegReasonDeepInput = s.degradedReasoningModelDeep ?? '';
    appDegExtInput = s.degradedExtractionModel ?? '';
    appOpenaiKeyInput = '';
  }

  const ingestionRoutes = $derived(
    routes.filter((r) => (r.workload ?? '').trim().toLowerCase() === 'ingestion')
  );

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required.');
    return { Authorization: `Bearer ${token}` };
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function responseErrorMessage(label: string, res: Response, body: unknown): string {
    if (isRecord(body)) {
      const restormel = body.restormel;
      if (isRecord(restormel)) {
        const code = typeof restormel.code === 'string' ? restormel.code : '';
        const detail = typeof restormel.detail === 'string' ? restormel.detail : '';
        const userMessage = typeof restormel.userMessage === 'string' ? restormel.userMessage : '';
        const endpoint = typeof restormel.endpoint === 'string' ? restormel.endpoint : '';
        const parts = [
          code && `${label}: ${code}`,
          userMessage || detail,
          endpoint && `Endpoint: ${endpoint}`
        ].filter(Boolean);
        if (parts.length) return parts.join(' — ');
      }
      if (typeof body.error === 'string') return `${label}: ${body.error}`;
    }
    return `${label}: HTTP ${String(res.status)}`;
  }

  const defaultSharedRouteId = $derived(appDefaultSharedRouteInput.trim());
  const defaultSharedRouteSteps = $derived(
    defaultSharedRouteId ? (stepsByRouteId[defaultSharedRouteId] ?? []) : []
  );

  function enabledStepsForDisplay(st: StepRow[] | undefined | null): StepRow[] {
    if (!st?.length) return [];
    return st.filter((s) => s.enabled !== false);
  }

  function stepChainSummary(st: StepRow[]): { count: number; oneLine: string } {
    const e = enabledStepsForDisplay(st);
    if (!e.length) return { count: 0, oneLine: 'No published steps' };
    const first = e[0];
    const p = (first.providerPreference ?? '?').trim();
    const m = (first.modelId ?? '?').trim();
    const more = e.length > 1 ? ` (+${e.length - 1} more)` : '';
    return { count: e.length, oneLine: `${p} · ${m}${more}` };
  }

  async function refreshStepsForDefaultSharedRoute() {
    const id = appDefaultSharedRouteInput.trim();
    if (!id || !routes.some((r) => r.id === id)) return;
    await loadStepsForRoutes([id]);
  }

  function priceHint(provider: string, modelId: string): string {
    const p = provider.trim().toLowerCase();
    const m = modelId.trim();
    const hit = catalog.find(
      (e) => e.provider.toLowerCase() === p && e.modelId === m
    );
    if (!hit?.pricing) return '—';
    const i = hit.pricing.inputPerMillion;
    const o = hit.pricing.outputPerMillion;
    if (typeof i !== 'number' && typeof o !== 'number') return '—';
    const parts: string[] = [];
    if (typeof i === 'number') parts.push(`in $${i.toFixed(2)}/M tok`);
    if (typeof o === 'number') parts.push(`out $${o.toFixed(2)}/M tok`);
    return parts.join(' · ');
  }

  async function loadStepsForRoutes(ids: string[]): Promise<void> {
    const unique = [...new Set(ids.filter(Boolean))];
    const next: Record<string, StepRow[]> = { ...stepsByRouteId };
    await Promise.all(
      unique.map(async (id) => {
        try {
          const res = await fetch(`/api/admin/ingestion-routing/routes/${encodeURIComponent(id)}/steps`, {
            headers: await authHeaders()
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            next[id] = [];
            return;
          }
          const steps = Array.isArray(body.steps) ? (body.steps as StepRow[]) : [];
          next[id] = [...steps].sort(
            (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)
          );
        } catch {
          next[id] = [];
        }
      })
    );
    stepsByRouteId = next;
  }

  async function load() {
    loading = true;
    err = '';
    routeAlignmentWarning = '';
    orphanRouteBindings = [];
    try {
      const h = await authHeaders();
      const [rRes, cRes, gRes, bRes, aRes] = await Promise.all([
        fetch('/api/admin/ingestion-routing/routes', { headers: h }),
        fetch('/api/admin/ingestion-routing/model-catalog', { headers: h }),
        fetch('/api/admin/ingestion-routing/gateway', { headers: h }),
        fetch('/api/admin/ingestion-routing/route-bindings', { headers: h }),
        fetch('/api/admin/app-ai-defaults', { headers: h })
      ]);
      const rBody = await rRes.json().catch(() => ({}));
      const cBody = await cRes.json().catch(() => ({}));
      const gBody = await gRes.json().catch(() => ({}));
      const bBody = await bRes.json().catch(() => ({}));
      const aBody = await aRes.json().catch(() => ({}));
      if (gRes.ok && gBody.summary && typeof gBody.summary === 'object') {
        gatewaySummary = gBody.summary as GatewaySummary;
      } else {
        gatewaySummary = null;
      }
      if (aRes.ok && aBody.summary && typeof aBody.summary === 'object') {
        appAiSummary = aBody.summary as AppAiDefaultsSummary;
        hydrateAppAiFormFromSummary(appAiSummary);
      } else {
        appAiSummary = null;
      }
      routeBindingsDbAvailable = bRes.ok && bBody.databaseAvailable !== false;
      const serverBindings =
        bRes.ok && bBody.bindings && typeof bBody.bindings === 'object'
          ? (bBody.bindings as Record<string, string>)
          : {};
      const failures: string[] = [];
      if (!rRes.ok) failures.push(responseErrorMessage('Routes', rRes, rBody));
      if (!cRes.ok) failures.push(responseErrorMessage('Catalog', cRes, cBody));
      if (!bRes.ok) failures.push(responseErrorMessage('Route bindings', bRes, bBody));
      if (!aRes.ok) failures.push(responseErrorMessage('App defaults', aRes, aBody));

      routes = rRes.ok && Array.isArray(rBody.routes) ? (rBody.routes as RouteRow[]) : [];
      catalog = cRes.ok && Array.isArray(cBody.entries) ? (cBody.entries as CatalogEntry[]) : [];

      const ingestOnly = routes.filter(
        (r) => (r.workload ?? '').trim().toLowerCase() === 'ingestion'
      );
      const nextOverride: Record<string, string | null> = {};
      for (const row of pipelineStages) {
        const s = serverBindings[row.key];
        nextOverride[row.key] = typeof s === 'string' && s.trim() ? s.trim() : null;
      }
      routeBindingOverrideByStage = nextOverride;
      const needSteps: string[] = [];
      for (const row of pipelineStages) {
        const o = nextOverride[row.key];
        const eff =
          typeof o === 'string' && o.trim()
            ? o.trim()
            : resolveRouteForStage(ingestOnly, row.key, null)?.id ?? '';
        if (eff) needSteps.push(eff);
      }
      const sharedFallback = (appAiSummary?.defaultRestormelSharedRouteId ?? '').trim();
      if (sharedFallback) needSteps.push(sharedFallback);
      const uniqueStepTargets = [...new Set(needSteps.filter(Boolean))];
      const allRouteIds = new Set(
        (routes as RouteRow[])
          .map((r) => (typeof r.id === 'string' ? r.id.trim() : ''))
          .filter(Boolean)
      );
      const orphanRows = pipelineStages
        .map((row) => {
          const routeId = nextOverride[row.key]?.trim();
          return routeId ? { stageKey: row.key, label: row.label, routeId } : null;
        })
        .filter(
          (row): row is OrphanRouteBinding =>
            row != null && !allRouteIds.has(row.routeId)
        );
      orphanRouteBindings = orphanRows;
      if (orphanRows.length) {
        routeAlignmentWarning = `One or more phase route bindings saved in Neon are not in the list returned for this Restormel project and key — step details would 404 in Keys. ` +
          `Check \`RESTORMEL_PROJECT_ID\` matches the project where the routes were created, fix the gateway key (Neon or env) so the same workspace is used, or clear the stale phase bindings. ` +
          `Missing from list: ${orphanRows
            .slice(0, 5)
            .map((row) => `${row.label}: ${row.routeId.slice(0, 8)}…`)
            .join(', ')}${orphanRows.length > 5 ? ` and ${String(orphanRows.length - 5)} more` : ''}.`;
      }
      const toFetch = uniqueStepTargets.filter((id) => allRouteIds.has(id));
      await loadStepsForRoutes(toFetch);
      if (failures.length) {
        err = failures.join('\n');
      }
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function sortedIngestionRoutesForPicker(list: RouteRow[]): RouteRow[] {
    return [...list].sort((a, b) => {
      const sa = (a.stage ?? '').trim().length > 0 ? 1 : 0;
      const sb = (b.stage ?? '').trim().length > 0 ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: 'base' });
    });
  }

  function effectiveRouteIdForStage(stageKey: string): string {
    const o = routeBindingOverrideByStage[stageKey];
    if (typeof o === 'string' && o.trim()) return o.trim();
    return resolveRouteForStage(ingestionRoutes, stageKey, null)?.id ?? '';
  }

  function bindingSelectValue(stageKey: string): string {
    const o = routeBindingOverrideByStage[stageKey];
    if (typeof o === 'string' && o.trim()) return o.trim();
    return ROUTE_AUTO;
  }

  async function onPickRouteForStage(stageKey: string, raw: string) {
    const nextOverride = raw === ROUTE_AUTO ? null : raw;
    routeBindingOverrideByStage = { ...routeBindingOverrideByStage, [stageKey]: nextOverride };
    routeBindingsMessage = '';
    const eff = effectiveRouteIdForStage(stageKey);
    if (!routeBindingsDbAvailable) {
      routeBindingsMessage =
        'DATABASE_URL unavailable here — route bindings are stored in Neon, so this change was not saved.';
      await loadStepsForRoutes([eff].filter(Boolean));
      return;
    }
    try {
      const h = await authHeaders();
      const res = await fetch('/api/admin/ingestion-routing/route-bindings', {
        method: 'PUT',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bindings: { [stageKey]: nextOverride } })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`);
      }
      if (payload.bindings && typeof payload.bindings === 'object') {
        const merged = payload.bindings as Record<string, string>;
        const next: Record<string, string | null> = {};
        for (const row of pipelineStages) {
          const v = merged[row.key];
          next[row.key] = typeof v === 'string' && v.trim() ? v.trim() : null;
        }
        routeBindingOverrideByStage = next;
      }
      await loadStepsForRoutes([effectiveRouteIdForStage(stageKey)].filter(Boolean));
    } catch (e) {
      routeBindingsMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function clearStaleRouteBindings() {
    if (!orphanRouteBindings.length) return;
    routeBindingsMessage = '';
    try {
      const h = await authHeaders();
      const patch: Record<string, null> = {};
      for (const row of orphanRouteBindings) {
        patch[row.stageKey] = null;
      }
      const res = await fetch('/api/admin/ingestion-routing/route-bindings', {
        method: 'PUT',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bindings: patch })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`);
      }
      routeBindingsMessage = `Cleared ${String(Object.keys(patch).length)} stale route binding(s).`;
      await load();
    } catch (e) {
      routeBindingsMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function createRouteInKeys() {
    createFeedback = '';
    const name = createName.trim();
    if (!name) {
      createFeedback = 'Enter a route name.';
      return;
    }
    createBusy = true;
    try {
      const h = await authHeaders();
      const body: Record<string, unknown> = {
        environmentId: restormelEnvironmentId.trim(),
        name,
        workload: 'ingestion',
        changeSummary: 'Route created via Sophia admin API',
        updatedVia: 'sophia_admin'
      };
      if (createStage.trim()) {
        body.stage = createStage.trim();
      } else {
        body.stage = null;
      }
      const desc = createDescription.trim();
      if (desc) body.description = desc;

      const res = await fetch('/api/admin/ingestion-routing/routes', {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const rm = payload?.restormel;
        const um =
          typeof rm?.userMessage === 'string'
            ? rm.userMessage
            : typeof rm?.detail === 'string'
              ? rm.detail
              : typeof payload?.error === 'string'
                ? payload.error
                : `HTTP ${res.status}`;
        throw new Error(um);
      }
      createFeedback = `Created route ${payload.route?.id ?? ''}. Add steps, then publish in Keys or via POST …/routes/{id}/publish.`;
      createName = '';
      createDescription = '';
      await load();
    } catch (e) {
      createFeedback = e instanceof Error ? e.message : String(e);
    } finally {
      createBusy = false;
    }
  }

  function hydratePhasePinsFromBrowser() {
    const s = loadOperatorPhasePinsFromStorage();
    phasePins = s ?? defaultOperatorPhasePins();
    phasePinsDirty = false;
    phasePinsMessage = '';
  }

  function savePhasePins() {
    saveOperatorPhasePinsToStorage(phasePins);
    phasePinsDirty = false;
    phasePinsMessage =
      'Saved locally. Overrides merge into the live run console (resume/respawn) and durable jobs when you start them in this browser.';
  }

  function clearPhasePins() {
    phasePins = defaultOperatorPhasePins();
    saveOperatorPhasePinsToStorage(phasePins);
    phasePinsDirty = false;
    phasePinsMessage = 'Cleared saved overrides.';
  }

  function updatePhasePin(
    key: OperatorPhaseKey,
    patch: {
      providerModel?: string;
      extractionBaseUrl?: string;
      extractionDeploymentModel?: string;
    }
  ) {
    phasePins = {
      ...phasePins,
      phases: {
        ...phasePins.phases,
        [key]: { ...phasePins.phases[key], ...patch }
      }
    };
    phasePinsDirty = true;
    phasePinsMessage = '';
  }

  function gatewaySourceLabel(source: GatewaySummary['source']): string {
    if (source === 'database') return 'Neon (admin override)';
    if (source === 'environment') return 'Environment (RESTORMEL_GATEWAY_KEY)';
    return 'Not configured';
  }

  async function saveAppAiDefaults() {
    appAiMessage = '';
    appAiBusy = true;
    try {
      const h = await authHeaders();
      const body: Record<string, unknown> = {
        defaultRestormelSharedRouteId: appDefaultSharedRouteInput.trim() || null,
        degradedPrimaryProvider: appDegPrimaryInput.trim() || null,
        degradedReasoningModelStandard: appDegReasonStdInput.trim() || null,
        degradedReasoningModelDeep: appDegReasonDeepInput.trim() || null,
        degradedExtractionModel: appDegExtInput.trim() || null
      };
      if (appOpenaiKeyInput.trim()) body.defaultOpenaiApiKey = appOpenaiKeyInput.trim();
      const res = await fetch('/api/admin/app-ai-defaults', {
        method: 'PUT',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`);
      }
      if (payload.summary && typeof payload.summary === 'object') {
        appAiSummary = payload.summary as AppAiDefaultsSummary;
        hydrateAppAiFormFromSummary(appAiSummary);
      }
      appAiMessage = 'Saved app-wide AI defaults.';
    } catch (e) {
      appAiMessage = e instanceof Error ? e.message : String(e);
    } finally {
      appAiBusy = false;
    }
  }

  async function clearAppOpenaiDefaultKey() {
    appAiMessage = '';
    appAiBusy = true;
    try {
      const h = await authHeaders();
      const res = await fetch('/api/admin/app-ai-defaults', {
        method: 'PUT',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearDefaultOpenaiApiKey: true })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`);
      }
      if (payload.summary && typeof payload.summary === 'object') {
        appAiSummary = payload.summary as AppAiDefaultsSummary;
        hydrateAppAiFormFromSummary(appAiSummary);
      }
      appAiMessage = 'Cleared default OpenAI API key from Neon.';
    } catch (e) {
      appAiMessage = e instanceof Error ? e.message : String(e);
    } finally {
      appAiBusy = false;
    }
  }

  onMount(() => {
    hydratePhasePinsFromBrowser();
    void load();
  });
</script>

<svelte:head>
  <title>Ingestion routing — Operator</title>
</svelte:head>

<main class="rt-page">
  <nav class="rt-crumb"><a href="/admin/ingest/operator">Operator hub</a> / Ingestion routing</nav>

  <h1 class="rt-h1">Ingestion routing (Restormel)</h1>
  <p class="rt-lead">
    Map each <strong>ingestion phase</strong> to a Restormel route (Neon) or <strong>Auto</strong> for env + Keys discovery. Optional app defaults provide a
    <strong>fallback shared route</strong> when no phase binding matches. Expand sections below for gateway policy, app-wide keys, and the
    <strong>production</strong> worker model chain used when Restormel resolve does not run.
  </p>

  <div class="rt-snapshot" aria-label="At a glance">
    <ul class="rt-snapshot-list">
      <li>
        <span class="rt-snapshot-k">Gateway</span>
        {#if gatewaySummary}
          <span class="rt-snapshot-v"
            >{gatewaySourceLabel(gatewaySummary.source)}{#if gatewaySummary.last4}
              <span class="rt-muted"> · <code class="rt-code">…{gatewaySummary.last4}</code></span>{/if}</span
          >
        {:else}
          <span class="rt-muted">Not loaded</span>
        {/if}
      </li>
      <li>
        <span class="rt-snapshot-k">App defaults</span>
        {#if appAiSummary}
          <span class="rt-snapshot-v"
            >{appAiSummary.databaseAvailable ? 'Neon OK' : 'No DATABASE_URL'}{#if defaultSharedRouteId}
              <span class="rt-muted"> · shared route <code class="rt-code"
                  >{defaultSharedRouteId.length > 12
                    ? `${defaultSharedRouteId.slice(0, 8)}…`
                    : defaultSharedRouteId}</code
                ></span
              >{/if}</span
          >
        {:else}
          <span class="rt-muted">Not loaded</span>
        {/if}
      </li>
      <li>
        <span class="rt-snapshot-k">Preset</span>
        <span class="rt-snapshot-v"
          >Pipeline <code class="rt-code">{INGESTION_PIPELINE_PRESET}</code> ·
          <a class="rt-link" href="#rt-preset-details">LLM routing (Restormel)</a></span
        >
      </li>
    </ul>
  </div>

  <div class="rt-actions">
    <button type="button" class="rt-btn" disabled={loading} onclick={() => void load()}
      >{loading ? 'Loading…' : 'Refresh'}</button
    >
    <a
      class="rt-link"
      href="https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/guides/sophia-keys-routing-consumer.md"
      >Sophia ↔ Keys routing guide</a
    >
  </div>

  {#if err}
    <p class="rt-err" role="alert">{err}</p>
  {/if}
  {#if routeAlignmentWarning}
    <div class="rt-err rt-warn-block" role="status">
      <p>{routeAlignmentWarning}</p>
      {#if orphanRouteBindings.length}
        <ul class="rt-mini-list">
          {#each orphanRouteBindings as row (`${row.stageKey}:${row.routeId}`)}
            <li>
              <strong>{row.label}</strong>: <code class="rt-code">{row.routeId}</code>
            </li>
          {/each}
        </ul>
        <button
          type="button"
          class="rt-btn rt-btn-ghost"
          disabled={!routeBindingsDbAvailable || loading}
          onclick={() => void clearStaleRouteBindings()}
        >
          Clear stale Neon route bindings
        </button>
      {/if}
    </div>
  {/if}

  <section class="rt-sec rt-hero" aria-labelledby="rt-table">
    <h2 id="rt-table" class="rt-h2">Phases → Restormel routes (Neon)</h2>
    <p class="rt-p">
      Per-phase route UUIDs are written to Neon for workers calling <code class="rt-code">POST /resolve</code>.
      <strong>Auto</strong> leaves discovery to env + Keys. <span class="rt-muted"
        >Expand a row’s resolve chain to see provider/model steps after publish.</span
      >
    </p>
    {#if routeBindingsMessage}
      <p class={routeBindingsMessage.includes('DATABASE_URL') ? 'rt-muted rt-p' : 'rt-err rt-p'} role="status">
        {routeBindingsMessage}
      </p>
    {/if}
    {#if embeddingRuntime}
      <p class="rt-p rt-embed-note">
        <strong>Embed (vectors):</strong> the worker still uses
        <code class="rt-code">{embeddingRuntime.providerName}</code> ·
        <code class="rt-code">{embeddingRuntime.documentModel}</code> ({embeddingRuntime.dimensions}-dim); the Keys
        <code class="rt-code">ingestion_embedding</code> route here is for catalog/health, not the vector pass.
      </p>
    {/if}
    {#if loading && !err}
      <p class="rt-muted">Loading routes and catalog…</p>
    {:else}
      <div class="rt-scroll">
        <table class="rt-table">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Route</th>
              <th>Resolve chain</th>
              <th>Pin env</th>
            </tr>
          </thead>
          <tbody>
            {#each pipelineStages as row (row.key)}
              {@const effId = effectiveRouteIdForStage(row.key)}
              {@const route = effId ? ingestionRoutes.find((r) => r.id === effId) ?? null : null}
              {@const steps = effId ? (stepsByRouteId[effId] ?? []) : []}
              {@const en = enabledStepsForDisplay(steps)}
              {@const pin = PIN_SUFFIX[row.key]}
              <tr>
                <td class="rt-phase">
                  <span class="rt-phase-label">{row.label}</span>
                  <code class="rt-code rt-small">{row.key}</code>
                </td>
                <td class="rt-route">
                  {#if ingestionRoutes.length === 0}
                    <span class="rt-warn">No ingestion routes</span>
                  {:else if route || effId}
                    <label class="rt-route-label" for="rt-route-{row.key}">Route</label>
                    <select
                      id="rt-route-{row.key}"
                      class="rt-input rt-route-select"
                      value={bindingSelectValue(row.key)}
                      onchange={(e) =>
                        void onPickRouteForStage(row.key, (e.currentTarget as HTMLSelectElement).value)}
                    >
                      <option value={ROUTE_AUTO}>Auto (env + Keys discover)</option>
                      {#each sortedIngestionRoutesForPicker(ingestionRoutes) as opt (opt.id)}
                        <option value={opt.id}>
                          {opt.name?.trim() || opt.id}
                          {(opt.stage ?? '').trim() ? ` · ${opt.stage}` : ' · (shared)'}
                        </option>
                      {/each}
                    </select>
                    {#if route?.isPublished === false}
                      <span class="rt-badge">draft</span>
                    {/if}
                  {:else}
                    <span class="rt-warn">No matching route</span>
                  {/if}
                </td>
                <td class="rt-models">
                  {#if !effId}
                    {#if row.key === 'ingestion_embedding' && embeddingRuntime}
                      <details class="rt-chain-d">
                        <summary>Vectors (worker) · {embeddingRuntime.documentModel}</summary>
                        <p class="rt-embed-runtime">
                          <code class="rt-code">{embeddingRuntime.providerName}</code> ·
                          {embeddingRuntime.dimensions}-dim. Keys embedding route is optional; worker path is the source
                          of truth.
                        </p>
                      </details>
                    {:else}
                      <span class="rt-muted">—</span>
                    {/if}
                  {:else if row.key === 'ingestion_embedding' && embeddingRuntime}
                    <details class="rt-chain-d">
                      <summary>Vectors (worker) · {embeddingRuntime.documentModel}</summary>
                      <p class="rt-embed-runtime">
                        <code class="rt-code">{embeddingRuntime.providerName}</code> ·
                        {embeddingRuntime.dimensions}-dim. Route chain below is catalog/AAIF only.
                      </p>
                    </details>
                    {#if en.length === 0}
                      <span class="rt-muted">No Keys steps</span>
                    {:else}
                      <details class="rt-chain-d" open={false}>
                        <summary
                          >{stepChainSummary(steps).oneLine}
                          <span class="rt-muted"
                            > · {en.length} step{en.length !== 1 ? 's' : ''} ·
                            <span class="rt-peek">open</span></span
                          >
                        </summary>
                        <ol class="rt-step-list">
                          {#each en as st, i (i)}
                            <li>
                              <span class="rt-step-idx">{i + 1}.</span>
                              <strong>{st.providerPreference ?? '?'}</strong>
                              · <code class="rt-code">{st.modelId ?? '?'}</code>
                              <span class="rt-price"
                                >{priceHint(st.providerPreference ?? '', st.modelId ?? '')}</span
                              >
                            </li>
                          {/each}
                        </ol>
                      </details>
                    {/if}
                  {:else if en.length === 0}
                    <span class="rt-muted">No steps in Keys (publish) or 404 — Refresh.</span>
                  {:else}
                    <details class="rt-chain-d" open={false}>
                      <summary
                        >{stepChainSummary(steps).oneLine}
                        <span class="rt-muted"
                          > · {en.length} step{en.length !== 1 ? 's' : ''} ·
                          <span class="rt-peek">open</span></span
                        >
                      </summary>
                      <ol class="rt-step-list">
                        {#each en as st, i (i)}
                          <li>
                            <span class="rt-step-idx">{i + 1}.</span>
                            <strong>{st.providerPreference ?? '?'}</strong>
                            · <code class="rt-code">{st.modelId ?? '?'}</code>
                            <span class="rt-price">{priceHint(st.providerPreference ?? '', st.modelId ?? '')}</span>
                          </li>
                        {/each}
                      </ol>
                    </details>
                  {/if}
                </td>
                <td class="rt-pin">
                  {#if pin}
                    <code class="rt-code rt-small">INGEST_PIN_PROVIDER_{pin}</code><br />
                    <code class="rt-code rt-small">INGEST_PIN_MODEL_{pin}</code>
                  {:else}
                    <span class="rt-muted">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <details class="rt-details" id="rt-preset-details">
    <summary class="rt-details-sum"
      >LLM routing (<code class="rt-code">{INGESTION_PIPELINE_PRESET}</code> profile)</summary
    >
    <p class="rt-p rt-p-tight">
      <strong>Extraction through json_repair</strong> are chosen by <strong>Restormel Keys</strong> routes
      (per stage below) and optional <strong>Neon route bindings</strong>. The ingest script uses the resolved
      primary, then the <strong>remaining published steps</strong> on the same route as <strong>fallback</strong> tiers
      (plus optional <code class="rt-code">INGEST_CATALOG_ROUTING_JSON</code> from Model availability). There is no
      static model list in the app.
    </p>
    <p class="rt-p rt-p-tight">Stages:</p>
    <ul class="rt-preset-chain rt-p">
      {#each PRESET_LLM_ORDER as sk (sk)}
        <li>
          <span class="rt-phase-label">{PRESET_LLM_LABEL[sk]}</span>
          <code class="rt-code rt-small">{sk}</code>
        </li>
      {/each}
    </ul>
  </details>

  <details class="rt-details">
    <summary class="rt-details-sum">Restormel gateway (read-only)</summary>
    <p class="rt-p">
      Admin APIs call Restormel Keys with a <strong>bearer</strong> gateway key (<code class="rt-code"
        >RESTORMEL_GATEWAY_KEY</code>).
    </p>
    {#if gatewaySummary}
      <p class="rt-p rt-gateway-status">
        <strong>Effective bearer:</strong>
        {gatewaySourceLabel(gatewaySummary.source)}
        {#if gatewaySummary.last4}
          <span class="rt-muted">· ends with <code class="rt-code">{gatewaySummary.last4}</code></span>
        {/if}
      </p>
    {:else}
      <p class="rt-muted rt-p">Gateway status not loaded yet.</p>
    {/if}
    {#if gatewaySummary && !gatewaySummary.configured}
      <p class="rt-err" role="status">
        <code class="rt-code">RESTORMEL_GATEWAY_KEY</code> is not set for this server.
      </p>
    {/if}
  </details>

  <details class="rt-details">
    <summary class="rt-details-sum">App-wide AI defaults (Neon) — shared route, keys, degraded</summary>
    <p class="rt-p">
      <strong>Fallback shared route UUID</strong> applies when no per-phase Neon binding matches. A
      <strong>default OpenAI</strong> key in Neon is used when env/BYOK does not set
      <code class="rt-code">OPENAI_API_KEY</code>.
    </p>
    {#if appAiSummary}
      <p class="rt-p rt-gateway-status">
        <strong>Database:</strong>
        {appAiSummary.databaseAvailable ? 'Neon available' : 'No DATABASE_URL'}
        {#if appAiSummary.defaultOpenaiKeyConfigured}
          <span class="rt-muted">
            · OpenAI default
            {#if appAiSummary.defaultOpenaiKeyLast4}
              ends <code class="rt-code">…{appAiSummary.defaultOpenaiKeyLast4}</code>
            {/if}
          </span>
        {:else}
          <span class="rt-muted">· No default OpenAI key in Neon</span>
        {/if}
      </p>
    {:else}
      <p class="rt-muted rt-p">App defaults not loaded yet.</p>
    {/if}
    {#if appAiSummary?.openaiDecryptFailed}
      <p class="rt-err" role="status">
        Stored default OpenAI key exists but could not be decrypted. Re-save a key or clear it; fix
        <code class="rt-code">BYOK_ENCRYPTION_KEY</code> if keys were rotated.
      </p>
    {/if}
    {#if defaultSharedRouteId}
      <div
        class="rt-shared-preview"
        role="region"
        aria-label="Models on the default shared Restormel route"
      >
        <h3 class="rt-h3">Route step chain (default shared)</h3>
        <p class="rt-p rt-p-tight rt-muted">
          Restormel route <code class="rt-code">{defaultSharedRouteId}</code> — providers and models configured in
          Keys for this route’s resolve chain.
        </p>
        {#if !routes.some((r) => r.id === defaultSharedRouteId)}
          <p class="rt-warn" role="status">This UUID is not in the project’s route list — check project id / key.</p>
        {:else if loading}
          <p class="rt-muted">Loading…</p>
        {:else if !enabledStepsForDisplay(defaultSharedRouteSteps).length}
          <p class="rt-muted">
            No step rows loaded (unpublished route, or fetch failed). Use Refresh after publishing in Keys.
          </p>
        {:else}
          <p class="rt-snapshot-v">{stepChainSummary(defaultSharedRouteSteps).oneLine}</p>
          <ol class="rt-step-list">
            {#each enabledStepsForDisplay(defaultSharedRouteSteps) as st, i (i)}
              <li>
                <span class="rt-step-idx">{i + 1}.</span>
                <strong>{st.providerPreference ?? '?'}</strong>
                · <code class="rt-code">{st.modelId ?? '?'}</code>
                <span class="rt-price"
                  >{priceHint(st.providerPreference ?? '', st.modelId ?? '')}</span
                >
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    {/if}
    {#if appAiSummary && !appAiSummary.databaseAvailable}
      <p class="rt-err" role="status">
        <code class="rt-code">DATABASE_URL</code> is not set — defaults cannot be persisted here.
      </p>
    {:else if appAiSummary?.databaseAvailable}
      <div class="rt-gateway-form">
        <label class="rt-label">
          Default shared Restormel route (UUID)
          <input
            class="rt-input"
            type="text"
            autocomplete="off"
            placeholder="e.g. published shared ingestion route"
            bind:value={appDefaultSharedRouteInput}
            onblur={() => void refreshStepsForDefaultSharedRoute()}
          />
        </label>
        <label class="rt-label">
          Quick pick (ingestion routes)
          <select
            class="rt-input"
            aria-label="Insert route id from list"
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v) {
                appDefaultSharedRouteInput = v;
                void loadStepsForRoutes([v]);
              }
              (e.currentTarget as HTMLSelectElement).value = '';
            }}
          >
            <option value="">— choose route —</option>
            {#each sortedIngestionRoutesForPicker(ingestionRoutes) as pick (pick.id)}
              <option value={pick.id}>{pick.name ?? pick.id}</option>
            {/each}
          </select>
        </label>
        <details class="rt-nested">
          <summary class="rt-nested-sum">Degraded + OpenAI key</summary>
          <div class="rt-nested-body">
            <label class="rt-label">
              Degraded primary provider override <span class="rt-muted">(optional, e.g. openai, vertex)</span>
              <input class="rt-input" type="text" autocomplete="off" bind:value={appDegPrimaryInput} />
            </label>
            <label class="rt-label">
              Degraded reasoning model (standard)
              <input class="rt-input" type="text" autocomplete="off" bind:value={appDegReasonStdInput} />
            </label>
            <label class="rt-label">
              Degraded reasoning model (deep)
              <input class="rt-input" type="text" autocomplete="off" bind:value={appDegReasonDeepInput} />
            </label>
            <label class="rt-label">
              Degraded extraction model
              <input class="rt-input" type="text" autocomplete="off" bind:value={appDegExtInput} />
            </label>
            <label class="rt-label">
              Default OpenAI API key <span class="rt-muted">(leave blank to keep existing)</span>
              <input class="rt-input" type="password" autocomplete="off" bind:value={appOpenaiKeyInput} />
            </label>
          </div>
        </details>
        <div class="rt-gateway-actions">
          <button type="button" class="rt-btn" disabled={appAiBusy} onclick={() => void saveAppAiDefaults()}>
            {appAiBusy ? 'Saving…' : 'Save defaults'}
          </button>
          <button
            type="button"
            class="rt-btn rt-btn-ghost"
            disabled={appAiBusy}
            onclick={() => void clearAppOpenaiDefaultKey()}
          >
            Clear OpenAI key only
          </button>
        </div>
      </div>
    {/if}
    {#if appAiMessage}
      <p
        class={appAiMessage.startsWith('Saved') || appAiMessage.startsWith('Cleared') ? 'rt-ok' : 'rt-err'}
        role="status"
      >
        {appAiMessage}
      </p>
    {/if}
  </details>

  <details class="rt-details">
    <summary class="rt-details-sum">Create route in Restormel Keys (proxied API)</summary>
  <div class="rt-details-inset">
  <section class="rt-sec" aria-labelledby="rt-create">
    <h2 id="rt-create" class="rt-h2">Create route in Restormel Keys</h2>
    <p class="rt-p">
      Calls <code class="rt-code">POST /api/admin/ingestion-routing/routes</code> → Keys
      <code class="rt-code">POST …/projects/:projectId/routes</code> (same contract as the dashboard). Environment:
      <code class="rt-code">{restormelEnvironmentId}</code> (from <code class="rt-code">RESTORMEL_ENVIRONMENT_ID</code>).
    </p>
    <form
      class="rt-create-form"
      onsubmit={(e) => {
        e.preventDefault();
        void createRouteInKeys();
      }}
    >
      <label class="rt-label">
        Route name
        <input class="rt-input" type="text" bind:value={createName} placeholder="e.g. Sophia — Ingestion (extraction)" />
      </label>
      <label class="rt-label">
        Stage
        <select class="rt-input" bind:value={createStage}>
          {#each createStageOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
      <label class="rt-label">
        Description <span class="rt-muted">(optional)</span>
        <input class="rt-input" type="text" bind:value={createDescription} placeholder="Operator notes" />
      </label>
      <button type="submit" class="rt-btn" disabled={createBusy}>
        {createBusy ? 'Creating…' : 'Create route'}
      </button>
    </form>
    {#if createFeedback}
      <p class={createFeedback.startsWith('Created') ? 'rt-ok' : 'rt-err'} role="status">{createFeedback}</p>
    {/if}
  </section>
  </div>
  </details>

  <details class="rt-details">
    <summary class="rt-details-sum">Per-phase worker model overrides (browser + durable jobs)</summary>
  <div class="rt-details-inset">
  <section class="rt-sec" aria-labelledby="rt-pins">
    <h2 id="rt-pins" class="rt-h2">Per-phase worker model overrides</h2>
    <p class="rt-p">
      Set <strong>INGEST_PIN_PROVIDER_*</strong> / <strong>INGEST_PIN_MODEL_*</strong> for each stage (saved in this browser).
      Non-<code class="rt-code">auto</code> rows <strong>override</strong> default stage picks and are merged into
      <strong>durable jobs</strong> when you enqueue from <a class="rt-a" href="/admin/ingest/jobs">Durable jobs</a>. For
      OpenAI-compatible <strong>extraction fine-tunes</strong>, add base URL + deployment model here — they map to
      <code class="rt-code">EXTRACTION_BASE_URL</code> / <code class="rt-code">EXTRACTION_MODEL</code> on the worker (same as
      <code class="rt-code">.env</code>).
    </p>
    <div class="rt-pin-actions">
      <button type="button" class="rt-btn" onclick={savePhasePins} disabled={!phasePinsDirty}>Save overrides</button>
      <button type="button" class="rt-btn rt-btn-ghost" onclick={clearPhasePins}>Clear</button>
    </div>
    {#if phasePinsMessage}
      <p class="rt-ok" role="status">{phasePinsMessage}</p>
    {/if}
    <div class="rt-scroll rt-pin-wrap">
      <table class="rt-table rt-pin-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Provider · model (or <code class="rt-code">auto</code>)</th>
            <th>Extraction FT (optional)</th>
          </tr>
        </thead>
        <tbody>
          {#each PHASE_PIN_ROWS as pr (pr.key)}
            <tr>
              <td class="rt-phase">
                <span class="rt-phase-label">{pr.label}</span>
                <code class="rt-code rt-small">{pr.key}</code>
                {#if pr.hint}
                  <span class="rt-muted rt-hint">{pr.hint}</span>
                {/if}
              </td>
              <td>
                <input
                  class="rt-input rt-input-wide"
                  type="text"
                  autocomplete="off"
                  placeholder="auto"
                  value={phasePins.phases[pr.key].providerModel}
                  oninput={(e) =>
                    updatePhasePin(pr.key, { providerModel: (e.currentTarget as HTMLInputElement).value })}
                />
              </td>
              <td>
                {#if pr.key === 'EXTRACTION'}
                  <label class="rt-label rt-label-inline">
                    Base URL
                    <input
                      class="rt-input"
                      type="url"
                      placeholder="https://api.fireworks.ai/inference/v1"
                      value={phasePins.phases.EXTRACTION.extractionBaseUrl ?? ''}
                      oninput={(e) =>
                        updatePhasePin('EXTRACTION', {
                          extractionBaseUrl: (e.currentTarget as HTMLInputElement).value
                        })}
                    />
                  </label>
                  <label class="rt-label rt-label-inline">
                    Deployment / model id
                    <input
                      class="rt-input"
                      type="text"
                      placeholder="accounts/…/deployments/…"
                      value={phasePins.phases.EXTRACTION.extractionDeploymentModel ?? ''}
                      oninput={(e) =>
                        updatePhasePin('EXTRACTION', {
                          extractionDeploymentModel: (e.currentTarget as HTMLInputElement).value
                        })}
                    />
                  </label>
                {:else}
                  <span class="rt-muted">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="rt-p rt-muted">
      Format: <code class="rt-code">provider · modelId</code> or stable id <code class="rt-code">provider__modelId</code>.
      Providers must match <code class="rt-code">@restormel/contracts</code> (e.g. <code class="rt-code">openai</code>,
      <code class="rt-code">vertex</code>, <code class="rt-code">aizolo</code>).
    </p>
  </section>
  </div>
  </details>

  <details class="rt-details">
    <summary class="rt-details-sum">Bootstrap, tools &amp; server / CLI env</summary>
  <div class="rt-details-inset">
  <section class="rt-sec" aria-labelledby="rt-cli">
    <h2 id="rt-cli" class="rt-h2">Bootstrap &amp; tools</h2>
    <ul class="rt-ul">
      <li>
        <strong>CLI:</strong>
        <code class="rt-code">pnpm restormel:ingestion-bootstrap plan|apply|verify</code>
        — creates/refreshes default ingestion routes and step chains (see
        <code class="rt-code">scripts/restormel/bootstrap-ingestion-routes.ts</code>).
      </li>
      <li>
        <strong>MCP:</strong> <code class="rt-code">pnpm mcp:restormel</code> — use Keys MCP tools for route import/export
        and simulate when your IDE is connected.
      </li>
      <li>
        <strong>Run console:</strong> attach to an in-memory orchestration run (logs, cancel, resume) via
        <a class="rt-a" href="/admin/ingest/run-console">live run console</a> — new work starts from durable jobs.
      </li>
    </ul>
  </section>

  <section class="rt-sec" aria-labelledby="rt-override">
    <h2 id="rt-override" class="rt-h2">Server / CLI env (without this UI)</h2>
    <p class="rt-p">
      The same pins can be set globally for workers started outside this browser (e.g. Cloud Run) via env
      <strong>before</strong> <code class="rt-code">scripts/ingest.ts</code> runs:
    </p>
    <ul class="rt-ul">
      <li>
        <code class="rt-code">INGEST_PIN_PROVIDER_&lt;STAGE&gt;</code> +
        <code class="rt-code">INGEST_PIN_MODEL_&lt;STAGE&gt;</code> where
        <code class="rt-code">&lt;STAGE&gt;</code> is one of
        <code class="rt-code">EXTRACTION | RELATIONS | GROUPING | VALIDATION | REMEDIATION | JSON_REPAIR</code>.
      </li>
      <li>
        Point OpenAI-compatible bases with <code class="rt-code">OPENAI_BASE_URL</code> (or provider-specific
        <code class="rt-code">*_BASE_URL</code>) plus the matching API key — see
        <code class="rt-code">.env.example</code>.
      </li>
      <li>
        Fine-tune policy / allowed vendors:
        <code class="rt-code">INGEST_FINETUNE_LABELER_STRICT</code>,
        <code class="rt-code">INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS</code> (ingest worker).
      </li>
    </ul>
  </section>
  </div>
  </details>

</main>

<style>
  .rt-page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 20px 56px;
  }
  .rt-crumb {
    font-size: 0.82rem;
    margin-bottom: 12px;
  }
  .rt-crumb a {
    color: var(--color-blue);
  }
  .rt-h1 {
    font-family: var(--font-serif);
    font-size: 1.55rem;
    margin: 0 0 8px;
    color: var(--color-text);
  }
  .rt-lead {
    font-size: 0.92rem;
    line-height: 1.55;
    max-width: 52rem;
    color: var(--color-text);
    opacity: 0.92;
  }
  .rt-create-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 32rem;
    margin-top: 8px;
  }
  .rt-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.82rem;
    font-weight: 500;
  }
  .rt-input {
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    font-size: 0.88rem;
  }
  .rt-ok {
    font-size: 0.88rem;
    color: color-mix(in srgb, var(--color-green, #22c55e) 90%, var(--color-text));
    margin-top: 8px;
  }
  .rt-pin-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-bottom: 12px;
  }
  .rt-btn-ghost {
    background: transparent;
  }
  .rt-details-inset {
    padding-top: 2px;
  }
  /* :global: classes appear inside {#if} / nested <details> branches Svelte can miss for unused-CSS. */
  .rt-details :global(.rt-gateway-status) {
    margin-top: 4px;
  }
  .rt-details :global(.rt-gateway-form) {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 36rem;
    margin-top: 8px;
  }
  .rt-details :global(.rt-gateway-actions) {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .rt-pin-wrap {
    margin-top: 8px;
  }
  .rt-pin-table .rt-input-wide {
    min-width: 220px;
    width: 100%;
    max-width: 420px;
  }
  .rt-label-inline {
    margin-bottom: 8px;
  }
  .rt-hint {
    display: block;
    font-size: 0.72rem;
    margin-top: 4px;
    max-width: 14rem;
  }
  .rt-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 20px;
    align-items: center;
    margin: 16px 0 20px;
  }
  .rt-btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
  }
  .rt-link {
    font-size: 0.88rem;
    color: var(--color-blue);
  }
  .rt-sec {
    margin-bottom: 28px;
  }
  .rt-h2 {
    font-size: 1.05rem;
    margin: 0 0 10px;
  }
  .rt-p,
  .rt-ul {
    font-size: 0.88rem;
    line-height: 1.55;
    max-width: 52rem;
  }
  .rt-ul {
    padding-left: 1.2rem;
  }
  .rt-code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.82em;
  }
  .rt-small {
    display: block;
    margin-top: 4px;
    font-size: 0.72rem;
    word-break: break-all;
  }
  .rt-a {
    color: var(--color-blue);
  }
  .rt-err {
    color: #f87171;
    font-size: 0.9rem;
  }
  .rt-muted {
    opacity: 0.78;
    font-size: 0.86rem;
  }
  .rt-scroll {
    overflow: auto;
    border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
    border-radius: 10px;
  }
  .rt-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
  }
  .rt-table th,
  .rt-table td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
    vertical-align: top;
  }
  .rt-table th {
    background: color-mix(in srgb, var(--color-surface) 92%, var(--color-border));
  }
  .rt-phase-label {
    display: block;
    font-weight: 600;
  }
  .rt-route {
    max-width: 280px;
  }
  .rt-route-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .rt-route-select {
    width: 100%;
    max-width: 260px;
    margin-top: 4px;
  }
  .rt-embed-note {
    font-size: 0.86rem;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    background: color-mix(in srgb, var(--color-surface) 96%, var(--color-border));
  }
  .rt-embed-runtime {
    margin: 0 0 8px;
    font-size: 0.84rem;
  }
  .rt-models {
    min-width: 280px;
  }
  .rt-step-list {
    margin: 0;
    padding-left: 1.1rem;
  }
  .rt-step-idx {
    opacity: 0.65;
    margin-right: 4px;
  }
  .rt-price {
    display: block;
    font-size: 0.78rem;
    opacity: 0.8;
    margin-top: 2px;
  }
  .rt-badge {
    display: inline-block;
    margin-left: 6px;
    font-size: 0.65rem;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--color-amber, #f59e0b) 50%, transparent);
  }
  .rt-warn {
    color: #fbbf24;
    font-size: 0.86rem;
  }
  .rt-snapshot {
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 16px;
    background: color-mix(in srgb, var(--color-surface) 95%, var(--color-border));
  }
  .rt-snapshot-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 12px 28px;
    font-size: 0.86rem;
    line-height: 1.4;
  }
  .rt-snapshot-k {
    color: var(--color-text);
    opacity: 0.75;
    font-weight: 500;
    margin-right: 6px;
  }
  .rt-snapshot-v {
    color: var(--color-text);
  }
  .rt-hero {
    border-left: 3px solid color-mix(in srgb, var(--color-blue, #3b82f6) 55%, transparent);
    padding-left: 12px;
  }
  .rt-details {
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    border-radius: 10px;
    padding: 0 14px 12px;
    margin-bottom: 14px;
    background: color-mix(in srgb, var(--color-surface) 98%, transparent);
  }
  .rt-details-inset .rt-sec {
    margin-bottom: 12px;
  }
  .rt-details-inset .rt-sec:last-child {
    margin-bottom: 0;
  }
  .rt-details-sum {
    font-weight: 600;
    font-size: 0.95rem;
    padding: 10px 0 8px;
    cursor: pointer;
    list-style: none;
  }
  .rt-details-sum::-webkit-details-marker {
    display: none;
  }
  .rt-details[open] > .rt-details-sum {
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    margin-bottom: 8px;
  }
  .rt-p-tight {
    margin: 0 0 8px;
    max-width: 50rem;
  }
  .rt-h3 {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0 0 6px;
  }
  .rt-preset-chain {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.84rem;
  }
  .rt-chain-d {
    font-size: 0.86rem;
  }
  .rt-chain-d[open] .rt-peek {
    display: none;
  }
  .rt-chain-d > summary {
    cursor: pointer;
    list-style: none;
  }
  .rt-chain-d > summary::-webkit-details-marker {
    display: none;
  }
  .rt-peek {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .rt-shared-preview {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
    background: color-mix(in srgb, var(--color-surface) 95%, var(--color-border));
    margin-bottom: 12px;
  }
  .rt-nested {
    border: 1px dashed color-mix(in srgb, var(--color-border) 80%, transparent);
    border-radius: 8px;
    padding: 0 10px 8px;
  }
  .rt-nested-sum {
    font-weight: 500;
    font-size: 0.88rem;
    padding: 8px 0;
    cursor: pointer;
  }
  .rt-nested-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
