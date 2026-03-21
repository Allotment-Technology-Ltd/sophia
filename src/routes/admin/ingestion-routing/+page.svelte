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
  import {
    BYOK_PROVIDER_ORDER,
    PROVIDER_UI_META,
    parseByokProvider,
    type ByokProvider
  } from '$lib/types/providers';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

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

  interface RouteRankingEntry {
    rank: number;
    providerType: string;
    modelId: string;
    display: string;
    confidence?: number;
    rationale?: string;
    contextWindow?: string;
    costTier?: 'low' | 'medium' | 'high';
    speed?: 'fast' | 'balanced' | 'thorough';
    estimatedCostUsd?: number;
  }

  interface RouteRecommendationPayload {
    support?: { available?: boolean; reason?: string };
    recommendation?: {
      recommendedAction?: string;
      reason?: string;
      estimatedImpact?: string;
      rankings?: RouteRankingEntry[];
      simulation?: Record<string, unknown> | null;
    } | null;
  }

  interface StageModelCatalogEntry {
    label: string;
    provider: string;
    modelId: string;
    costTier: 'low' | 'medium' | 'high';
    qualityTier: 'capable' | 'strong' | 'frontier';
    speed: 'fast' | 'balanced' | 'thorough';
    contextWindow: string;
    bestFor: string;
    catalogSource?: 'annotated' | 'remote' | 'static_supplement';
  }

  interface QuickStageModelSelection {
    provider: string;
    modelId: string;
  }

  interface QuickStageRecommendation extends QuickStageModelSelection {
    rationale: string;
    costTier: StageModelCatalogEntry['costTier'];
    qualityTier: StageModelCatalogEntry['qualityTier'];
    speed: StageModelCatalogEntry['speed'];
    catalogSource?: StageModelCatalogEntry['catalogSource'];
  }

  interface StageModelGuidance {
    why: string;
    focusAreas: string[];
    slotRationale: [string, string, string];
  }

  interface ByokProviderStatus {
    provider: ByokProvider;
    configured: boolean;
    status: 'not_configured' | 'pending_validation' | 'active' | 'invalid' | 'revoked';
    fingerprint_last8: string | null;
    validated_at: string | null;
    updated_at: string | null;
    last_error: string | null;
  }

  type PageState = 'loading' | 'ready' | 'forbidden';
  type RouteCoverageMode = 'dedicated' | 'shared' | 'missing';
  type BusyAction =
    | ''
    | 'context'
    | 'steps'
    | 'history'
    | 'bulk-assign'
    | 'mcp-setup'
    | 'save-route'
    | 'save-steps'
    | 'simulate'
    | 'resolve'
    | 'publish'
    | 'rollback';
  type EditorTab = 'configure' | 'simulate' | 'probe';
  type JourneyStep = 1 | 2 | 3 | 4;
  type IngestionObjective = 'lowest_cost' | 'balanced' | 'highest_quality';

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

  const STAGE_MODEL_GUIDANCE: Record<string, StageModelGuidance> = {
    ingestion_extraction: {
      why: 'Extraction quality drives every downstream phase. If claims are wrong or incomplete here, relations and validation drift.',
      focusAreas: ['Accuracy on dense passages', 'Structured output reliability', 'Reasonable spend for long documents'],
      slotRationale: [
        'Primary: strong balanced model for faithful claim extraction.',
        'Fallback 1: faster lower-cost model to keep throughput stable.',
        'Fallback 2: highest-quality safety net for difficult OCR or ambiguous passages.'
      ]
    },
    ingestion_relations: {
      why: 'Relations is reasoning-heavy. Weak model choice here creates false links and misses important dependencies.',
      focusAreas: ['Reasoning depth', 'Consistency across long context', 'Controlled fallback cost'],
      slotRationale: [
        'Primary: reasoning-first model for support/tension mapping.',
        'Fallback 1: lower-cost backup for straightforward relation patterns.',
        'Fallback 2: stronger reasoning fallback for ambiguous edge cases.'
      ]
    },
    ingestion_grouping: {
      why: 'Grouping decides how arguments are clustered. Poor clustering hurts retrieval, review, and final synthesis quality.',
      focusAreas: ['Semantic clustering quality', 'Cost control at scale', 'Context coverage'],
      slotRationale: [
        'Primary: balanced model for semantic grouping quality.',
        'Fallback 1: lower-cost route for simpler recurring pattern detection.',
        'Fallback 2: higher-quality fallback for noisy or mixed-position corpora.'
      ]
    },
    ingestion_validation: {
      why: 'Validation is the confidence gate before storage. Better models reduce false positives and missed defects.',
      focusAreas: ['Error detection precision', 'Confidence calibration', 'Safe final fallback'],
      slotRationale: [
        'Primary: strong validator for confidence and evidence checks.',
        'Fallback 1: low-cost monitor for routine validations.',
        'Fallback 2: higher-depth fallback for high-risk validation failures.'
      ]
    },
    ingestion_embedding: {
      why: 'Embedding-stage calls are high-volume. Cost and context window matter more than frontier reasoning depth.',
      focusAreas: ['Token cost efficiency', 'Throughput and latency', 'Long-context handling'],
      slotRationale: [
        'Primary: fast low-cost model for volume-heavy embedding-adjacent prep.',
        'Fallback 1: low-cost secondary path to protect throughput.',
        'Fallback 2: stronger long-context fallback when chunk complexity increases.'
      ]
    },
    ingestion_json_repair: {
      why: 'JSON repair is mostly deterministic cleanup. Fast, structured-output models usually outperform expensive frontier choices.',
      focusAreas: ['Structured output stability', 'Low latency', 'Low per-request cost'],
      slotRationale: [
        'Primary: cost-efficient model tuned for fast structured repair.',
        'Fallback 1: secondary low-cost fixer when primary is unavailable.',
        'Fallback 2: stronger fallback for stubborn malformed outputs.'
      ]
    }
  };

  let pageState = $state<PageState>('loading');
  let currentUserEmail = $state<string | null>(null);
  let pageError = $state('');
  let pageMessage = $state('');
  let busyAction = $state<BusyAction>('');
  let editorTab = $state<EditorTab>('configure');
  let journeyStep = $state<JourneyStep>(1);

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
  let recommendationState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let recommendationSummary = $state('');
  let recommendationRankings = $state<RouteRankingEntry[]>([]);
  let recommendationError = $state('');
  let ingestionObjective = $state<IngestionObjective>('balanced');
  let defaultRouteId = $state<string>('');
  let pendingStageFromQuery = $state<string | null>(null);
  let quickStageMode = $state(false);
  let quickRouteDraftName = $state('');
  let stageModelCatalog = $state<StageModelCatalogEntry[]>([]);
  let quickModelSelections = $state<QuickStageModelSelection[]>([
    { provider: '', modelId: '' },
    { provider: '', modelId: '' },
    { provider: '', modelId: '' }
  ]);
  let byokProviders = $state<ByokProviderStatus[]>([]);
  let byokInputs = $state<Record<ByokProvider, string>>(emptyByokMap(''));
  let byokSaving = $state<Record<ByokProvider, boolean>>(emptyByokMap(false));
  let byokError = $state('');
  let byokMessage = $state('');
  let byokLoading = $state(false);
  let byokLoaded = $state(false);
  let showByokInlineSetup = $state(false);
  let showCreateRouteInline = $state(false);
  let quickRenameRouteName = $state('');
  let quickDefaultsInfo = $state('');

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

  const objectiveHelpText = $derived.by(() => {
    if (ingestionObjective === 'lowest_cost') return 'Prioritize lower-cost model and route behavior first.';
    if (ingestionObjective === 'highest_quality') return 'Prioritize highest quality and robustness first.';
    return 'Balance quality, speed, and spend for general ingestion.';
  });

  const stageRoutingSummary = $derived.by(() => {
    const total = routeStageCoverage.length;
    const overridden = routeStageCoverage.filter((entry) => {
      const routeId = entry.route?.id ?? '';
      return Boolean(defaultRouteId) && Boolean(routeId) && routeId !== defaultRouteId;
    }).length;
    const inherited = total - overridden;
    return { total, overridden, inherited };
  });

  const quickStageRequirementSummary = $derived.by(() => {
    const stage = selectedCoverageEntry?.stage ?? selectedStage;
    if (stage === 'ingestion_extraction') return 'Curated for extraction accuracy and robust parsing.';
    if (stage === 'ingestion_relations') return 'Curated for relationship reasoning and consistency.';
    if (stage === 'ingestion_grouping') return 'Curated for clustering quality and argument coherence.';
    if (stage === 'ingestion_validation') return 'Curated for confidence checks and stricter validation logic.';
    if (stage === 'ingestion_embedding') return 'Curated for throughput, context capacity, and lower-cost embedding-adjacent work.';
    if (stage === 'ingestion_json_repair') return 'Curated for fast, structured JSON repair and format correction.';
    return 'Curated for the selected stage.';
  });

  const quickStageModelGuidance = $derived.by(() => {
    const stage = selectedCoverageEntry?.stage ?? selectedStage;
    return stage ? STAGE_MODEL_GUIDANCE[stage] ?? null : null;
  });

  const curatedStageCatalog = $derived.by(() => {
    const stage = selectedCoverageEntry?.stage ?? selectedStage;
    const scored = stageModelCatalog.map((entry) => ({
      entry,
      score: scoreStageModel(entry, stage)
    }));
    return scored
      .sort((a, b) => b.score - a.score || a.entry.provider.localeCompare(b.entry.provider) || a.entry.modelId.localeCompare(b.entry.modelId))
      .map((row) => row.entry)
      .slice(0, 18);
  });

  const quickProviderOptions = $derived.by(() =>
    Array.from(
      new Set([
        ...curatedStageCatalog.map((entry) => entry.provider),
        ...quickStageRecommendations.map((entry) => entry.provider),
        ...quickModelSelections.map((entry) => entry.provider)
      ].filter((value) => value.trim().length > 0))
    ).sort((a, b) => a.localeCompare(b))
  );

  const quickStageLiveRecommendations = $derived.by(() => {
    if (recommendationRankings.length === 0) return [] as QuickStageRecommendation[];
    return recommendationRankings
      .slice(0, 3)
      .map((ranking, index) => {
        const modelId = ranking.modelId ?? '';
        const providerFromRanking = ranking.providerType ?? '';
        const normalizedFromRanking = normalizeStageProviderToByok(providerFromRanking);
        const inferredProvider = inferProviderForModelId(modelId);
        const provider =
          normalizedFromRanking
            ? providerFromRanking
            : inferredProvider || providerFromRanking;

        return {
          provider,
          modelId,
          rationale:
            ranking.rationale ??
            (index === 0
              ? 'Primary recommendation from live routing analysis.'
              : index === 1
                ? 'First fallback from live routing analysis.'
                : 'Second fallback from live routing analysis.'),
          costTier: ranking.costTier ?? 'medium',
          qualityTier: 'strong',
          speed: ranking.speed ?? 'balanced',
          catalogSource: 'remote'
        } satisfies QuickStageRecommendation;
      })
      .filter((entry) => entry.modelId.trim().length > 0);
  });

  const quickStageRecommendations = $derived.by(() => {
    const live = quickStageLiveRecommendations.filter(
      (entry) => entry.provider.trim().length > 0 && entry.modelId.trim().length > 0
    );
    if (live.length > 0) return live;
    return recommendQuickChainForStage(selectedCoverageEntry?.stage ?? selectedStage);
  });

  const quickPrimarySelectionReady = $derived.by(
    () => quickModelSelections[0]?.provider.trim().length > 0 && quickModelSelections[0]?.modelId.trim().length > 0
  );

  const byokStatusByProvider = $derived.by(
    () => new Map(byokProviders.map((status) => [status.provider, status]))
  );

  const enabledByokProviderSet = $derived.by(() =>
    new Set(byokProviders.map((status) => status.provider))
  );

  const requiredByokProvidersForQuickStage = $derived.by(() => {
    const required = new Set<ByokProvider>();
    for (const selection of quickModelSelections) {
      const modelId = selection.modelId.trim();
      if (!modelId) continue;
      const provider =
        normalizeStageProviderToByok(selection.provider) ??
        normalizeStageProviderToByok(inferProviderForModelId(modelId));
      if (provider) required.add(provider);
    }
    return BYOK_PROVIDER_ORDER.filter((provider) => required.has(provider));
  });

  const unavailableByokProvidersForQuickStage = $derived.by(() => {
    if (!byokLoaded || byokError) return [];
    return requiredByokProvidersForQuickStage.filter((provider) => !enabledByokProviderSet.has(provider));
  });

  const missingByokProvidersForQuickStage = $derived.by(() => {
    if (!byokLoaded) return [];
    return requiredByokProvidersForQuickStage.filter((provider) => {
      if (!enabledByokProviderSet.has(provider)) return false;
      const status = byokStatusByProvider.get(provider);
      return !status || status.status !== 'active';
    });
  });

  const activeQuickStage = $derived.by(
    () => selectedCoverageEntry?.stage ?? selectedStage ?? stageList[0] ?? null
  );

  const activeQuickStageIndex = $derived.by(
    () => (activeQuickStage ? stageList.indexOf(activeQuickStage) : -1)
  );

  const canGoPrevQuickStage = $derived.by(() => activeQuickStageIndex > 0);
  const canGoNextQuickStage = $derived.by(
    () => activeQuickStageIndex >= 0 && activeQuickStageIndex < stageList.length - 1
  );
  const isFinalQuickStage = $derived.by(
    () => activeQuickStageIndex >= 0 && activeQuickStageIndex === stageList.length - 1
  );

  const journeySteps = [
    { id: 1 as const, title: 'Stage mapping', subtitle: 'Choose stage and route coverage' },
    { id: 2 as const, title: 'Route setup', subtitle: 'Create/edit route and step chain' },
    { id: 3 as const, title: 'Validate', subtitle: 'Simulate + resolve probe' },
    { id: 4 as const, title: 'Review & publish', subtitle: 'Final check and commit' }
  ] satisfies Array<{ id: JourneyStep; title: string; subtitle: string }>;

  const stageMappingReady = $derived.by(() => Boolean(selectedCoverageEntry?.stage));
  const routeSetupReady = $derived.by(() => Boolean(selectedRouteId));
  const validationReady = $derived.by(() => Boolean(simulationResult || resolveResult));

  const canGoNextFromJourneyStep = $derived.by(() => {
    if (journeyStep === 1) return stageMappingReady;
    if (journeyStep === 2) return routeSetupReady;
    if (journeyStep === 3) return validationReady;
    return true;
  });

  const journeyHint = $derived.by((): string | null => {
    if (journeyStep === 1 && !stageMappingReady) {
      return 'Select a stage card to anchor the route workspace.';
    }
    if (journeyStep === 2 && !routeSetupReady) {
      return 'Create or select a route before moving to validation.';
    }
    if (journeyStep === 3 && !validationReady) {
      return 'Run simulation or resolve probe to verify routing behaviour.';
    }
    return null;
  });

  const remainingJourneySteps = $derived.by(() => Math.max(0, 4 - journeyStep));

  function goJourneyBack(): void {
    if (journeyStep <= 1) return;
    journeyStep = (journeyStep - 1) as JourneyStep;
  }

  function goJourneyNext(): void {
    if (journeyStep >= 4) return;
    if (!canGoNextFromJourneyStep) return;
    journeyStep = (journeyStep + 1) as JourneyStep;
  }

  function stageTitle(stage: string | null | undefined): string {
    if (!stage) return 'Shared route';
    return STAGE_LABELS[stage] ?? stage.replace(/^ingestion_/, '').replaceAll('_', ' ');
  }

  function stageDescription(stage: string | null | undefined): string {
    if (!stage) return 'Reusable route for stages without dedicated coverage.';
    return STAGE_DESCRIPTIONS[stage] ?? 'Stage detail not yet documented.';
  }

  function emptyByokMap<T>(value: T): Record<ByokProvider, T> {
    return Object.fromEntries(BYOK_PROVIDER_ORDER.map((provider) => [provider, value])) as Record<ByokProvider, T>;
  }

  function normalizeStageProviderToByok(value: string | null | undefined): ByokProvider | null {
    const normalized = (value ?? '').trim().toLowerCase();
    if (!normalized) return null;

    const direct = parseByokProvider(normalized);
    if (direct) return direct;

    if (normalized === 'google' || normalized === 'gemini' || normalized === 'google-vertex') {
      return 'vertex';
    }

    return null;
  }

  function byokStatusLabel(status: ByokProviderStatus['status']): string {
    if (status === 'active') return 'Active';
    if (status === 'pending_validation') return 'Pending validation';
    if (status === 'invalid') return 'Invalid';
    if (status === 'revoked') return 'Revoked';
    return 'Not configured';
  }

  async function loadByokProviders(): Promise<void> {
    byokLoading = true;
    try {
      const body = await authorizedJson('/api/byok/providers', { method: 'GET' });
      byokProviders = Array.isArray(body.providers) ? (body.providers as ByokProviderStatus[]) : [];
      byokError = '';
    } catch (error) {
      byokProviders = [];
      byokError = error instanceof Error ? error.message : 'Unable to load BYOK providers';
    } finally {
      byokLoading = false;
      byokLoaded = true;
    }
  }

  function setByokSaving(provider: ByokProvider, saving: boolean): void {
    byokSaving = {
      ...byokSaving,
      [provider]: saving
    };
  }

  async function saveInlineByokKey(provider: ByokProvider): Promise<void> {
    byokError = '';
    byokMessage = '';
    const apiKey = byokInputs[provider]?.trim();
    if (!apiKey) {
      byokError = `Enter a ${PROVIDER_UI_META[provider].label} API key before saving.`;
      return;
    }

    setByokSaving(provider, true);
    try {
      const body = await authorizedJson(`/api/byok/providers/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey })
      });
      byokInputs = {
        ...byokInputs,
        [provider]: ''
      };
      await loadByokProviders();
      const ok = body?.validation?.ok === true;
      byokMessage = ok
        ? `${PROVIDER_UI_META[provider].label} key saved and validated.`
        : `${PROVIDER_UI_META[provider].label} key saved but validation failed.`;
    } catch (error) {
      byokError = error instanceof Error ? error.message : `Failed to save ${provider} key`;
    } finally {
      setByokSaving(provider, false);
    }
  }

  async function validateInlineByokInput(provider: ByokProvider): Promise<void> {
    byokError = '';
    byokMessage = '';
    const apiKey = byokInputs[provider]?.trim();
    if (!apiKey) {
      byokError = `Enter a ${PROVIDER_UI_META[provider].label} API key before validating.`;
      return;
    }

    setByokSaving(provider, true);
    try {
      const body = await authorizedJson(`/api/byok/providers/${provider}/validate-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey })
      });
      const ok = body?.validation?.ok === true;
      byokMessage = ok
        ? `${PROVIDER_UI_META[provider].label} key looks valid. Save it to activate this provider.`
        : `${PROVIDER_UI_META[provider].label} validation failed${body?.validation?.error ? `: ${body.validation.error}` : '.'}`;
    } catch (error) {
      byokError = error instanceof Error ? error.message : `Failed to validate ${provider} key`;
    } finally {
      setByokSaving(provider, false);
    }
  }

  async function validateInlineByokCredential(provider: ByokProvider): Promise<void> {
    byokError = '';
    byokMessage = '';
    setByokSaving(provider, true);
    try {
      const body = await authorizedJson(`/api/byok/providers/${provider}/validate`, {
        method: 'POST'
      });
      await loadByokProviders();
      const ok = body?.validation?.ok === true;
      byokMessage = ok
        ? `${PROVIDER_UI_META[provider].label} credential is valid.`
        : `${PROVIDER_UI_META[provider].label} validation failed${body?.validation?.error ? `: ${body.validation.error}` : '.'}`;
    } catch (error) {
      byokError = error instanceof Error ? error.message : `Failed to validate ${provider} credential`;
    } finally {
      setByokSaving(provider, false);
    }
  }

  async function ensureByokReadyForQuickStageSave(): Promise<boolean> {
    byokError = '';
    byokMessage = '';
    await loadByokProviders();

    if (byokError) {
      showByokInlineSetup = true;
      pageError = `Unable to verify BYOK provider status: ${byokError}`;
      return false;
    }

    if (unavailableByokProvidersForQuickStage.length > 0) {
      showByokInlineSetup = true;
      const unavailableLabels = unavailableByokProvidersForQuickStage
        .map((provider) => PROVIDER_UI_META[provider].label)
        .join(', ');
      pageError = `BYOK is not enabled for ${unavailableLabels} in this environment. Enable those providers (BYOK_ENABLED_PROVIDERS) or choose models from enabled providers.`;
      return false;
    }

    if (missingByokProvidersForQuickStage.length === 0) {
      return true;
    }

    showByokInlineSetup = true;
    const providerLabels = missingByokProvidersForQuickStage
      .map((provider) => PROVIDER_UI_META[provider].label)
      .join(', ');
    pageError = `Add active provider keys for ${providerLabels} before saving stage models.`;
    return false;
  }

  function syncQuickStageQuery(stage: string): void {
    if (!browser) return;
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'quick');
    url.searchParams.set('stage', stage);
    const query = url.searchParams.toString();
    window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}`);
  }

  async function goToAdjacentQuickStage(offset: -1 | 1): Promise<void> {
    if (!quickStageMode || activeQuickStageIndex < 0) return;
    const targetIndex = activeQuickStageIndex + offset;
    if (targetIndex < 0 || targetIndex >= stageList.length) return;
    const targetStage = stageList[targetIndex];
    await chooseStage(targetStage);
    syncQuickStageQuery(targetStage);
    pageMessage = `Loaded ${stageTitle(targetStage)}.`;
  }

  async function goToQuickStageReview(): Promise<void> {
    quickStageMode = false;
    journeyStep = 4;
    if (browser) {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      url.searchParams.delete('stage');
      const query = url.searchParams.toString();
      window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}`);
    }
  }

  async function handleQuickStageRouteSelection(value: string): Promise<void> {
    if (!selectedCoverageEntry) return;
    if (value === '__create_new__') {
      showCreateRouteInline = true;
      return;
    }
    showCreateRouteInline = false;
    if (!value) return;
    await assignRouteToStage(selectedCoverageEntry.stage, value);
  }

  function contextWindowTokens(contextWindow: string): number {
    const lower = contextWindow.toLowerCase().trim();
    if (lower.endsWith('m')) {
      const numeric = Number.parseFloat(lower.replace('m', ''));
      return Number.isFinite(numeric) ? Math.round(numeric * 1_000_000) : 0;
    }
    if (lower.endsWith('k')) {
      const numeric = Number.parseFloat(lower.replace('k', ''));
      return Number.isFinite(numeric) ? Math.round(numeric * 1_000) : 0;
    }
    const raw = Number.parseInt(lower, 10);
    return Number.isFinite(raw) ? raw : 0;
  }

  function scoreStageModel(entry: StageModelCatalogEntry, stage: string | null | undefined): number {
    let score = 0;
    const bestFor = entry.bestFor.toLowerCase();
    const window = contextWindowTokens(entry.contextWindow);

    if (
      stage === 'ingestion_extraction' ||
      stage === 'ingestion_relations' ||
      stage === 'ingestion_grouping' ||
      stage === 'ingestion_validation'
    ) {
      score += entry.qualityTier === 'frontier' ? 6 : entry.qualityTier === 'strong' ? 4 : 2;
      score += entry.speed === 'balanced' ? 3 : entry.speed === 'thorough' ? 2 : 1;
      if (bestFor.includes('extraction') || bestFor.includes('pdf') || bestFor.includes('reasoning') || bestFor.includes('quality')) score += 3;
    } else if (stage === 'ingestion_embedding') {
      score += entry.speed === 'fast' ? 5 : entry.speed === 'balanced' ? 3 : 1;
      score += entry.costTier === 'low' ? 5 : entry.costTier === 'medium' ? 3 : 1;
      score += window >= 200_000 ? 3 : 1;
      if (bestFor.includes('long') || bestFor.includes('gutenberg') || bestFor.includes('context')) score += 2;
    } else if (stage === 'ingestion_json_repair') {
      score += entry.speed === 'fast' ? 5 : entry.speed === 'balanced' ? 3 : 1;
      score += entry.costTier === 'low' ? 4 : entry.costTier === 'medium' ? 3 : 1;
      score += entry.qualityTier === 'strong' ? 3 : entry.qualityTier === 'frontier' ? 2 : 1;
      if (bestFor.includes('straightforward') || bestFor.includes('structure') || bestFor.includes('clean')) score += 2;
    } else {
      score += entry.qualityTier === 'strong' ? 3 : entry.qualityTier === 'frontier' ? 4 : 2;
      score += entry.speed === 'balanced' ? 3 : 2;
    }

    return score;
  }

  function modelSelectionKey(provider: string | null | undefined, modelId: string | null | undefined): string {
    return `${(provider ?? '').trim().toLowerCase()}::${(modelId ?? '').trim().toLowerCase()}`;
  }

  function isProjectListedModel(entry: StageModelCatalogEntry): boolean {
    return entry.catalogSource === 'annotated' || entry.catalogSource === 'remote';
  }

  function scoreStageModelForSlot(
    entry: StageModelCatalogEntry,
    stage: string | null | undefined,
    slotIndex: number,
    objective: IngestionObjective = ingestionObjective
  ): number {
    let score = scoreStageModel(entry, stage);

    if (objective === 'lowest_cost') {
      score += entry.costTier === 'low' ? 9 : entry.costTier === 'medium' ? 4 : 0;
      score += entry.speed === 'fast' ? 4 : entry.speed === 'balanced' ? 2 : 0;
    } else if (objective === 'highest_quality') {
      score += entry.qualityTier === 'frontier' ? 9 : entry.qualityTier === 'strong' ? 5 : 1;
      score += entry.speed === 'thorough' ? 4 : entry.speed === 'balanced' ? 2 : 0;
    } else {
      score += entry.qualityTier === 'frontier' ? 4 : entry.qualityTier === 'strong' ? 3 : 1;
      score += entry.costTier === 'low' ? 3 : entry.costTier === 'medium' ? 2 : 0;
    }

    if (slotIndex === 0) {
      if (stage === 'ingestion_embedding' || stage === 'ingestion_json_repair') {
        score += entry.costTier === 'low' ? 5 : entry.costTier === 'medium' ? 2 : -1;
        score += entry.speed === 'fast' ? 4 : entry.speed === 'balanced' ? 2 : 0;
      } else {
        score += entry.qualityTier === 'frontier' ? 5 : entry.qualityTier === 'strong' ? 4 : 1;
        score += entry.speed === 'balanced' ? 3 : entry.speed === 'thorough' ? 1 : 0;
      }
    } else if (slotIndex === 1) {
      score += entry.costTier === 'low' ? 7 : entry.costTier === 'medium' ? 3 : 0;
      score += entry.speed === 'fast' ? 4 : entry.speed === 'balanced' ? 2 : 0;
    } else {
      if (stage === 'ingestion_embedding' || stage === 'ingestion_json_repair') {
        score += entry.qualityTier === 'strong' ? 3 : entry.qualityTier === 'frontier' ? 2 : 1;
        score += entry.costTier === 'medium' ? 2 : entry.costTier === 'low' ? 1 : 0;
      } else {
        score += entry.qualityTier === 'frontier' ? 7 : entry.qualityTier === 'strong' ? 4 : 1;
      }
    }

    score += isProjectListedModel(entry) ? 2 : 0;
    return score;
  }

  function slotLabel(index: number): string {
    if (index === 0) return 'Primary model';
    return `Fallback ${index}`;
  }

  function recommendQuickChainForStage(stage: string | null | undefined): QuickStageRecommendation[] {
    if (!stage || stageModelCatalog.length === 0) return [];

    const guidance = STAGE_MODEL_GUIDANCE[stage];
    const objective = ingestionObjective;
    const usedKeys = new Set<string>();
    const picks: QuickStageRecommendation[] = [];

    for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
      const picked =
        [...stageModelCatalog]
          .sort((a, b) => {
            const scoreDiff =
              scoreStageModelForSlot(b, stage, slotIndex, objective) -
              scoreStageModelForSlot(a, stage, slotIndex, objective);
            if (scoreDiff !== 0) return scoreDiff;
            return a.label.localeCompare(b.label);
          })
          .find((entry) => !usedKeys.has(modelSelectionKey(entry.provider, entry.modelId))) ?? null;

      if (!picked) continue;
      usedKeys.add(modelSelectionKey(picked.provider, picked.modelId));
      picks.push({
        provider: picked.provider,
        modelId: picked.modelId,
        rationale:
          guidance?.slotRationale[slotIndex] ??
          (slotIndex === 0
            ? 'Primary default for this phase.'
            : slotIndex === 1
              ? 'Fallback optimized for throughput and spend.'
              : 'Fallback optimized for quality edge-cases.'),
        costTier: picked.costTier,
        qualityTier: picked.qualityTier,
        speed: picked.speed,
        catalogSource: picked.catalogSource
      });
    }

    return picks;
  }

  function applyStageRecommendedChain(
    mode: 'replace' | 'fill-missing',
    stageOverride: string | null | undefined = selectedCoverageEntry?.stage ?? selectedStage
  ): boolean {
    const recommendations = quickStageRecommendations.length
      ? quickStageRecommendations
      : recommendQuickChainForStage(stageOverride);
    if (recommendations.length === 0) return false;

    const next = cloneQuickSelections();
    const usedKeys = new Set<string>();
    let changed = false;

    for (const selection of next) {
      if (selection.modelId.trim()) {
        usedKeys.add(modelSelectionKey(selection.provider, selection.modelId));
      }
    }

    for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
      const current = next[slotIndex] ?? { provider: '', modelId: '' };
      if (mode === 'fill-missing' && current.modelId.trim()) continue;

      const preferredForSlot = recommendations[slotIndex];
      const fallback = recommendations.find((entry) => !usedKeys.has(modelSelectionKey(entry.provider, entry.modelId)));
      const picked = preferredForSlot ?? fallback ?? null;
      if (!picked) continue;

      if (
        current.provider.trim() !== picked.provider.trim() ||
        current.modelId.trim() !== picked.modelId.trim()
      ) {
        next[slotIndex] = {
          provider: picked.provider,
          modelId: picked.modelId
        };
        changed = true;
      }

      usedKeys.add(modelSelectionKey(picked.provider, picked.modelId));
    }

    if (changed) {
      quickModelSelections = next;
    }
    return changed;
  }

  async function applyQuickStageDefaults(objective: IngestionObjective = ingestionObjective): Promise<void> {
    ingestionObjective = objective;
    const stage = selectedCoverageEntry?.stage ?? selectedStage;
    if (selectedRouteId) {
      await requestRouteRecommendation(selectedRouteId);
    }
    const changed = applyStageRecommendedChain('replace', stage);
    if (!stageModelCatalog.length) {
      quickDefaultsInfo = 'Model catalog unavailable. Refresh control plane and try again.';
      return;
    }
    if (changed && stage) {
      const source = quickStageLiveRecommendations.length > 0
        ? 'live Restormel routing recommendations'
        : 'Sophia benchmark scoring';
      quickDefaultsInfo = `Applied recommended ${stageTitle(stage)} chain from ${source}.`;
      return;
    }
    quickDefaultsInfo = 'Current chain already matches the recommended stage defaults.';
  }

  function quickModelsForProvider(provider: string, selectedModelId = ''): StageModelCatalogEntry[] {
    const p = provider.trim().toLowerCase();
    if (!p) return [];
    const fromCatalog = stageModelCatalog.filter((entry) => entry.provider.toLowerCase() === p);
    const selected = selectedModelId.trim();
    if (!selected || fromCatalog.some((entry) => entry.modelId === selected)) {
      return fromCatalog;
    }
    return [
      {
        label: `${provider} · ${selected}`,
        provider,
        modelId: selected,
        costTier: 'medium',
        qualityTier: 'strong',
        speed: 'balanced',
        contextWindow: '128k',
        bestFor: 'Manually selected model',
        catalogSource: 'remote'
      },
      ...fromCatalog
    ];
  }

  function inferProviderForModelId(modelId: string): string {
    const model = modelId.trim();
    if (!model) return '';
    return stageModelCatalog.find((entry) => entry.modelId === model)?.provider ?? '';
  }

  function parseStageFromQuery(): string | null {
    if (!browser) return null;
    const raw = new URLSearchParams(window.location.search).get('stage');
    if (!raw) return null;
    return Object.prototype.hasOwnProperty.call(STAGE_LABELS, raw) ? raw : null;
  }

  function parseQuickModeFromQuery(): boolean {
    if (!browser) return false;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const hasStage = Boolean(params.get('stage'));
    return mode === 'quick' || hasStage;
  }

  async function loadStageModelCatalog(): Promise<void> {
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/model-catalog');
      stageModelCatalog = Array.isArray(body.entries) ? (body.entries as StageModelCatalogEntry[]) : [];
    } catch {
      stageModelCatalog = [];
    }
  }

  function hydrateQuickModelsFromSteps(): void {
    const ordered = [...steps].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    quickModelSelections = [0, 1, 2].map((index) => {
      const row = ordered[index];
      const modelId = row?.modelId?.trim() ?? '';
      let provider = row?.providerPreference?.trim() ?? '';
      if (!provider && modelId) {
        provider = inferProviderForModelId(modelId);
      }
      return { provider, modelId };
    });

    const stage = selectedCoverageEntry?.stage ?? selectedStage;
    const hasAnyConfigured = quickModelSelections.some((selection) => selection.modelId.trim().length > 0);
    const hasMissing = quickModelSelections.some((selection) => selection.modelId.trim().length === 0);
    if (!stage || stageModelCatalog.length === 0) return;

    if (!hasAnyConfigured) {
      const changed = applyStageRecommendedChain('replace', stage);
      if (changed) {
        const source = quickStageLiveRecommendations.length > 0
          ? 'live Restormel routing recommendations'
          : 'Sophia benchmark scoring';
        quickDefaultsInfo = `Starter chain auto-filled for ${stageTitle(stage)} from ${source}.`;
      }
      return;
    }

    if (hasMissing) {
      const changed = applyStageRecommendedChain('fill-missing', stage);
      if (changed) {
        const source = quickStageLiveRecommendations.length > 0
          ? 'live Restormel routing recommendations'
          : 'Sophia benchmark scoring';
        quickDefaultsInfo = `Filled missing ${stageTitle(stage)} fallback slots from ${source}.`;
      }
    }
  }

  function cloneQuickSelections(): QuickStageModelSelection[] {
    return [0, 1, 2].map((index) => {
      const row = quickModelSelections[index];
      return {
        provider: row?.provider?.trim() ?? '',
        modelId: row?.modelId?.trim() ?? ''
      };
    });
  }

  function updateQuickProvider(index: number, provider: string): void {
    const next = cloneQuickSelections();
    const prevModelId = next[index]?.modelId ?? '';
    const curated = quickModelsForProvider(provider, prevModelId);
    next[index] = {
      provider,
      modelId: curated.some((entry) => entry.modelId === prevModelId) ? prevModelId : ''
    };
    quickModelSelections = next;
  }

  function updateQuickModel(index: number, modelId: string): void {
    const next = cloneQuickSelections();
    const provider = next[index]?.provider ?? '';
    next[index] = { provider, modelId };
    quickModelSelections = next;
  }

  async function createQuickRouteForStage(): Promise<void> {
    if (!selectedStage) return;
    busyAction = 'save-route';
    pageError = '';
    pageMessage = '';
    try {
      const payload = buildDefaultRouteDraft(selectedStage);
      payload.name =
        quickRouteDraftName.trim().length > 0
          ? quickRouteDraftName.trim()
          : `${stageTitle(selectedStage)} Route`;
      const body = await authorizedJson('/api/admin/ingestion-routing/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const routeId =
        typeof body?.route?.id === 'string' ? body.route.id : null;
      await loadRoutingContext();
      if (routeId) {
        await selectRoute(routeId, selectedStage);
        await assignRouteToStage(selectedStage, routeId);
      }
      pageMessage = `Created route for ${stageTitle(selectedStage)}.`;
      quickRouteDraftName = '';
      showCreateRouteInline = false;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to create route';
    } finally {
      busyAction = '';
    }
  }

  async function renameSelectedRouteFromQuick(): Promise<void> {
    if (!selectedRoute) return;
    const nextName = quickRenameRouteName.trim();
    if (!nextName) {
      pageError = 'Enter a route name before saving.';
      return;
    }

    if ((selectedRoute.name?.trim() ?? '') === nextName) {
      pageMessage = 'Route name unchanged.';
      return;
    }

    busyAction = 'save-route';
    pageError = '';
    pageMessage = '';
    try {
      await authorizedJson('/api/admin/ingestion-routing/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedRoute,
          name: nextName
        })
      });
      await loadRoutingContext();
      await selectRoute(selectedRoute.id, selectedCoverageEntry?.stage ?? selectedStage);
      pageMessage = `Renamed route to ${nextName}.`;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to rename route';
    } finally {
      busyAction = '';
    }
  }

  function buildQuickStageStepsPayload(): AdminStepRecord[] {
    const existingByIndex = new Map<number, AdminStepRecord>();
    for (const step of sortedSteps) {
      existingByIndex.set(step.orderIndex ?? 0, step);
    }

    return [0, 1, 2]
      .map((index) => {
        const selected = quickModelSelections[index] ?? { provider: '', modelId: '' };
        const modelId = selected.modelId.trim();
        if (!modelId) return null;
        const base = existingByIndex.get(index) ?? {};
        return {
          ...base,
          orderIndex: index,
          enabled: base.enabled === false ? false : true,
          providerPreference: selected.provider.trim() || base.providerPreference || null,
          modelId
        };
      })
      .filter(Boolean) as AdminStepRecord[];
  }

  async function persistQuickStageModels(routeId: string): Promise<void> {
    const nextSteps = buildQuickStageStepsPayload();
    await authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextSteps)
    });
  }

  async function saveQuickStageModels(): Promise<void> {
    if (!selectedRouteId) return;
    const byokReady = await ensureByokReadyForQuickStageSave();
    if (!byokReady) return;

    busyAction = 'save-steps';
    pageError = '';
    pageMessage = '';
    try {
      await persistQuickStageModels(selectedRouteId);

      pageMessage = `Saved model chain for ${selectedRouteId}.`;
      showByokInlineSetup = false;
      await loadRouteArtifacts(selectedRouteId);
      hydrateQuickModelsFromSteps();
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to save stage models';
    } finally {
      busyAction = '';
    }
  }

  function objectiveLabel(value: IngestionObjective): string {
    if (value === 'lowest_cost') return 'Budget';
    if (value === 'highest_quality') return 'High quality';
    return 'Balanced';
  }

  let mcpCopyStatus = $state<'idle' | 'copied' | 'error'>('idle');

  const mcpIdeConfigJson = $derived(
    JSON.stringify(
      {
        mcpServers: {
          restormel: {
            command: 'pnpm',
            args: ['exec', 'restormel-mcp'],
            env: {
              RESTORMEL_GATEWAY_KEY: '<paste from Restormel Keys → Gateway key>',
              RESTORMEL_EVALUATE_URL: data.mcpRestormel.policiesEvaluateUrl
            }
          }
        }
      },
      null,
      2
    )
  );

  async function copyMcpIdeConfig(): Promise<void> {
    if (!browser) return;
    try {
      await navigator.clipboard.writeText(mcpIdeConfigJson);
      mcpCopyStatus = 'copied';
      window.setTimeout(() => {
        mcpCopyStatus = 'idle';
      }, 2200);
    } catch {
      mcpCopyStatus = 'error';
      window.setTimeout(() => {
        mcpCopyStatus = 'idle';
      }, 2200);
    }
  }

  function openMcpAutoConfigurePanel(): void {
    if (!browser) return;
    const el = document.getElementById('auto-configure-mcp');
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function invokeRestormelMcpSetup(): Promise<void> {
    busyAction = 'mcp-setup';
    pageError = '';
    pageMessage = '';
    try {
      await loadStageModelCatalog();
      await loadRoutingContext();

      const stages = [...stageList];
      if (stages.length === 0) {
        pageError = 'No ingestion stages available for MCP setup.';
        return;
      }

      for (const stage of stages) {
        let coverage = routeStageCoverage.find((entry) => entry.stage === stage) ?? null;
        let routeId = coverage?.route?.id ?? null;

        if (!routeId) {
          const payload = buildDefaultRouteDraft(stage);
          payload.name = `${stageTitle(stage)} MCP`;
          const created = await authorizedJson('/api/admin/ingestion-routing/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          routeId = typeof created?.route?.id === 'string' ? created.route.id : null;
          if (!routeId) {
            throw new Error(`Failed to create route for ${stageTitle(stage)}.`);
          }
          await loadRoutingContext();
          coverage = routeStageCoverage.find((entry) => entry.stage === stage) ?? null;
          routeId = coverage?.route?.id ?? routeId;
        }

        await selectRoute(routeId, stage);
        await requestRouteRecommendation(routeId);
        applyStageRecommendedChain('replace', stage);
        await persistQuickStageModels(routeId);
      }

      const firstStage = stages[0] ?? null;
      if (firstStage) {
        await chooseStage(firstStage);
      }
      pageMessage =
        `Auto-configure (routing) applied across ${stages.length} ingestion phases (${objectiveLabel(ingestionObjective)} objective).`;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to invoke Restormel MCP setup';
    } finally {
      busyAction = '';
    }
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

  function routeSummaryLabel(route: AdminRouteRecord | null): string {
    if (!route) return 'New route draft';
    const status = route.enabled === false ? 'disabled' : route.stage ? 'stage-bound' : 'shared';
    return `${route.name ?? route.id} · ${status}`;
  }

  function routeChoicesForStage(): AdminRouteRecord[] {
    return [...routes].filter((route) => route.enabled !== false);
  }

  async function applyDefaultRouteToAllStages(routeId: string): Promise<void> {
    const targetRoute = routes.find((route) => route.id === routeId) ?? null;
    if (!targetRoute) return;

    busyAction = 'bulk-assign';
    pageError = '';
    pageMessage = '';

    try {
      for (const stage of stageList) {
        const currentRouteForStage =
          routes.find((route) => route.stage === stage && route.enabled !== false) ?? null;

        if (currentRouteForStage && currentRouteForStage.id !== targetRoute.id) {
          await authorizedJson('/api/admin/ingestion-routing/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...currentRouteForStage,
              stage: null
            })
          });
        }

        await authorizedJson('/api/admin/ingestion-routing/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...targetRoute,
            stage
          })
        });
      }

      defaultRouteId = routeId;
      pageMessage = `Applied ${targetRoute.name ?? targetRoute.id} as the default route across ${stageList.length} ingestion phases.`;
      journeyStep = 2;
      await loadRoutingContext();
      await selectRoute(routeId, selectedStage);
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to apply default route to all phases';
    } finally {
      busyAction = '';
    }
  }

  async function assignRouteToStage(stage: string, routeId: string): Promise<void> {
    const targetRoute = routes.find((route) => route.id === routeId) ?? null;
    if (!targetRoute) return;

    const currentRouteForStage =
      routes.find((route) => route.stage === stage && route.enabled !== false) ?? null;
    if (currentRouteForStage?.id === targetRoute.id && targetRoute.stage === stage) {
      selectedStage = stage;
      selectedRouteId = targetRoute.id;
      journeyStep = 2;
      await selectRoute(targetRoute.id, stage);
      return;
    }

    busyAction = 'save-route';
    pageError = '';
    pageMessage = '';

    try {
      if (currentRouteForStage && currentRouteForStage.id !== targetRoute.id) {
        await authorizedJson('/api/admin/ingestion-routing/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...currentRouteForStage,
            stage: null
          })
        });
      }

      await authorizedJson('/api/admin/ingestion-routing/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...targetRoute,
          stage
        })
      });

      pageMessage = `Stage ${stageTitle(stage)} now uses ${targetRoute.name ?? targetRoute.id}.`;
      journeyStep = 2;
      await loadRoutingContext();
      await selectRoute(targetRoute.id, stage);
    } catch (error) {
      pageError = error instanceof Error ? error.message : `Failed to assign route to ${stage}`;
    } finally {
      busyAction = '';
    }
  }

  function startNewRouteDraft(): void {
    selectedRouteId = null;
    journeyStep = 2;
    selectedStage = selectedCoverageEntry?.stage ?? selectedStage ?? stageList[0] ?? null;
    syncDraftsFromRoute(null, selectedStage);
    steps = [];
    history = [];
    simulationResult = null;
    resolveResult = null;
    pageMessage = 'New route draft ready. Edit the JSON and save to create it in Restormel.';
  }

  function prepareRouteDisableDraft(): Record<string, unknown> | null {
    if (!selectedRoute) return null;
    try {
      const payload = JSON.parse(routeJsonDraft) as Record<string, unknown>;
      return {
        ...payload,
        id: selectedRoute.id,
        enabled: false
      };
    } catch {
      return {
        ...selectedRoute,
        enabled: false
      };
    }
  }

  async function requestRouteRecommendation(routeId: string): Promise<void> {
    recommendationState = 'loading';
    recommendationError = '';
    recommendationSummary = '';
    recommendationRankings = [];

    try {
      const body = (await authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType: 'use_recommended_route',
          environmentId: routingEnvironmentId,
          workload: selectedRoute?.workload ?? 'ingestion',
          stage: selectedStage ?? selectedCoverageEntry?.stage ?? undefined,
          task: selectedStage === 'ingestion_embedding' ? 'embedding' : 'completion',
          attempt: 1,
          estimatedInputTokens: 14000,
          estimatedInputChars: 56000,
          preferredObjective: ingestionObjective,
          stageRequirementSummary: quickStageRequirementSummary,
          recommendationScope: 'restormel_project_models_and_route_context'
        })
      })) as RouteRecommendationPayload;

      const recommendation = body.recommendation ?? null;
      const supportReason = body.support?.reason ?? '';
      recommendationSummary =
        recommendation?.estimatedImpact ??
        recommendation?.reason ??
        supportReason ??
        'Route recommendation ready.';
      recommendationRankings = recommendation?.rankings ?? [];
      recommendationState = 'ready';
    } catch (error) {
      recommendationState = 'error';
      recommendationError = error instanceof Error ? error.message : 'Failed to load recommendation';
    }
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
      const problemTitle = typeof body?.title === 'string' ? body.title.trim() : '';
      const problemDetail = typeof body?.detail === 'string' ? body.detail.trim() : '';
      if (problemTitle || problemDetail) {
        throw new Error(problemDetail ? `${problemTitle || 'Request failed'}: ${problemDetail}` : problemTitle);
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
      hydrateQuickModelsFromSteps();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load route artifacts';
      stepsError = message;
      historyError = message;
      steps = [];
      history = [];
      stepsJsonDraft = '[]';
      quickModelSelections = [
        { provider: '', modelId: '' },
        { provider: '', modelId: '' },
        { provider: '', modelId: '' }
      ];
    } finally {
      busyAction = '';
    }
  }

  async function selectRoute(routeId: string, stageOverride: string | null = selectedStage): Promise<void> {
    selectedRouteId = routeId;
    journeyStep = 2;
    if (stageOverride !== undefined) selectedStage = stageOverride;
    const route = routes.find((entry) => entry.id === routeId) ?? null;
    syncDraftsFromRoute(route, stageOverride);
    simulationResult = null;
    resolveResult = null;
    await loadRouteArtifacts(routeId);
  }

  async function chooseStage(stage: string): Promise<void> {
    selectedStage = stage;
    quickDefaultsInfo = '';
    journeyStep = 2;
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
    quickModelSelections = [
      { provider: '', modelId: '' },
      { provider: '', modelId: '' },
      { provider: '', modelId: '' }
    ];
    quickDefaultsInfo = '';
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
      if (!defaultRouteId) {
        const shared = listEnabledSharedRoutes(nextRoutes)[0] ?? null;
        defaultRouteId = shared?.id ?? routeForStage?.id ?? '';
      }
      syncDraftsFromRoute(routeForStage, nextSelectedStage);

      const recommendRoute = routeForStage ?? nextRoutes.find((route) => route.enabled !== false) ?? null;
      if (recommendRoute?.id) {
        void requestRouteRecommendation(recommendRoute.id);
      } else {
        recommendationState = 'idle';
      }

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
      await loadStageModelCatalog();
      await loadRoutingContext();
    }
  }

  async function saveRouteDraft(): Promise<void> {
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
      pageMessage = `Route ${body.route?.id ?? selectedRoute?.id ?? 'draft'} saved.`;
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

  async function disableSelectedRoute(): Promise<void> {
    if (!selectedRoute) return;
    const confirmed = browser ? window.confirm(`Disable route "${selectedRoute.name ?? selectedRoute.id}"?`) : true;
    if (!confirmed) return;

    const payload = prepareRouteDisableDraft();
    if (!payload) return;

    busyAction = 'save-route';
    pageError = '';
    pageMessage = '';
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      pageMessage = `Route ${body.route?.id ?? selectedRoute.id} disabled.`;
      await loadRoutingContext();
      selectedRouteId = body.route?.id ?? null;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to disable route';
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
      journeyStep = 4;
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
      journeyStep = 4;
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

  $effect(() => {
    if (missingByokProvidersForQuickStage.length === 0 && showByokInlineSetup) {
      showByokInlineSetup = false;
    }
  });

  $effect(() => {
    if (!selectedRouteId) {
      quickRenameRouteName = '';
      return;
    }
    quickRenameRouteName = selectedRoute?.name?.trim() ?? '';
  });

  onMount(() => {
    if (!browser) return;
    pendingStageFromQuery = parseStageFromQuery();
    quickStageMode = parseQuickModeFromQuery();

    const sync = async () => {
      if (!auth?.currentUser) {
        pageState = 'forbidden';
        await goto('/auth');
        return;
      }

      try {
        await loadAdminContext();
        await loadByokProviders();
        if (pendingStageFromQuery) {
          await chooseStage(pendingStageFromQuery);
          pendingStageFromQuery = null;
          hydrateQuickModelsFromSteps();
        }
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
  <div class="admin-routing-shell mx-auto w-full max-w-[76rem] px-6 py-8 sm:px-10 lg:px-14 xl:px-16 space-y-8">
    <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-8 md:p-10">
      <div class="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
        <div class="space-y-5">
          <div class="flex flex-wrap items-center gap-3">
            <span class="rounded-full border border-sophia-dark-purple/35 bg-sophia-dark-purple/10 px-4 py-2.5 font-mono text-[0.75rem] font-medium uppercase tracking-[0.08em] leading-none text-sophia-dark-purple">
              Ingestion
            </span>
            <span class="rounded-full border border-sophia-dark-border px-3.5 py-2 font-mono text-[0.72rem] uppercase tracking-[0.1em] leading-none text-sophia-dark-muted">
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
            class="rounded border border-sophia-dark-blue/45 bg-sophia-dark-blue/12 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-blue hover:bg-sophia-dark-blue/20"
            onclick={() => openMcpAutoConfigurePanel()}
          >
            Auto configure with MCP
          </button>
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

      <details
        id="auto-configure-mcp"
        class="mt-8 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/50 open:border-sophia-dark-blue/30 open:bg-sophia-dark-bg/70"
      >
        <summary
          class="cursor-pointer select-none list-none px-5 py-4 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text marker:hidden [&::-webkit-details-marker]:hidden"
        >
          <span class="text-sophia-dark-blue">Auto configure with MCP</span>
          <span class="ml-2 font-normal normal-case tracking-normal text-sophia-dark-muted">
            — routing defaults, IDE connection, docs
          </span>
        </summary>
        <div class="space-y-8 border-t border-sophia-dark-border px-5 py-6">
          <div>
            <h3 class="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
              1 · Ingestion routes in Sophia
            </h3>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
              Create routes if needed, pull live Restormel recommendations for each stage, and persist model chains. This runs in Sophia using your server
              <span class="font-mono text-sophia-dark-text">RESTORMEL_GATEWAY_KEY</span>; it does not install anything in your editor.
            </p>
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-sage/22 disabled:opacity-50"
                onclick={() => void invokeRestormelMcpSetup()}
                disabled={busyAction !== ''}
              >
                {busyAction === 'mcp-setup' ? 'Applying…' : 'Apply recommended routes to all stages'}
              </button>
              <span class="font-mono text-[0.65rem] text-sophia-dark-dim">
                Objective: {objectiveLabel(ingestionObjective)} · matches quick-stage toolbar
              </span>
            </div>
          </div>

          <div>
            <h3 class="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
              2 · Restormel MCP in Cursor / Claude Desktop
            </h3>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
              Merge the JSON below into your client MCP settings (e.g. Cursor
              <span class="font-mono text-sophia-dark-text">~/.cursor/mcp.json</span>
              ). Replace the gateway key placeholder with the secret from
              <a
                href={data.mcpRestormel.dashboardBaseUrl}
                target="_blank"
                rel="noreferrer"
                class="text-sophia-dark-blue underline-offset-2 hover:underline"
                >Restormel Keys</a
              >. Policy evaluate URL is set from this deployment’s environment.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                onclick={() => void copyMcpIdeConfig()}
              >
                {mcpCopyStatus === 'copied'
                  ? 'Copied'
                  : mcpCopyStatus === 'error'
                    ? 'Copy failed — select & copy manually'
                    : 'Copy MCP JSON'}
              </button>
              <a
                href={data.mcpRestormel.integrationDocsUrl}
                target="_blank"
                rel="noreferrer"
                class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                >MCP integration docs</a
              >
            </div>
            <pre
              class="mt-4 max-h-[min(24rem,50vh)] overflow-auto rounded-lg border border-sophia-dark-border bg-sophia-dark-surface/80 p-4 font-mono text-[0.72rem] leading-relaxed text-sophia-dark-text"
            ><code>{mcpIdeConfigJson}</code></pre>
          </div>
        </div>
      </details>
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

      {#if quickStageMode}
      <section class="mx-auto w-full max-w-[72rem] rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-7 md:p-9">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Quick stage editor</div>
            <h2 class="mt-2 font-serif text-3xl text-sophia-dark-text">
              {selectedCoverageEntry?.title ?? stageTitle(selectedStage)}
            </h2>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
              Minimal editing mode: bind a route to this stage and update the model chain. Use full studio only if you need advanced controls.
            </p>
            <p class="mt-2 text-xs leading-5 text-sophia-dark-dim">
              Routing is provided by
              <a
                href="https://restormel.dev/keys/dashboard"
                target="_blank"
                rel="noreferrer"
                class="text-sophia-dark-blue underline-offset-2 hover:underline"
              >
                restormel/keys
              </a>.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded border border-sophia-dark-blue/45 bg-sophia-dark-blue/12 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-blue hover:bg-sophia-dark-blue/20"
              onclick={() => openMcpAutoConfigurePanel()}
            >
              Auto configure with MCP
            </button>
            <button
              type="button"
              class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
              onclick={() => (quickStageMode = false)}
            >
              Open full studio
            </button>
            <a
              href="/admin"
              class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
            >
              Back to pipeline
            </a>
          </div>
        </div>
      </section>

      <section class="mx-auto w-full max-w-[72rem] rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-7 md:p-9">
        <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">1. Route for this stage</div>
        <div class="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label class="space-y-2">
            <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Bind route to {selectedCoverageEntry?.title ?? 'stage'}</span>
            <select
              value={selectedCoverageEntry?.route?.id ?? ''}
              class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
              onchange={(event) => void handleQuickStageRouteSelection((event.currentTarget as HTMLSelectElement).value)}
              disabled={busyAction !== ''}
            >
              <option value="">Select a route</option>
              {#each routeChoicesForStage() as route}
                <option value={route.id}>{routeOptionLabel(route)}</option>
              {/each}
              <option value="__create_new__">+ Create new route…</option>
            </select>
            <p class="text-xs leading-5 text-sophia-dark-dim">
              {selectedCoverageEntry?.route ? `Current: ${selectedCoverageEntry.route.name ?? selectedCoverageEntry.route.id}` : 'No route currently bound to this stage.'}
            </p>
          </label>
          <button
            type="button"
            class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
            onclick={() => selectedCoverageEntry && void chooseStage(selectedCoverageEntry.stage)}
            disabled={!selectedCoverageEntry || busyAction !== ''}
          >
            Refresh stage
          </button>
        </div>

        {#if showCreateRouteInline || routeChoicesForStage().length === 0}
          <div class="mt-4 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/60 p-4">
            <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
              {routeChoicesForStage().length === 0 ? 'No routes yet' : 'Create new route'}
            </div>
            <div class="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label class="space-y-2">
                <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">New route name</span>
                <input
                  type="text"
                  bind:value={quickRouteDraftName}
                  placeholder={`${selectedCoverageEntry?.title ?? 'Stage'} Route`}
                  class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
                />
              </label>
              <button
                type="button"
                class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-purple/24 disabled:opacity-50"
                onclick={() => void createQuickRouteForStage()}
                disabled={!selectedStage || busyAction !== ''}
              >
                {busyAction === 'save-route' ? 'Creating…' : 'Create route'}
              </button>
            </div>
            {#if showCreateRouteInline && routeChoicesForStage().length > 0}
              <div class="mt-3">
                <button
                  type="button"
                  class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                  onclick={() => (showCreateRouteInline = false)}
                  disabled={busyAction !== ''}
                >
                  Cancel
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if selectedRoute}
          <div class="mt-4 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/60 p-4">
            <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Rename current route</div>
            <div class="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label class="space-y-2">
                <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route name</span>
                <input
                  type="text"
                  bind:value={quickRenameRouteName}
                  placeholder={selectedRoute.name ?? selectedRoute.id}
                  class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
                  disabled={busyAction !== ''}
                />
              </label>
              <button
                type="button"
                class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                onclick={() => void renameSelectedRouteFromQuick()}
                disabled={busyAction !== ''}
              >
                {busyAction === 'save-route' ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </div>
        {/if}
      </section>

      <section class="mx-auto w-full max-w-[72rem] rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-7 md:p-9">
        <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">2. Model chain for selected route</div>
        <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
          Edit the primary plus two fallback slots used by this stage route.
        </p>
        <p class="mt-2 text-xs leading-5 text-sophia-dark-dim">{quickStageRequirementSummary}</p>

        {#if quickStageModelGuidance}
          <div class="mt-4 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/60 p-4">
            <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
              Why model choice matters for this phase
            </div>
            <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{quickStageModelGuidance.why}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              {#each quickStageModelGuidance.focusAreas as focus (focus)}
                <span class="rounded border border-sophia-dark-border px-2.5 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-muted">
                  {focus}
                </span>
              {/each}
            </div>

            {#if quickStageRecommendations.length > 0}
              <div class="mt-4 grid gap-3 lg:grid-cols-3">
                {#each quickStageRecommendations as recommendation, index (`${recommendation.provider}:${recommendation.modelId}:${index}`)}
                  <div class="rounded-lg border border-sophia-dark-border bg-sophia-dark-surface-raised/20 p-3">
                    <div class="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-dim">{slotLabel(index)}</div>
                    <div class="mt-1 font-mono text-xs text-sophia-dark-text">
                      {recommendation.provider} · {recommendation.modelId}
                    </div>
                    <p class="mt-2 text-xs leading-5 text-sophia-dark-muted">{recommendation.rationale}</p>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-sophia-dark-muted">
                        Cost {recommendation.costTier}
                      </span>
                      <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-sophia-dark-muted">
                        Quality {recommendation.qualityTier}
                      </span>
                      <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-sophia-dark-muted">
                        Speed {recommendation.speed}
                      </span>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                class={`rounded border px-4 py-2.5 font-mono text-[0.68rem] uppercase tracking-[0.1em] disabled:opacity-50 ${
                  ingestionObjective === 'lowest_cost'
                    ? 'border-sophia-dark-sage/45 bg-sophia-dark-sage/12 text-sophia-dark-sage'
                    : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'
                }`}
                onclick={() => void applyQuickStageDefaults('lowest_cost')}
                disabled={busyAction !== '' || quickStageRecommendations.length === 0}
              >
                Auto: Budget
              </button>
              <button
                type="button"
                class={`rounded border px-4 py-2.5 font-mono text-[0.68rem] uppercase tracking-[0.1em] disabled:opacity-50 ${
                  ingestionObjective === 'balanced'
                    ? 'border-sophia-dark-blue/45 bg-sophia-dark-blue/14 text-sophia-dark-blue'
                    : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'
                }`}
                onclick={() => void applyQuickStageDefaults('balanced')}
                disabled={busyAction !== '' || quickStageRecommendations.length === 0}
              >
                Auto: Balanced
              </button>
              <button
                type="button"
                class={`rounded border px-4 py-2.5 font-mono text-[0.68rem] uppercase tracking-[0.1em] disabled:opacity-50 ${
                  ingestionObjective === 'highest_quality'
                    ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/16 text-sophia-dark-text'
                    : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'
                }`}
                onclick={() => void applyQuickStageDefaults('highest_quality')}
                disabled={busyAction !== '' || quickStageRecommendations.length === 0}
              >
                Auto: High quality
              </button>
              <span class="text-xs leading-5 text-sophia-dark-dim">
                {quickDefaultsInfo || 'Defaults are based on Sophia phase benchmarking for quality, reliability, and cost control.'}
              </span>
            </div>

            <div class="mt-3 rounded border border-sophia-dark-blue/30 bg-sophia-dark-blue/8 px-3 py-2 text-xs text-sophia-dark-muted">
              BYOK mode: model choice is not restricted to platform-funded defaults. If the provider key is active, you can route to that model and pay provider-side usage directly.
            </div>
          </div>
        {/if}

        {#if curatedStageCatalog.length === 0}
          <div class="mt-4 rounded-xl border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 text-xs text-sophia-dark-copper">
            Model catalog is unavailable, so stage-curated dropdowns cannot be shown yet. Refresh control plane and retry.
          </div>
        {:else}
          <div class="mt-4 space-y-4">
            {#each [0, 1, 2] as index (index)}
              {@const selection = quickModelSelections[index] ?? { provider: '', modelId: '' }}
              {@const providerModels = quickModelsForProvider(selection.provider, selection.modelId)}
              {@const selectedMeta = providerModels.find((entry) => entry.modelId === selection.modelId) ?? null}
              <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/60 p-4">
                <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
                  {index === 0 ? 'Primary model' : `Fallback ${index}`}
                </div>
                <div class="mt-3 grid gap-3 md:grid-cols-2">
                  <label class="space-y-2">
                    <span class="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Provider</span>
                    <select
                      value={selection.provider}
                      onchange={(event) => updateQuickProvider(index, (event.currentTarget as HTMLSelectElement).value)}
                      class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
                    >
                      <option value="">Select provider</option>
                      {#each quickProviderOptions as provider (provider)}
                        <option value={provider}>{provider}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="space-y-2">
                    <span class="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Model</span>
                    <select
                      value={selection.modelId}
                      onchange={(event) => updateQuickModel(index, (event.currentTarget as HTMLSelectElement).value)}
                      class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
                      disabled={!selection.provider}
                    >
                      <option value="">{selection.provider ? 'Select model' : 'Select provider first'}</option>
                      {#each providerModels as model (`${selection.provider}:${model.modelId}`)}
                        <option value={model.modelId}>{model.modelId}</option>
                      {/each}
                    </select>
                  </label>
                </div>
                {#if selectedMeta}
                  <div class="mt-3 flex flex-wrap gap-2">
                    <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Cost {selectedMeta.costTier}</span>
                    <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Quality {selectedMeta.qualityTier}</span>
                    <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Speed {selectedMeta.speed}</span>
                    <span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Context {selectedMeta.contextWindow}</span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if requiredByokProvidersForQuickStage.length > 0}
          <div class="mt-5 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/60 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                  Required provider keys
                </div>
                <p class="mt-1 text-xs leading-5 text-sophia-dark-muted">
                  Selected models require active BYOK keys. Add missing keys here and they will be saved to your BYOK settings.
                </p>
              </div>
              <button
                type="button"
                class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                onclick={() => void loadByokProviders()}
                disabled={byokLoading || busyAction !== ''}
              >
                {byokLoading ? 'Refreshing…' : 'Refresh key status'}
              </button>
            </div>

            <div class="mt-3 flex flex-wrap gap-2">
              {#each requiredByokProvidersForQuickStage as provider (provider)}
                {@const status = byokStatusByProvider.get(provider)}
                {@const unavailable = unavailableByokProvidersForQuickStage.includes(provider)}
                <div class="flex flex-wrap items-center gap-2">
                  <span class={`rounded-full border px-3 py-1 font-mono text-[0.66rem] uppercase tracking-[0.1em] ${
                    status?.status === 'active'
                      ? 'border-sophia-dark-sage/35 bg-sophia-dark-sage/10 text-sophia-dark-sage'
                      : unavailable
                        ? 'border-sophia-dark-amber/35 bg-sophia-dark-amber/10 text-sophia-dark-amber'
                        : 'border-sophia-dark-copper/35 bg-sophia-dark-copper/10 text-sophia-dark-copper'
                  }`}>
                    {PROVIDER_UI_META[provider].label} · {unavailable ? 'Unavailable' : byokStatusLabel(status?.status ?? 'not_configured')}
                  </span>
                  {#if status?.configured && !unavailable}
                    <button
                      type="button"
                      class="rounded border border-sophia-dark-border px-3 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                      onclick={() => void validateInlineByokCredential(provider)}
                      disabled={byokSaving[provider]}
                    >
                      {byokSaving[provider] ? 'Validating…' : 'Validate'}
                    </button>
                  {/if}
                </div>
              {/each}
            </div>

            {#if unavailableByokProvidersForQuickStage.length > 0}
              <div class="mt-3 rounded border border-sophia-dark-amber/35 bg-sophia-dark-amber/10 px-3 py-2 text-xs text-sophia-dark-amber">
                BYOK not enabled for:
                {unavailableByokProvidersForQuickStage.map((provider) => PROVIDER_UI_META[provider].label).join(', ')}.
                Update <span class="font-mono">BYOK_ENABLED_PROVIDERS</span> and restart local dev, or select models from enabled providers.
              </div>
            {/if}

            {#if showByokInlineSetup || missingByokProvidersForQuickStage.length > 0}
              <div class="mt-4 space-y-3">
                {#each missingByokProvidersForQuickStage as provider (provider)}
                  <div class="rounded-lg border border-sophia-dark-copper/30 bg-sophia-dark-copper/8 p-3">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-sophia-dark-copper">
                      Add {PROVIDER_UI_META[provider].label} key
                    </div>
                    <p class="mt-1 text-xs leading-5 text-sophia-dark-muted">{PROVIDER_UI_META[provider].hint}</p>
                    <div class="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                      <label class="space-y-2">
                        <span class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-sophia-dark-dim">API key</span>
                        <input
                          type="password"
                          placeholder={PROVIDER_UI_META[provider].placeholder}
                          value={byokInputs[provider]}
                          oninput={(event) => {
                            byokInputs = {
                              ...byokInputs,
                              [provider]: (event.currentTarget as HTMLInputElement).value
                            };
                          }}
                          class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
                          disabled={byokSaving[provider]}
                        />
                      </label>
                      <button
                        type="button"
                        class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-text hover:bg-sophia-dark-purple/24 disabled:opacity-50"
                        onclick={() => void saveInlineByokKey(provider)}
                        disabled={byokSaving[provider]}
                      >
                        {byokSaving[provider] ? 'Saving…' : 'Save key'}
                      </button>
                      <button
                        type="button"
                        class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                        onclick={() => void validateInlineByokInput(provider)}
                        disabled={byokSaving[provider]}
                      >
                        {byokSaving[provider] ? 'Validating…' : 'Validate key'}
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            {#if byokMessage}
              <div class="mt-3 rounded border border-sophia-dark-sage/35 bg-sophia-dark-sage/10 px-3 py-2 font-mono text-xs text-sophia-dark-sage">
                {byokMessage}
              </div>
            {/if}
            {#if byokError}
              <div class="mt-3 rounded border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-3 py-2 font-mono text-xs text-sophia-dark-copper">
                {byokError}
              </div>
            {/if}
          </div>
        {/if}

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-text hover:bg-sophia-dark-purple/24 disabled:opacity-50"
            onclick={() => void saveQuickStageModels()}
            disabled={!selectedRouteId || !quickPrimarySelectionReady || busyAction !== ''}
          >
            {busyAction === 'save-steps' ? 'Saving…' : 'Save stage models'}
          </button>
          <span class="text-xs text-sophia-dark-dim">Route: {selectedRoute?.name ?? selectedRouteId ?? 'Select a route first'}</span>
        </div>

        <div class="mt-5 flex flex-wrap items-center gap-3 border-t border-sophia-dark-border pt-4">
          <a
            href="/admin"
            class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
          >
            Back to 6-stage dashboard
          </a>
          <button
            type="button"
            class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
            onclick={() => void goToAdjacentQuickStage(-1)}
            disabled={!canGoPrevQuickStage || busyAction !== ''}
          >
            Previous stage
          </button>
          {#if isFinalQuickStage}
            <button
              type="button"
              class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-text hover:bg-sophia-dark-purple/24"
              onclick={() => void goToQuickStageReview()}
              disabled={busyAction !== ''}
            >
              Review all stages
            </button>
          {:else}
            <button
              type="button"
              class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
              onclick={() => void goToAdjacentQuickStage(1)}
              disabled={!canGoNextQuickStage || busyAction !== ''}
            >
              Next stage
            </button>
          {/if}
          <span class="text-xs text-sophia-dark-dim">
            Stage {activeQuickStageIndex >= 0 ? activeQuickStageIndex + 1 : 1} of {stageList.length}
          </span>
        </div>

        {#if recommendationRankings.length > 0}
          <div class="mt-5 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg/60 p-4">
            <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Top model advice</div>
            <div class="mt-3 grid gap-2 md:grid-cols-3">
              {#each recommendationRankings.slice(0, 3) as ranking}
                <div class="rounded-lg border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-3 py-2">
                  <div class="font-mono text-xs text-sophia-dark-text">#{ranking.rank} {ranking.display}</div>
                  <div class="mt-1 text-xs text-sophia-dark-dim">Cost {ranking.costTier ?? 'medium'} · {ranking.speed ?? 'balanced'}</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
      {:else}
      <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted">Routing journey</div>
            <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
              Step {journeyStep} of 4. {remainingJourneySteps === 0 ? 'Final review ready.' : `${remainingJourneySteps} step${remainingJourneySteps === 1 ? '' : 's'} remaining.`}
            </p>
          </div>
          <div class="max-w-xl text-xs leading-5 text-sophia-dark-dim">
            Linked flow: <a href="/admin" class="text-sophia-dark-text underline underline-offset-2 hover:text-sophia-dark-sage">Admin setup</a> defines source + model intent; this screen controls how each ingestion stage resolves routes in Restormel Keys.
          </div>
        </div>

        <div class="mt-4 h-1.5 w-full rounded-full bg-sophia-dark-bg/60">
          <div class="h-1.5 rounded-full bg-sophia-dark-purple transition-all" style={`width: ${(journeyStep / 4) * 100}%`}></div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {#each journeySteps as step}
            <button
              type="button"
              onclick={() => (journeyStep = step.id)}
              class={`rounded-xl border px-4 py-3 text-left ${journeyStep === step.id ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/10' : 'border-sophia-dark-border bg-sophia-dark-bg/40 hover:border-sophia-dark-border'}`}
            >
              <div class="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-muted">Step {step.id}</div>
              <div class="mt-1 font-serif text-lg text-sophia-dark-text">{step.title}</div>
              <div class="mt-1 text-xs text-sophia-dark-muted">{step.subtitle}</div>
            </button>
          {/each}
        </div>
      </section>

      <section class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-5 py-4">
        {#if journeyStep === 1}
          <div class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted">Outcome for this step</div>
          <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
            Set one default route across all 6 phases, then flag phase-specific overrides where needed.
          </p>
        {:else if journeyStep === 2}
          <div class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted">Outcome for this step</div>
          <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
            Save route and step configuration back to Restormel Keys for the selected stage.
          </p>
        {:else if journeyStep === 3}
          <div class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted">Outcome for this step</div>
          <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
            Validate behaviour with simulation and/or resolve probe so publish is evidence-backed.
          </p>
        {:else}
          <div class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted">Outcome for this step</div>
          <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
            Final review, then publish and continue into Operations.
          </p>
        {/if}
      </section>

      {#if journeyStep < 4}
      {#if journeyStep === 1}
      <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 md:p-8">
        <div class="flex flex-col gap-6">
          <div>
            <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Quick setup for all 6 phases</div>
            <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
              Start simple: pick one default objective and one default route, apply it across every ingestion phase, then override only where a phase needs special behavior.
            </p>
          </div>
          <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <label class="space-y-2">
              <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
                Ingestion objective
                <span class="ml-1 cursor-help text-sophia-dark-muted" title="This sets your planning lens. You can still override per phase later.">ⓘ</span>
              </span>
              <select
                bind:value={ingestionObjective}
                class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
              >
                <option value="lowest_cost">Lowest cost</option>
                <option value="balanced">Balanced</option>
                <option value="highest_quality">Highest quality</option>
              </select>
              <p class="text-xs leading-5 text-sophia-dark-dim">{objectiveHelpText}</p>
            </label>

            <label class="space-y-2">
              <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
                Default route (all phases)
                <span class="ml-1 cursor-help text-sophia-dark-muted" title="Apply one route to all 6 stages as your baseline.">ⓘ</span>
              </span>
              <select
                bind:value={defaultRouteId}
                class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
              >
                <option value="">Select default route</option>
                {#each routeChoicesForStage() as route}
                  <option value={route.id}>{routeOptionLabel(route)}</option>
                {/each}
              </select>
              <p class="text-xs leading-5 text-sophia-dark-dim">
                Then use per-stage overrides below where needed.
              </p>
            </label>

            <button
              type="button"
              class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-purple/24 disabled:opacity-50"
              onclick={() => defaultRouteId && void applyDefaultRouteToAllStages(defaultRouteId)}
              disabled={!defaultRouteId || busyAction !== ''}
            >
              {busyAction === 'bulk-assign' ? 'Applying…' : `Apply to all ${stageList.length} phases`}
            </button>
          </div>
        </div>
      </section>
      {/if}

      <div class={`grid gap-6 ${journeyStep === 2 ? 'xl:grid-cols-[1.08fr,0.92fr]' : ''}`}>
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
                  <article
                    class={`rounded-xl border px-4 py-4 transition-colors ${
                      selectedCoverageEntry?.stage === entry.stage
                        ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/10'
                        : 'border-sophia-dark-border bg-sophia-dark-surface-raised/30'
                    }`}
                  >
                    <div class="flex items-start justify-between gap-4">
                      <div>
                        <button
                          type="button"
                          class="text-left"
                          onclick={() => void chooseStage(entry.stage)}
                        >
                          <div class="font-serif text-xl text-sophia-dark-text">{entry.title}</div>
                        </button>
                        <p class="mt-1 text-sm leading-6 text-sophia-dark-muted">{entry.description}</p>
                      </div>
                      <span class={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${routeModeTone(entry.mode)}`}>
                        {routeModeLabel(entry.mode)}
                      </span>
                    </div>
                    <div class="mt-4 border-t border-sophia-dark-border pt-4">
                      <div class="flex items-center justify-between gap-4">
                        <div>
                          <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route</div>
                          <div class="mt-1 font-mono text-sm text-sophia-dark-text">
                            {entry.route ? entry.route.name ?? entry.route.id : 'No route currently returned'}
                          </div>
                          <div class="mt-1 font-mono text-xs text-sophia-dark-dim">
                            {routeStatusSummary(entry.route)}
                          </div>
                          {#if defaultRouteId && entry.route?.id}
                            <div class={`mt-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${entry.route.id === defaultRouteId ? 'text-sophia-dark-sage' : 'text-sophia-dark-blue'}`}>
                              {entry.route.id === defaultRouteId ? 'Using default route' : 'Phase override'}
                            </div>
                          {/if}
                        </div>
                        <div class="font-mono text-xs text-sophia-dark-muted">Inspect</div>
                      </div>

                      <div class="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                        <label class="space-y-2">
                          <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Bind route to stage</span>
                          <select
                            value={entry.route?.id ?? ''}
                            class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
                            onchange={(event) => void assignRouteToStage(entry.stage, (event.currentTarget as HTMLSelectElement).value)}
                            disabled={busyAction !== ''}
                          >
                            <option value="">Select a route</option>
                            {#each routeChoicesForStage() as route}
                              <option value={route.id}>{routeOptionLabel(route)}</option>
                            {/each}
                          </select>
                        </label>
                        <div class="flex items-end">
                          <button
                            type="button"
                            class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                            onclick={() => void chooseStage(entry.stage)}
                            disabled={busyAction !== ''}
                          >
                            Focus stage
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
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

        {#if journeyStep === 2}
        <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 md:p-8">
          <div class="flex flex-col gap-6">
            <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
              <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div class="space-y-2">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted">
                    Route manager
                  </div>
                  <div class="font-serif text-2xl text-sophia-dark-text">
                    {routeSummaryLabel(selectedRoute)}
                  </div>
                  <p class="max-w-2xl text-sm leading-6 text-sophia-dark-muted">
                    Create a new route, edit the current draft, disable an existing route, and save the result back to Restormel Keys.
                  </p>
                </div>

                <div class="flex flex-wrap gap-3">
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    onclick={startNewRouteDraft}
                    disabled={busyAction !== ''}
                  >
                    New route
                  </button>
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-purple/24"
                    onclick={saveRouteDraft}
                    disabled={busyAction !== ''}
                  >
                    {busyAction === 'save-route' ? 'Saving…' : 'Save route'}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-sophia-dark-copper/40 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-copper hover:bg-sophia-dark-copper/10 disabled:opacity-50"
                    onclick={disableSelectedRoute}
                    disabled={!selectedRoute || busyAction !== ''}
                  >
                    Disable route
                  </button>
                </div>
              </div>

              <div class="mt-4 grid gap-3 md:grid-cols-3">
                <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                  <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route count</div>
                  <div class="mt-2 font-mono text-sm text-sophia-dark-text">{routes.length} total</div>
                </div>
                <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                  <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Shared routes</div>
                  <div class="mt-2 font-mono text-sm text-sophia-dark-text">{listEnabledSharedRoutes(routes).length} available</div>
                </div>
                <div class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                  <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Model advice</div>
                  <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                    {recommendationState === 'ready'
                      ? 'Ready'
                      : recommendationState === 'loading'
                        ? 'Loading…'
                        : 'Available on demand'}
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-muted">
                    Best model advice
                  </div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                    Use this to pick the right primary model and fallback chain for the current task. The ranking comes from Restormel's recommendation API when available.
                  </p>
                </div>
                <button
                  type="button"
                  class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                  onclick={() => selectedRouteId && void requestRouteRecommendation(selectedRouteId)}
                  disabled={!selectedRouteId || recommendationState === 'loading' || busyAction !== ''}
                >
                  {recommendationState === 'loading' ? 'Loading…' : 'Refresh advice'}
                </button>
              </div>

              {#if recommendationError}
                <div class="mt-4 rounded-xl border border-sophia-dark-copper/35 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                  {recommendationError}
                </div>
              {:else if recommendationSummary}
                <div class="mt-4 rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-4 py-3">
                  <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Summary</div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{recommendationSummary}</p>
                </div>
              {/if}

              {#if recommendationRankings.length > 0}
                <div class="mt-4 grid gap-3 md:grid-cols-3">
                  {#each recommendationRankings.slice(0, 3) as ranking}
                    <article class="rounded-xl border border-sophia-dark-border bg-sophia-dark-surface-raised/20 p-4">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">
                            Rank {ranking.rank}
                          </div>
                          <div class="mt-2 font-serif text-xl text-sophia-dark-text">{ranking.display}</div>
                        </div>
                        <span class="rounded-full border border-sophia-dark-border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-sophia-dark-muted">
                          {ranking.speed ?? 'balanced'}
                        </span>
                      </div>
                      <div class="mt-3 grid gap-2 text-xs font-mono text-sophia-dark-muted">
                        <div>Cost tier: <span class="text-sophia-dark-text">{ranking.costTier ?? 'medium'}</span></div>
                        <div>Context: <span class="text-sophia-dark-text">{ranking.contextWindow ?? '—'}</span></div>
                        <div>Confidence: <span class="text-sophia-dark-text">{ranking.confidence ?? '—'}</span></div>
                      </div>
                      {#if ranking.rationale}
                        <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{ranking.rationale}</p>
                      {/if}
                    </article>
                  {/each}
                </div>
              {/if}
            </section>

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
        {/if}
      </div>

      <div class={`grid gap-6 ${journeyStep === 2 ? 'xl:grid-cols-[0.95fr,1.05fr]' : ''}`}>
        {#if journeyStep === 2}
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
        {/if}

        {#if journeyStep === 3 || journeyStep === 2}
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
        {/if}
      </div>
      {:else}
      <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 md:p-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Final review</div>
            <h2 class="mt-2 font-serif text-3xl text-sophia-dark-text">Review routing before publish</h2>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
              Confirm stage binding, route draft, and validation evidence. Use Change to jump back to the right step.
            </p>
          </div>
          <span class="rounded-full border border-sophia-dark-sage/35 bg-sophia-dark-sage/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-sage">
            Ready to commit
          </span>
        </div>

        <dl class="gov-summary-list mt-6">
          <div class="gov-summary-list__row">
            <dt class="gov-summary-list__key">Objective</dt>
            <dd class="gov-summary-list__value">{ingestionObjective === 'lowest_cost' ? 'Lowest cost' : ingestionObjective === 'highest_quality' ? 'Highest quality' : 'Balanced'}</dd>
            <dd class="gov-summary-list__actions"><button type="button" class="summary-action" onclick={() => (journeyStep = 1)}>Change</button></dd>
          </div>
          <div class="gov-summary-list__row">
            <dt class="gov-summary-list__key">Default route</dt>
            <dd class="gov-summary-list__value">
              {(routes.find((route) => route.id === defaultRouteId)?.name ?? defaultRouteId) || 'Not set'}
              <span class="block mt-1 text-xs text-sophia-dark-dim">{stageRoutingSummary.inherited} inherited · {stageRoutingSummary.overridden} overridden</span>
            </dd>
            <dd class="gov-summary-list__actions"><button type="button" class="summary-action" onclick={() => (journeyStep = 1)}>Change</button></dd>
          </div>
          <div class="gov-summary-list__row">
            <dt class="gov-summary-list__key">Stage</dt>
            <dd class="gov-summary-list__value">{selectedCoverageEntry?.title ?? 'No stage selected'}</dd>
            <dd class="gov-summary-list__actions"><button type="button" class="summary-action" onclick={() => (journeyStep = 1)}>Change</button></dd>
          </div>
          <div class="gov-summary-list__row">
            <dt class="gov-summary-list__key">Route</dt>
            <dd class="gov-summary-list__value">{selectedRoute?.name ?? selectedRouteId ?? 'No route selected'}</dd>
            <dd class="gov-summary-list__actions"><button type="button" class="summary-action" onclick={() => (journeyStep = 2)}>Change</button></dd>
          </div>
          <div class="gov-summary-list__row">
            <dt class="gov-summary-list__key">Fallback chain</dt>
            <dd class="gov-summary-list__value">{sortedSteps.length > 0 ? `${sortedSteps.length} configured steps` : 'No steps returned'}</dd>
            <dd class="gov-summary-list__actions"><button type="button" class="summary-action" onclick={() => (journeyStep = 2)}>Change</button></dd>
          </div>
          <div class="gov-summary-list__row">
            <dt class="gov-summary-list__key">Validation evidence</dt>
            <dd class="gov-summary-list__value">
              {#if simulationResult || resolveResult}
                {simulationResult ? 'Simulation run' : ''}{simulationResult && resolveResult ? ' + ' : ''}{resolveResult ? 'Resolve probe run' : ''}
              {:else}
                No simulation or probe run yet
              {/if}
            </dd>
            <dd class="gov-summary-list__actions"><button type="button" class="summary-action" onclick={() => (journeyStep = 3)}>Change</button></dd>
          </div>
          <div class="gov-summary-list__row">
            <dt class="gov-summary-list__key">Versions</dt>
            <dd class="gov-summary-list__value">{routeStatusSummary(selectedRoute)}</dd>
            <dd class="gov-summary-list__actions"></dd>
          </div>
        </dl>

        <div class="mt-6 rounded-xl border border-sophia-dark-border bg-sophia-dark-bg p-5">
          <div class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">6-phase routing summary</div>
          <div class="mt-4 grid gap-2">
            {#each routeStageCoverage as entry}
              <div class="rounded-lg border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-3 py-2 text-sm">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-serif text-sophia-dark-text">{entry.title}</span>
                  <span class={`font-mono text-[0.66rem] uppercase tracking-[0.12em] ${defaultRouteId && entry.route?.id === defaultRouteId ? 'text-sophia-dark-sage' : 'text-sophia-dark-blue'}`}>
                    {defaultRouteId && entry.route?.id === defaultRouteId ? 'Inherited' : 'Override'}
                  </span>
                </div>
                <div class="mt-1 font-mono text-xs text-sophia-dark-muted">{entry.route?.name ?? entry.route?.id ?? 'No route bound'}</div>
              </div>
            {/each}
          </div>
        </div>

        <div class="mt-6 flex flex-wrap items-center gap-3">
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
            class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
            onclick={() => void goto('/admin/operations')}
            disabled={!selectedRouteId}
          >
            Open Operations Workbench
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
      </section>
      {/if}

      <div class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface px-5 py-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-40"
            onclick={goJourneyBack}
            disabled={journeyStep === 1}
          >
            ← Back
          </button>
          <div class="flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:max-w-md sm:flex-row sm:items-center sm:justify-end">
            {#if journeyHint && journeyStep < 4}
              <p class="text-xs leading-5 text-sophia-dark-dim sm:mr-2 sm:text-right">{journeyHint}</p>
            {/if}
            {#if journeyStep < 4}
              <button
                type="button"
                class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-purple/24 disabled:opacity-50"
                onclick={goJourneyNext}
                disabled={!canGoNextFromJourneyStep}
              >
                Continue →
              </button>
            {/if}
          </div>
        </div>
      </div>
      {/if}
    {/if}
  </div>
</div>

<style>
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
    .admin-routing-shell {
      padding-inline: 1.25rem;
    }

    .admin-routing-shell section {
      padding-inline: 1.25rem !important;
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
