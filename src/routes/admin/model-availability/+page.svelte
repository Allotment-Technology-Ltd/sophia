<script lang="ts">
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/authClient';
  import {
    INGESTION_PHASE_COLUMN_ORDER,
    INGESTION_PHASE_TABLE_HEADING,
    ingestionPhaseSuitabilityTitle,
    type IngestionPhaseSuitabilityLevel,
    type IngestionPipelineStageKey
  } from '$lib/ingestionPipelineModelRequirements';

  type CatalogRow = {
    providerType: string;
    modelId: string;
    isEmbedding: boolean;
    catalogUsable: boolean;
    detailsSufficient: boolean;
    eligibleForSurfaces: boolean;
    userQueryable: boolean;
    raw: Record<string, unknown>;
    ingestionPhaseSuitability?: Record<IngestionPipelineStageKey, IngestionPhaseSuitabilityLevel>;
    /** Server canonical key for surfaceAssignments (google/vertex normalized). */
    surfaceRowKey?: string;
  };

  type SurfaceRole =
    | 'off'
    | 'ingestion_only'
    | 'embeddings_only'
    | 'app_inquiries_only'
    | 'ingestion_and_inquiries';

  const SURFACE_ROLE_LABEL: Record<SurfaceRole, string> = {
    off: 'Not available',
    ingestion_only: 'Ingestion only',
    embeddings_only: 'Embeddings only',
    app_inquiries_only: 'App inquiries only',
    ingestion_and_inquiries: 'Ingestion + app inquiries'
  };

  /** Canonical string for property filter matching (includes missing values). */
  const PROP_VALUE_MISSING = '__sophia_prop_missing__';

  function canonicalPropertyValue(value: unknown): string {
    if (value === undefined || value === null) return PROP_VALUE_MISSING;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function formatFilterOptionLabel(canonical: string): string {
    if (canonical === PROP_VALUE_MISSING) return '(empty / missing)';
    if (canonical.length > 72) return `${canonical.slice(0, 69)}…`;
    return canonical;
  }

  const PREVIEW_KEYS_MAX = 12;

  function rowKey(r: Pick<CatalogRow, 'providerType' | 'modelId' | 'surfaceRowKey'>): string {
    const stable = r.surfaceRowKey?.trim();
    if (stable) return stable;
    return `${r.providerType.trim().toLowerCase()}::${r.modelId.trim()}`;
  }

  function formatCellPreview(value: unknown): string {
    if (value === undefined || value === null) return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') {
      return value.length > 48 ? `${value.slice(0, 45)}…` : value;
    }
    try {
      const s = JSON.stringify(value);
      return s.length > 48 ? `${s.slice(0, 45)}…` : s;
    } catch {
      return '…';
    }
  }

  function safeJsonStringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  /** Omitted from catalog preview columns and field filters (identity / noise / supplement metadata). */
  const EXCLUDED_CATALOG_RAW_KEYS = new Set([
    'canonicalName',
    'providerType',
    'providerTypes',
    'modelId',
    'sophiaCatalogSupplement',
    'sophiaCatalogSupplementNote',
    'variants'
  ]);

  function collectSortedRawKeys(rows: CatalogRow[]): string[] {
    const s = new Set<string>();
    for (const r of rows) {
      const raw = r.raw;
      if (raw && typeof raw === 'object') {
        for (const k of Object.keys(raw)) {
          if (EXCLUDED_CATALOG_RAW_KEYS.has(k)) continue;
          s.add(k);
        }
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  function phaseLevel(
    r: CatalogRow,
    sk: IngestionPipelineStageKey
  ): IngestionPhaseSuitabilityLevel {
    return r.ingestionPhaseSuitability?.[sk] ?? 'na';
  }

  function phaseSearchBlob(r: CatalogRow): string {
    if (!r.ingestionPhaseSuitability) return '';
    return INGESTION_PHASE_COLUMN_ORDER.map((sk) => `${sk}:${r.ingestionPhaseSuitability![sk]}`).join(' ');
  }

  function roleOptionsForRow(r: CatalogRow): SurfaceRole[] {
    if (!r.eligibleForSurfaces) return ['off'];
    if (r.isEmbedding) return ['off', 'embeddings_only'];
    return ['off', 'ingestion_only', 'app_inquiries_only', 'ingestion_and_inquiries'];
  }

  function coerceRoleForRow(r: CatalogRow, role: SurfaceRole): SurfaceRole {
    const allowed = roleOptionsForRow(r);
    return allowed.includes(role) ? role : 'off';
  }

  /**
   * Merge server `surfaceAssignments` (full catalog) with per-row coercion for displayed rows.
   * When the table lists only Keys-bindable models, `rows` is a subset — preserve assignments for other keys from `raw`.
   */
  function normalizeSurfaceAssignments(
    rows: CatalogRow[],
    raw: Record<string, SurfaceRole> | undefined
  ): Record<string, SurfaceRole> {
    const out: Record<string, SurfaceRole> = { ...(raw ?? {}) };
    for (const r of rows) {
      const k = rowKey(r);
      const role = raw?.[k];
      const parsed =
        role === 'off' ||
        role === 'ingestion_only' ||
        role === 'embeddings_only' ||
        role === 'app_inquiries_only' ||
        role === 'ingestion_and_inquiries'
          ? role
          : 'off';
      out[k] = coerceRoleForRow(r, parsed);
    }
    return out;
  }

  /** Fixed levels for ingestion phase column filters (matches table ● / ◐ / ✗ / —). */
  const PHASE_LEVEL_FILTER_OPTIONS: { value: IngestionPhaseSuitabilityLevel; label: string }[] = [
    { value: 'yes', label: 'Balanced (●)' },
    { value: 'weak', label: 'Budget only (◐)' },
    { value: 'no', label: 'Below budget (✗)' },
    { value: 'na', label: 'Not applicable (—)' }
  ];

  function catalogRowMatches(
    r: CatalogRow,
    globalQ: string,
    /** Per property: selected canonical values; empty = no filter on that property. */
    selections: Record<string, string[]>,
    /** Per pipeline stage: selected suitability levels; empty = no filter on that stage. */
    phaseSelections: Partial<Record<IngestionPipelineStageKey, IngestionPhaseSuitabilityLevel[]>>,
    /** Selected provider types; empty = any provider. */
    providerFilter: string[],
    assignments: Record<string, SurfaceRole>
  ): boolean {
    const raw = r.raw ?? {};
    /** Within each filter: selected values OR. Between filters (catalog fields, phases, provider, search): AND. */
    for (const [prop, selected] of Object.entries(selections)) {
      if (!selected?.length) continue;
      const canon = canonicalPropertyValue(raw[prop]);
      if (!selected.includes(canon)) return false;
    }
    for (const sk of INGESTION_PHASE_COLUMN_ORDER) {
      const selected = phaseSelections[sk];
      if (!selected?.length) continue;
      const lvl = phaseLevel(r, sk);
      if (!selected.includes(lvl)) return false;
    }
    if (providerFilter.length > 0 && !providerFilter.includes(r.providerType)) return false;
    const g = globalQ.trim().toLowerCase();
    if (g) {
      const roleLabel = SURFACE_ROLE_LABEL[assignments[rowKey(r)] ?? 'off'] ?? '';
      const hay = (
        safeJsonStringify(raw) +
        r.providerType +
        r.modelId +
        roleLabel +
        (r.catalogUsable ? 'yes' : 'no') +
        (r.detailsSufficient ? 'yes' : 'no') +
        (r.eligibleForSurfaces ? 'yes' : 'no') +
        phaseSearchBlob(r)
      ).toLowerCase();
      if (!hay.includes(g)) return false;
    }
    return true;
  }

  let loading = $state(true);
  let loadError = $state('');
  let saveBusy = $state(false);
  let saveMessage = $state('');
  let saveError = $state('');

  let catalogRows = $state<CatalogRow[]>([]);
  let catalogContract = $state<string | null>(null);
  let catalogFresh = $state(false);
  /** When false, Keys omitted freshness block — we treat catalog as saveable (typical on local). */
  let catalogFreshnessSignalsPresent = $state<boolean | null>(null);
  let catalogLoadError = $state<string | null>(null);
  /** When Keys bindable fetch succeeds, API may set this to pre-filter row count (full catalog). */
  let catalogTotalRowCount = $state<number | null>(null);
  /** When Keys bindable-model fetch fails, PUT still uses bindable filter; GET omits filter for effectiveOperations. */
  let keysBindableModelsError = $state<string | null>(null);
  /** Mirrors server env RESTORMEL_PROJECT_MODEL_REGISTRY_BINDINGS — registry rows on project model PUT. */
  let registryProjectModelBindings = $state(false);

  const saveDisabled = $derived.by(() => {
    if (saveBusy) return true;
    if (catalogFreshnessSignalsPresent === false) return false;
    if (catalogFreshnessSignalsPresent === true) return !catalogFresh;
    return !catalogFresh;
  });

  let lastRestormelError = $state<string | null>(null);

  let surfaceAssignments = $state<Record<string, SurfaceRole>>({});
  let filterQuery = $state('');
  /** Per top-level catalog property: selected canonical values (multi-select). */
  let propertyFilterSelections = $state<Record<string, string[]>>({});
  /** Per ingestion phase column (Fetch, Extract, …): selected suitability levels. */
  let phaseFilterSelections = $state<
    Partial<Record<IngestionPipelineStageKey, IngestionPhaseSuitabilityLevel[]>>
  >({});
  /** Selected provider types (matches `CatalogRow.providerType`); empty = all providers. */
  let providerFilterSelections = $state<string[]>([]);

  const ineligibleSurfacesCount = $derived(catalogRows.filter((r) => !r.eligibleForSurfaces).length);

  const allRawKeys = $derived(collectSortedRawKeys(catalogRows));
  const previewPropertyKeys = $derived(allRawKeys.slice(0, PREVIEW_KEYS_MAX));

  const filteredCatalogRows = $derived.by(() => {
    return catalogRows.filter((r) =>
      catalogRowMatches(
        r,
        filterQuery,
        propertyFilterSelections,
        phaseFilterSelections,
        providerFilterSelections,
        surfaceAssignments
      )
    );
  });

  /** Distinct provider types in the loaded catalog (for the provider filter). */
  const distinctProviders = $derived.by(() => {
    const set = new Set<string>();
    for (const r of catalogRows) set.add(r.providerType);
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  /** Rows after filters, sorted by provider then model id (no provider group header rows). */
  const catalogRowsSorted = $derived.by(() => {
    return [...filteredCatalogRows].sort((a, b) => {
      const pc = a.providerType.localeCompare(b.providerType);
      if (pc !== 0) return pc;
      return a.modelId.localeCompare(b.modelId);
    });
  });

  /** Distinct canonical values per raw property key (for multi-select filters). */
  const distinctPropertyValuesByKey = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const pk of allRawKeys) {
      const set = new Set<string>();
      for (const r of catalogRows) {
        const raw = r.raw ?? {};
        set.add(canonicalPropertyValue(raw[pk]));
      }
      map.set(pk, [...set].sort((a, b) => a.localeCompare(b)));
    }
    return map;
  });

  const activePropertyFilterCount = $derived(
    Object.values(propertyFilterSelections).filter((arr) => arr.length > 0).length
  );

  const activePhaseFilterCount = $derived(
    INGESTION_PHASE_COLUMN_ORDER.filter((sk) => (phaseFilterSelections[sk]?.length ?? 0) > 0)
      .length
  );

  const activeProviderFilterCount = $derived(providerFilterSelections.length > 0 ? 1 : 0);

  const activeCatalogFilterCount = $derived(
    activePropertyFilterCount + activePhaseFilterCount + activeProviderFilterCount
  );

  function clearAllCatalogFilters(): void {
    propertyFilterSelections = {};
    phaseFilterSelections = {};
    providerFilterSelections = [];
  }

  function setProviderFilterSelection(values: string[]): void {
    providerFilterSelections = [...values].sort((a, b) => a.localeCompare(b));
  }

  function selectAllProviderFilter(): void {
    setProviderFilterSelection([...distinctProviders]);
  }

  function clearProviderFilter(): void {
    providerFilterSelections = [];
  }

  function selectedValuesForProperty(pk: string): string[] {
    return propertyFilterSelections[pk] ?? [];
  }

  function setPropertyFilterSelection(pk: string, values: string[]): void {
    propertyFilterSelections = {
      ...propertyFilterSelections,
      [pk]: [...values].sort((a, b) => a.localeCompare(b))
    };
  }

  function selectAllPropertyFilter(pk: string): void {
    const all = distinctPropertyValuesByKey.get(pk) ?? [];
    propertyFilterSelections = { ...propertyFilterSelections, [pk]: [...all] };
  }

  function clearPropertyFilter(pk: string): void {
    const { [pk]: _, ...rest } = propertyFilterSelections;
    propertyFilterSelections = rest;
  }

  function selectedPhaseLevelsFor(sk: IngestionPipelineStageKey): IngestionPhaseSuitabilityLevel[] {
    return phaseFilterSelections[sk] ?? [];
  }

  function setPhaseFilterSelection(
    sk: IngestionPipelineStageKey,
    values: IngestionPhaseSuitabilityLevel[]
  ): void {
    phaseFilterSelections = {
      ...phaseFilterSelections,
      [sk]: [...values].sort((a, b) => a.localeCompare(b))
    };
  }

  function selectAllPhaseFilter(sk: IngestionPipelineStageKey): void {
    setPhaseFilterSelection(
      sk,
      PHASE_LEVEL_FILTER_OPTIONS.map((o) => o.value)
    );
  }

  function clearPhaseFilter(sk: IngestionPipelineStageKey): void {
    const { [sk]: _, ...rest } = phaseFilterSelections;
    phaseFilterSelections = rest;
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required. Sign in again.');
    return { Authorization: `Bearer ${token}` };
  }

  function setSurfaceRole(k: string, r: CatalogRow, value: string): void {
    const v = value as SurfaceRole;
    const nextRole = coerceRoleForRow(r, v);
    surfaceAssignments = { ...surfaceAssignments, [k]: nextRole };
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/admin/model-surfaces', { headers: await authHeaders() });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        loadError = typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
        return;
      }
      const cat = body.catalog as Record<string, unknown> | undefined;
      catalogContract = typeof cat?.contractVersion === 'string' ? cat.contractVersion : null;
      catalogFresh = cat?.allFresh === true;
      catalogFreshnessSignalsPresent =
        typeof cat?.freshnessSignalsPresent === 'boolean' ? cat.freshnessSignalsPresent : null;
      catalogLoadError = typeof cat?.error === 'string' ? cat.error : null;
      catalogTotalRowCount = typeof cat?.totalRowCount === 'number' ? cat.totalRowCount : null;
      keysBindableModelsError =
        typeof body.keysBindableModelsError === 'string' ? body.keysBindableModelsError : null;
      registryProjectModelBindings = body.registryProjectModelBindings === true;

      const rows = Array.isArray(body.catalogRows) ? (body.catalogRows as CatalogRow[]) : [];
      catalogRows = rows;

      propertyFilterSelections = {};
      phaseFilterSelections = {};
      providerFilterSelections = [];

      const stored = body.stored as Record<string, unknown> | undefined;
      lastRestormelError =
        stored?.lastRestormelSyncError === null || stored?.lastRestormelSyncError === undefined
          ? null
          : String(stored.lastRestormelSyncError);

      const sa = body.surfaceAssignments as Record<string, SurfaceRole> | undefined;
      surfaceAssignments = normalizeSurfaceAssignments(rows, sa);
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  /** Prefer upstream Restormel detail; the API wraps failures as `error` + `restormel` (detail is often omitted). */
  function formatModelSurfacesSaveError(out: Record<string, unknown>, httpStatus: number): string {
    const err =
      typeof out.error === 'string' ? out.error : `Save failed (${httpStatus})`;
    const rm = out.restormel;
    if (rm && typeof rm === 'object' && rm !== null) {
      const r = rm as Record<string, unknown>;
      const um = typeof r.userMessage === 'string' ? r.userMessage.trim() : '';
      const d = typeof r.detail === 'string' ? r.detail.trim() : '';
      const code = typeof r.code === 'string' ? r.code.trim() : '';
      const endpoint = typeof r.endpoint === 'string' ? r.endpoint.trim() : '';
      /** Prefer `detail` — server merges per-model `errors[]` there; `userMessage` is often shorter. */
      const human = d || um || code;
      if (human) {
        const epNote =
          endpoint && !human.includes(endpoint) ? ` — ${endpoint}` : '';
        return `${err}: ${human}${epNote}`;
      }
      const pub = r.publishErrors;
      if (Array.isArray(pub) && pub.length > 0) {
        try {
          return `${err}: ${JSON.stringify(pub[0]).slice(0, 280)}`;
        } catch {
          /* ignore */
        }
      }
    }
    if (typeof out.detail === 'string' && out.detail) {
      return `${err}: ${out.detail}`;
    }
    return err;
  }

  async function save(): Promise<void> {
    saveBusy = true;
    saveMessage = '';
    saveError = '';
    try {
      const body = { surfaceAssignments };
      const res = await fetch('/api/admin/model-surfaces', {
        method: 'PUT',
        headers: {
          ...(await authHeaders()),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        saveError = formatModelSurfacesSaveError(out, res.status);
        return;
      }
      saveMessage = registryProjectModelBindings
        ? 'Saved and synced Restormel project model index (execution + registry bindings where applicable).'
        : 'Saved and synced Restormel project model index.';
      await load();
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saveBusy = false;
    }
  }

  const inputClass =
    'min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage';

  const filterMultiSelectClass =
    'w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-2 py-2 font-mono text-[11px] leading-snug text-sophia-dark-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage';

  const surfaceSelectClass =
    'w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-[11px] text-sophia-dark-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage disabled:cursor-not-allowed disabled:opacity-60';

  onMount(() => {
    void load();
  });
</script>

<svelte:head>
  <title>Model availability — Admin</title>
</svelte:head>

<main class="expand-page">
  <header class="expand-hero">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
        <h1 class="mt-2 font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">Model availability</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
          Full Restormel catalog rows are shown below with collapsible field filters. Under each model name, choose where
          that model is used: ingestion (Restormel index), embeddings only, app inquiry pickers only, ingestion plus app,
          or not at all. Saving updates Firestore and syncs the Restormel project model index for every model that is
          <strong class="text-sophia-dark-text">not</strong> set to
          <strong class="text-sophia-dark-text">Not available</strong> or
          <strong class="text-sophia-dark-text">App inquiries only</strong>.
        </p>
      </div>
      <nav class="flex flex-wrap gap-2" aria-label="Admin shortcuts">
        <a href="/admin" class="admin-hub-action">Admin home</a>
        <a href="/admin/ingest/operator" class="admin-hub-action">Ingestion</a>
      </nav>
    </div>
  </header>

  {#if loading}
    <p class="mt-8 font-mono text-sm text-sophia-dark-muted">Loading catalog and configuration…</p>
  {:else if loadError}
    <p class="mt-8 font-mono text-sm text-sophia-dark-copper">{loadError}</p>
  {:else}
    <div class="mt-8 space-y-6">
      {#if catalogLoadError}
        <div
          class="rounded border border-sophia-dark-copper/45 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper"
          role="status"
        >
          Catalog fetch issue: {catalogLoadError}
        </div>
      {/if}

      {#if catalogFreshnessSignalsPresent === true && !catalogFresh}
        <div
          class="rounded border border-sophia-dark-amber/45 bg-sophia-dark-amber/12 px-4 py-3 font-mono text-xs text-sophia-dark-amber"
          role="status"
        >
          Catalog freshness is not healthy — saving is blocked until Restormel reports fresh signals. User query lists may be
          empty in the app until this recovers.
        </div>
      {:else if catalogFreshnessSignalsPresent === false}
        <div
          class="rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/35 px-4 py-3 font-mono text-xs text-sophia-dark-muted"
          role="status"
        >
          Restormel did not include <span class="text-sophia-dark-text">externalSignals.freshness</span> on this catalog
          response (common on local Keys). Save is allowed; production should use a catalog that reports freshness.
        </div>
      {/if}

      {#if lastRestormelError}
        <div
          class="rounded border border-sophia-dark-border px-4 py-3 font-mono text-xs text-sophia-dark-muted"
          role="status"
        >
          Last Restormel sync error: <span class="text-sophia-dark-copper">{lastRestormelError}</span>
        </div>
      {/if}

      {#if keysBindableModelsError}
        <div
          class="rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/35 px-4 py-3 font-mono text-xs text-sophia-dark-muted"
          role="status"
        >
          Could not load Keys bindable models (GET /models + project index).{#if registryProjectModelBindings}
            Save can still apply <span class="text-sophia-dark-text">registry</span> bindings for assigned rows.{:else}
            Save still filters by bindable keys.{/if}
          —
          <span class="text-sophia-dark-copper">{keysBindableModelsError}</span>
        </div>
      {/if}

      <p class="font-mono text-xs text-sophia-dark-dim">
        Contract: {catalogContract ?? '—'} · {#if registryProjectModelBindings}
          Catalog rows (full v5 list):{:else}
          Catalog rows (Keys bindable){/if}
        {catalogRows.length}{#if catalogTotalRowCount != null && catalogTotalRowCount > catalogRows.length}
          <span class="text-sophia-dark-muted">
            · {catalogTotalRowCount} in full catalog</span
          >{/if}{#if ineligibleSurfacesCount > 0}
          <span class="text-sophia-dark-muted">
            · {ineligibleSurfacesCount} not eligible for surfaces</span
          >{/if}
        · Showing {filteredCatalogRows.length} after filters
      </p>

      <section class="rounded border border-sophia-dark-border bg-sophia-dark-bg/40 p-5">
        <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Search &amp; filters</h2>
        <p class="mt-2 text-sm text-sophia-dark-muted">
          Search across the full row JSON, model id, and surface labels.           Use <span class="text-sophia-dark-text">Provider</span> to narrow by Restormel provider (same field as each row’s
          backend <span class="font-mono text-[11px] text-sophia-dark-text">providerType</span>, not shown as a property column).
          Open an ingestion phase or catalog field below to restrict rows (hold
          <kbd class="rounded bg-sophia-dark-bg/80 px-1 font-mono text-[11px] text-sophia-dark-text">⌘</kbd> or
          <kbd class="rounded bg-sophia-dark-bg/80 px-1 font-mono text-[11px] text-sophia-dark-text">Ctrl</kbd> for disjoint
          selection in multi-selects). Within each filter, chosen values combine with
          <span class="text-sophia-dark-text">OR</span>; when you use several filters together, those combine with
          <span class="text-sophia-dark-text">AND</span>.
        </p>
        <div class="mt-4 flex flex-wrap items-end gap-4">
          <div class="min-w-[12rem] flex-1 max-w-lg">
            <label class="font-mono text-xs text-sophia-dark-muted" for="model-filter">Global search</label>
            <input
              id="model-filter"
              bind:value={filterQuery}
              type="search"
              placeholder="Any text in row JSON, model id, surface…"
              class="mt-1 block w-full {inputClass}"
            />
          </div>
          <button
            type="button"
            class="min-h-11 rounded border border-sophia-dark-border/70 px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
            onclick={() => void load()}
          >
            Reload
          </button>
          {#if activeCatalogFilterCount > 0}
            <button
              type="button"
              class="min-h-11 rounded border border-sophia-dark-border/70 px-4 py-2 font-mono text-xs text-sophia-dark-muted hover:bg-sophia-dark-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
              onclick={clearAllCatalogFilters}
            >
              Clear all filters ({activeCatalogFilterCount})
            </button>
          {/if}
        </div>

        {#if distinctProviders.length > 0}
          <div class="mt-6 border-t border-sophia-dark-border/50 pt-6">
            <p class="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Filter by provider</p>
            <div class="mt-3">
              <details
                class="catalog-filter-disclosure max-w-xl rounded-lg border border-sophia-dark-border/60 bg-sophia-dark-bg/30"
              >
                <summary
                  class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-mono text-xs text-sophia-dark-text hover:bg-sophia-dark-bg/40 [&::-webkit-details-marker]:hidden"
                  title="Filter by Restormel provider type (matches each row’s providerType)"
                >
                  <span class="min-w-0 truncate font-medium">Provider</span>
                  <span class="shrink-0 font-mono text-[10px] text-sophia-dark-dim">
                    {#if providerFilterSelections.length === 0}
                      Any
                    {:else}
                      {providerFilterSelections.length} / {distinctProviders.length}
                    {/if}
                  </span>
                </summary>
                <div class="border-t border-sophia-dark-border/40 px-3 py-3">
                  <label class="sr-only" for="filter-provider-ms">Providers</label>
                  <select
                    id="filter-provider-ms"
                    multiple
                    size={Math.min(12, Math.max(4, distinctProviders.length))}
                    class={filterMultiSelectClass}
                    onchange={(e) => {
                      const el = e.currentTarget as HTMLSelectElement;
                      setProviderFilterSelection(Array.from(el.selectedOptions, (o) => o.value));
                    }}
                  >
                    {#each distinctProviders as p}
                      <option value={p} selected={providerFilterSelections.includes(p)}>{p}</option>
                    {/each}
                  </select>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="min-h-9 rounded border border-sophia-dark-border/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-sophia-dark-muted hover:bg-sophia-dark-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
                      onclick={selectAllProviderFilter}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      class="min-h-9 rounded border border-sophia-dark-border/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-sophia-dark-muted hover:bg-sophia-dark-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
                      onclick={clearProviderFilter}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </div>
        {/if}

        <div class="mt-6 border-t border-sophia-dark-border/50 pt-6">
          <p class="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
            Filter by ingestion phase
          </p>
          <div
            class="catalog-filter-stack mt-3 grid max-h-[min(28rem,55vh)] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3"
          >
            {#each INGESTION_PHASE_COLUMN_ORDER as sk}
              {@const heading = INGESTION_PHASE_TABLE_HEADING[sk]}
              {@const selected = selectedPhaseLevelsFor(sk)}
              <details
                class="catalog-filter-disclosure min-w-0 rounded-lg border border-sophia-dark-border/60 bg-sophia-dark-bg/30"
              >
                <summary
                  class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-mono text-xs text-sophia-dark-text hover:bg-sophia-dark-bg/40 [&::-webkit-details-marker]:hidden"
                  title={`Filter rows by ${heading} suitability (Balanced, Budget only, Below budget, N/A)`}
                >
                  <span class="min-w-0 truncate font-medium">{heading}</span>
                  <span class="shrink-0 font-mono text-[10px] text-sophia-dark-dim">
                    {#if selected.length === 0}
                      Any
                    {:else}
                      {selected.length} / {PHASE_LEVEL_FILTER_OPTIONS.length}
                    {/if}
                  </span>
                </summary>
                <div class="border-t border-sophia-dark-border/40 px-3 py-3">
                  <label class="sr-only" for={`filter-phase-ms-${sk}`}>Levels for {heading}</label>
                  <select
                    id={`filter-phase-ms-${sk}`}
                    multiple
                    size={4}
                    class={filterMultiSelectClass}
                    onchange={(e) => {
                      const el = e.currentTarget as HTMLSelectElement;
                      setPhaseFilterSelection(
                        sk,
                        Array.from(el.selectedOptions, (o) => o.value as IngestionPhaseSuitabilityLevel)
                      );
                    }}
                  >
                    {#each PHASE_LEVEL_FILTER_OPTIONS as opt}
                      <option value={opt.value} selected={selected.includes(opt.value)}>{opt.label}</option>
                    {/each}
                  </select>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="min-h-9 rounded border border-sophia-dark-border/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-sophia-dark-muted hover:bg-sophia-dark-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
                      onclick={() => selectAllPhaseFilter(sk)}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      class="min-h-9 rounded border border-sophia-dark-border/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-sophia-dark-muted hover:bg-sophia-dark-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
                      onclick={() => clearPhaseFilter(sk)}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </details>
            {/each}
          </div>
        </div>

        {#if allRawKeys.length > 0}
          <div class="mt-6 border-t border-sophia-dark-border/50 pt-6">
            <p class="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Filter by catalog field</p>
            <div
              class="catalog-filter-stack mt-3 grid max-h-[min(28rem,55vh)] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3"
            >
              {#each allRawKeys as pk}
                {@const options = distinctPropertyValuesByKey.get(pk) ?? []}
                {@const selected = selectedValuesForProperty(pk)}
                <details
                  class="catalog-filter-disclosure min-w-0 rounded-lg border border-sophia-dark-border/60 bg-sophia-dark-bg/30"
                >
                  <summary
                    class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-mono text-xs text-sophia-dark-text hover:bg-sophia-dark-bg/40 [&::-webkit-details-marker]:hidden"
                  >
                    <span class="min-w-0 truncate font-medium" title={pk}>{pk}</span>
                    <span class="shrink-0 font-mono text-[10px] text-sophia-dark-dim">
                      {#if selected.length === 0}
                        Any
                      {:else}
                        {selected.length} / {options.length}
                      {/if}
                    </span>
                  </summary>
                  <div class="border-t border-sophia-dark-border/40 px-3 py-3">
                    <label class="sr-only" for={`filter-ms-${pk}`}>Values for {pk}</label>
                    <select
                      id={`filter-ms-${pk}`}
                      multiple
                      size={Math.min(12, Math.max(4, options.length))}
                      class={filterMultiSelectClass}
                      onchange={(e) => {
                        const el = e.currentTarget as HTMLSelectElement;
                        setPropertyFilterSelection(pk, Array.from(el.selectedOptions, (o) => o.value));
                      }}
                    >
                      {#each options as opt}
                        <option value={opt} selected={selected.includes(opt)}>{formatFilterOptionLabel(opt)}</option>
                      {/each}
                    </select>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="min-h-9 rounded border border-sophia-dark-border/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-sophia-dark-muted hover:bg-sophia-dark-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
                        onclick={() => selectAllPropertyFilter(pk)}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        class="min-h-9 rounded border border-sophia-dark-border/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-sophia-dark-muted hover:bg-sophia-dark-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
                        onclick={() => clearPropertyFilter(pk)}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </details>
              {/each}
            </div>
          </div>
        {/if}
      </section>

      <section class="rounded border border-sophia-dark-border bg-sophia-dark-bg/40 p-5">
        <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Catalog browser</h2>
        <p class="mt-2 text-sm text-sophia-dark-muted">
          The table includes Vertex embedding rows from the v5 catalog when Keys omits them from GET /models (for surface
          assignment when those rows appear here).{#if registryProjectModelBindings}
            This host has <strong class="text-sophia-dark-text">RESTORMEL_PROJECT_MODEL_REGISTRY_BINDINGS</strong> enabled:
            save syncs ingestion / embedding / ingestion+app rows using Keys
            <strong class="text-sophia-dark-text">execution</strong> bindings when the pair appears in GET /models (and project
            index), and <strong class="text-sophia-dark-text">registry</strong> bindings for other assigned pairs (e.g. catalog-only
            embeddings).{:else}
            Project model sync sends <strong class="text-sophia-dark-text">non-embedding</strong> chat models only on PUT
            unless registry bindings are enabled (Keys migration 021 + env).{/if}
          Canonical provider ids for execution-style rows: openai, anthropic, vertex, openrouter, vercel, portkey, voyage
          (google→vertex). Save still persists surface roles for the full catalog. Rows are sorted
          by provider then model id; use
          <strong class="text-sophia-dark-text">Filter by provider</strong> above to narrow further. First column: model id plus
          surface assignment below it. Next {PREVIEW_KEYS_MAX}
          Restormel properties (alphabetically; provider fields are not shown as columns), then ingestion phase suitability
          (same rules as Admin → Expand), then Sophia flags. Phase cells:
          <span class="text-sophia-dark-sage">●</span> balanced ·
          <span class="text-sophia-dark-amber">◐</span> budget only ·
          <span class="text-sophia-dark-copper">✗</span> blocked · — n/a.
        </p>
        <div class="mt-4 overflow-x-auto rounded border border-sophia-dark-border/60">
          <table class="w-max min-w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr class="border-b border-sophia-dark-border/60 bg-sophia-dark-bg/50 text-left text-sophia-dark-dim">
                <th class="sticky left-0 z-10 min-w-[min(16rem,88vw)] bg-sophia-dark-bg/95 px-3 py-2">Model &amp; surface</th>
                {#each previewPropertyKeys as pk}
                  <th class="max-w-[10rem] whitespace-normal px-3 py-2">{pk}</th>
                {/each}
                {#each INGESTION_PHASE_COLUMN_ORDER as sk}
                  <th class="min-w-[2.75rem] px-2 py-2 text-center" title={INGESTION_PHASE_TABLE_HEADING[sk]}>
                    {INGESTION_PHASE_TABLE_HEADING[sk]}
                  </th>
                {/each}
                <th class="px-3 py-2">Keys usable</th>
                <th class="px-3 py-2">Routing detail</th>
                <th class="px-3 py-2">Eligible</th>
                <th class="px-3 py-2">Embedding</th>
                <th class="px-3 py-2">App</th>
              </tr>
            </thead>
            <tbody>
              {#each catalogRowsSorted as r}
                {@const k = rowKey(r)}
                <tr class="border-b border-sophia-dark-border/40 align-top" class:opacity-60={!r.eligibleForSurfaces}>
                  <td class="sticky left-0 z-10 bg-sophia-dark-bg/95 px-3 py-2 align-top">
                    <div class="flex min-w-0 max-w-[min(18rem,88vw)] flex-col gap-2">
                      <span class="break-words font-mono text-sm text-sophia-dark-text">{r.modelId}</span>
                      <label class="sr-only" for={`surface-${k}`}>Surface for {r.modelId}</label>
                      <select
                        id={`surface-${k}`}
                        class={surfaceSelectClass}
                        disabled={!r.eligibleForSurfaces}
                        value={surfaceAssignments[k] ?? 'off'}
                        onchange={(e) => setSurfaceRole(k, r, (e.currentTarget as HTMLSelectElement).value)}
                      >
                        {#each roleOptionsForRow(r) as opt}
                          <option value={opt}>{SURFACE_ROLE_LABEL[opt]}</option>
                        {/each}
                      </select>
                    </div>
                  </td>
                  {#each previewPropertyKeys as pk}
                    <td class="max-w-[10rem] break-words px-3 py-2 text-sophia-dark-muted"
                      >{formatCellPreview(r.raw[pk])}</td
                    >
                  {/each}
                  {#each INGESTION_PHASE_COLUMN_ORDER as sk}
                    {@const lvl = phaseLevel(r, sk)}
                    <td
                      class="px-2 py-2 text-center align-middle font-mono text-xs leading-none text-sophia-dark-muted"
                      title={ingestionPhaseSuitabilityTitle(sk, lvl)}
                    >
                      {#if lvl === 'yes'}<span class="text-sophia-dark-sage" aria-hidden="true">●</span>
                      {:else if lvl === 'weak'}<span class="text-sophia-dark-amber" aria-hidden="true">◐</span>
                      {:else if lvl === 'no'}<span class="text-sophia-dark-copper" aria-hidden="true">✗</span>
                      {:else}<span class="text-sophia-dark-dim">—</span>{/if}
                    </td>
                  {/each}
                  <td class="px-3 py-2 text-sophia-dark-muted">{r.catalogUsable ? 'yes' : 'no'}</td>
                  <td class="px-3 py-2 text-sophia-dark-muted">{r.detailsSufficient ? 'yes' : 'no'}</td>
                  <td class="px-3 py-2 text-sophia-dark-muted">{r.eligibleForSurfaces ? 'yes' : 'no'}</td>
                  <td class="px-3 py-2 text-sophia-dark-muted">{r.isEmbedding ? 'yes' : 'no'}</td>
                  <td class="px-3 py-2 text-sophia-dark-muted">{r.userQueryable ? 'yes' : 'no'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <div class="flex flex-wrap items-center gap-4 border-t border-sophia-dark-border/60 pt-6">
        <button
          type="button"
          disabled={saveDisabled}
          class="min-h-11 rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-6 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-sage"
          onclick={() => void save()}
        >
          {saveBusy ? 'Saving…' : 'Save and sync to Restormel'}
        </button>
        {#if saveMessage}<p class="font-mono text-xs text-sophia-dark-sage">{saveMessage}</p>{/if}
        {#if saveError}<p class="max-w-full break-words font-mono text-xs text-sophia-dark-copper">{saveError}</p>{/if}
      </div>
    </div>
  {/if}
</main>

<style>
  .expand-page {
    min-height: calc(100vh - var(--nav-height));
    padding: 20px;
    max-width: 1240px;
    margin: 0 auto;
    color: var(--color-text);
  }
  .expand-hero {
    border: 1px solid var(--color-border);
    background: linear-gradient(130deg, rgba(127, 163, 131, 0.2), rgba(44, 96, 142, 0.14));
    border-radius: 12px;
    padding: 20px;
  }
  .admin-hub-action {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    font-family: var(--font-ui);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-decoration: none;
    color: var(--color-muted);
    background: var(--color-surface);
  }
  .admin-hub-action:hover {
    border-color: color-mix(in srgb, var(--color-sage) 40%, var(--color-border));
    color: var(--color-text);
  }
  .catalog-json {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .catalog-filter-disclosure[open] > summary {
    background: color-mix(in srgb, var(--color-sage) 10%, transparent);
    border-radius: 8px 8px 0 0;
  }
  kbd {
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  }
</style>
