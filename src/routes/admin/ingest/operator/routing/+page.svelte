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

  let { data } = $props();
  const restormelEnvironmentId = data.restormelEnvironmentId ?? 'production';

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
    { value: 'ingestion_json_repair', label: 'ingestion_json_repair' }
  ];

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
  };
  let gatewaySummary = $state<GatewaySummary | null>(null);
  let gatewayDbAvailable = $state(true);
  let gatewayKeyInput = $state('');
  let gatewayBusy = $state(false);
  let gatewayMessage = $state('');

  const ingestionRoutes = $derived(
    routes.filter((r) => (r.workload ?? '').trim().toLowerCase() === 'ingestion')
  );

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required.');
    return { Authorization: `Bearer ${token}` };
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
    try {
      const h = await authHeaders();
      const [rRes, cRes, gRes] = await Promise.all([
        fetch('/api/admin/ingestion-routing/routes', { headers: h }),
        fetch('/api/admin/ingestion-routing/model-catalog', { headers: h }),
        fetch('/api/admin/ingestion-routing/gateway', { headers: h })
      ]);
      const rBody = await rRes.json().catch(() => ({}));
      const cBody = await cRes.json().catch(() => ({}));
      const gBody = await gRes.json().catch(() => ({}));
      if (!rRes.ok) throw new Error(typeof rBody.error === 'string' ? rBody.error : 'Routes failed');
      if (!cRes.ok) throw new Error(typeof cBody.error === 'string' ? cBody.error : 'Catalog failed');
      if (gRes.ok && gBody.summary && typeof gBody.summary === 'object') {
        gatewaySummary = gBody.summary as GatewaySummary;
        gatewayDbAvailable = gBody.databaseAvailable !== false;
      } else {
        gatewaySummary = null;
      }
      routes = Array.isArray(rBody.routes) ? (rBody.routes as RouteRow[]) : [];
      catalog = Array.isArray(cBody.entries) ? (cBody.entries as CatalogEntry[]) : [];

      const ingestOnly = routes.filter(
        (r) => (r.workload ?? '').trim().toLowerCase() === 'ingestion'
      );
      const needSteps: string[] = [];
      for (const row of pipelineStages) {
        const hit = resolveRouteForStage(ingestOnly, row.key, null);
        if (hit?.id) needSteps.push(hit.id);
      }
      await loadStepsForRoutes(needSteps);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
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
      'Saved locally. Overrides merge into legacy wizard runs and durable jobs when you start them in this browser.';
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

  async function saveGatewayKey() {
    gatewayMessage = '';
    const key = gatewayKeyInput.trim();
    if (!key) {
      gatewayMessage = 'Paste the Restormel gateway API key (rk_…).';
      return;
    }
    gatewayBusy = true;
    try {
      const h = await authHeaders();
      const res = await fetch('/api/admin/ingestion-routing/gateway', {
        method: 'PUT',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gatewayKey: key })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`);
      }
      gatewayKeyInput = '';
      gatewaySummary = payload.summary ?? gatewaySummary;
      gatewayMessage = 'Saved. Sophia admin routes to Keys will use this bearer until you clear it.';
    } catch (e) {
      gatewayMessage = e instanceof Error ? e.message : String(e);
    } finally {
      gatewayBusy = false;
    }
  }

  async function clearGatewayOverride() {
    gatewayMessage = '';
    gatewayBusy = true;
    try {
      const h = await authHeaders();
      const res = await fetch('/api/admin/ingestion-routing/gateway', {
        method: 'PUT',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`);
      }
      gatewaySummary = payload.summary ?? gatewaySummary;
      gatewayMessage = 'Cleared stored key. Effective bearer falls back to RESTORMEL_GATEWAY_KEY when set.';
    } catch (e) {
      gatewayMessage = e instanceof Error ? e.message : String(e);
    } finally {
      gatewayBusy = false;
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
    Before you run ingestion, each phase resolves a <strong>Restormel route</strong> (workload
    <code class="rt-code">ingestion</code>, stage <code class="rt-code">ingestion_*</code>) or a shared ingestion fallback.
    This screen shows which route applies per phase, the <strong>model chain</strong> on that route, and
    <strong>approximate list pricing</strong> from the merged catalog. You can <strong>create</strong> routes here (proxied to
    Keys with the gateway key) or use the Keys dashboard, MCP, or CLI; then add steps, publish, and run resolve. Use
    <strong>Per-phase worker model overrides</strong> below to pin fine-tuned or custom models for each stage before you
    start runs from the legacy wizard or durable jobs.
  </p>

  <section class="rt-sec" aria-labelledby="rt-gateway">
    <h2 id="rt-gateway" class="rt-h2">Restormel Gateway API key</h2>
    <p class="rt-p">
      Admin APIs on this server call Restormel Keys with a <strong>bearer token</strong> (gateway key, typically
      <code class="rt-code">rk_…</code>). You can set it here (encrypted in Neon) or via
      <code class="rt-code">RESTORMEL_GATEWAY_KEY</code> in deployment env. When both exist, the <strong>stored</strong> key
      wins. Ingest workers and CLI scripts still use env unless they read the same database.
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
    {#if !gatewayDbAvailable}
      <p class="rt-err" role="status">
        <code class="rt-code">DATABASE_URL</code> is not set on this deployment — keys can only be supplied via env.
      </p>
    {:else}
      <div class="rt-gateway-form">
        <label class="rt-label">
          New gateway key
          <input
            class="rt-input"
            type="password"
            autocomplete="off"
            placeholder="rk_…"
            bind:value={gatewayKeyInput}
          />
        </label>
        <div class="rt-gateway-actions">
          <button type="button" class="rt-btn" disabled={gatewayBusy} onclick={() => void saveGatewayKey()}>
            {gatewayBusy ? 'Saving…' : 'Save to Neon'}
          </button>
          <button
            type="button"
            class="rt-btn rt-btn-ghost"
            disabled={gatewayBusy}
            onclick={() => void clearGatewayOverride()}
          >
            Clear stored key
          </button>
        </div>
      </div>
    {/if}
    {#if gatewayMessage}
      <p
        class={gatewayMessage.includes('Saved') || gatewayMessage.includes('Cleared') ? 'rt-ok' : 'rt-err'}
        role="status"
      >
        {gatewayMessage}
      </p>
    {/if}
  </section>

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

  <section class="rt-sec" aria-labelledby="rt-pins">
    <h2 id="rt-pins" class="rt-h2">Per-phase worker model overrides</h2>
    <p class="rt-p">
      Set <strong>INGEST_PIN_PROVIDER_*</strong> / <strong>INGEST_PIN_MODEL_*</strong> for each stage (saved in this browser).
      Non-<code class="rt-code">auto</code> rows <strong>override</strong> the legacy wizard’s stage picks and are merged into
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
        <strong>Legacy wizard:</strong> full routing editor tabs remain on
        <a class="rt-a" href="/admin/ingest/legacy-wizard">legacy wizard</a> (pre-scan + publish flows).
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

  <section class="rt-sec" aria-labelledby="rt-table">
    <h2 id="rt-table" class="rt-h2">Phases → routes → models</h2>
    {#if loading && !err}
      <p class="rt-muted">Loading routes and catalog…</p>
    {:else}
      <div class="rt-scroll">
        <table class="rt-table">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Route</th>
              <th>Models (ordered)</th>
              <th>Pin override env</th>
            </tr>
          </thead>
          <tbody>
            {#each pipelineStages as row (row.key)}
              {@const route = resolveRouteForStage(ingestionRoutes, row.key, null)}
              {@const steps = route?.id ? stepsByRouteId[route.id] ?? [] : []}
              {@const pin = PIN_SUFFIX[row.key]}
              <tr>
                <td class="rt-phase">
                  <span class="rt-phase-label">{row.label}</span>
                  <code class="rt-code rt-small">{row.key}</code>
                </td>
                <td class="rt-route">
                  {#if route}
                    <span class="rt-muted">{route.name ?? '—'}</span>
                    <code class="rt-code rt-small" title={route.id}>{route.id.slice(0, 10)}…</code>
                    {#if route.isPublished === false}
                      <span class="rt-badge">draft</span>
                    {/if}
                  {:else}
                    <span class="rt-warn">No matching route</span>
                  {/if}
                </td>
                <td class="rt-models">
                  {#if route && steps.length === 0}
                    <span class="rt-muted">No steps loaded (save/publish route in Keys).</span>
                  {:else if steps.length > 0}
                    <ol class="rt-step-list">
                      {#each steps as st, i (i)}
                        {#if st.enabled !== false}
                          <li>
                            <span class="rt-step-idx">{i + 1}.</span>
                            <strong>{st.providerPreference ?? '?'}</strong>
                            · <code class="rt-code">{st.modelId ?? '?'}</code>
                            <span class="rt-price">{priceHint(st.providerPreference ?? '', st.modelId ?? '')}</span>
                          </li>
                        {/if}
                      {/each}
                    </ol>
                  {:else}
                    —
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
  .rt-gateway-status {
    margin-top: 4px;
  }
  .rt-gateway-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 36rem;
    margin-top: 8px;
  }
  .rt-gateway-actions {
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
    max-width: 220px;
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
</style>
