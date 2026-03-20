<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { auth, getIdToken, onAuthChange } from '$lib/firebase';

  type PageState = 'loading' | 'ready' | 'forbidden';
  type RequestState = 'idle' | 'loading';
  type SourceMode = 'url' | 'file';
  type FailoverAction = 'switch_secondary' | 'switch_tertiary' | 'retry_primary_once' | 'pause_for_operator';

  interface RouteRecord {
    id: string;
    name?: string | null;
    stage?: string | null;
    workload?: string | null;
  }

  interface StepRecord {
    id: string;
    orderIndex?: number | null;
    providerPreference?: string | null;
    modelId?: string | null;
    enabled?: boolean | null;
  }

  interface ValidationRecommendation {
    rank: number;
    model: string;
    confidence: number;
    reason: string;
    costTier: 'low' | 'medium' | 'high';
    speed: 'fast' | 'balanced' | 'thorough';
    contextWindow: string;
  }

  type CatalogEntrySource = 'annotated' | 'remote' | 'static_supplement';

  interface CatalogEntry {
    label: string;
    provider: string;
    modelId: string;
    costTier: 'low' | 'medium' | 'high';
    qualityTier: 'capable' | 'strong' | 'frontier';
    speed: 'fast' | 'balanced' | 'thorough';
    contextWindow: string;
    bestFor: string;
    catalogSource?: CatalogEntrySource;
  }

  interface CatalogSyncState {
    status: 'restormel' | 'static' | 'merged';
    reason?: string;
    remoteRowCount: number;
    annotatedCount: number;
    inferredRemoteCount: number;
    staticSupplementCount: number;
  }

  interface SourceHintRow {
    budget: string;
    balanced: string;
    quality: string;
    note: string;
  }

  const SOURCE_TYPES = [
    { id: 'sep_entry', label: 'Stanford Encyclopedia of Philosophy' },
    { id: 'gutenberg_text', label: 'Project Gutenberg' },
    { id: 'journal_article', label: 'Journal article / PDF text' },
    { id: 'web_article', label: 'General web source' }
  ] as const;

  const FAILOVER_OPTIONS: Array<{ id: FailoverAction; label: string }> = [
    { id: 'switch_secondary', label: 'Switch to secondary model' },
    { id: 'switch_tertiary', label: 'Switch to tertiary model' },
    { id: 'retry_primary_once', label: 'Retry primary once, then switch' },
    { id: 'pause_for_operator', label: 'Pause and ask operator' }
  ];

  const SOURCE_TYPE_BY_DOMAIN: Record<string, (typeof SOURCE_TYPES)[number]['id']> = {
    'plato.stanford.edu': 'sep_entry',
    'gutenberg.org': 'gutenberg_text',
    'www.gutenberg.org': 'gutenberg_text'
  };

  /** When Restormel route steps omit model IDs, validation still returns ranked labels — keep selects in sync. */
  const FALLBACK_CHAIN_MODEL_LABELS = [
    'anthropic · claude-3-5-sonnet-20241022',
    'openai · gpt-4o',
    'google · gemini-2.5-pro'
  ] as const;

  let pageState = $state<PageState>('loading');
  let currentUserEmail = $state<string | null>(null);
  let errorMessage = $state('');
  let successMessage = $state('');

  let loadingContextState = $state<RequestState>('idle');
  let recommendingState = $state<RequestState>('idle');

  let sourceMode = $state<SourceMode>('url');
  let sourceUrl = $state('');
  let sourceFile = $state<File | null>(null);
  let sourceFileName = $state('');
  let sourceType = $state<(typeof SOURCE_TYPES)[number]['id']>('sep_entry');
  let sourceTypeOverridden = $state(false);

  let firstStage = $state('ingestion_extraction');
  let routes = $state<RouteRecord[]>([]);
  let selectedRouteId = $state('');
  let routeSteps = $state<StepRecord[]>([]);

  let modelChain = $state<string[]>(['', '', '']);
  let failoverAction = $state<FailoverAction>('switch_secondary');

  let validationRan = $state(false);
  let validationSummary = $state('Run validation to generate ranked model advice for this source.');
  let validationResults = $state<ValidationRecommendation[]>([]);

  let lastDraftSavedAt = $state<string | null>(null);

  let modelCatalogEntries = $state<CatalogEntry[]>([]);
  let sourceHints = $state<Record<string, SourceHintRow>>({});
  let catalogSync = $state<CatalogSyncState | null>(null);

  const showCatalogSourceColumn = $derived.by(() =>
    modelCatalogEntries.some((r) => r.catalogSource)
  );

  /** Why "Validate best models" is disabled — show next to the button */
  const validateRouteHint = $derived.by((): string | null => {
    if (loadingContextState === 'loading') return 'Loading routes from Restormel…';
    if (routes.length === 0) return null;
    if (!selectedRouteId) return 'Choose a route above — validation calls the recommend API for that route.';
    return null;
  });

  const selectedRoute = $derived.by(
    () => routes.find((route) => route.id === selectedRouteId) ?? null
  );

  const modelOptions = $derived.by(() => {
    const options: string[] = [];
    for (const step of routeSteps) {
      const model = step.modelId?.trim();
      if (!model) continue;
      const provider = step.providerPreference?.trim();
      const label = provider ? `${provider} · ${model}` : model;
      if (!options.includes(label)) options.push(label);
    }
    return options;
  });

  const chainModelSelectOptions = $derived.by(() => {
    const options: string[] = [];
    const push = (label: string) => {
      const t = label.trim();
      if (t && !options.includes(t)) options.push(t);
    };
    for (const label of modelOptions) push(label);
    for (const m of modelChain) push(m);
    for (const r of validationResults) push(r.model);
    for (const e of modelCatalogEntries) push(e.label);
    if (options.length === 0) {
      for (const label of FALLBACK_CHAIN_MODEL_LABELS) push(label);
    }
    return options;
  });

  const sourceTypeLabel = $derived.by(
    () => SOURCE_TYPES.find((t) => t.id === sourceType)?.label ?? sourceType
  );

  const hintForSource = $derived.by(() => sourceHints[sourceType] ?? null);

  /** Route steps first; full catalog; then validation-only / fallback labels */
  const selectOptionsRoute = $derived.by(() => [...modelOptions]);

  const selectOptionsCatalog = $derived.by(() => {
    const inRoute = new Set(modelOptions);
    return modelCatalogEntries
      .map((e) => e.label)
      .filter((l) => !inRoute.has(l))
      .sort((a, b) => a.localeCompare(b));
  });

  const selectOptionsOther = $derived.by(() => {
    const inRoute = new Set(modelOptions);
    const inCat = new Set(modelCatalogEntries.map((e) => e.label));
    return chainModelSelectOptions.filter((l) => !inRoute.has(l) && !inCat.has(l));
  });

  const sourceReady = $derived.by(
    () => (sourceMode === 'url' ? sourceUrl.trim().length > 0 : sourceFile !== null) && sourceType.length > 0
  );

  const duplicateModels = $derived.by(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const model of modelChain) {
      const normalized = model.trim();
      if (!normalized) continue;
      if (seen.has(normalized)) duplicates.add(normalized);
      seen.add(normalized);
    }
    return Array.from(duplicates);
  });

  const chainReady = $derived.by(() => modelChain.every((entry) => entry.trim().length > 0));

  const estimatedDurationMinutes = $derived.by(() => {
    const multiplier =
      sourceType === 'journal_article' ? 12 :
      sourceType === 'gutenberg_text' ? 10 :
      sourceType === 'sep_entry' ? 7 :
      6;
    return sourceMode === 'file' ? multiplier + 2 : multiplier;
  });

  const estimatedCostUsd = $derived.by(() => {
    const modelCost = modelChain.reduce((sum, model) => sum + modelCostWeight(model), 0);
    const sourceFactor =
      sourceType === 'journal_article' ? 1.35 :
      sourceType === 'gutenberg_text' ? 1.2 :
      sourceType === 'sep_entry' ? 1.0 :
      0.9;
    const baseline = modelCost > 0 ? modelCost : 0.09;
    return Number((baseline * sourceFactor).toFixed(2));
  });

  const urlPreview = $derived.by(() => {
    if (sourceMode !== 'url' || !sourceUrl.trim()) return null;
    try {
      const parsed = new URL(sourceUrl.trim());
      const domain = parsed.hostname;
      return {
        domain,
        title: guessTitleFromUrl(parsed),
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
      };
    } catch {
      return null;
    }
  });

  const canStartPhaseOne = $derived.by(
    () => sourceReady && chainReady && duplicateModels.length === 0
  );

  const setupSteps = $derived.by(() => [
    {
      title: 'Source',
      subtitle: 'Input + source typing',
      complete: sourceReady
    },
    {
      title: 'Model chain',
      subtitle: 'Primary, fallback, failover',
      complete: chainReady && duplicateModels.length === 0
    },
    {
      title: 'Recommend',
      subtitle: 'Optional Restormel pass',
      complete: (validationRan && validationResults.length > 0) || chainReady
    },
    {
      title: 'Review',
      subtitle: 'Summary + start phase',
      complete: canStartPhaseOne
    }
  ]);

  const activeStep = $derived.by(() => {
    const firstIncomplete = setupSteps.findIndex((step) => !step.complete);
    return firstIncomplete === -1 ? setupSteps.length : firstIncomplete + 1;
  });

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
      const message =
        typeof body?.error === 'string' ? body.error : `Request failed with status ${response.status}`;
      const error = new Error(message);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return body;
  }

  function modelCostWeight(modelLabel: string): number {
    const label = modelLabel.toLowerCase();
    if (!label) return 0;
    if (label.includes('opus') || label.includes('gpt-5') || label.includes('sonnet')) return 0.06;
    if (label.includes('gpt-4o') || label.includes('claude-3-5')) return 0.045;
    return 0.03;
  }

  function modelMetadata(modelLabel: string): {
    contextWindow: string;
    costTier: 'low' | 'medium' | 'high';
    speed: 'fast' | 'balanced' | 'thorough';
    qualityTier?: 'capable' | 'strong' | 'frontier';
  } {
    const trimmed = modelLabel.trim();
    const fromCat = modelCatalogEntries.find((e) => e.label === trimmed);
    if (fromCat) {
      return {
        contextWindow: fromCat.contextWindow,
        costTier: fromCat.costTier,
        speed: fromCat.speed,
        qualityTier: fromCat.qualityTier
      };
    }
    const label = modelLabel.toLowerCase();
    if (label.includes('flash') || label.includes('mini')) {
      return { contextWindow: '128k', costTier: 'low', speed: 'fast' };
    }
    if (label.includes('opus') || label.includes('gpt-5')) {
      return { contextWindow: '200k', costTier: 'high', speed: 'thorough' };
    }
    return { contextWindow: '128k', costTier: 'medium', speed: 'balanced' };
  }

  function guessTitleFromUrl(parsed: URL): string {
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts.at(-1) ?? parsed.hostname;
    return last
      .replace(/[-_]/g, ' ')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function detectSourceType(url: string): (typeof SOURCE_TYPES)[number]['id'] | null {
    if (!url.trim()) return null;
    try {
      const hostname = new URL(url.trim()).hostname.toLowerCase();
      for (const [domain, source] of Object.entries(SOURCE_TYPE_BY_DOMAIN)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return source;
        }
      }
      if (hostname.includes('stanford.edu')) return 'sep_entry';
      if (hostname.includes('gutenberg.org')) return 'gutenberg_text';
      return 'web_article';
    } catch {
      return null;
    }
  }

  function applyRouteDefaults(steps: StepRecord[]): void {
    const ordered = [...steps].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    routeSteps = ordered;
    const options = ordered
      .map((step) => {
        const model = step.modelId?.trim();
        if (!model) return null;
        const provider = step.providerPreference?.trim();
        return provider ? `${provider} · ${model}` : model;
      })
      .filter((value): value is string => Boolean(value));

    modelChain = [options[0] ?? '', options[1] ?? options[0] ?? '', options[2] ?? options[1] ?? options[0] ?? ''];
  }

  function routeOptionLabel(route: RouteRecord): string {
    const shortId = route.id.slice(0, 8);
    return route.name?.trim() ? `${route.name} · ${shortId}` : route.id;
  }

  async function loadRouteSteps(routeId: string): Promise<void> {
    const body = await authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/steps`);
    const steps = Array.isArray(body.steps) ? (body.steps as StepRecord[]) : [];
    applyRouteDefaults(steps);
  }

  async function loadIngestionContext(): Promise<void> {
    loadingContextState = 'loading';
    errorMessage = '';
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/context');
      const nextRoutes = Array.isArray(body.routes) ? (body.routes as RouteRecord[]) : [];
      routes = nextRoutes;
      const stageMatch =
        nextRoutes.find((route) => route.stage === firstStage) ??
        nextRoutes.find((route) => route.name === 'interactive') ??
        nextRoutes[0] ??
        null;
      selectedRouteId = stageMatch?.id ?? '';
      if (selectedRouteId) {
        await loadRouteSteps(selectedRouteId);
      } else {
        routeSteps = [];
      }
    } finally {
      loadingContextState = 'idle';
    }
  }

  function catalogSourceLabel(source: CatalogEntrySource | undefined): string {
    if (source === 'annotated') return 'Restormel + guide';
    if (source === 'remote') return 'Restormel only';
    if (source === 'static_supplement') return 'Guide only';
    return '—';
  }

  async function loadModelCatalog(): Promise<void> {
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/model-catalog');
      modelCatalogEntries = Array.isArray(body.entries) ? (body.entries as CatalogEntry[]) : [];
      sourceHints =
        typeof body.sourceHints === 'object' && body.sourceHints !== null
          ? (body.sourceHints as Record<string, SourceHintRow>)
          : {};
      const sync = body.catalogSync;
      catalogSync =
        sync && typeof sync === 'object' && typeof sync.status === 'string'
          ? (sync as CatalogSyncState)
          : null;
    } catch {
      modelCatalogEntries = [];
      sourceHints = {};
      catalogSync = null;
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
      await loadIngestionContext();
      await loadModelCatalog();
      hydrateDraft();
    }
  }

  function setSourceType(value: (typeof SOURCE_TYPES)[number]['id']): void {
    sourceType = value;
    sourceTypeOverridden = true;
  }

  function onFileSelected(fileList: FileList | null): void {
    const file = fileList?.[0] ?? null;
    sourceFile = file;
    sourceFileName = file?.name ?? '';
  }

  function applySuggestedChainFromHints(): void {
    const h = hintForSource;
    if (!h) return;
    modelChain = [h.budget, h.balanced, h.quality];
    successMessage = 'Filled Model 1–3 with suggested picks (lowest cost → balanced → quality-first).';
    errorMessage = '';
  }

  function moveModel(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target > 2) return;
    const next = [...modelChain];
    const current = next[index];
    next[index] = next[target];
    next[target] = current;
    modelChain = next;
  }

  function buildValidationRecommendations(summaryText: string): ValidationRecommendation[] {
    const candidates =
      modelOptions.length > 0 ? modelOptions : [...FALLBACK_CHAIN_MODEL_LABELS];

    return candidates.slice(0, 5).map((model, idx) => {
      const meta = modelMetadata(model);
      return {
        rank: idx + 1,
        model,
        confidence: Number((0.91 - idx * 0.09).toFixed(2)),
        reason:
          idx === 0
            ? `Best fit for current source profile. ${summaryText}`
            : idx === 1
              ? 'Balanced fallback if primary fails or rate limits.'
              : 'Low-risk fallback to keep ingestion progressing.',
        costTier: meta.costTier,
        speed: meta.speed,
        contextWindow: meta.contextWindow
      };
    });
  }

  async function runModelValidation(): Promise<void> {
    if (!selectedRouteId) {
      errorMessage = 'Select a route before validation.';
      return;
    }
    recommendingState = 'loading';
    errorMessage = '';
    successMessage = '';
    try {
      const recommendBody = await authorizedJson(
        `/api/admin/ingestion-routing/routes/${selectedRouteId}/recommend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionType: 'use_recommended_route',
            environmentId: null,
            stage: firstStage,
            workload: 'ingestion',
            sourceType
          })
        }
      );

      const summary =
        recommendBody?.recommendation?.recommendedAction ??
        recommendBody?.recommendation?.reason ??
        recommendBody?.data?.recommendations?.[0]?.recommendedAction ??
        recommendBody?.data?.recommendations?.[0]?.reason ??
        'Recommended route generated.';

      validationSummary = String(summary);
      const returnedRankings = Array.isArray(recommendBody?.recommendation?.rankings)
        ? recommendBody.recommendation.rankings
        : null;
      validationResults = returnedRankings
        ? returnedRankings.map((ranking: Record<string, unknown>, idx: number) => ({
            rank: typeof ranking.rank === 'number' ? ranking.rank : idx + 1,
            model:
              typeof ranking.display === 'string'
                ? ranking.display
                : `${String(ranking.providerType ?? 'auto')} · ${String(ranking.modelId ?? 'model')}`,
            confidence:
              typeof ranking.confidence === 'number' ? ranking.confidence : Number(Math.max(0.5, 0.88 - idx * 0.1).toFixed(2)),
            reason:
              typeof ranking.rationale === 'string'
                ? ranking.rationale
                : 'Recommended from configured route steps.',
            costTier:
              ranking.costTier === 'low' || ranking.costTier === 'medium' || ranking.costTier === 'high'
                ? ranking.costTier
                : 'medium',
            speed:
              ranking.speed === 'fast' || ranking.speed === 'balanced' || ranking.speed === 'thorough'
                ? ranking.speed
                : 'balanced',
            contextWindow:
              typeof ranking.contextWindow === 'string' ? ranking.contextWindow : '128k'
          }))
        : buildValidationRecommendations(validationSummary);
      validationRan = true;
      successMessage = 'Validation completed. Review ranked recommendations and confirm your model chain.';
      if (validationResults.length >= 3) {
        modelChain = [validationResults[0].model, validationResults[1].model, validationResults[2].model];
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Validation failed';
      validationRan = false;
      validationResults = [];
      validationSummary = 'Validation failed. Check route/provider setup and retry.';
    } finally {
      recommendingState = 'idle';
    }
  }

  async function handleRouteChange(routeId: string): Promise<void> {
    selectedRouteId = routeId;
    validationRan = false;
    validationResults = [];
    validationSummary = 'Run validation to generate ranked model advice for this source.';
    if (!routeId) {
      routeSteps = [];
      modelChain = ['', '', ''];
      return;
    }
    try {
      await loadRouteSteps(routeId);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load route steps';
    }
  }

  function saveDraft(): void {
    if (!browser) return;
    const payload = {
      sourceMode,
      sourceUrl,
      sourceFileName,
      sourceType,
      selectedRouteId,
      modelChain,
      failoverAction,
      validationRan,
      validationSummary,
      validationResults
    };
    localStorage.setItem('sophia.admin.ingestion.draft', JSON.stringify(payload));
    lastDraftSavedAt = new Date().toLocaleString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short'
    });
    successMessage = 'Draft saved.';
  }

  function hydrateDraft(): void {
    if (!browser) return;
    const raw = localStorage.getItem('sophia.admin.ingestion.draft');
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Record<string, unknown>;
      sourceMode = draft.sourceMode === 'file' ? 'file' : 'url';
      sourceUrl = typeof draft.sourceUrl === 'string' ? draft.sourceUrl : '';
      sourceFileName = typeof draft.sourceFileName === 'string' ? draft.sourceFileName : '';
      if (
        typeof draft.sourceType === 'string' &&
        SOURCE_TYPES.some((type) => type.id === draft.sourceType)
      ) {
        sourceType = draft.sourceType as (typeof SOURCE_TYPES)[number]['id'];
      }
      selectedRouteId = typeof draft.selectedRouteId === 'string' ? draft.selectedRouteId : selectedRouteId;
      modelChain = Array.isArray(draft.modelChain)
        ? [String(draft.modelChain[0] ?? ''), String(draft.modelChain[1] ?? ''), String(draft.modelChain[2] ?? '')]
        : modelChain;
      if (typeof draft.failoverAction === 'string' && FAILOVER_OPTIONS.some((option) => option.id === draft.failoverAction)) {
        failoverAction = draft.failoverAction as FailoverAction;
      }
      validationRan = draft.validationRan === true;
      validationSummary = typeof draft.validationSummary === 'string' ? draft.validationSummary : validationSummary;
      if (Array.isArray(draft.validationResults)) {
        const parsed = draft.validationResults.filter(
          (row): row is Record<string, unknown> =>
            typeof row === 'object' && row !== null && typeof (row as { model?: unknown }).model === 'string'
        );
        validationResults = parsed.map((row, idx) => ({
          rank: typeof row.rank === 'number' ? row.rank : idx + 1,
          model: String(row.model),
          confidence: typeof row.confidence === 'number' ? row.confidence : 0.75,
          reason: typeof row.reason === 'string' ? row.reason : '',
          costTier:
            row.costTier === 'low' || row.costTier === 'medium' || row.costTier === 'high'
              ? row.costTier
              : 'medium',
          speed:
            row.speed === 'fast' || row.speed === 'balanced' || row.speed === 'thorough'
              ? row.speed
              : 'balanced',
          contextWindow: typeof row.contextWindow === 'string' ? row.contextWindow : '128k'
        }));
      }
      if (validationRan && validationResults.length === 0) {
        validationRan = false;
        validationSummary = 'Run validation to generate ranked model advice for this source.';
      }
    } catch {
      // ignore invalid draft payload
    }
  }

  async function startPhaseOne(): Promise<void> {
    if (!canStartPhaseOne) return;
    if (browser) {
      sessionStorage.setItem(
        'sophia.admin.ingestion.current',
        JSON.stringify({
          sourceMode,
          sourceUrl,
          sourceFileName,
          sourceType,
          routeId: selectedRouteId,
          modelChain,
          failoverAction
        })
      );
    }
    await goto('/admin/operations');
  }

  $effect(() => {
    if (sourceMode !== 'url') return;
    if (sourceTypeOverridden) return;
    const detected = detectSourceType(sourceUrl);
    if (detected) sourceType = detected;
  });

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
        errorMessage = error instanceof Error ? error.message : 'Failed to load administrator context';
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

<div class="admin-ingestion min-h-screen text-sophia-dark-text">
  <div class="admin-ingestion-shell mx-auto w-full max-w-[min(100%,88rem)] px-4 py-8 sm:px-8 sm:py-10 lg:px-12">
    <header class="rounded-2xl border border-sophia-dark-border/80 bg-sophia-dark-surface/95 p-8 md:p-10">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full border border-sophia-dark-purple/40 bg-sophia-dark-purple/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-purple">
            Admin Ingestion
          </span>
          <span
            class="rounded-full border border-sophia-dark-border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted"
            title="Phase 1 prepares extraction. Phase 2 and 3 continue in Operations."
          >
            Phase 1 of 3: Extraction & Ingestion
          </span>
        </div>
        <nav class="flex flex-wrap items-center gap-6">
          <a href="/admin/operations" class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-surface">Operations Workbench</a>
          <a href="/admin/ingestion-routing" class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-surface">Ingestion Routing</a>
          <a href="/admin/review" class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-surface">Review Queue</a>
        </nav>
      </div>

      <h1 class="mt-4 text-[2.1rem] font-serif leading-[1.15] text-sophia-dark-text md:text-[2.45rem]">
        Configure ingestion with a guided setup flow
      </h1>
      <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
        Choose a source, set your three-model chain, optionally run a Restormel recommendation, then start Phase 1.
      </p>
    </header>

    {#if pageState === 'loading'}
      <div class="mt-6 rounded-xl border border-sophia-dark-border bg-sophia-dark-surface p-5 font-mono text-sm text-sophia-dark-muted">
        Loading administrator context...
      </div>
    {:else if pageState === 'forbidden'}
      <div class="mt-6 rounded-xl border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-5">
        <h2 class="text-lg font-serif text-sophia-dark-copper">Administrator access required</h2>
        <p class="mt-2 font-mono text-sm text-sophia-dark-copper">
          {currentUserEmail ?? 'This account'} does not currently hold the `administrator` role.
        </p>
      </div>
    {:else}
      {#if errorMessage}
        <div class="mt-6 rounded-xl border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-sm text-sophia-dark-copper">
          {errorMessage}
        </div>
      {/if}
      {#if successMessage}
        <div class="mt-6 rounded-xl border border-sophia-dark-sage/40 bg-sophia-dark-sage/10 px-4 py-3 font-mono text-sm text-sophia-dark-sage">
          {successMessage}
        </div>
      {/if}

      <div class="mt-10 w-full">
        <nav
          class="setup-stepper mb-10 flex flex-wrap items-stretch justify-center gap-3 border-b border-sophia-dark-border/60 pb-8"
          aria-label="Setup progress"
        >
          {#each setupSteps as step, idx}
            <div
              class={`flex min-w-[9.5rem] max-w-[15rem] flex-1 flex-col rounded-xl border px-3 py-3 sm:px-4 sm:py-4 ${idx + 1 === activeStep ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/10' : 'border-sophia-dark-border bg-sophia-dark-bg/60'}`}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Step {idx + 1}</span>
                <span
                  class={`rounded-full border px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.12em] ${step.complete ? 'border-sophia-dark-sage/40 bg-sophia-dark-sage/10 text-sophia-dark-sage' : 'border-sophia-dark-border bg-sophia-dark-surface-raised text-sophia-dark-muted'}`}
                >
                  {step.complete ? '✓' : '•'}
                </span>
              </div>
              <div class="mt-2 font-serif text-base leading-snug text-sophia-dark-text sm:text-lg">{step.title}</div>
              <p class="mt-1 text-xs leading-5 text-sophia-dark-muted">{step.subtitle}</p>
            </div>
          {/each}
        </nav>

        <div class="mx-auto w-full max-w-5xl space-y-6">
          <section class="setup-card rounded-xl border border-sophia-dark-border bg-sophia-dark-surface/95 p-6 md:p-8">
            <div class="mb-5 flex items-center justify-between gap-3">
              <h2 class="text-2xl font-serif text-sophia-dark-text">1. Source input</h2>
              <span class="help-tip" title="Pick exactly one source mode. URL mode fetches from a link. File mode uses a local upload for this run setup.">ⓘ</span>
            </div>

            <div class="inline-flex rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-1">
              <button
                type="button"
                class={`rounded px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] ${sourceMode === 'url' ? 'bg-sophia-dark-purple/18 text-sophia-dark-text' : 'text-sophia-dark-muted'}`}
                onclick={() => (sourceMode = 'url')}
                aria-pressed={sourceMode === 'url'}
              >
                Paste URL
              </button>
              <button
                type="button"
                class={`rounded px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] ${sourceMode === 'file' ? 'bg-sophia-dark-purple/18 text-sophia-dark-text' : 'text-sophia-dark-muted'}`}
                onclick={() => (sourceMode = 'file')}
                aria-pressed={sourceMode === 'file'}
              >
                Browse file
              </button>
            </div>

            {#if sourceMode === 'url'}
              <div class="mt-6 space-y-5">
                <label class="block space-y-2">
                  <span class="text-sm text-sophia-dark-muted">Source URL</span>
                  <input
                    bind:value={sourceUrl}
                    type="url"
                    placeholder="https://plato.stanford.edu/entries/ethics-deontology/"
                    class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
                  />
                </label>

                {#if urlPreview}
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-4 py-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Source preview</div>
                    <div class="mt-2 flex items-center gap-3">
                      <img src={urlPreview.favicon} alt="" class="h-5 w-5 rounded-sm" />
                      <div>
                        <div class="text-sm text-sophia-dark-text">{urlPreview.title}</div>
                        <div class="font-mono text-xs text-sophia-dark-muted">{urlPreview.domain}</div>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            {:else}
              <div class="mt-6">
                <label class="block rounded border border-dashed border-sophia-dark-border bg-sophia-dark-bg/70 p-8 text-center">
                  <input
                    type="file"
                    class="hidden"
                    onchange={(event) => onFileSelected((event.currentTarget as HTMLInputElement).files)}
                  />
                  <span class="font-mono text-sm text-sophia-dark-text">Drop a file here or click to choose</span>
                  <p class="mt-2 text-xs text-sophia-dark-muted">Supports text, markdown, or document files used for ingestion setup.</p>
                </label>
                {#if sourceFileName}
                  <p class="mt-3 font-mono text-xs text-sophia-dark-muted">Selected: {sourceFileName}</p>
                {/if}
              </div>
            {/if}

            <label class="mt-6 block space-y-2">
              <span class="text-sm text-sophia-dark-muted">Source type</span>
              <select
                value={sourceType}
                onchange={(event) => setSourceType((event.currentTarget as HTMLSelectElement).value as (typeof SOURCE_TYPES)[number]['id'])}
                class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
              >
                {#each SOURCE_TYPES as option}
                  <option value={option.id}>{option.label}</option>
                {/each}
              </select>
              <span class="text-xs text-sophia-dark-muted">Auto-detected from URL when possible. You can override manually.</span>
            </label>
          </section>

          <section class="setup-card rounded-xl border border-sophia-dark-border bg-sophia-dark-surface/95 p-6 md:p-8">
            <div class="mb-5 flex items-center justify-between gap-3">
              <h2 class="text-2xl font-serif text-sophia-dark-text">2. Model chain & failover</h2>
              <span class="help-tip" title="Model chain order defines fallback progression: Model 1 fails -> Model 2 -> Model 3.">ⓘ</span>
            </div>

            <p class="mb-5 text-sm leading-6 text-sophia-dark-muted">
              This is the main control: choose each slot from the groups below (your route, then the full reference catalog). Step 3 only adds an optional Restormel ranking — it does not unlock the dropdowns.
            </p>

            <div class="space-y-4">
              {#each [0, 1, 2] as index}
                <div class="model-row rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/70 px-4 py-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <span class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Model {index + 1}</span>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        onclick={() => moveModel(index, -1)}
                        disabled={index === 0}
                        class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onclick={() => moveModel(index, 1)}
                        disabled={index === 2}
                        class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  <div class="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <select
                      value={modelChain[index]}
                      onchange={(event) => {
                        const next = [...modelChain];
                        next[index] = (event.currentTarget as HTMLSelectElement).value;
                        modelChain = next;
                      }}
                      class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
                    >
                      <option value="">Select model</option>
                      {#if selectOptionsRoute.length === 0 && selectOptionsCatalog.length === 0 && selectOptionsOther.length === 0}
                        {#each chainModelSelectOptions as option}
                          <option value={option}>{option}</option>
                        {/each}
                      {:else}
                        {#if selectOptionsRoute.length > 0}
                          <optgroup label="On your Restormel route">
                            {#each selectOptionsRoute as option}
                              <option value={option}>{option}</option>
                            {/each}
                          </optgroup>
                        {/if}
                        {#if selectOptionsCatalog.length > 0}
                          <optgroup label="Reference catalog">
                            {#each selectOptionsCatalog as option}
                              <option value={option}>{option}</option>
                            {/each}
                          </optgroup>
                        {/if}
                        {#if selectOptionsOther.length > 0}
                          <optgroup label="Other picks & validation">
                            {#each selectOptionsOther as option}
                              <option value={option}>{option}</option>
                            {/each}
                          </optgroup>
                        {/if}
                      {/if}
                    </select>
                    {#if modelChain[index]}
                      {@const meta = modelMetadata(modelChain[index])}
                      <div class="flex flex-wrap gap-2">
                        <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Context {meta.contextWindow}</span>
                        <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Cost {meta.costTier}</span>
                        {#if meta.qualityTier}
                          <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Quality {meta.qualityTier}</span>
                        {/if}
                        <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Speed {meta.speed}</span>
                      </div>
                    {/if}
                  </div>
                  {#if index < 2}
                    <div class="mt-4 font-mono text-xs text-sophia-dark-dim">Falls back to Model {index + 2} on configured failover.</div>
                  {/if}
                </div>
              {/each}
            </div>

            <label class="mt-6 block space-y-2">
              <span class="text-sm text-sophia-dark-muted">
                Preferred failover action
                <span class="help-tip" title="Defines what SOPHIA does when the current model fails at runtime.">ⓘ</span>
              </span>
              <select
                bind:value={failoverAction}
                class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
              >
                {#each FAILOVER_OPTIONS as option}
                  <option value={option.id}>{option.label}</option>
                {/each}
              </select>
            </label>

            {#if duplicateModels.length > 0}
              <div class="mt-5 rounded border border-sophia-dark-copper/45 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                Duplicate model selection detected: {duplicateModels.join(', ')}. Use distinct models for resilient fallback.
              </div>
            {/if}
          </section>

          <section class="setup-card rounded-xl border border-sophia-dark-border bg-sophia-dark-surface/95 p-6 md:p-8">
            <div class="mb-5 flex items-center justify-between gap-3">
              <h2 class="text-2xl font-serif text-sophia-dark-text">3. Optional: Restormel recommendation</h2>
              <span class="help-tip" title="Calls the recommend API for the selected route. Your model chain in step 2 is what Phase 1 uses; this step only refines rankings.">ⓘ</span>
            </div>

            <p class="mb-5 text-sm leading-6 text-sophia-dark-muted">
              Optional. If you already chose models in step 2, you can skip this. To run it, pick a Restormel route — the button stays inactive until a route is selected (it is not broken).
            </p>

            <details class="mb-6 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/60 p-4" open>
              <summary class="cursor-pointer font-serif text-lg text-sophia-dark-text">
                Model reference — cost, quality &amp; task fit
              </summary>
              <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">
                Tiers are <span class="text-sophia-dark-text">relative</span> for planning. Actual spend and availability depend on Restormel routing and your provider keys.
              </p>
              {#if catalogSync}
                <p class="mt-2 font-mono text-xs leading-5 text-sophia-dark-dim">
                  {#if catalogSync.status === 'restormel'}
                    Model list from Restormel ({catalogSync.remoteRowCount} rows); guide copy where labels match.
                  {:else if catalogSync.status === 'merged'}
                    Merged: Restormel index ({catalogSync.remoteRowCount} rows) + {catalogSync.staticSupplementCount} guide-only
                    supplement{catalogSync.staticSupplementCount === 1 ? '' : 's'}.
                  {:else}
                    Static guide only
                    {#if catalogSync.reason}
                      — {catalogSync.reason}
                    {/if}
                  {/if}
                </p>
              {/if}
              {#if modelCatalogEntries.length > 0}
                <div class="mt-4 overflow-x-auto rounded-lg border border-sophia-dark-border">
                  <table class="w-full min-w-[44rem] border-collapse text-left text-sm">
                    <thead class="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                      <tr>
                        <th class="border-b border-sophia-dark-border px-3 py-2">Model</th>
                        <th class="border-b border-sophia-dark-border px-3 py-2">Cost</th>
                        <th class="border-b border-sophia-dark-border px-3 py-2">Quality</th>
                        <th class="border-b border-sophia-dark-border px-3 py-2">Speed</th>
                        <th class="border-b border-sophia-dark-border px-3 py-2">Context</th>
                        <th class="border-b border-sophia-dark-border px-3 py-2">Best for</th>
                        {#if showCatalogSourceColumn}
                          <th class="border-b border-sophia-dark-border px-3 py-2">Source</th>
                        {/if}
                      </tr>
                    </thead>
                    <tbody>
                      {#each modelCatalogEntries as row}
                        <tr class="border-b border-sophia-dark-border/80 text-sophia-dark-text last:border-0">
                          <td class="px-3 py-2 font-mono text-xs">{row.label}</td>
                          <td class="px-3 py-2 text-sophia-dark-muted">{row.costTier}</td>
                          <td class="px-3 py-2 text-sophia-dark-muted">{row.qualityTier}</td>
                          <td class="px-3 py-2 text-sophia-dark-muted">{row.speed}</td>
                          <td class="px-3 py-2 font-mono text-xs text-sophia-dark-muted">{row.contextWindow}</td>
                          <td class="px-3 py-2 text-sophia-dark-muted">{row.bestFor}</td>
                          {#if showCatalogSourceColumn}
                            <td class="px-3 py-2 font-mono text-[0.65rem] text-sophia-dark-dim">
                              {catalogSourceLabel(row.catalogSource)}
                            </td>
                          {/if}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else}
                <p class="mt-3 font-mono text-xs text-sophia-dark-dim">Catalog loading…</p>
              {/if}

              {#if hintForSource}
                <div class="mt-5 rounded-lg border border-sophia-dark-purple/30 bg-sophia-dark-purple/8 px-4 py-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
                    Suggested starting points for “{sourceTypeLabel}”
                  </div>
                  <ul class="mt-3 max-w-3xl text-sm leading-7 text-sophia-dark-muted">
                    <li><span class="font-mono text-xs text-sophia-dark-text">Lowest cost</span> — {hintForSource.budget}</li>
                    <li><span class="font-mono text-xs text-sophia-dark-text">Balanced</span> — {hintForSource.balanced}</li>
                    <li><span class="font-mono text-xs text-sophia-dark-text">Quality-first</span> — {hintForSource.quality}</li>
                  </ul>
                  <p class="mt-3 text-xs leading-5 text-sophia-dark-muted">{hintForSource.note}</p>
                  <button
                    type="button"
                    class="mt-4 rounded border border-sophia-dark-sage/40 bg-sophia-dark-sage/12 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-sage hover:bg-sophia-dark-sage/18"
                    onclick={() => applySuggestedChainFromHints()}
                  >
                    Apply suggested picks to chain (step 2)
                  </button>
                </div>
              {/if}
            </details>

            {#if routes.length === 0 && loadingContextState === 'idle'}
              <div class="mb-5 rounded-lg border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 text-sm text-sophia-dark-muted">
                No routes returned from Restormel for this project.
                <a
                  href="/admin/ingestion-routing"
                  class="font-mono text-sophia-dark-text underline underline-offset-2 hover:text-sophia-dark-sage"
                  >Ingestion Routing</a>
                or the Dashboard steps API. Validation cannot run until at least one route exists.
              </div>
            {/if}

            <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div class="space-y-2">
                <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
                  Route for Stage 1: {(selectedRoute?.name ?? selectedRouteId) || 'No route selected'}
                </div>
                <select
                  value={selectedRouteId}
                  onchange={(event) => void handleRouteChange((event.currentTarget as HTMLSelectElement).value)}
                  class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
                >
                  <option value="">Select route</option>
                  {#each routes as route}
                    <option value={route.id}>{routeOptionLabel(route)}</option>
                  {/each}
                </select>
                <p class="text-xs text-sophia-dark-muted">
                  Stage key:
                  <span class="font-mono">ingestion_extraction</span>
                  <span class="help-tip" title="This is the first ingestion stage where structured claims are extracted from the source.">ⓘ</span>
                </p>
                {#if validateRouteHint}
                  <p class="text-xs leading-5 text-sophia-dark-dim">{validateRouteHint}</p>
                {/if}
              </div>
              <button
                type="button"
                class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-5 py-3 font-mono text-sm text-sophia-dark-text hover:bg-sophia-dark-purple/24 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loadingContextState === 'loading' || recommendingState === 'loading' || !selectedRouteId}
                onclick={() => void runModelValidation()}
              >
                {recommendingState === 'loading' ? 'Validating…' : 'Validate best models'}
              </button>
            </div>

            <div class="mt-5 rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-4 py-4 text-sm text-sophia-dark-muted">
              {validationSummary}
            </div>

            {#if validationRan && validationResults.length > 0}
              <div class="mt-6 rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-5">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Recommended ranking</div>
                <div class="mt-3 space-y-3">
                  {#each validationResults as recommendation}
                    {@const recoMeta = modelMetadata(recommendation.model)}
                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 px-3 py-3">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="font-mono text-sm text-sophia-dark-text">
                          #{recommendation.rank} {recommendation.model}
                        </div>
                        <span class="rounded-full border border-sophia-dark-blue/35 bg-sophia-dark-blue/10 px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-blue">
                          {(recommendation.confidence * 100).toFixed(0)}% confidence
                        </span>
                      </div>
                      <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{recommendation.reason}</p>
                      <div class="mt-2 flex flex-wrap gap-2">
                        <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">
                          Context {recommendation.contextWindow}
                        </span>
                        <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">
                          Cost {recommendation.costTier}
                        </span>
                        {#if recoMeta.qualityTier}
                          <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">
                            Quality {recoMeta.qualityTier}
                          </span>
                        {/if}
                        <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">
                          Speed {recommendation.speed}
                        </span>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </section>

          <section class="setup-card rounded-xl border border-sophia-dark-border bg-sophia-dark-surface/95 p-6 md:p-8">
            <div class="mb-5 flex items-center justify-between gap-3">
              <h2 class="text-2xl font-serif text-sophia-dark-text">4. Review & proceed</h2>
              <span class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Final check</span>
            </div>

            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-5">
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Configuration summary</div>
              <div class="summary-list mt-4 divide-y divide-sophia-dark-border">
                <div class="summary-row py-3">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Source</div>
                  <div class="mt-1 text-sm text-sophia-dark-text break-all">
                    {sourceMode === 'url' ? sourceUrl || 'Not set' : sourceFileName || 'No file selected'}
                  </div>
                </div>
                <div class="summary-row py-3">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Route</div>
                  <div class="mt-1 text-sm text-sophia-dark-text">{(selectedRoute?.name ?? selectedRouteId) || 'Not selected'}</div>
                </div>
                <div class="summary-row py-3">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Model chain</div>
                  <div class="mt-1 text-sm text-sophia-dark-text">
                    {modelChain[0] || '—'} → {modelChain[1] || '—'} → {modelChain[2] || '—'}
                  </div>
                </div>
                <div class="summary-row py-3">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Failover</div>
                  <div class="mt-1 text-sm text-sophia-dark-text">
                    {FAILOVER_OPTIONS.find((option) => option.id === failoverAction)?.label}
                  </div>
                </div>
                <div class="summary-row py-3">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Estimated envelope</div>
                  <div class="mt-1 text-sm text-sophia-dark-text">~${estimatedCostUsd.toFixed(2)} · ~{estimatedDurationMinutes} min</div>
                </div>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onclick={() => void startPhaseOne()}
                disabled={!canStartPhaseOne}
                title={!canStartPhaseOne ? 'Complete source setup and a non-duplicated three-model chain before continuing.' : ''}
                class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-5 py-3 font-mono text-sm text-sophia-dark-sage hover:bg-sophia-dark-sage/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start Phase 1: Extraction →
              </button>
              <button
                type="button"
                onclick={saveDraft}
                class="rounded border border-sophia-dark-border px-4 py-3 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
              >
                Save as draft
              </button>
              {#if !canStartPhaseOne}
                <p class="w-full text-sm leading-6 text-sophia-dark-muted">
                  Complete source setup and fill all three model slots with distinct models to continue.
                </p>
              {/if}
              {#if lastDraftSavedAt}
                <span class="font-mono text-xs text-sophia-dark-dim">Draft saved {lastDraftSavedAt}</span>
              {/if}
            </div>
          </section>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .admin-ingestion {
    background:
      radial-gradient(920px 340px at 12% -4%, rgba(111, 163, 212, 0.06), transparent 74%),
      radial-gradient(860px 320px at 88% -4%, rgba(196, 168, 130, 0.06), transparent 74%),
      linear-gradient(180deg, rgba(13, 13, 13, 1), rgba(11, 11, 11, 1));
  }

  .admin-ingestion :is(input, select, button) {
    min-height: 2.75rem;
  }

  .help-tip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.15rem;
    height: 1.15rem;
    border: 1px solid rgba(140, 146, 168, 0.45);
    border-radius: 999px;
    font-family: var(--font-ui);
    font-size: 0.66rem;
    color: var(--color-dim);
    cursor: help;
  }
</style>
