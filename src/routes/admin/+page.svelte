<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { auth, getIdToken, onAuthChange } from '$lib/firebase';
  import {
    adminIngestionHomeShouldRedirectToQuickStart,
    consumeAdminQuickStartParams
  } from '$lib/admin/quickStartGate';
  import { resolveStageRoutes } from '$lib/utils/ingestionRouting';

  type PageState = 'loading' | 'ready' | 'forbidden';
  type RequestState = 'idle' | 'loading';
  type SourceMode = 'url' | 'file';
  type FailoverAction = 'switch_secondary' | 'switch_tertiary' | 'retry_primary_once' | 'pause_for_operator';
  const ADMIN_CONTEXT_TIMEOUT_MS = 15000;

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

  interface IngestionConfigPayload {
    sourceMode: SourceMode;
    sourceUrl: string;
    sourceFileName: string;
    sourceType: (typeof SOURCE_TYPES)[number]['id'];
    sourceTitle: string;
    sourceAuthor: string;
    sourcePublicationYear: string;
    sourceContentType: string;
    sourceContentBytes: number | null;
    sourceMetadataUrl: string;
    sourceMetadataUpdatedAt: string;
    selectedRouteId: string;
    modelChain: string[];
    failoverAction: FailoverAction;
    validationRan: boolean;
    validationSummary: string;
    validationResults: ValidationRecommendation[];
  }

  interface IngestionProfile {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    payload: IngestionConfigPayload;
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

  const INGESTION_STAGE_PREVIEW = [
    { id: 'ingestion_extraction', title: 'Extraction', description: 'Pull claims and source passages.' },
    { id: 'ingestion_relations', title: 'Relations', description: 'Connect support and dependency links.' },
    { id: 'ingestion_grouping', title: 'Grouping', description: 'Cluster recurring positions.' },
    { id: 'ingestion_validation', title: 'Validation', description: 'Check quality and confidence.' },
    { id: 'ingestion_embedding', title: 'Embedding', description: 'Prepare retrieval vectors.' },
    { id: 'ingestion_json_repair', title: 'JSON Repair', description: 'Clean malformed output before storage.' }
  ] as const;

  const INGESTION_PROFILES_STORAGE_KEY = 'sophia.admin.ingestion.profiles';
  const INGESTION_ACTIVE_PROFILE_KEY = 'sophia.admin.ingestion.active_profile';

  /** When Restormel route steps omit model IDs, validation still returns ranked labels — keep selects in sync. */
  const FALLBACK_CHAIN_MODEL_LABELS = [
    'anthropic · claude-3-5-sonnet-20241022',
    'anthropic · claude-sonnet-4-5-20250929',
    'openai · gpt-4o',
    'openai · gpt-4.1',
    'google · gemini-2.5-pro',
    'vertex · gemini-2.5-flash',
    'deepseek · deepseek-chat',
    'deepseek · deepseek-reasoner',
    'voyage · voyage-4',
    'voyage · voyage-3-lite'
  ] as const;

  let pageState = $state<PageState>('loading');
  let currentUserEmail = $state<string | null>(null);
  let errorMessage = $state('');
  let successMessage = $state('');

  let loadingContextState = $state<RequestState>('idle');
  let recommendingState = $state<RequestState>('idle');
  let launchRunState = $state<RequestState>('idle');

  let sourceMode = $state<SourceMode>('url');
  let sourceUrl = $state('');
  let sourceFile = $state<File | null>(null);
  let sourceFileName = $state('');
  let sourceType = $state<(typeof SOURCE_TYPES)[number]['id']>('sep_entry');
  let sourceTypeOverridden = $state(false);
  let sourceTitle = $state('');
  let sourceAuthor = $state('');
  let sourcePublicationYear = $state('');
  let sourceContentType = $state('');
  let sourceContentBytes = $state<number | null>(null);
  let sourceMetadataUrl = $state('');
  let sourceMetadataUpdatedAt = $state('');
  let sourceMetadataState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let sourceMetadataError = $state('');
  let sourceTitleTouched = $state(false);
  let sourceAuthorTouched = $state(false);
  let sourcePublicationYearTouched = $state(false);
  let lastSourceMetadataUrl = $state('');

  let firstStage = $state('ingestion_extraction');
  let routes = $state<RouteRecord[]>([]);
  /** When GET /routes fails, Restormel error detail (otherwise empty list looks like “no config”) */
  let routeContextError = $state<{ status: number; code: string; detail: string; endpoint?: string } | null>(
    null
  );
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
  let wizardStep = $state(1);
  let showPipelineLanding = $state(true);
  let ingestionProfiles = $state<IngestionProfile[]>([]);
  let activeProfileId = $state('');
  let activeProfileNameInput = $state('');
  let profilesHydrated = $state(false);
  let lastAutosavedSnapshot = $state('');

  const showCatalogSourceColumn = $derived.by(() =>
    modelCatalogEntries.some((r) => r.catalogSource)
  );

  /** Why "Validate best models" is disabled — show next to the button */
  const validateRouteHint = $derived.by((): string | null => {
    if (loadingContextState === 'loading') return 'Loading routes from Restormel…';
    if (routes.length === 0) {
      return 'No routes in this project — you can still run guide-only validation, or add routes via Ingestion Routing.';
    }
    if (!selectedRouteId) return 'Choose a route above — live validation calls the recommend API for that route.';
    return null;
  });

  const selectedRoute = $derived.by(
    () => routes.find((route) => route.id === selectedRouteId) ?? null
  );

  const activeProfile = $derived.by(
    () => ingestionProfiles.find((profile) => profile.id === activeProfileId) ?? null
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

  const sourceKnownBytes = $derived.by(() => {
    if (sourceMode === 'file') return sourceFile?.size ?? sourceContentBytes ?? null;
    const currentUrl = sourceUrl.trim();
    if (!currentUrl) return null;
    if (sourceMetadataState !== 'ready') return null;
    if (lastSourceMetadataUrl !== currentUrl) return null;
    return sourceContentBytes;
  });

  const sourceEstimatedTokens = $derived.by(() => {
    if (!sourceKnownBytes || sourceKnownBytes <= 0) return null;
    return Math.max(1, Math.round(sourceKnownBytes / 4));
  });

  const sourceKnownContentType = $derived.by(() => {
    if (sourceMode === 'file') return sourceFile?.type || sourceContentType || '';
    const currentUrl = sourceUrl.trim();
    if (!currentUrl || sourceMetadataState !== 'ready' || lastSourceMetadataUrl !== currentUrl) return '';
    return sourceContentType;
  });

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

  const stageRouteCoverage = $derived.by(() =>
    resolveStageRoutes(
      routes,
      INGESTION_STAGE_PREVIEW.map((stage) => stage.id),
      selectedRouteId
    )
  );

  const routedStageCount = $derived.by(
    () => stageRouteCoverage.filter((entry) => entry.mode !== 'missing').length
  );

  const allStagesHaveRouting = $derived.by(() => routedStageCount === INGESTION_STAGE_PREVIEW.length);

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

  const canStartIngestion = $derived.by(
    () => canStartPhaseOne && allStagesHaveRouting && launchRunState === 'idle'
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

  const canGoNextFromCurrentStep = $derived.by(() => {
    if (wizardStep === 1) return sourceReady;
    if (wizardStep === 2) return chainReady && duplicateModels.length === 0;
    if (wizardStep === 3) return true;
    return true;
  });

  const nextButtonHint = $derived.by((): string | null => {
    if (wizardStep === 1 && !sourceReady) {
      return 'Add a URL or file and set source type before continuing.';
    }
    if (wizardStep === 2) {
      if (!chainReady) return 'Choose a model for each slot.';
      if (duplicateModels.length > 0) return 'Use three distinct models.';
    }
    return null;
  });

  const remainingSteps = $derived.by(() => Math.max(0, 4 - wizardStep));

  function goWizardBack(): void {
    if (wizardStep <= 1) return;
    wizardStep -= 1;
  }

  function goWizardNext(): void {
    if (wizardStep >= 4) return;
    if (!canGoNextFromCurrentStep) return;
    wizardStep += 1;
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

  function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function normalizePublicationYear(input: string | null | undefined): string {
    const raw = (input ?? '').trim();
    if (!raw) return '';
    const match = raw.match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : '';
  }

  function extractYearFromUrl(url: string): string {
    return normalizePublicationYear(url);
  }

  function titleFromFilename(fileName: string): string {
    const stripped = fileName.replace(/\.[a-z0-9]+$/i, '').trim();
    if (!stripped) return '';
    return stripped
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function isInspectableHttpUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function seedSourceMetadataFromUrl(value: string): void {
    if (!isInspectableHttpUrl(value)) return;
    try {
      const parsed = new URL(value);
      if (!sourceTitleTouched || !sourceTitle.trim()) {
        sourceTitle = guessTitleFromUrl(parsed);
      }
      if (!sourcePublicationYearTouched || !sourcePublicationYear.trim()) {
        const guessedYear = extractYearFromUrl(value);
        if (guessedYear) sourcePublicationYear = guessedYear;
      }
    } catch {
      // ignore parsing failures
    }
  }

  async function inspectSourceMetadataFromUrl(force = false): Promise<void> {
    const url = sourceUrl.trim();
    if (!isInspectableHttpUrl(url)) return;
    if (!force && sourceMetadataState === 'loading') return;
    if (!force && url === sourceMetadataUrl && sourceMetadataUpdatedAt) return;
    sourceMetadataState = 'loading';
    sourceMetadataError = '';

    try {
      const body = await authorizedJson('/api/admin/ingestion-source/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const metadata = (body?.metadata ?? {}) as {
        title?: string;
        author?: string;
        publicationYear?: string;
        contentType?: string;
        contentLengthBytes?: number | null;
        finalUrl?: string;
        hostname?: string;
      };

      const nextTitle = typeof metadata.title === 'string' ? metadata.title.trim() : '';
      const nextAuthor = typeof metadata.author === 'string' ? metadata.author.trim() : '';
      const nextYear = normalizePublicationYear(metadata.publicationYear ?? '');

      if (!sourceTitleTouched || !sourceTitle.trim()) {
        sourceTitle = nextTitle || sourceTitle || '';
      }
      if (!sourceAuthorTouched || !sourceAuthor.trim()) {
        sourceAuthor = nextAuthor || sourceAuthor || '';
      }
      if (!sourcePublicationYearTouched || !sourcePublicationYear.trim()) {
        sourcePublicationYear = nextYear || sourcePublicationYear || '';
      }

      sourceContentType = typeof metadata.contentType === 'string' ? metadata.contentType : sourceContentType;
      sourceContentBytes =
        typeof metadata.contentLengthBytes === 'number' && Number.isFinite(metadata.contentLengthBytes)
          ? metadata.contentLengthBytes
          : sourceContentBytes;
      sourceMetadataUrl = typeof metadata.finalUrl === 'string' ? metadata.finalUrl : url;
      sourceMetadataUpdatedAt = new Date().toISOString();
      lastSourceMetadataUrl = url;
      sourceMetadataState = 'ready';
    } catch (error) {
      sourceMetadataState = 'error';
      sourceMetadataError =
        error instanceof Error
          ? error.message
          : 'Could not inspect source metadata from URL.';
    }
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
      const err = body.errors?.routes;
      routeContextError =
        err && typeof err === 'object' && typeof (err as { detail?: unknown }).detail === 'string'
          ? (err as { status: number; code: string; detail: string; endpoint?: string })
          : null;
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

  function loadAdminContextWithTimeout(timeoutMs = ADMIN_CONTEXT_TIMEOUT_MS): Promise<void> {
    return Promise.race([
      loadAdminContext(),
      new Promise<void>((_, reject) => {
        const timeoutId = window.setTimeout(() => {
          clearTimeout(timeoutId);
          reject(new Error('Admin context request timed out. Check auth/session and API connectivity, then retry.'));
        }, timeoutMs);
      })
    ]);
  }

  async function retryLoadAdminContext(): Promise<void> {
    errorMessage = '';
    successMessage = '';
    pageState = 'loading';
    try {
      await loadAdminContextWithTimeout();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load administrator context';
      pageState = 'ready';
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
    sourceMetadataError = '';
    sourceMetadataState = file ? 'ready' : 'idle';
    if (file) {
      sourceContentType = file.type || 'application/octet-stream';
      sourceContentBytes = file.size;
      sourceMetadataUrl = '';
      sourceMetadataUpdatedAt = new Date().toISOString();
      if (!sourceTitleTouched || !sourceTitle.trim()) {
        sourceTitle = titleFromFilename(file.name);
      }
      if (!sourcePublicationYearTouched || !sourcePublicationYear.trim()) {
        const fileYear = new Date(file.lastModified).getFullYear();
        sourcePublicationYear = fileYear >= 1900 ? String(fileYear) : sourcePublicationYear;
      }
    } else {
      sourceContentType = '';
      sourceContentBytes = null;
      sourceMetadataUpdatedAt = '';
    }
  }

  function applySuggestedChainFromHints(): void {
    const h = hintForSource;
    if (!h) return;
    modelChain = [h.budget, h.balanced, h.quality];
    wizardStep = 2;
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

  /** Rankings when Restormel has no routes — uses source-type hints when available */
  function buildLocalValidationWithoutRoute(): ValidationRecommendation[] {
    const h = hintForSource;
    if (h) {
      const rows = [
        { rank: 1 as const, model: h.budget, reason: 'Lowest-cost pick for this source type (guide).' },
        { rank: 2 as const, model: h.balanced, reason: 'Balanced pick for this source type (guide).' },
        { rank: 3 as const, model: h.quality, reason: 'Quality-first pick for this source type (guide).' }
      ];
      return rows.map((row) => {
        const meta = modelMetadata(row.model);
        return {
          rank: row.rank,
          model: row.model,
          confidence: Number((0.9 - (row.rank - 1) * 0.08).toFixed(2)),
          reason: row.reason,
          costTier: meta.costTier,
          speed: meta.speed,
          contextWindow: meta.contextWindow
        };
      });
    }
    return buildValidationRecommendations(
      'No Restormel routes and no source hints — using default catalog order.'
    );
  }

  async function runModelValidation(): Promise<void> {
    if (routes.length > 0 && !selectedRouteId) {
      errorMessage = 'Select a route before validation.';
      return;
    }

    if (routes.length === 0) {
      recommendingState = 'loading';
      errorMessage = '';
      successMessage = '';
      try {
        const summary =
          'No Restormel routes for this project — guide-only ranking (live recommend API needs a route).';
        validationSummary = summary;
        validationResults = buildLocalValidationWithoutRoute();
        validationRan = true;
        successMessage =
          'Generated guide-only rankings. Add routes in Restormel (or fix the routes API) to use live validation.';
        if (validationResults.length >= 3) {
          modelChain = [validationResults[0].model, validationResults[1].model, validationResults[2].model];
        }
      } finally {
        recommendingState = 'idle';
      }
      return;
    }

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

  function createConfigPayload(): IngestionConfigPayload {
    return {
      sourceMode,
      sourceUrl,
      sourceFileName,
      sourceType,
      sourceTitle,
      sourceAuthor,
      sourcePublicationYear,
      sourceContentType,
      sourceContentBytes,
      sourceMetadataUrl,
      sourceMetadataUpdatedAt,
      selectedRouteId,
      modelChain: [...modelChain],
      failoverAction,
      validationRan,
      validationSummary,
      validationResults: [...validationResults]
    };
  }

  function applyConfigPayload(payload: IngestionConfigPayload): void {
    sourceMode = payload.sourceMode === 'file' ? 'file' : 'url';
    sourceUrl = payload.sourceUrl ?? '';
    sourceFileName = payload.sourceFileName ?? '';
    if (SOURCE_TYPES.some((type) => type.id === payload.sourceType)) {
      sourceType = payload.sourceType;
    }
    sourceTitle = typeof payload.sourceTitle === 'string' ? payload.sourceTitle : '';
    sourceAuthor = typeof payload.sourceAuthor === 'string' ? payload.sourceAuthor : '';
    sourcePublicationYear = normalizePublicationYear(payload.sourcePublicationYear ?? '');
    sourceContentType = typeof payload.sourceContentType === 'string' ? payload.sourceContentType : '';
    sourceContentBytes =
      typeof payload.sourceContentBytes === 'number' && Number.isFinite(payload.sourceContentBytes)
        ? payload.sourceContentBytes
        : null;
    sourceMetadataUrl = typeof payload.sourceMetadataUrl === 'string' ? payload.sourceMetadataUrl : '';
    sourceMetadataUpdatedAt = typeof payload.sourceMetadataUpdatedAt === 'string' ? payload.sourceMetadataUpdatedAt : '';
    sourceTitleTouched = false;
    sourceAuthorTouched = false;
    sourcePublicationYearTouched = false;
    lastSourceMetadataUrl = sourceUrl.trim();
    selectedRouteId = payload.selectedRouteId ?? '';
    modelChain = [
      String(payload.modelChain?.[0] ?? ''),
      String(payload.modelChain?.[1] ?? ''),
      String(payload.modelChain?.[2] ?? '')
    ];
    if (FAILOVER_OPTIONS.some((option) => option.id === payload.failoverAction)) {
      failoverAction = payload.failoverAction;
    }
    validationRan = payload.validationRan === true;
    validationSummary =
      typeof payload.validationSummary === 'string'
        ? payload.validationSummary
        : 'Run validation to generate ranked model advice for this source.';
    validationResults = Array.isArray(payload.validationResults)
      ? payload.validationResults.map((row, idx) => ({
          rank: typeof row.rank === 'number' ? row.rank : idx + 1,
          model: String(row.model ?? ''),
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
        }))
      : [];
  }

  function profilePlaceholderName(): string {
    return `Ingestion config ${new Date().toLocaleDateString('en-GB')}`;
  }

  function loadProfilesFromStorage(): void {
    if (!browser) return;
    try {
      const raw = localStorage.getItem(INGESTION_PROFILES_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as IngestionProfile[]) : [];
      ingestionProfiles = Array.isArray(parsed) ? parsed : [];
      const savedActive = localStorage.getItem(INGESTION_ACTIVE_PROFILE_KEY) ?? '';
      activeProfileId =
        (savedActive && ingestionProfiles.some((profile) => profile.id === savedActive) ? savedActive : '') ||
        ingestionProfiles[0]?.id ||
        '';
      activeProfileNameInput =
        ingestionProfiles.find((profile) => profile.id === activeProfileId)?.name ?? '';
      const active = ingestionProfiles.find((profile) => profile.id === activeProfileId);
      if (active) {
        applyConfigPayload(active.payload);
        lastAutosavedSnapshot = JSON.stringify(active.payload);
      }
    } catch {
      ingestionProfiles = [];
      activeProfileId = '';
      activeProfileNameInput = '';
    } finally {
      profilesHydrated = true;
    }
  }

  function persistProfiles(): void {
    if (!browser) return;
    localStorage.setItem(INGESTION_PROFILES_STORAGE_KEY, JSON.stringify(ingestionProfiles));
    if (activeProfileId) {
      localStorage.setItem(INGESTION_ACTIVE_PROFILE_KEY, activeProfileId);
    }
  }

  function ensureActiveProfile(): void {
    if (activeProfileId && ingestionProfiles.some((profile) => profile.id === activeProfileId)) return;
    const now = new Date().toISOString();
    const created: IngestionProfile = {
      id: crypto.randomUUID(),
      name: profilePlaceholderName(),
      createdAt: now,
      updatedAt: now,
      payload: createConfigPayload()
    };
    ingestionProfiles = [created, ...ingestionProfiles];
    activeProfileId = created.id;
    activeProfileNameInput = created.name;
    persistProfiles();
  }

  function autosaveActiveProfile(): void {
    if (!browser || !profilesHydrated || pageState !== 'ready') return;
    ensureActiveProfile();
    if (!activeProfileId) return;

    const payload = createConfigPayload();
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastAutosavedSnapshot) return;
    lastAutosavedSnapshot = snapshot;

    ingestionProfiles = ingestionProfiles.map((profile) =>
      profile.id === activeProfileId
        ? {
            ...profile,
            updatedAt: new Date().toISOString(),
            payload
          }
        : profile
    );
    persistProfiles();
  }

  function renameActiveProfile(): void {
    if (!activeProfileId) return;
    const nextName = activeProfileNameInput.trim();
    if (!nextName) return;
    ingestionProfiles = ingestionProfiles.map((profile) =>
      profile.id === activeProfileId
        ? { ...profile, name: nextName, updatedAt: new Date().toISOString() }
        : profile
    );
    persistProfiles();
    successMessage = 'Config name updated.';
  }

  function createNewProfileFromCurrent(): void {
    const now = new Date().toISOString();
    const created: IngestionProfile = {
      id: crypto.randomUUID(),
      name: `${profilePlaceholderName()} (copy)`,
      createdAt: now,
      updatedAt: now,
      payload: createConfigPayload()
    };
    ingestionProfiles = [created, ...ingestionProfiles];
    activeProfileId = created.id;
    activeProfileNameInput = created.name;
    lastAutosavedSnapshot = JSON.stringify(created.payload);
    persistProfiles();
    successMessage = 'Created a reusable config copy.';
  }

  async function switchActiveProfile(profileId: string): Promise<void> {
    const profile = ingestionProfiles.find((entry) => entry.id === profileId);
    if (!profile) return;
    activeProfileId = profile.id;
    activeProfileNameInput = profile.name;
    applyConfigPayload(profile.payload);
    persistProfiles();
    showPipelineLanding = false;
    if (profile.payload.selectedRouteId) {
      await handleRouteChange(profile.payload.selectedRouteId);
    }
    successMessage = `Loaded config: ${profile.name}.`;
  }

  function saveDraft(): void {
    if (!browser) return;
    const payload = createConfigPayload();
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
      if (typeof draft === 'object' && draft !== null) {
        applyConfigPayload({
          sourceMode: draft.sourceMode === 'file' ? 'file' : 'url',
          sourceUrl: typeof draft.sourceUrl === 'string' ? draft.sourceUrl : '',
          sourceFileName: typeof draft.sourceFileName === 'string' ? draft.sourceFileName : '',
          sourceType:
            typeof draft.sourceType === 'string' &&
            SOURCE_TYPES.some((type) => type.id === draft.sourceType)
              ? (draft.sourceType as (typeof SOURCE_TYPES)[number]['id'])
              : sourceType,
          sourceTitle: typeof draft.sourceTitle === 'string' ? draft.sourceTitle : '',
          sourceAuthor: typeof draft.sourceAuthor === 'string' ? draft.sourceAuthor : '',
          sourcePublicationYear:
            typeof draft.sourcePublicationYear === 'string' ? draft.sourcePublicationYear : '',
          sourceContentType: typeof draft.sourceContentType === 'string' ? draft.sourceContentType : '',
          sourceContentBytes:
            typeof draft.sourceContentBytes === 'number' && Number.isFinite(draft.sourceContentBytes)
              ? draft.sourceContentBytes
              : null,
          sourceMetadataUrl: typeof draft.sourceMetadataUrl === 'string' ? draft.sourceMetadataUrl : '',
          sourceMetadataUpdatedAt:
            typeof draft.sourceMetadataUpdatedAt === 'string' ? draft.sourceMetadataUpdatedAt : '',
          selectedRouteId: typeof draft.selectedRouteId === 'string' ? draft.selectedRouteId : selectedRouteId,
          modelChain: Array.isArray(draft.modelChain)
            ? [String(draft.modelChain[0] ?? ''), String(draft.modelChain[1] ?? ''), String(draft.modelChain[2] ?? '')]
            : modelChain,
          failoverAction:
            typeof draft.failoverAction === 'string' &&
            FAILOVER_OPTIONS.some((option) => option.id === draft.failoverAction)
              ? (draft.failoverAction as FailoverAction)
              : failoverAction,
          validationRan: draft.validationRan === true,
          validationSummary:
            typeof draft.validationSummary === 'string'
              ? draft.validationSummary
              : 'Run validation to generate ranked model advice for this source.',
          validationResults: Array.isArray(draft.validationResults)
            ? (draft.validationResults as ValidationRecommendation[])
            : []
        });
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
    if (!canStartIngestion) return;
    if (sourceMode !== 'url' || !sourceUrl.trim()) {
      errorMessage = 'A source URL is required before starting ingestion.';
      return;
    }

    launchRunState = 'loading';
    errorMessage = '';
    successMessage = '';
    try {
      const body = await authorizedJson('/api/admin/ingest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_url: sourceUrl.trim(),
          source_type: sourceType,
          validate: true,
          model_chain: {
            extract: modelChain[0],
            relate: modelChain[1] || modelChain[0],
            group: modelChain[2] || modelChain[1] || modelChain[0],
            validate: modelChain[0]
          }
        })
      });
      const runId = typeof body?.run_id === 'string' ? body.run_id : '';
      if (!runId) {
        throw new Error('Could not start ingestion run.');
      }
      await goto(`/admin/ingest?monitor=1&runId=${encodeURIComponent(runId)}`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to start ingestion run.';
    } finally {
      launchRunState = 'idle';
    }
  }

  $effect(() => {
    if (sourceMode !== 'url') return;
    seedSourceMetadataFromUrl(sourceUrl);
    if (sourceTypeOverridden) return;
    const detected = detectSourceType(sourceUrl);
    if (detected) sourceType = detected;
  });

  $effect(() => {
    if (!browser) return;
    if (sourceMode !== 'url') return;
    const nextUrl = sourceUrl.trim();
    if (!isInspectableHttpUrl(nextUrl)) return;

    if (nextUrl !== lastSourceMetadataUrl) {
      sourceTitleTouched = false;
      sourceAuthorTouched = false;
      sourcePublicationYearTouched = false;
      lastSourceMetadataUrl = nextUrl;
    }

    const timer = window.setTimeout(() => {
      void inspectSourceMetadataFromUrl(false);
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  });

  $effect(() => {
    sourceMode;
    sourceUrl;
    sourceFileName;
    sourceType;
    sourceTitle;
    sourceAuthor;
    sourcePublicationYear;
    sourceContentType;
    sourceContentBytes;
    sourceMetadataUrl;
    sourceMetadataUpdatedAt;
    selectedRouteId;
    modelChain;
    failoverAction;
    validationRan;
    validationSummary;
    validationResults;
    autosaveActiveProfile();
  });

  onMount(() => {
    if (!browser) return;
    consumeAdminQuickStartParams();
    if (adminIngestionHomeShouldRedirectToQuickStart(window.location.search)) {
      void goto('/admin/quick-start', { replaceState: true });
      return;
    }
    loadProfilesFromStorage();

    const sync = async () => {
      if (!auth?.currentUser) {
        pageState = 'forbidden';
        await goto('/auth');
        return;
      }
      try {
        await loadAdminContextWithTimeout();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Failed to load administrator context';
        pageState = 'ready';
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
  <div class="admin-ingestion-shell mx-auto w-full max-w-[76rem] px-6 py-8 sm:px-10 sm:py-10 lg:px-14 xl:px-16">
    <header class="rounded-2xl border border-sophia-dark-border/80 bg-sophia-dark-surface/95 p-8 md:p-11">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full border border-sophia-dark-purple/40 bg-sophia-dark-purple/10 px-4 py-2.5 font-mono text-[0.75rem] font-medium uppercase tracking-[0.08em] leading-none text-sophia-dark-purple">
            Ingestion
          </span>
          <span
            class="rounded-full border border-sophia-dark-border px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.1em] leading-none text-sophia-dark-muted"
            title="Phase 1 prepares extraction. Phase 2 and 3 continue in Operations."
          >
            Phase 1 of 3: Extraction & Ingestion
          </span>
        </div>
        <nav class="flex flex-wrap items-center gap-6">
          <a href="/admin/quick-start" class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/12 px-3 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-sage/20">Quick start</a>
          <a href="/admin/operations" class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-surface">Operations Workbench</a>
          <a href="/admin/ingestion-routing" class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-surface">Ingestion Routing</a>
          <a href="/admin/review" class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-surface">Review Queue</a>
        </nav>
      </div>

      <h1 class="mt-4 text-[2.1rem] font-serif leading-[1.15] text-sophia-dark-text md:text-[2.45rem]">
        Configure ingestion and launch quickly
      </h1>
      <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
        Four clear steps: source, model chain, optional recommendation, then final review. You can move between tabs and always see what remains.
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
        <div class="mt-6 rounded-xl border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-5 py-4 font-mono text-sm text-sophia-dark-copper">
          <div>{errorMessage}</div>
          <button
            type="button"
            class="mt-3 rounded border border-sophia-dark-copper/40 bg-sophia-dark-bg/60 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-copper hover:bg-sophia-dark-copper/10"
            onclick={() => void retryLoadAdminContext()}
          >
            Retry loading admin context
          </button>
        </div>
      {/if}
      {#if successMessage}
        <div class="mt-6 rounded-xl border border-sophia-dark-sage/40 bg-sophia-dark-sage/10 px-4 py-3 font-mono text-sm text-sophia-dark-sage">
          {successMessage}
        </div>
      {/if}

      {#if showPipelineLanding}
      <section class="landing-panel mt-10 rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface/90 p-7 md:p-10">
        <div class="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Ingestion source</div>
            <h2 class="mt-2 font-serif text-3xl text-sophia-dark-text">Set your source before routing setup</h2>
            <p class="mt-3 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
              Provide a URL or upload a file, then confirm core metadata (title, author, year). Sophia can pull what it can automatically so you know scope and expected ingestion load before configuring the 6 stages.
            </p>
          </div>
          <div class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/60 px-5 py-3.5 text-xs text-sophia-dark-muted">
            Source mode:
            <span class="ml-1 font-mono text-sophia-dark-text">{sourceMode === 'url' ? 'URL' : 'File upload'}</span>
          </div>
        </div>

        <div class="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
          <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/55 p-5">
            <div class="inline-flex items-center gap-1 rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-1">
              <button
                type="button"
                class={`rounded border px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] ${sourceMode === 'url' ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/18 text-sophia-dark-text' : 'border-transparent text-sophia-dark-muted hover:border-sophia-dark-border'}`}
                onclick={() => (sourceMode = 'url')}
                aria-pressed={sourceMode === 'url'}
              >
                Paste URL
              </button>
              <span class="h-5 w-px bg-sophia-dark-border" aria-hidden="true"></span>
              <button
                type="button"
                class={`rounded border px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] ${sourceMode === 'file' ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/18 text-sophia-dark-text' : 'border-transparent text-sophia-dark-muted hover:border-sophia-dark-border'}`}
                onclick={() => (sourceMode = 'file')}
                aria-pressed={sourceMode === 'file'}
              >
                Browse file
              </button>
            </div>

            {#if sourceMode === 'url'}
              <div class="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label class="space-y-2">
                  <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Source URL</span>
                  <input
                    bind:value={sourceUrl}
                    type="url"
                    placeholder="https://plato.stanford.edu/entries/ethics-deontology/"
                    class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
                  />
                </label>
                <button
                  type="button"
                  onclick={() => void inspectSourceMetadataFromUrl(true)}
                  disabled={!isInspectableHttpUrl(sourceUrl.trim()) || sourceMetadataState === 'loading'}
                  class="rounded border border-sophia-dark-border px-4 py-3 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-40"
                >
                  {sourceMetadataState === 'loading' ? 'Pulling…' : 'Pull metadata'}
                </button>
              </div>

              {#if urlPreview}
                <div class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-4 py-3">
                  <div class="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Detected source</div>
                  <div class="mt-2 flex items-center gap-3">
                    <img src={urlPreview.favicon} alt="" class="h-5 w-5 rounded-sm" />
                    <div>
                      <div class="text-sm text-sophia-dark-text">{urlPreview.title}</div>
                      <div class="font-mono text-xs text-sophia-dark-muted">{urlPreview.domain}</div>
                    </div>
                  </div>
                </div>
              {/if}
            {:else}
              <div class="mt-5">
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

            <label class="mt-5 block space-y-2">
              <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Source type</span>
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
          </div>

          <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/55 p-5">
            <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Source metadata</div>
            <p class="mt-2 text-xs leading-5 text-sophia-dark-muted">
              You can edit all fields. Auto-fill updates only values you have not manually changed.
            </p>

            <div class="mt-4 space-y-3">
              <label class="block space-y-2">
                <span class="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Article title</span>
                <input
                  bind:value={sourceTitle}
                  type="text"
                  placeholder="Title"
                  class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 text-sm text-sophia-dark-text"
                  oninput={() => (sourceTitleTouched = true)}
                />
              </label>
              <label class="block space-y-2">
                <span class="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Author</span>
                <input
                  bind:value={sourceAuthor}
                  type="text"
                  placeholder="Author"
                  class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 text-sm text-sophia-dark-text"
                  oninput={() => (sourceAuthorTouched = true)}
                />
              </label>
              <label class="block space-y-2">
                <span class="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Publication year</span>
                <input
                  bind:value={sourcePublicationYear}
                  type="text"
                  inputmode="numeric"
                  placeholder="YYYY"
                  class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
                  oninput={() => {
                    sourcePublicationYearTouched = true;
                    sourcePublicationYear = normalizePublicationYear(sourcePublicationYear) || sourcePublicationYear.slice(0, 4);
                  }}
                />
              </label>
            </div>

            <div class="mt-5 rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/25 px-4 py-4">
              <div class="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Ingestion profile</div>
              <dl class="mt-3 grid grid-cols-1 gap-2 text-sm">
                <div class="flex items-center justify-between gap-3">
                  <dt class="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Type</dt>
                  <dd class="text-sophia-dark-text">{sourceTypeLabel}</dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Size</dt>
                  <dd class="font-mono text-sophia-dark-text">{formatBytes(sourceKnownBytes)}</dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Estimated tokens</dt>
                  <dd class="font-mono text-sophia-dark-text">{sourceEstimatedTokens ? `~${sourceEstimatedTokens.toLocaleString('en-GB')}` : 'Unknown'}</dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Content type</dt>
                  <dd class="font-mono text-sophia-dark-text">{sourceKnownContentType || 'Unknown'}</dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Metadata refreshed</dt>
                  <dd class="font-mono text-sophia-dark-text">
                    {sourceMetadataUpdatedAt ? new Date(sourceMetadataUpdatedAt).toLocaleString('en-GB') : 'Not yet'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        {#if sourceMetadataError}
          <div class="mt-4 rounded border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
            Metadata pull failed: {sourceMetadataError}
          </div>
        {/if}
      </section>

      <section class="landing-panel mt-10 rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface/90 p-7 md:p-10">
        <div class="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Preconfigured pipeline</div>
            <h2 class="mt-2 font-serif text-3xl text-sophia-dark-text">6-stage ingestion pipeline is ready</h2>
            <p class="mt-3 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
              Default settings are applied across all phases. Start quickly, then edit routing and model behavior per stage only where needed.
            </p>
          </div>
          <div class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/60 px-5 py-3.5 text-xs text-sophia-dark-muted">
            Routed stages:
            <span class="ml-1 font-mono text-sophia-dark-text">{routedStageCount} / {INGESTION_STAGE_PREVIEW.length}</span>
          </div>
        </div>

        <div class="mt-7 grid gap-4 md:grid-cols-2">
          {#each INGESTION_STAGE_PREVIEW as stage}
            {@const coverage = stageRouteCoverage.find((entry) => entry.stage === stage.id)}
            <article class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/45 p-5">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h3 class="font-serif text-xl text-sophia-dark-text">{stage.title}</h3>
                  <p class="mt-1 text-sm leading-6 text-sophia-dark-muted">{stage.description}</p>
                </div>
                {#if coverage?.mode === 'missing'}
                  <span class="rounded-full border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-2.5 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-sophia-dark-copper">
                    Needs route
                  </span>
                {:else if coverage?.mode === 'dedicated'}
                  <span class="rounded-full border border-sophia-dark-sage/35 bg-sophia-dark-sage/10 px-2.5 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-sophia-dark-sage">
                    Dedicated
                  </span>
                {:else}
                  <span class="rounded-full border border-sophia-dark-blue/35 bg-sophia-dark-blue/10 px-2.5 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-sophia-dark-blue">
                    Shared
                  </span>
                {/if}
              </div>
              <div class="mt-4 flex items-center justify-between gap-3 border-t border-sophia-dark-border pt-4">
                <div class="font-mono text-xs text-sophia-dark-dim">
                  Route: {(coverage?.route?.name ?? coverage?.route?.id) || 'Not configured'}
                </div>
                <a
                  href={`/admin/ingestion-routing?mode=quick&stage=${stage.id}`}
                  class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
                >
                  Edit stage
                </a>
              </div>
            </article>
          {/each}
        </div>

        <div class="mt-7 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/60 p-5 md:p-6">
          <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Launch</div>
          <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
            Once all six stages are routed, press Start to launch ingestion and move to live monitor mode.
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onclick={() => void startPhaseOne()}
              class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-5 py-3 font-mono text-sm text-sophia-dark-sage hover:bg-sophia-dark-sage/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canStartIngestion}
            >
              {launchRunState === 'loading' ? 'Starting…' : 'Start'}
            </button>
            {#if !allStagesHaveRouting}
              <p class="text-xs text-sophia-dark-copper">
                Route each stage first. {INGESTION_STAGE_PREVIEW.length - routedStageCount} stage{INGESTION_STAGE_PREVIEW.length - routedStageCount === 1 ? '' : 's'} still need routing.
              </p>
            {/if}
          </div>
        </div>
      </section>
      {:else}
      <div class="mt-10 rounded-xl border border-sophia-dark-border bg-sophia-dark-surface/80 p-4">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
            Step {wizardStep} of 4
          </div>
          <div class="text-xs text-sophia-dark-dim">
            {remainingSteps === 0 ? 'Final review ready' : `${remainingSteps} step${remainingSteps === 1 ? '' : 's'} remaining`}
          </div>
        </div>
        <div class="h-1.5 w-full rounded-full bg-sophia-dark-bg/60">
          <div
            class="h-1.5 rounded-full bg-sophia-dark-purple transition-all"
            style={`width: ${(wizardStep / 4) * 100}%`}
          ></div>
        </div>
        <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {#each setupSteps as step, idx}
          <button
            type="button"
            onclick={() => (wizardStep = idx + 1)}
            class={`rounded-lg border px-4 py-3 text-left ${wizardStep === idx + 1 ? 'border-sophia-dark-purple/50 bg-sophia-dark-purple/12' : 'border-sophia-dark-border bg-sophia-dark-bg/40 hover:border-sophia-dark-border'}`}
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Step {idx + 1}</span>
              <span
                class={`rounded-full border px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.12em] ${step.complete ? 'border-sophia-dark-sage/40 bg-sophia-dark-sage/10 text-sophia-dark-sage' : 'border-sophia-dark-border bg-sophia-dark-surface-raised text-sophia-dark-muted'}`}
              >
                {step.complete ? '✓' : '•'}
              </span>
            </div>
            <div class="mt-1 font-serif text-base text-sophia-dark-text">{step.title}</div>
            <div class="mt-0.5 text-xs leading-snug text-sophia-dark-muted">{step.subtitle}</div>
          </button>
        {/each}
        </div>
      </div>

      <div class="mt-6 flex w-full flex-col gap-6">
        <div class="min-w-0 flex-1 space-y-6">
          {#if wizardStep === 1}
          <section class="setup-card rounded-xl border border-sophia-dark-border bg-sophia-dark-surface/95 p-6 md:p-8">
            <div class="mb-5 flex items-center justify-between gap-3">
              <h2 class="text-2xl font-serif text-sophia-dark-text">1. Source input</h2>
              <span class="help-tip" title="Pick exactly one source mode. URL mode fetches from a link. File mode uses a local upload for this run setup.">ⓘ</span>
            </div>

            <div class="inline-flex items-center gap-1 rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-1">
              <button
                type="button"
                class={`rounded border px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] ${sourceMode === 'url' ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/18 text-sophia-dark-text' : 'border-transparent text-sophia-dark-muted hover:border-sophia-dark-border'}`}
                onclick={() => (sourceMode = 'url')}
                aria-pressed={sourceMode === 'url'}
              >
                Paste URL
              </button>
              <span class="h-5 w-px bg-sophia-dark-border" aria-hidden="true"></span>
              <button
                type="button"
                class={`rounded border px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] ${sourceMode === 'file' ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/18 text-sophia-dark-text' : 'border-transparent text-sophia-dark-muted hover:border-sophia-dark-border'}`}
                onclick={() => (sourceMode = 'file')}
                aria-pressed={sourceMode === 'file'}
              >
                Browse File
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
        {:else if wizardStep === 2}
          <section class="setup-card rounded-xl border border-sophia-dark-border bg-sophia-dark-surface/95 p-6 md:p-8">
            <div class="mb-5 flex items-center justify-between gap-3">
              <h2 class="text-2xl font-serif text-sophia-dark-text">2. Model chain & failover</h2>
              <span class="help-tip" title="Model chain order defines fallback progression: Model 1 fails -> Model 2 -> Model 3.">ⓘ</span>
            </div>

            <p class="mb-5 text-sm leading-6 text-sophia-dark-muted">
              This is the main control: choose each slot from the groups below (your route, then the full reference catalog). The Recommend tab only adds an optional Restormel ranking — it does not unlock these dropdowns.
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
        {:else if wizardStep === 3}
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
                  <p class="mt-3 text-xs leading-5 text-sophia-dark-dim">
                    This button fills Model 1–3 on the Model chain tab with the three lines above (cost → balanced → quality) and switches you to that tab. It does not talk to Restormel.
                  </p>
                  <button
                    type="button"
                    class="mt-4 rounded border border-sophia-dark-sage/40 bg-sophia-dark-sage/12 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-sage hover:bg-sophia-dark-sage/18"
                    onclick={() => applySuggestedChainFromHints()}
                  >
                    Apply suggested picks to model chain (tab 2)
                  </button>
                </div>
              {/if}
            </details>

            {#if routes.length === 0 && loadingContextState === 'idle'}
              <div class="mb-5 space-y-3 rounded-lg border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 text-sm text-sophia-dark-muted">
                <p>
                  The route list is empty — either no routes are configured in Restormel for this project, or the
                  <span class="font-mono text-sophia-dark-text">GET …/routes</span> call failed.
                </p>
                {#if routeContextError}
                  <p class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-bg/80 px-3 py-2 font-mono text-xs text-sophia-dark-copper">
                    API error ({routeContextError.status} {routeContextError.code}): {routeContextError.detail}
                    {#if routeContextError.endpoint}
                      <span class="block mt-1 text-sophia-dark-dim">{routeContextError.endpoint}</span>
                    {/if}
                  </p>
                {/if}
                {#if routeContextError?.code === 'upstream_non_json'}
                  <p class="text-xs leading-relaxed text-sophia-dark-muted">
                    Sophia appends <span class="font-mono">/api</span> to the Keys dashboard base. If
                    <span class="font-mono">RESTORMEL_KEYS_BASE</span> is only the site origin (e.g.
                    <span class="font-mono">https://restormel.dev</span>), the request hits the wrong path and the
                    server returns an HTML error page. Use
                    <span class="font-mono">https://restormel.dev/keys/dashboard</span> (or redeploy with the latest
                    server, which normalizes bare origins automatically).
                  </p>
                {/if}
                <p>
                  <a
                    href="/admin/ingestion-routing"
                    class="font-mono text-sophia-dark-text underline underline-offset-2 hover:text-sophia-dark-sage"
                    >Ingestion Routing</a>
                  or the Restormel Dashboard / CLI to create routes and steps. Meanwhile, use the button below for
                  Sophia’s guide-only ranking (no Restormel route required).
                </p>
                <button
                  type="button"
                  class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                  onclick={() => void loadIngestionContext()}
                >
                  Retry loading routes
                </button>
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
                disabled={loadingContextState === 'loading' ||
                  recommendingState === 'loading' ||
                  (routes.length > 0 && !selectedRouteId)}
                onclick={() => void runModelValidation()}
              >
                {recommendingState === 'loading'
                  ? 'Validating…'
                  : routes.length === 0
                    ? 'Guide-only validate'
                    : 'Validate best models'}
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
        {:else}
          <section class="setup-card rounded-xl border border-sophia-dark-border bg-sophia-dark-surface/95 p-6 md:p-8">
            <div class="mb-5 flex items-center justify-between gap-3">
              <h2 class="text-2xl font-serif text-sophia-dark-text">4. Review & proceed</h2>
              <span class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Final check</span>
            </div>

            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-5">
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Configuration summary</div>
              <dl class="gov-summary-list mt-4">
                <div class="gov-summary-list__row">
                  <dt class="gov-summary-list__key">Config profile</dt>
                  <dd class="gov-summary-list__value">{activeProfile?.name ?? 'Auto-saved config'}</dd>
                  <dd class="gov-summary-list__actions">
                    <button type="button" class="summary-action" onclick={() => (showPipelineLanding = true)}>Manage</button>
                  </dd>
                </div>
                <div class="gov-summary-list__row">
                  <dt class="gov-summary-list__key">Source</dt>
                  <dd class="gov-summary-list__value break-all">{sourceMode === 'url' ? sourceUrl || 'Not set' : sourceFileName || 'No file selected'}</dd>
                  <dd class="gov-summary-list__actions">
                    <button type="button" class="summary-action" onclick={() => (wizardStep = 1)}>Change</button>
                  </dd>
                </div>
                <div class="gov-summary-list__row">
                  <dt class="gov-summary-list__key">Source metadata</dt>
                  <dd class="gov-summary-list__value">
                    {sourceTitle || 'Untitled source'}
                    {#if sourceAuthor}
                      · {sourceAuthor}
                    {/if}
                    {#if sourcePublicationYear}
                      · {sourcePublicationYear}
                    {/if}
                  </dd>
                  <dd class="gov-summary-list__actions">
                    <button type="button" class="summary-action" onclick={() => (showPipelineLanding = true)}>Edit</button>
                  </dd>
                </div>
                <div class="gov-summary-list__row">
                  <dt class="gov-summary-list__key">Route</dt>
                  <dd class="gov-summary-list__value">{(selectedRoute?.name ?? selectedRouteId) || 'Not selected'}</dd>
                  <dd class="gov-summary-list__actions">
                    <button type="button" class="summary-action" onclick={() => (wizardStep = 3)}>Change</button>
                  </dd>
                </div>
                <div class="gov-summary-list__row">
                  <dt class="gov-summary-list__key">Model chain</dt>
                  <dd class="gov-summary-list__value">{modelChain[0] || '—'} → {modelChain[1] || '—'} → {modelChain[2] || '—'}</dd>
                  <dd class="gov-summary-list__actions">
                    <button type="button" class="summary-action" onclick={() => (wizardStep = 2)}>Change</button>
                  </dd>
                </div>
                <div class="gov-summary-list__row">
                  <dt class="gov-summary-list__key">Failover</dt>
                  <dd class="gov-summary-list__value">{FAILOVER_OPTIONS.find((option) => option.id === failoverAction)?.label}</dd>
                  <dd class="gov-summary-list__actions">
                    <button type="button" class="summary-action" onclick={() => (wizardStep = 2)}>Change</button>
                  </dd>
                </div>
                <div class="gov-summary-list__row">
                  <dt class="gov-summary-list__key">Estimated envelope</dt>
                  <dd class="gov-summary-list__value">~${estimatedCostUsd.toFixed(2)} · ~{estimatedDurationMinutes} min</dd>
                  <dd class="gov-summary-list__actions"></dd>
                </div>
              </dl>
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
          {/if}

          <div class="flex flex-col gap-4 border-t border-sophia-dark-border/50 pt-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <button
              type="button"
              onclick={goWizardBack}
              disabled={wizardStep === 1}
              class="rounded border border-sophia-dark-border px-4 py-3 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Back
            </button>
            <div class="flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:max-w-md sm:flex-row sm:items-center sm:justify-end">
              {#if nextButtonHint && wizardStep < 4}
                <p class="text-xs leading-5 text-sophia-dark-dim sm:mr-2 sm:text-right">{nextButtonHint}</p>
              {/if}
              {#if wizardStep < 4}
                <button
                  type="button"
                  onclick={goWizardNext}
                  disabled={!canGoNextFromCurrentStep}
                  class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-5 py-3 font-mono text-sm text-sophia-dark-text hover:bg-sophia-dark-purple/24 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue →
                </button>
              {/if}
            </div>
          </div>
        </div>
      </div>
      {/if}
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

  .admin-ingestion-shell {
    padding-bottom: 3rem;
  }

  .landing-panel {
    max-width: 76rem;
    margin-inline: auto;
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

  .gov-summary-list {
    margin: 0;
    border-top: 1px solid rgba(140, 146, 168, 0.28);
  }

  .gov-summary-list__row {
    display: grid;
    grid-template-columns: minmax(8rem, 12rem) minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: start;
    padding: 0.85rem 0;
    border-bottom: 1px solid rgba(140, 146, 168, 0.28);
  }

  .gov-summary-list__key {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-dim);
  }

  .gov-summary-list__value {
    font-size: 0.95rem;
    color: var(--color-text);
  }

  .gov-summary-list__actions {
    text-align: right;
  }

  .summary-action {
    min-height: auto;
    border: 1px solid rgba(140, 146, 168, 0.45);
    border-radius: 0.35rem;
    padding: 0.2rem 0.55rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--color-text);
    background: rgba(20, 20, 20, 0.7);
  }

  .summary-action:hover {
    background: rgba(33, 33, 33, 0.9);
  }

  @media (max-width: 720px) {
    .admin-ingestion-shell {
      padding-inline: 1.25rem;
    }

    .admin-ingestion header {
      padding: 1.25rem;
    }

    .landing-panel {
      padding: 1.25rem;
    }

    .gov-summary-list__row {
      grid-template-columns: 1fr;
      gap: 0.45rem;
    }

    .gov-summary-list__actions {
      text-align: left;
    }
  }
</style>
