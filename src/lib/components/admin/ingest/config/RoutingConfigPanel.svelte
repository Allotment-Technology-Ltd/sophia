<script module lang="ts">
  export type RouteRow = {
    id: string;
    name?: string | null;
    workload?: string | null;
    stage?: string | null;
    isPublished?: boolean | null;
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import {
    INGESTION_PHASE_COLUMN_ORDER,
    INGESTION_PHASE_TABLE_HEADING,
    type IngestionPipelineStageKey
  } from '$lib/ingestionPipelineModelRequirements';

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

  const ROUTE_AUTO = '__auto__';
  const pipelineStages: { key: string; label: string }[] = [
    ...INGESTION_PHASE_COLUMN_ORDER.map((k: IngestionPipelineStageKey) => ({
      key: k,
      label: INGESTION_PHASE_TABLE_HEADING[k]
    })),
    { key: 'ingestion_remediation', label: 'Remediate' }
  ];

  let { compactHeader = false } = $props<{ compactHeader?: boolean }>();

  let loading = $state(true);
  let err = $state('');
  let routes = $state<RouteRow[]>([]);
  let gatewaySummary = $state<GatewaySummary | null>(null);
  let routeBindingsDbAvailable = $state(true);
  let routeBindingsMessage = $state('');

  let routeBindingOverrideByStage = $state<Record<string, string | null>>({});

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

  const ingestionRoutes = $derived(routes.filter((r) => (r.workload ?? '').trim().toLowerCase() === 'ingestion'));

  function sortedIngestionRoutesForPicker(list: RouteRow[]): RouteRow[] {
    return [...list].sort((a, b) => {
      const sa = (a.stage ?? '').trim().length > 0 ? 1 : 0;
      const sb = (b.stage ?? '').trim().length > 0 ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: 'base' });
    });
  }

  function bindingSelectValue(stageKey: string): string {
    const o = routeBindingOverrideByStage[stageKey];
    if (typeof o === 'string' && o.trim()) return o.trim();
    return ROUTE_AUTO;
  }

  function gatewaySourceLabel(source: GatewaySummary['source']): string {
    if (source === 'database') return 'Neon (admin override)';
    if (source === 'environment') return 'Environment (RESTORMEL_GATEWAY_KEY)';
    return 'Not configured';
  }

  async function load(): Promise<void> {
    loading = true;
    err = '';
    routeBindingsMessage = '';
    try {
      const [rBody, gBody, bBody, aBody] = await Promise.all([
        authorizedFetchJson<Record<string, unknown>>('/api/admin/ingestion-routing/routes'),
        authorizedFetchJson<Record<string, unknown>>('/api/admin/ingestion-routing/gateway'),
        authorizedFetchJson<Record<string, unknown>>('/api/admin/ingestion-routing/route-bindings'),
        authorizedFetchJson<Record<string, unknown>>('/api/admin/app-ai-defaults')
      ]);

      routes = Array.isArray(rBody.routes) ? (rBody.routes as RouteRow[]) : [];
      gatewaySummary =
        gBody.summary && typeof gBody.summary === 'object' ? (gBody.summary as GatewaySummary) : null;

      routeBindingsDbAvailable = bBody.databaseAvailable !== false;
      const serverBindings =
        bBody.bindings && typeof bBody.bindings === 'object' ? (bBody.bindings as Record<string, string>) : {};

      const nextOverride: Record<string, string | null> = {};
      for (const row of pipelineStages) {
        const s = serverBindings[row.key];
        nextOverride[row.key] = typeof s === 'string' && s.trim() ? s.trim() : null;
      }
      routeBindingOverrideByStage = nextOverride;

      if (aBody.summary && typeof aBody.summary === 'object') {
        appAiSummary = aBody.summary as AppAiDefaultsSummary;
        hydrateAppAiFormFromSummary(appAiSummary);
      } else {
        appAiSummary = null;
      }
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function onPickRouteForStage(stageKey: string, raw: string): Promise<void> {
    const nextOverride = raw === ROUTE_AUTO ? null : raw;
    routeBindingOverrideByStage = { ...routeBindingOverrideByStage, [stageKey]: nextOverride };
    routeBindingsMessage = '';
    if (!routeBindingsDbAvailable) {
      routeBindingsMessage = 'DATABASE_URL unavailable here — route bindings are stored in Neon, so this change was not saved.';
      return;
    }
    try {
      const payload = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingestion-routing/route-bindings', {
        method: 'PUT',
        jsonBody: { bindings: { [stageKey]: nextOverride } }
      });
      if (payload.bindings && typeof payload.bindings === 'object') {
        const merged = payload.bindings as Record<string, string>;
        const next: Record<string, string | null> = {};
        for (const row of pipelineStages) {
          const v = merged[row.key];
          next[row.key] = typeof v === 'string' && v.trim() ? v.trim() : null;
        }
        routeBindingOverrideByStage = next;
      }
    } catch (e) {
      routeBindingsMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveAppAiDefaults(): Promise<void> {
    appAiMessage = '';
    appAiBusy = true;
    try {
      const body: Record<string, unknown> = {
        defaultRestormelSharedRouteId: appDefaultSharedRouteInput.trim() || null,
        degradedPrimaryProvider: appDegPrimaryInput.trim() || null,
        degradedReasoningModelStandard: appDegReasonStdInput.trim() || null,
        degradedReasoningModelDeep: appDegReasonDeepInput.trim() || null,
        degradedExtractionModel: appDegExtInput.trim() || null
      };
      if (appOpenaiKeyInput.trim()) body.defaultOpenaiApiKey = appOpenaiKeyInput.trim();
      const payload = await authorizedFetchJson<Record<string, unknown>>('/api/admin/app-ai-defaults', {
        method: 'PUT',
        jsonBody: body
      });
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

  async function clearAppOpenaiDefaultKey(): Promise<void> {
    appAiMessage = '';
    appAiBusy = true;
    try {
      const payload = await authorizedFetchJson<Record<string, unknown>>('/api/admin/app-ai-defaults', {
        method: 'PUT',
        jsonBody: { clearDefaultOpenaiApiKey: true }
      });
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
    void load();
  });
</script>

{#if !compactHeader}
  <div class="op-subhead">
    <p class="op-subhead-title">Routing</p>
    <p class="op-subhead-muted">Environment-wide route bindings and AI defaults.</p>
  </div>
{/if}

{#if loading}
  <p class="font-mono text-sm text-sophia-dark-muted">Loading routing…</p>
{:else if err}
  <div class="rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
    <p>{err}</p>
  </div>
{:else}
  {#if gatewaySummary}
    <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/40 p-4 font-mono text-xs text-sophia-dark-muted">
      <p>
        <span class="text-sophia-dark-dim">Gateway source</span>
        <span class="ml-2 text-sophia-dark-text">{gatewaySourceLabel(gatewaySummary.source)}</span>
      </p>
      <p class="mt-2">
        <span class="text-sophia-dark-dim">Key last4</span>
        <span class="ml-2 text-sophia-dark-text">{gatewaySummary.last4 ?? '—'}</span>
      </p>
      {#if gatewaySummary.ignoredEnvironmentKeyLast4}
        <p class="mt-2">
          <span class="text-sophia-dark-dim">Ignored env key</span>
          <span class="ml-2 text-sophia-dark-text">{gatewaySummary.ignoredEnvironmentKeyLast4}</span>
        </p>
      {/if}
      {#if gatewaySummary.storageDecryptFailed && gatewaySummary.storageDecryptError}
        <p class="mt-3 rounded border border-sophia-dark-amber/40 bg-sophia-dark-amber/10 p-2 text-sophia-dark-muted">
          {gatewaySummary.storageDecryptError}
        </p>
      {/if}
    </div>
  {/if}

  <div class="mt-5 rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
    <p class="font-mono text-sm text-sophia-dark-text">Phase route bindings</p>
    <p class="mt-1 font-mono text-xs leading-relaxed text-sophia-dark-muted">
      Use <span class="text-sophia-dark-text">Auto</span> to follow Restormel’s stage routing. Overrides are stored in Neon.
    </p>
    {#if !routeBindingsDbAvailable}
      <p class="mt-3 rounded border border-sophia-dark-amber/40 bg-sophia-dark-amber/10 p-2 font-mono text-xs text-sophia-dark-muted">
        DATABASE_URL unavailable — overrides cannot be saved in this environment.
      </p>
    {/if}
    {#if routeBindingsMessage}
      <p class="mt-3 rounded border border-sophia-dark-border bg-sophia-dark-bg p-2 font-mono text-xs text-sophia-dark-text">
        {routeBindingsMessage}
      </p>
    {/if}

    <div class="mt-4 grid gap-3">
      {#each pipelineStages as row (row.key)}
        <label class="block">
          <span class="font-mono text-xs text-sophia-dark-muted">{row.label}</span>
          <select
            class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text outline-none focus:border-sophia-dark-copper/60"
            value={bindingSelectValue(row.key)}
            onchange={(e) => void onPickRouteForStage(row.key, (e.currentTarget as HTMLSelectElement).value)}
          >
            <option value={ROUTE_AUTO}>Auto</option>
            {#each sortedIngestionRoutesForPicker(ingestionRoutes) as r (r.id)}
              <option value={r.id}>
                {(r.name ?? r.id).slice(0, 80)}{r.stage ? ` · ${r.stage}` : ''}{r.isPublished ? '' : ' · draft'}
              </option>
            {/each}
          </select>
        </label>
      {/each}
    </div>

    <details class="mt-4">
      <summary class="cursor-pointer font-mono text-xs text-sophia-dark-muted">Advanced: app-wide AI defaults</summary>
      <div class="mt-3 grid gap-3">
        <label class="block">
          <span class="font-mono text-xs text-sophia-dark-muted">Default Restormel shared route id</span>
          <input
            class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text outline-none focus:border-sophia-dark-copper/60"
            type="text"
            bind:value={appDefaultSharedRouteInput}
            placeholder="route uuid (optional)"
          />
        </label>
        <label class="block">
          <span class="font-mono text-xs text-sophia-dark-muted">Degraded primary provider</span>
          <input class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text outline-none focus:border-sophia-dark-copper/60" type="text" bind:value={appDegPrimaryInput} placeholder="e.g. openai" />
        </label>
        <label class="block">
          <span class="font-mono text-xs text-sophia-dark-muted">Degraded reasoning model (standard)</span>
          <input class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text outline-none focus:border-sophia-dark-copper/60" type="text" bind:value={appDegReasonStdInput} placeholder="model id (optional)" />
        </label>
        <label class="block">
          <span class="font-mono text-xs text-sophia-dark-muted">Degraded reasoning model (deep)</span>
          <input class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text outline-none focus:border-sophia-dark-copper/60" type="text" bind:value={appDegReasonDeepInput} placeholder="model id (optional)" />
        </label>
        <label class="block">
          <span class="font-mono text-xs text-sophia-dark-muted">Degraded extraction model</span>
          <input class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text outline-none focus:border-sophia-dark-copper/60" type="text" bind:value={appDegExtInput} placeholder="model id (optional)" />
        </label>
        <label class="block">
          <span class="font-mono text-xs text-sophia-dark-muted">Default OpenAI key (optional)</span>
          <input class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text outline-none focus:border-sophia-dark-copper/60" type="password" bind:value={appOpenaiKeyInput} placeholder="sk-…" autocomplete="off" />
          {#if appAiSummary?.defaultOpenaiKeyConfigured}
            <p class="mt-1 font-mono text-[11px] text-sophia-dark-muted">
              Currently configured: <span class="text-sophia-dark-text">{appAiSummary.defaultOpenaiKeyLast4 ?? '—'}</span>
            </p>
          {/if}
        </label>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="op-btn" disabled={appAiBusy} onclick={() => void saveAppAiDefaults()}>
            {appAiBusy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            class="op-btn op-btn-danger"
            disabled={appAiBusy || !appAiSummary?.defaultOpenaiKeyConfigured}
            onclick={() => void clearAppOpenaiDefaultKey()}
            title={!appAiSummary?.defaultOpenaiKeyConfigured ? 'No key to clear' : ''}
          >
            Clear OpenAI key
          </button>
          <button type="button" class="op-btn" disabled={appAiBusy} onclick={() => void load()}>Refresh</button>
        </div>

        {#if appAiMessage}
          <p class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-2 font-mono text-xs text-sophia-dark-text">
            {appAiMessage}
          </p>
        {/if}
      </div>
    </details>
  </div>
{/if}

<style>
  .op-subhead {
    margin-bottom: 12px;
  }
  .op-subhead-title {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 13px;
    color: var(--sophia-dark-text);
  }
  .op-subhead-muted {
    margin-top: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 12px;
    color: var(--sophia-dark-muted);
  }
</style>

