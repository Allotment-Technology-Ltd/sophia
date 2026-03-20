<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { auth, getIdToken, onAuthChange } from '$lib/firebase';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';
  import type { PageData } from './$types';
  import type { AdminOperationRecord } from '$lib/server/adminOperations';

  let { data }: { data: PageData } = $props();
  type OperationKind = PageData['operationKinds'][number];
  type WorkbenchPhaseId = 'prepare' | 'preflight' | 'pipeline' | 'simulate' | 'run' | 'review';
  type SourceMode = 'url' | 'file';
  type RouteCoverageMode = 'dedicated' | 'shared' | 'missing';
  type PhaseSignal = 'not_started' | 'blocked' | 'attention' | 'ready' | 'running' | 'passed';

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
    routeId?: string | null;
    orderIndex?: number | null;
    enabled?: boolean | null;
    providerPreference?: string | null;
    modelId?: string | null;
    switchCriteria?: Record<string, unknown> | null;
    retryPolicy?: Record<string, unknown> | null;
    costPolicy?: Record<string, unknown> | null;
    fallbackOn?: string | null;
    label?: string | null;
    notes?: string | null;
    [key: string]: unknown;
  }

  interface ContextError {
    status: number;
    code: string;
    detail: string;
    endpoint?: string;
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

  interface AdminOperationWorkbenchRecord extends AdminOperationRecord {
    logs?: unknown[] | null;
    route_decision?: {
      routeName?: string | null;
      providerType?: string | null;
      modelId?: string | null;
      switchReasonCode?: string | null;
      estimatedCostUsd?: number | string | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  }

  interface RoutingContextPayload {
    environmentId?: string;
    recommendations?: {
      available: boolean;
      reason: string;
      actionTypes?: string[];
    } | null;
    capabilities: { workloads?: string[]; stages?: string[] } | null;
    switchCriteria: Record<string, unknown> | null;
    providersHealth: {
      providers?: Array<{
        providerType?: string | null;
        status?: string | null;
        source?: string | null;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    } | null;
    routes: AdminRouteRecord[];
    errors: {
      capabilities: ContextError | null;
      switchCriteria: ContextError | null;
      providersHealth: ContextError | null;
      routes: ContextError | null;
    };
  }

  interface StageDescriptor {
    stage: string;
    title: string;
    summary: string;
    route: AdminRouteRecord | null;
    mode: RouteCoverageMode;
  }

  const SOURCE_TYPES = [
    'sep_entry',
    'iep_entry',
    'book',
    'paper',
    'institutional'
  ] as const;

  const PHASES: Array<{
    id: WorkbenchPhaseId;
    title: string;
    cue: string;
    summary: string;
  }> = [
    {
      id: 'prepare',
      title: 'Configure source',
      cue: 'Step 1',
      summary: 'Choose the source, operation type, and basic execution settings.'
    },
    {
      id: 'preflight',
      title: 'Review checks',
      cue: 'Step 2',
      summary: 'See blockers, warnings, and anything that needs fixing before launch.'
    },
    {
      id: 'pipeline',
      title: 'Review pipeline',
      cue: 'Step 3',
      summary: 'Inspect each ingestion stage, its route, and its fallback steps.'
    },
    {
      id: 'simulate',
      title: 'Preview route',
      cue: 'Step 4',
      summary: 'Run a route preview to confirm the likely active path and cost.'
    },
    {
      id: 'run',
      title: 'Launch run',
      cue: 'Step 5',
      summary: 'Queue the operation when the source, routing, and checks are ready.'
    },
    {
      id: 'review',
      title: 'Review result',
      cue: 'Step 6',
      summary: 'Review the outcome, logs, and next action after the run finishes.'
    }
  ];

  const STAGE_META: Record<string, { title: string; summary: string }> = {
    ingestion_extraction: {
      title: 'Extraction',
      summary: 'Pull structured claims and passages out of the source.'
    },
    ingestion_relations: {
      title: 'Relations',
      summary: 'Connect claims, tensions, and support chains.'
    },
    ingestion_grouping: {
      title: 'Grouping',
      summary: 'Assemble argument clusters and recurring positions.'
    },
    ingestion_validation: {
      title: 'Validation',
      summary: 'Check evidence quality, coherence, and promotion readiness.'
    },
    ingestion_embedding: {
      title: 'Embedding',
      summary: 'Prepare retrieval vectors and downstream lookup support.'
    },
    ingestion_json_repair: {
      title: 'Repair',
      summary: 'Clean malformed outputs and stabilize the final record.'
    }
  };

  const OPERATION_PROFILES: Record<
    OperationKind,
    { title: string; summary: string; routeHint: string; launchLabel: string }
  > = {
    ingest_import: {
      title: 'Ingest source',
      summary: 'Run the full staged ingestion pipeline against a source and optionally validate it before storage.',
      routeHint: 'Uses the ingestion route plan and can fall back to a shared route if no dedicated stage route exists.',
      launchLabel: 'Queue ingestion'
    },
    validate: {
      title: 'Validate state',
      summary: 'Check Restormel and Surreal state for consistency or drift.',
      routeHint: 'Validation runs are usually diagnostic and less route-sensitive.',
      launchLabel: 'Queue validation'
    },
    diagnose_doctor: {
      title: 'Run diagnostics',
      summary: 'Launch Restormel doctor tooling to inspect routes, keys, or environment health.',
      routeHint: 'Primarily a CLI-backed diagnostics path.',
      launchLabel: 'Queue diagnostics'
    },
    replay_reingest: {
      title: 'Replay ingestion',
      summary: 'Re-run an existing source through the ingestion stages after a correction or route change.',
      routeHint: 'Respects the same stage routing plan as a fresh import.',
      launchLabel: 'Queue replay'
    },
    repair_finalize: {
      title: 'Repair and finalize',
      summary: 'Repair a local source artifact or finalize a partially completed ingest.',
      routeHint: 'Mostly file/process oriented, with limited route interaction.',
      launchLabel: 'Queue repair'
    },
    sync_to_surreal: {
      title: 'Sync to Surreal',
      summary: 'Confirm or force the graph sync stage for a source.',
      routeHint: 'Uses downstream storage checks rather than the full reasoning stack.',
      launchLabel: 'Queue sync'
    }
  };

  let operations = $state<AdminOperationWorkbenchRecord[]>([]);
  let selectedId = $state<string | null>(null);
  let selectedOperation = $state<AdminOperationWorkbenchRecord | null>(null);
  let selectedKind = $state<OperationKind>('ingest_import');
  let payloadText = $state('');
  let requestState = $state<'idle' | 'submitting'>('idle');
  let pageState = $state<'loading' | 'ready' | 'forbidden'>('loading');
  let currentUserEmail = $state<string | null>(null);
  let errorMessage = $state('');
  let successMessage = $state('');
  let activePhase = $state<WorkbenchPhaseId>('prepare');
  let advancedMode = $state(false);

  let sourceMode = $state<SourceMode>('url');
  let sourceUrl = $state('');
  let sourceType = $state<(typeof SOURCE_TYPES)[number] | ''>('');
  let sourceFile = $state('');
  let validateRun = $state(true);
  let dryRun = $state(false);
  let domain = $state('');
  let ingestProvider = $state<'auto' | 'vertex' | 'anthropic'>('auto');
  let notes = $state('');

  let routingState = $state<'idle' | 'loading' | 'ready'>('idle');
  let routingContext = $state<RoutingContextPayload | null>(null);
  let routeStepsById = $state<Record<string, AdminStepRecord[]>>({});
  let routeStepErrors = $state<Record<string, string>>({});
  let routeHistoryById = $state<Record<string, AdminHistoryEntry[]>>({});
  let routeHistoryErrors = $state<Record<string, string>>({});
  let selectedStage = $state('ingestion_extraction');
  let simulationState = $state<'idle' | 'running' | 'ready' | 'failed'>('idle');
  let simulationResult = $state<Record<string, unknown> | null>(null);
  let simulationError = $state('');
  let recommendationState = $state<'idle' | 'requesting'>('idle');
  let recommendationMessage = $state('');
  let launchConfirmed = $state(false);

  const activeOperation = $derived.by(() =>
    operations.find((operation) => operation.id === selectedId) ?? selectedOperation
  );
  const shouldPoll = $derived.by(() =>
    operations.some((operation) => operation.status === 'queued' || operation.status === 'running')
  );
  const activeProfile = $derived(OPERATION_PROFILES[selectedKind]);
  const routingEnvironmentId = $derived(routingContext?.environmentId ?? 'production');
  const routingStages = $derived.by(
    () => routingContext?.capabilities?.stages ?? Object.keys(STAGE_META)
  );
  const sharedRoute = $derived.by(
    () => routingContext?.routes.find((route) => !route.stage && route.enabled !== false) ?? null
  );
  const stageDescriptors = $derived.by<StageDescriptor[]>(() =>
    routingStages.map((stage) => {
      const dedicatedRoute =
        routingContext?.routes.find((route) => route.stage === stage && route.enabled !== false) ?? null;
      const route = dedicatedRoute ?? sharedRoute ?? null;
      return {
        stage,
        title: STAGE_META[stage]?.title ?? stage.replace(/^ingestion_/, '').replaceAll('_', ' '),
        summary: STAGE_META[stage]?.summary ?? 'Stage detail not yet documented.',
        route,
        mode: dedicatedRoute ? 'dedicated' : route ? 'shared' : 'missing'
      };
    })
  );
  const selectedStageDescriptor = $derived.by(
    () => stageDescriptors.find((descriptor) => descriptor.stage === selectedStage) ?? stageDescriptors[0] ?? null
  );
  const selectedRouteSteps = $derived.by(
    () =>
      (selectedStageDescriptor?.route?.id
        ? routeStepsById[selectedStageDescriptor.route.id] ?? []
        : []) as AdminStepRecord[]
  );
  const selectedRouteStepError = $derived.by(
    () => (selectedStageDescriptor?.route?.id ? routeStepErrors[selectedStageDescriptor.route.id] ?? '' : '')
  );
  const selectedRouteHistory = $derived.by(
    () =>
      (selectedStageDescriptor?.route?.id
        ? routeHistoryById[selectedStageDescriptor.route.id] ?? []
        : []) as AdminHistoryEntry[]
  );
  const selectedRouteHistoryError = $derived.by(
    () => (selectedStageDescriptor?.route?.id ? routeHistoryErrors[selectedStageDescriptor.route.id] ?? '' : '')
  );
  const providerHealthEntries = $derived.by(
    () => routingContext?.providersHealth?.providers ?? []
  );
  const recommendationSupport = $derived.by(
    () =>
      routingContext?.recommendations ?? {
        available: false,
        reason: 'Restormel recommendation actions are not yet available for this environment.',
        actionTypes: []
      }
  );
  const dedicatedRouteCount = $derived(
    stageDescriptors.filter((descriptor) => descriptor.mode === 'dedicated').length
  );
  const sharedFallbackCount = $derived(
    stageDescriptors.filter((descriptor) => descriptor.mode === 'shared').length
  );
  const missingStageCount = $derived(
    stageDescriptors.filter((descriptor) => descriptor.mode === 'missing').length
  );
  const selectedRouteHistoryLatest = $derived.by(() => selectedRouteHistory[0] ?? null);
  const providerHealthSummary = $derived.by(() => {
    const total = providerHealthEntries.length;
    const healthy = providerHealthEntries.filter((provider) =>
      ['healthy', 'ready'].includes((provider.status ?? '').toLowerCase())
    ).length;
    const degraded = providerHealthEntries.filter((provider) =>
      ['degraded', 'warning'].includes((provider.status ?? '').toLowerCase())
    ).length;
    const failed = providerHealthEntries.filter((provider) =>
      ['failed', 'unhealthy'].includes((provider.status ?? '').toLowerCase())
    ).length;
    return { total, healthy, degraded, failed };
  });
  const routeCoverageSummary = $derived.by(() => {
    if (missingStageCount > 0) {
      return {
        tone: 'attention' as PhaseSignal,
        label: `${missingStageCount} missing`,
        detail: 'Some stages still need a dedicated route before this becomes a fully staged ingestion plan.'
      };
    }

    if (sharedFallbackCount > 0) {
      return {
        tone: 'ready' as PhaseSignal,
        label: `${sharedFallbackCount} shared`,
        detail: 'No stages are missing, but some still rely on the shared route rather than a dedicated stage route.'
      };
    }

    return {
      tone: 'passed' as PhaseSignal,
      label: `${dedicatedRouteCount}/${routingStages.length} dedicated`,
      detail: 'Every stage now has dedicated route coverage.'
    };
  });
  const selectedRouteSyncState = $derived.by(() => {
    const route = selectedStageDescriptor?.route;
    if (!route) {
      return {
        tone: 'blocked' as PhaseSignal,
        label: 'No route',
        detail: 'This stage does not yet have a route bound to it.'
      };
    }

    if (selectedRouteHistoryError) {
      return {
        tone: 'attention' as PhaseSignal,
        label: 'History unavailable',
        detail: selectedRouteHistoryError
      };
    }

    if (route.version && route.publishedVersion && route.version !== route.publishedVersion) {
      return {
        tone: 'attention' as PhaseSignal,
        label: 'Draft differs',
        detail: `Draft v${route.version} differs from published v${route.publishedVersion}.`
      };
    }

    return {
      tone: 'passed' as PhaseSignal,
      label: 'In sync',
      detail: `Published route ${route.name ?? route.id} is aligned with the current version.`
    };
  });
  const selectedRoutePolicySummary = $derived.by(() => {
    if (selectedRouteSteps.length === 0) {
      return 'No policy detail is available for this stage yet.';
    }

    const switchCount = selectedRouteSteps.filter((step) => step.switchCriteria || step.fallbackOn).length;
    const retryCount = selectedRouteSteps.filter((step) => step.retryPolicy).length;
    const costCount = selectedRouteSteps.filter((step) => step.costPolicy).length;
    const fallbackCount = Math.max(selectedRouteSteps.length - 1, 0);

    return `${fallbackCount} fallback ${fallbackCount === 1 ? 'step' : 'steps'}, ${switchCount} switch rule${switchCount === 1 ? '' : 's'}, ${retryCount} retry polic${retryCount === 1 ? 'y' : 'ies'}, ${costCount} cost polic${costCount === 1 ? 'y' : 'ies'}.`;
  });
  const suggestedSourceType = $derived.by(() => inferSourceType(sourceUrl));
  const payloadPreviewObject = $derived.by<Record<string, unknown> | null>(() => {
    try {
      return JSON.parse(payloadText) as Record<string, unknown>;
    } catch {
      return null;
    }
  });
  const payloadParseError = $derived.by(() => {
    try {
      JSON.parse(payloadText);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid JSON';
    }
  });
  const estimatedInputTokens = $derived.by(() => {
    if (sourceMode === 'file') return 16_000;
    switch (sourceType) {
      case 'sep_entry':
        return 14_000;
      case 'iep_entry':
        return 12_000;
      case 'book':
        return 35_000;
      case 'paper':
        return 18_000;
      case 'institutional':
        return 9_000;
      default:
        return 12_000;
    }
  });
  const estimatedInputChars = $derived(estimatedInputTokens * 4);
  const activeOperationLogText = $derived.by(() => {
    if (!activeOperation) return 'No logs captured yet.';
    if (typeof activeOperation.log_text === 'string' && activeOperation.log_text.trim()) {
      return activeOperation.log_text;
    }
    if (Array.isArray(activeOperation.logs)) {
      return activeOperation.logs.map((entry) => String(entry)).join('\n');
    }
    return 'No logs captured yet.';
  });
  const routingAdvisory = $derived.by(() => {
    const healthyProviders = providerHealthEntries.filter((provider) =>
      ['healthy', 'ready'].includes((provider.status ?? '').toLowerCase())
    );

    if (selectedKind !== 'ingest_import') {
      return {
        tone: 'ready' as PhaseSignal,
        title: 'Keep this operation direct.',
        body: 'This action is less route-sensitive than a fresh ingest. Use the workbench to keep the payload explicit, then rely on the operator log for confirmation.',
        routeFocus: 'Use the configured route only if this operation explicitly re-enters the ingestion stages.',
        policyFocus: 'Prefer validation and dry-run discipline over aggressive route changes.'
      };
    }

    if (ingestProvider !== 'auto') {
      return {
        tone: 'attention' as PhaseSignal,
        title: 'A manual provider override is active.',
        body: 'Only keep this if you intentionally want to narrow the run. Otherwise let Restormel choose the primary and fallback path for this source.',
        routeFocus: 'Return to automatic routing unless this run is testing a known provider-specific behavior.',
        policyFocus: 'If you keep the override, leave fallback and retry policies permissive enough to recover from provider failure.'
      };
    }

    if (providerHealthEntries.length === 0) {
      return {
        tone: 'attention' as PhaseSignal,
        title: 'Routing exists, but provider visibility is weak.',
        body: 'Sophia can still launch the run, but it cannot confidently advise reliability because the provider-health surface is empty for this project.',
        routeFocus: 'Prefer shared fallbacks or conservative stage routes until health entries are visible.',
        policyFocus: 'Keep validation enabled and treat this as a higher-observation run.'
      };
    }

    if (missingStageCount > 0) {
      return {
        tone: 'attention' as PhaseSignal,
        title: 'Use this as a bootstrap route, not a finished ingestion plan.',
        body: 'Some stages still rely on shared coverage or have no route at all. The system can run, but the pipeline is not yet tailored stage-by-stage.',
        routeFocus: 'Prioritise dedicated routes for extraction, grouping, and validation first.',
        policyFocus: 'Use broad fallback-on-error policies until the dedicated stages are configured.'
      };
    }

    if (estimatedInputTokens > 20_000 || healthyProviders.length < 2) {
      return {
        tone: 'ready' as PhaseSignal,
        title: 'Bias for resilience over speed.',
        body: 'This source looks heavy enough that you should preserve fallback breadth and keep validation live, even if that increases latency slightly.',
        routeFocus: 'Prefer dedicated stage routes with at least one meaningful fallback chain.',
        policyFocus: 'Keep timeout, rate-limit, and provider-health switchover rules active.'
      };
    }

    return {
      tone: 'passed' as PhaseSignal,
      title: 'Automatic staged routing is the right default here.',
      body: 'Coverage and provider visibility are good enough for Sophia to trust Restormel to choose the primary route and keep the user out of the weeds.',
      routeFocus: 'Leave provider selection on automatic and let the stage routes do their work.',
      policyFocus: 'Use normal fallback-on-error behavior and validate before promotion.'
    };
  });

  function templateFor(kind: OperationKind): string {
    return data.payloadTemplates[kind];
  }

  function inferSourceType(url: string): (typeof SOURCE_TYPES)[number] | null {
    const normalized = url.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('plato.stanford.edu')) return 'sep_entry';
    if (normalized.includes('iep.utm.edu')) return 'iep_entry';
    if (normalized.endsWith('.pdf') || normalized.includes('/doi/')) return 'paper';
    if (normalized.includes('/book') || normalized.includes('/books/')) return 'book';
    if (normalized.includes('.edu') || normalized.includes('.ac.') || normalized.includes('.org')) {
      return 'institutional';
    }
    return null;
  }

  function stageLatency(stage: string): 'low' | 'balanced' | 'high' {
    if (stage === 'ingestion_extraction' || stage === 'ingestion_json_repair') return 'low';
    if (stage === 'ingestion_validation' || stage === 'ingestion_grouping') return 'high';
    return 'balanced';
  }

  function stageComplexity(tokens: number): 'low' | 'medium' | 'high' {
    if (tokens > 20_000) return 'high';
    if (tokens > 10_000) return 'medium';
    return 'low';
  }

  function formatDate(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function badgeClass(status: AdminOperationRecord['status']): string {
    switch (status) {
      case 'succeeded':
        return 'bg-sophia-dark-sage/20 text-sophia-dark-sage border-sophia-dark-sage/40';
      case 'queued':
      case 'running':
        return 'bg-sophia-dark-blue/20 text-sophia-dark-blue border-sophia-dark-blue/40';
      case 'cancelled':
        return 'bg-sophia-dark-surface-raised text-sophia-dark-muted border-sophia-dark-border';
      default:
        return 'bg-sophia-dark-copper/20 text-sophia-dark-copper border-sophia-dark-copper/40';
    }
  }

  function statusTone(signal: PhaseSignal): string {
    switch (signal) {
      case 'passed':
        return 'text-sophia-dark-sage border-sophia-dark-sage/35 bg-sophia-dark-sage/8';
      case 'ready':
        return 'text-sophia-dark-blue border-sophia-dark-blue/35 bg-sophia-dark-blue/8';
      case 'running':
        return 'text-sophia-dark-amber border-sophia-dark-amber/35 bg-sophia-dark-amber/8';
      case 'blocked':
        return 'text-sophia-dark-coral border-sophia-dark-coral/35 bg-sophia-dark-coral/8';
      case 'attention':
        return 'text-sophia-dark-copper border-sophia-dark-copper/35 bg-sophia-dark-copper/8';
      default:
        return 'text-sophia-dark-dim border-sophia-dark-border bg-sophia-dark-surface-raised/30';
    }
  }

  function phaseSignalLabel(signal: PhaseSignal): string {
    switch (signal) {
      case 'not_started':
        return 'Not started';
      case 'blocked':
        return 'Blocked';
      case 'attention':
        return 'Needs attention';
      case 'ready':
        return 'Ready';
      case 'running':
        return 'Running';
      case 'passed':
        return 'Passed';
    }
  }

  function routeModeTone(mode: RouteCoverageMode): string {
    switch (mode) {
      case 'dedicated':
        return 'text-sophia-dark-sage border-sophia-dark-sage/35 bg-sophia-dark-sage/8';
      case 'shared':
        return 'text-sophia-dark-blue border-sophia-dark-blue/35 bg-sophia-dark-blue/8';
      default:
        return 'text-sophia-dark-copper border-sophia-dark-copper/35 bg-sophia-dark-copper/8';
    }
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

  function currentTrianglePass(): 'analysis' | 'critique' | 'synthesis' {
    if (activePhase === 'prepare' || activePhase === 'preflight') return 'analysis';
    if (activePhase === 'pipeline' || activePhase === 'simulate') return 'critique';
    return 'synthesis';
  }

  function startedTrianglePasses(): string[] {
    if (activePhase === 'prepare') return ['analysis'];
    if (activePhase === 'preflight') return ['analysis'];
    if (activePhase === 'pipeline' || activePhase === 'simulate') return ['analysis', 'critique'];
    return ['analysis', 'critique', 'synthesis'];
  }

  function completedTrianglePasses(): string[] {
    if (activePhase === 'prepare') return [];
    if (activePhase === 'preflight') return prepareReady ? ['analysis'] : [];
    if (activePhase === 'pipeline' || activePhase === 'simulate') return ['analysis'];
    if (activePhase === 'review' && activeOperation?.status === 'succeeded') {
      return ['analysis', 'critique', 'synthesis'];
    }
    return ['analysis', 'critique'];
  }

  function buildIngestPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (sourceMode === 'url') {
      if (sourceUrl.trim()) payload.source_url = sourceUrl.trim();
      if (sourceType) payload.source_type = sourceType;
    } else if (sourceFile.trim()) {
      payload.source_file = sourceFile.trim();
    }
    payload.validate = validateRun;
    if (ingestProvider !== 'auto') payload.ingest_provider = ingestProvider;
    if (domain.trim()) payload.domain = domain.trim();
    if (dryRun) payload.dry_run = true;
    if (notes.trim()) payload.notes = notes.trim();
    return payload;
  }

  function hydrateIngestFormFromPayload(input: unknown): void {
    if (!input || typeof input !== 'object') return;
    const payload = input as Record<string, unknown>;
    sourceMode = typeof payload.source_file === 'string' && payload.source_file.trim() ? 'file' : 'url';
    sourceUrl = typeof payload.source_url === 'string' ? payload.source_url : '';
    sourceType = SOURCE_TYPES.includes(payload.source_type as (typeof SOURCE_TYPES)[number])
      ? (payload.source_type as (typeof SOURCE_TYPES)[number])
      : '';
    sourceFile = typeof payload.source_file === 'string' ? payload.source_file : '';
    validateRun = typeof payload.validate === 'boolean' ? payload.validate : true;
    domain = typeof payload.domain === 'string' ? payload.domain : '';
    dryRun = Boolean(payload.dry_run);
    notes = typeof payload.notes === 'string' ? payload.notes : '';
    ingestProvider =
      payload.ingest_provider === 'vertex' || payload.ingest_provider === 'anthropic'
        ? payload.ingest_provider
        : 'auto';
  }

  function handleKindChange(kind: string): void {
    selectedKind = kind as OperationKind;
    payloadText = templateFor(selectedKind);
    activePhase = 'prepare';
    simulationState = 'idle';
    simulationResult = null;
    simulationError = '';
    if (selectedKind === 'ingest_import') {
      try {
        hydrateIngestFormFromPayload(JSON.parse(payloadText));
      } catch {
        hydrateIngestFormFromPayload({});
      }
    }
  }

  function applySuggestedSourceType(): void {
    if (suggestedSourceType) sourceType = suggestedSourceType;
  }

  function useAutomaticRouting(): void {
    ingestProvider = 'auto';
  }

  function preflightBlockers(): string[] {
    const issues: string[] = [];
    if (selectedKind === 'ingest_import') {
      if (sourceMode === 'url' && !sourceUrl.trim()) issues.push('Choose a source URL before continuing.');
      if (sourceMode === 'file' && !sourceFile.trim()) issues.push('Choose a source file before continuing.');
      if (sourceMode === 'url' && sourceUrl.trim() && !sourceType) {
        issues.push('A source type is required for URL-based ingestion.');
      }
    }
    if (payloadParseError) issues.push('The generated payload is not valid JSON.');
    return issues;
  }

  function preflightWarnings(): string[] {
    const issues: string[] = [];
    if (selectedKind === 'ingest_import') {
      if (providerHealthEntries.length === 0) {
        issues.push('Provider health is not surfacing any configured providers yet.');
      }
      if (missingStageCount > 0) {
        issues.push(`${missingStageCount} ingestion stage${missingStageCount === 1 ? '' : 's'} still lack a dedicated route.`);
      }
      if (sharedFallbackCount > 0) {
        issues.push(`${sharedFallbackCount} stage${sharedFallbackCount === 1 ? '' : 's'} currently rely on a shared fallback route.`);
      }
    }
    if (routingContext?.errors?.routes) {
      issues.push(`Restormel routes could not be read: ${routingContext.errors.routes.detail}`);
    }
    return issues;
  }

  const prepareReady = $derived(preflightBlockers().length === 0);
  const canLaunch = $derived(
    prepareReady &&
      requestState !== 'submitting' &&
      (selectedKind !== 'ingest_import' || launchConfirmed)
  );
  const preflightBlockerList = $derived.by(() => preflightBlockers());
  const preflightWarningList = $derived.by(() => preflightWarnings());
  const criticalSignals = $derived.by(() => {
    const signals: Array<{ tone: 'attention' | 'ready' | 'passed'; label: string; value: string; detail: string }> = [];

    if (preflightBlockerList.length > 0) {
      signals.push({
        tone: 'attention',
        label: 'Blockers',
        value: `${preflightBlockerList.length}`,
        detail: 'Fix these before launch.'
      });
    } else {
      signals.push({
        tone: 'passed',
        label: 'Blockers',
        value: '0',
        detail: 'No required fixes.'
      });
    }

    if (providerHealthEntries.length === 0) {
      signals.push({
        tone: 'attention',
        label: 'Provider health',
        value: 'Unavailable',
        detail: 'Reliability signal is weak.'
      });
    } else {
      signals.push({
        tone: 'passed',
        label: 'Provider health',
        value: `${providerHealthEntries.length}`,
        detail: 'Configured providers visible.'
      });
    }

    if (missingStageCount > 0) {
      signals.push({
        tone: 'attention',
        label: 'Route coverage',
        value: `${missingStageCount} missing`,
        detail: 'Some stages still need routing.'
      });
    } else if (sharedFallbackCount > 0) {
      signals.push({
        tone: 'ready',
        label: 'Route coverage',
        value: `${sharedFallbackCount} shared`,
        detail: 'No stages are missing, but some still rely on the shared route.'
      });
    } else {
      signals.push({
        tone: 'passed',
        label: 'Route coverage',
        value: `${dedicatedRouteCount} dedicated`,
        detail: 'Every stage has dedicated coverage.'
      });
    }

    signals.push({
      tone: ingestProvider === 'auto' ? 'passed' : 'ready',
      label: 'Routing mode',
      value: ingestProvider === 'auto' ? 'Automatic' : 'Manual',
      detail: ingestProvider === 'auto' ? 'Restormel chooses the path.' : 'A provider override is active.'
    });

    return signals;
  });
  const dominantSignal = $derived.by(() => {
    if (preflightBlockerList.length > 0) {
      return {
        tone: 'attention' as PhaseSignal,
        title: 'This run needs fixes before launch.',
        detail: preflightBlockerList[0]
      };
    }
    if (providerHealthEntries.length === 0) {
      return {
        tone: 'attention' as PhaseSignal,
        title: 'Provider health is not visible for this project.',
        detail: 'You can still configure the run, but reliability guidance is weaker than it should be.'
      };
    }
    if (missingStageCount > 0) {
      return {
        tone: 'ready' as PhaseSignal,
        title: 'The pipeline is usable, but stage routing is incomplete.',
        detail: `${missingStageCount} stage${missingStageCount === 1 ? '' : 's'} still rely on shared or missing coverage.`
      };
    }
    return {
      tone: 'passed' as PhaseSignal,
      title: 'The workbench is ready for a clean staged walkthrough.',
      detail: 'Source setup, route coverage, and provider visibility are in a workable state.'
    };
  });
  const reviewRecommendation = $derived.by(() => {
    if (!activeOperation) {
      return {
        tone: 'not_started' as PhaseSignal,
        title: 'No run selected yet.',
        detail: 'Choose a recent run or queue a new operation to inspect outcomes here.'
      };
    }

    if (activeOperation.status === 'queued' || activeOperation.status === 'running') {
      return {
        tone: 'running' as PhaseSignal,
        title: 'This run is still in progress.',
        detail: 'Keep the review panel open for logs, or leave it running while you inspect another phase.'
      };
    }

    if (activeOperation.status === 'succeeded') {
      return {
        tone: 'passed' as PhaseSignal,
        title: 'The run completed successfully.',
        detail: 'Review the outcome and lineage, then decide whether a follow-on validation, sync, or promotion step is needed.'
      };
    }

    return {
      tone: 'attention' as PhaseSignal,
      title: 'This run needs operator attention.',
      detail: activeOperation.last_error ?? 'Check the summary and log, then retry or adjust the route before running again.'
    };
  });
  const activePhaseMeta = $derived.by(
    () => PHASES.find((phase) => phase.id === activePhase) ?? PHASES[0]
  );
  const activePhaseNumber = $derived.by(
    () => Math.max(1, PHASES.findIndex((phase) => phase.id === activePhase) + 1)
  );
  const systemStatus = $derived.by(() => {
    if (preflightBlockerList.length > 0) {
      return {
        tone: 'blocked' as PhaseSignal,
        eyebrow: 'Launch blocked',
        title: `${preflightBlockerList.length} blocker${preflightBlockerList.length === 1 ? '' : 's'} must be resolved before this run can continue.`,
        detail: preflightBlockerList[0],
        ctaLabel: 'Review checks',
        ctaHref: null as string | null,
        ctaAction: 'preflight' as const
      };
    }

    if (missingStageCount > 0) {
      return {
        tone: 'attention' as PhaseSignal,
        eyebrow: 'Route coverage',
        title: `${missingStageCount} stage${missingStageCount === 1 ? '' : 's'} still need dedicated routing.`,
        detail:
          providerHealthEntries.length === 0
            ? 'Provider visibility is also weak for this project, so launch guidance is incomplete.'
            : 'Automatic fallback can still run, but the staged plan is not yet fully bound.',
        ctaLabel: 'Open routing studio',
        ctaHref: '/admin/ingestion-routing',
        ctaAction: null as 'preflight' | null
      };
    }

    if (providerHealthEntries.length === 0) {
      return {
        tone: 'attention' as PhaseSignal,
        eyebrow: 'Weak signal',
        title: 'Provider health is not visible for this project.',
        detail: 'Routing can still exist, but reliability guidance is weaker than it should be until bindings are visible.',
        ctaLabel: 'Review checks',
        ctaHref: null as string | null,
        ctaAction: 'preflight' as const
      };
    }

    return {
      tone: 'passed' as PhaseSignal,
      eyebrow: 'System',
      title: 'The operator surface is clear enough to walk the run from source to review.',
      detail: 'Routes, provider visibility, and staged checks are available.',
      ctaLabel: 'Review pipeline',
      ctaHref: null as string | null,
      ctaAction: 'pipeline' as const
    };
  });
  const stickyAction = $derived.by(() => {
    switch (activePhase) {
      case 'prepare':
        return {
          label: 'Continue to review checks',
          note: `Step ${activePhaseNumber} of ${PHASES.length} · ${prepareReady ? 'Source configured' : 'Source still needs attention'}`,
          disabled: !prepareReady,
          secondaryLabel: advancedMode ? 'Hide raw payload' : 'Open raw payload',
          secondaryAction: 'payload' as const
        };
      case 'preflight':
        return {
          label: 'Continue to review pipeline',
          note: `Step ${activePhaseNumber} of ${PHASES.length} · ${preflightBlockerList.length === 0 ? 'Checks reviewed' : 'Fix blockers before launch'}`,
          disabled: !prepareReady,
          secondaryLabel: 'Back to source',
          secondaryAction: 'prepare' as const
        };
      case 'pipeline':
        return {
          label: 'Continue to route preview',
          note: `Step ${activePhaseNumber} of ${PHASES.length} · ${missingStageCount > 0 ? `${missingStageCount} stage${missingStageCount === 1 ? '' : 's'} still unrouted` : 'Pipeline inspected'}`,
          disabled: false,
          secondaryLabel: 'Open routing studio',
          secondaryAction: 'routing' as const
        };
      case 'simulate':
        return {
          label: 'Continue to launch',
          note: `Step ${activePhaseNumber} of ${PHASES.length} · ${simulationState === 'ready' ? 'Preview complete' : 'Run preview before launch if you need cost or route evidence'}`,
          disabled: false,
          secondaryLabel: 'Back to pipeline',
          secondaryAction: 'pipeline' as const
        };
      case 'run':
        return {
          label: requestState === 'submitting' ? 'Queueing…' : activeProfile.launchLabel,
          note: `Step ${activePhaseNumber} of ${PHASES.length} · ${canLaunch ? 'Ready to queue' : 'Confirm the launch checklist before queueing'}`,
          disabled: !canLaunch,
          secondaryLabel: 'Back to preview',
          secondaryAction: 'simulate' as const
        };
      default:
        return {
          label: activeOperation ? 'Review pipeline again' : 'Start a new run',
          note: `Step ${activePhaseNumber} of ${PHASES.length} · ${activeOperation ? 'Review complete' : 'No run selected yet'}`,
          disabled: false,
          secondaryLabel: activeOperation ? 'Retry selected run' : 'Back to source',
          secondaryAction: activeOperation ? 'retry' as const : 'prepare' as const
        };
    }
  });

  function phaseSignal(id: WorkbenchPhaseId): PhaseSignal {
    const blockers = preflightBlockerList;
    const warnings = preflightWarningList;
    const hasSucceeded = activeOperation?.status === 'succeeded';
    const hasSourceInput = Boolean(sourceUrl.trim() || sourceFile.trim());
    const activeIdx = PHASES.findIndex((phase) => phase.id === activePhase);
    const idx = PHASES.findIndex((phase) => phase.id === id);

    if (idx > activeIdx) {
      if (id === 'run' && simulationState === 'ready') return 'ready';
      if (id === 'review' && activeOperation) {
        return activeOperation.status === 'queued' || activeOperation.status === 'running' ? 'running' : 'ready';
      }
      return 'not_started';
    }

    if (id === 'prepare') {
      if (!hasSourceInput && !payloadParseError) return activePhase === 'prepare' ? 'not_started' : 'not_started';
      if (activePhase === 'prepare') return prepareReady ? 'ready' : 'attention';
      return prepareReady ? 'passed' : 'attention';
    }

    if (id === 'preflight') {
      if (!hasSourceInput) return 'not_started';
      if (!prepareReady) return activePhase === 'preflight' ? 'blocked' : 'blocked';
      if (blockers.length > 0) return 'blocked';
      if (warnings.length > 0) return 'attention';
      return activePhase === 'preflight' ? 'ready' : 'passed';
    }

    if (id === 'pipeline') {
      if (!prepareReady) return activeIdx >= idx ? 'blocked' : 'not_started';
      if (missingStageCount > 0 || providerHealthEntries.length === 0) return 'attention';
      return activePhase === 'pipeline' ? 'ready' : 'passed';
    }

    if (id === 'simulate') {
      if (!prepareReady) return activeIdx >= idx ? 'blocked' : 'not_started';
      if (simulationState === 'running') return 'running';
      if (simulationState === 'ready') return 'passed';
      if (simulationState === 'failed') return 'attention';
      return activePhase === 'simulate' ? 'ready' : 'not_started';
    }

    if (id === 'run') {
      if (!prepareReady) return activeIdx >= idx ? 'blocked' : 'not_started';
      if (activeOperation?.status === 'queued' || activeOperation?.status === 'running') return 'running';
      if (hasSucceeded) return 'passed';
      if (activeOperation) {
        return activeOperation.status === 'succeeded' ? 'passed' : 'attention';
      }
      return simulationState === 'ready' ? 'ready' : 'not_started';
    }

    if (!activeOperation) return 'not_started';
    if (activeOperation.status === 'succeeded') return 'passed';
    if (activeOperation.status === 'queued' || activeOperation.status === 'running') return 'running';
    return 'attention';
  }

  function nextPhase(id: WorkbenchPhaseId): WorkbenchPhaseId | null {
    const idx = PHASES.findIndex((phase) => phase.id === id);
    return idx >= 0 && idx < PHASES.length - 1 ? PHASES[idx + 1].id : null;
  }

  function advancePhase(): void {
    const next = nextPhase(activePhase);
    if (next) activePhase = next;
  }

  async function handlePrimaryPhaseAction(): Promise<void> {
    if (activePhase === 'run') {
      await submitOperation();
      return;
    }

    if (activePhase === 'review') {
      activePhase = activeOperation ? 'pipeline' : 'prepare';
      return;
    }

    advancePhase();
  }

  async function handleSecondaryPhaseAction(): Promise<void> {
    switch (stickyAction.secondaryAction) {
      case 'payload':
        advancedMode = !advancedMode;
        return;
      case 'prepare':
        activePhase = 'prepare';
        return;
      case 'pipeline':
        activePhase = 'pipeline';
        return;
      case 'simulate':
        activePhase = 'simulate';
        return;
      case 'routing':
        await goto('/admin/ingestion-routing');
        return;
      case 'retry':
        if (activeOperation) {
          await triggerOperationAction(activeOperation.id, 'retry');
        }
        return;
    }
  }

  async function requestRecommendation(actionType: string): Promise<void> {
    recommendationState = 'requesting';
    recommendationMessage = '';
    errorMessage = '';

    try {
      const routeId = selectedStageDescriptor?.route?.id;
      if (!routeId) {
        throw new Error('No route is bound to the selected stage.');
      }

      const body = await authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          actionType,
          environmentId: routingEnvironmentId,
          workload: selectedStageDescriptor?.route?.workload ?? 'ingestion',
          stage: selectedStageDescriptor?.stage ?? selectedStage,
          task: selectedStageDescriptor?.stage === 'ingestion_embedding' ? 'embedding' : 'completion',
          estimatedInputTokens,
          estimatedInputChars
        })
      });

      const recommendedAction =
        body?.recommendation?.recommendedAction ??
        body?.recommendation?.reason ??
        body?.data?.recommendations?.[0]?.recommendedAction ??
        body?.data?.recommendations?.[0]?.reason ??
        body?.support?.reason;

      const estimatedImpact =
        body?.recommendation?.estimatedImpact ??
        body?.data?.recommendations?.[0]?.estimatedImpact;

      if (recommendedAction) {
        recommendationMessage = estimatedImpact
          ? `${recommendedAction} ${estimatedImpact}`
          : String(recommendedAction);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recommendation request failed';
      recommendationMessage = message;
      errorMessage = message;
    } finally {
      recommendationState = 'idle';
    }
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
        const suffix = detail.endpoint ? ` (${detail.endpoint})` : '';
        throw new Error(`[${detail.status} ${detail.code}] ${detail.detail}${suffix}`);
      }
      throw new Error(typeof body?.error === 'string' ? body.error : `status ${response.status}`);
    }
    return body;
  }

  async function refreshOperations(): Promise<void> {
    const body = await authorizedJson('/api/admin/operations?limit=25');
    operations = Array.isArray(body.operations) ? body.operations : [];
    if (!selectedId && operations.length > 0) {
      selectedId = operations[0].id;
      selectedOperation = operations[0];
      return;
    }
    if (selectedId) {
      selectedOperation = operations.find((operation) => operation.id === selectedId) ?? selectedOperation;
    }
  }

  async function refreshRoutingContext(): Promise<void> {
    routingState = 'loading';
    const body = (await authorizedJson('/api/admin/ingestion-routing/context')) as RoutingContextPayload;
    routingContext = body;

    const uniqueRouteIds = Array.from(
      new Set((body.routes ?? []).map((route) => route.id).filter((id): id is string => Boolean(id)))
    );
    const nextSteps: Record<string, AdminStepRecord[]> = {};
    const nextErrors: Record<string, string> = {};
    const nextHistory: Record<string, AdminHistoryEntry[]> = {};
    const nextHistoryErrors: Record<string, string> = {};

    await Promise.all(
      uniqueRouteIds.map(async (routeId) => {
        try {
          const [stepBody, historyBody] = await Promise.all([
            authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/steps`),
            authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/history`)
          ]);
          nextSteps[routeId] = Array.isArray(stepBody.steps) ? stepBody.steps : [];
          nextHistory[routeId] = Array.isArray(historyBody.history) ? historyBody.history : [];
        } catch (error) {
          nextSteps[routeId] = [];
          nextHistory[routeId] = [];
          nextErrors[routeId] = error instanceof Error ? error.message : 'Failed to load route steps';
          nextHistoryErrors[routeId] = error instanceof Error ? error.message : 'Failed to load route history';
        }
      })
    );

    routeStepsById = nextSteps;
    routeStepErrors = nextErrors;
    routeHistoryById = nextHistory;
    routeHistoryErrors = nextHistoryErrors;
    if (!selectedStage || !routingStages.includes(selectedStage)) {
      selectedStage = routingStages[0] ?? 'ingestion_extraction';
    }
    routingState = 'ready';
  }

  async function loadOperation(id: string): Promise<void> {
    selectedId = id;
    const body = await authorizedJson(`/api/admin/operations/${id}`);
    selectedOperation = body.operation ?? null;
    const idx = operations.findIndex((operation) => operation.id === id);
    if (idx >= 0 && selectedOperation) {
      operations[idx] = selectedOperation;
      operations = [...operations];
    }
  }

  async function submitOperation(): Promise<void> {
    requestState = 'submitting';
    errorMessage = '';
    successMessage = '';
    try {
      const payload = JSON.parse(payloadText);
      const body = await authorizedJson('/api/admin/operations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          kind: selectedKind,
          payload
        })
      });
      successMessage = `${body.operation.requested_action} queued.`;
      selectedId = body.operation.id;
      selectedOperation = body.operation;
      await refreshOperations();
      await loadOperation(body.operation.id);
      activePhase = 'review';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to submit operation';
    } finally {
      requestState = 'idle';
    }
  }

  async function triggerOperationAction(id: string, action: 'cancel' | 'retry'): Promise<void> {
    errorMessage = '';
    successMessage = '';
    try {
      const body = await authorizedJson(`/api/admin/operations/${id}/${action}`, {
        method: 'POST'
      });
      successMessage = action === 'cancel' ? 'Cancellation requested.' : 'Retry queued.';
      selectedOperation = body.operation ?? null;
      await refreshOperations();
      if (selectedOperation) {
        selectedId = selectedOperation.id;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to update operation';
    }
  }

  async function runSimulationPreview(): Promise<void> {
    simulationState = 'running';
    simulationError = '';
    simulationResult = null;

    try {
      const route = selectedStageDescriptor?.route;
      if (!route?.id) {
        throw new Error('No route is currently bound to this stage.');
      }

      const body =
        route.stage || route.workload
          ? {
              environmentId: routingEnvironmentId,
              workload: route.workload ?? 'ingestion',
              stage: selectedStageDescriptor?.stage ?? selectedStage,
              task: selectedStageDescriptor?.stage === 'ingestion_embedding' ? 'embedding' : 'completion',
              attempt: 1,
              estimatedInputTokens,
              estimatedInputChars,
              complexity: stageComplexity(estimatedInputTokens),
              constraints: {
                latency: stageLatency(selectedStageDescriptor?.stage ?? selectedStage)
              }
            }
          : {
              environmentId: routingEnvironmentId
            };

      const bodyJson = await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      simulationResult = bodyJson.simulation ?? null;
      simulationState = 'ready';
      activePhase = 'simulate';
    } catch (error) {
      simulationError = error instanceof Error ? error.message : 'Failed to simulate route';
      simulationState = 'failed';
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
    const body = await response.json();
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
      await Promise.all([refreshOperations(), refreshRoutingContext()]);
    }
  }

  $effect(() => {
    if (!payloadText) {
      payloadText = templateFor(selectedKind);
    }
  });

  $effect(() => {
    if (selectedKind === 'ingest_import') {
      payloadText = JSON.stringify(buildIngestPayload(), null, 2);
    }
  });

  $effect(() => {
    if (activePhase !== 'run' && launchConfirmed) {
      launchConfirmed = false;
    }
  });

  onMount(() => {
    if (!browser) return;
    try {
      hydrateIngestFormFromPayload(JSON.parse(templateFor('ingest_import')));
    } catch {
      // keep defaults
    }

    let interval: number | null = null;

    const startPolling = () => {
      if (interval !== null) return;
      interval = window.setInterval(async () => {
        if (pageState !== 'ready' || !shouldPoll) return;
        try {
          await refreshOperations();
          if (selectedId) {
            await loadOperation(selectedId);
          }
        } catch {
          // keep the last successful state on screen
        }
      }, 4000);
    };

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
    startPolling();

    return () => {
      unsubscribe();
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  });
</script>

<div class="admin-workbench min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
  <div class="mx-auto max-w-[100rem] px-5 py-8 space-y-8 md:px-6">
    <section class="workbench-hero rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 md:p-8">
      <div class="hero-grid grid gap-6">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center gap-3">
            <span class="rounded-full border border-sophia-dark-purple/35 bg-sophia-dark-purple/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-purple">
              Admin Ingestion Workbench
            </span>
            <span class={`rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] ${statusTone(systemStatus.tone)}`}>
              {systemStatus.eyebrow}
            </span>
          </div>

          <div>
            <h1 class="max-w-3xl text-[2.25rem] font-serif leading-[1.04] text-sophia-dark-text md:text-[2.85rem]">
              Six steps from source to knowledge. The pipeline is yours to command.
            </h1>
            <p class="mt-3 max-w-2xl text-[0.96rem] leading-7 text-sophia-dark-muted md:text-[1.02rem]">
              Start here, configure the run, inspect the route, and only queue the ingest when the checks and stage signals say it is safe to proceed.
            </p>
          </div>

          <div class="flex flex-col gap-3 md:flex-row md:items-center">
            <button
              type="button"
              onclick={() => (activePhase = 'prepare')}
              class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-5 py-3 font-mono text-sm text-sophia-dark-text shadow-[0_0_0_1px_rgba(156,132,216,0.18)] hover:bg-sophia-dark-purple/24"
            >
              Configure your ingestion run →
            </button>
            <p class="max-w-2xl text-sm leading-6 text-sophia-dark-muted">
              Use the left rail to move through the ritual sequence. Raw payload editing stays available when you need expert control.
            </p>
          </div>
        </div>

        <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/82 p-4 md:p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase signal</div>
              <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                The triangle tracks setup, route judgment, launch, and review without pushing raw infrastructure into the primary flow.
              </p>
            </div>
            <DialecticalTriangle
              mode={activePhase === 'review' && activeOperation?.status === 'succeeded' ? 'complete' : 'loading'}
              currentPass={currentTrianglePass()}
              startedPasses={startedTrianglePasses()}
              completedPasses={completedTrianglePasses()}
              completionReady={prepareReady}
              size={160}
            />
          </div>

          <div class="mt-5 grid gap-3">
            <div class="flex items-center justify-between rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/50 px-3 py-2">
              <span class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-dim">Current focus</span>
              <span class="font-mono text-sm text-sophia-dark-text">{activePhaseMeta.title}</span>
            </div>
            <div class="flex items-center justify-between rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/50 px-3 py-2">
              <span class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-dim">Run queue</span>
              <span class="font-mono text-sm text-sophia-dark-text">{operations.length} visible</span>
            </div>
            <div class="flex items-center justify-between rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/50 px-3 py-2">
              <span class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-dim">System</span>
              <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${statusTone(systemStatus.tone)}`}>
                {phaseSignalLabel(systemStatus.tone)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    {#if pageState === 'loading'}
      <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface px-4 py-10 text-center font-mono text-sm text-sophia-dark-muted">
        Loading administrator context…
      </div>
    {:else if pageState === 'forbidden'}
      <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-6 font-mono text-sm text-sophia-dark-copper">
        Administrator access is required for this workbench.
        {#if currentUserEmail}
          Current account: {currentUserEmail}
        {/if}
      </div>
    {/if}

    {#if errorMessage}
      <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-sm text-sophia-dark-copper">
        {errorMessage}
      </div>
    {/if}

    {#if successMessage}
      <div class="rounded border border-sophia-dark-sage/40 bg-sophia-dark-sage/10 px-4 py-3 font-mono text-sm text-sophia-dark-sage">
        {successMessage}
      </div>
    {/if}

    {#if pageState === 'ready'}
      <section class={`system-status-bar rounded border px-4 py-3 ${statusTone(systemStatus.tone)}`}>
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em]">{systemStatus.eyebrow}</div>
            <div class="mt-1 text-base font-semibold text-sophia-dark-text">{systemStatus.title}</div>
            <p class="mt-1 text-sm leading-6 text-sophia-dark-muted">{systemStatus.detail}</p>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            {#if systemStatus.ctaHref}
              <a
                href={systemStatus.ctaHref}
                class="rounded border border-current/25 bg-sophia-dark-surface px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
              >
                {systemStatus.ctaLabel} →
              </a>
            {:else if systemStatus.ctaAction}
              <button
                type="button"
                onclick={() => (activePhase = systemStatus.ctaAction === 'pipeline' ? 'pipeline' : 'preflight')}
                class="rounded border border-current/25 bg-sophia-dark-surface px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
              >
                {systemStatus.ctaLabel} →
              </button>
            {/if}
          </div>
        </div>
      </section>

      <div class="workbench-layout grid gap-6">
        <nav class="phase-rail rounded border border-sophia-dark-border bg-sophia-dark-surface px-4 py-5" aria-label="Ingestion walkthrough phases">
          <div class="phase-rail-steps space-y-3">
            {#each PHASES as phase, index}
              <button
                type="button"
                class="phase-step phase-step-rail rounded border px-4 py-4 text-left transition-colors"
                class:is-active={phase.id === activePhase}
                class:is-passed={phaseSignal(phase.id) === 'passed'}
                class:is-attention={phaseSignal(phase.id) === 'attention'}
                class:is-blocked={phaseSignal(phase.id) === 'blocked'}
                class:is-locked={phaseSignal(phase.id) === 'not_started'}
                onclick={() => (activePhase = phase.id)}
              >
                <div class="phase-step-connector" aria-hidden="true">
                  <span class="phase-step-node">{index + 1}</span>
                </div>
                <div class="ml-12">
                <div class="flex items-start justify-between gap-3">
                  <div>
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">{phase.cue}</div>
                      <div class="phase-step-title mt-2 font-serif leading-none text-sophia-dark-text">{phase.title}</div>
                    </div>
                  </div>
                  <p class="phase-step-summary mt-2 hidden text-sm leading-6 text-sophia-dark-muted">{phase.summary}</p>
                  <div class="mt-3">
                    <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${statusTone(phaseSignal(phase.id))}`}>
                      {phaseSignalLabel(phaseSignal(phase.id))}
                    </span>
                  </div>
                </div>
              </button>
            {/each}
          </div>

          <div class="mt-5 rounded border border-sophia-dark-border bg-sophia-dark-bg/76 p-4">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Signal panel</div>
            <div class="mt-4 space-y-3">
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 px-3 py-3">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route</div>
                <div class="mt-2 font-mono text-sm text-sophia-dark-text">{ingestProvider === 'auto' ? 'Automatic' : `${ingestProvider} override`}</div>
              </div>
              <div class={`rounded border px-3 py-3 ${statusTone(routeCoverageSummary.tone)}`}>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Route coverage</div>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <span class="rounded-full border border-sophia-dark-sage/35 bg-sophia-dark-sage/8 px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-sage">
                    {dedicatedRouteCount} dedicated
                  </span>
                  <span class="rounded-full border border-sophia-dark-blue/35 bg-sophia-dark-blue/8 px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-blue">
                    {sharedFallbackCount} shared
                  </span>
                  <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${missingStageCount > 0 ? 'text-sophia-dark-coral border-sophia-dark-coral/35 bg-sophia-dark-coral/8' : 'text-sophia-dark-dim border-sophia-dark-border bg-sophia-dark-surface-raised/30'}`}>
                    {missingStageCount} missing
                  </span>
                </div>
                <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                  {routeCoverageSummary.detail}
                </p>
              </div>
              <div class={`rounded border px-3 py-3 ${providerHealthEntries.length === 0 ? 'border-sophia-dark-amber/35 bg-sophia-dark-amber/10' : 'border-sophia-dark-blue/35 bg-sophia-dark-blue/10'}`}>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Health</div>
                <div class="mt-2 font-mono text-sm text-sophia-dark-text">{providerHealthEntries.length === 0 ? 'Weak signal' : `${providerHealthSummary.healthy}/${providerHealthSummary.total} healthy`}</div>
              </div>
            </div>
            <a
              href="/admin/ingestion-routing"
              class="mt-4 inline-flex rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
            >
              → Routing Studio
            </a>
          </div>
        </nav>

        <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 md:p-6">
          {#if activePhase === 'prepare'}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 1</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Configure the source and confirm the basics.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  Choose the source, confirm the run type, and set the execution defaults. This step should answer one question only: is the run clearly defined?
                </p>
              </div>

              <div class="workbench-split workbench-split-xl grid gap-5">
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/72 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Operation selection</div>
                    <span class="rounded-full border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                      Required
                    </span>
                  </div>
                  <label class="mt-3 block space-y-2">
                    <span class="font-mono text-xs text-sophia-dark-muted">Kind</span>
                    <select
                      value={selectedKind}
                      onchange={(event) => handleKindChange((event.currentTarget as HTMLSelectElement).value)}
                      class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 font-mono text-sm text-sophia-dark-text"
                    >
                      {#each data.operationKinds as kind}
                        <option value={kind}>{OPERATION_PROFILES[kind].title}</option>
                      {/each}
                    </select>
                  </label>

                  <div class="mt-5 rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/40 p-4">
                    <div class="font-serif text-2xl text-sophia-dark-text">{activeProfile.title}</div>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{activeProfile.summary}</p>
                    <p class="mt-3 font-mono text-xs leading-6 text-sophia-dark-dim">{activeProfile.routeHint}</p>
                  </div>
                </div>

                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/72 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Source selection</div>
                    <span class="rounded-full border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                      Required
                    </span>
                  </div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">Choose one source mode, then complete only the fields that belong to that path.</p>
                  <div class="mt-4 inline-flex rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-1">
                    <button
                      type="button"
                      class={`rounded px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] ${sourceMode === 'url' ? 'bg-sophia-dark-purple/16 text-sophia-dark-text shadow-[inset_0_0_0_1px_rgba(156,132,216,0.35)]' : 'text-sophia-dark-muted'}`}
                      onclick={() => (sourceMode = 'url')}
                      aria-pressed={sourceMode === 'url'}
                    >
                      URL source
                    </button>
                    <button
                      type="button"
                      class={`rounded px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] ${sourceMode === 'file' ? 'bg-sophia-dark-purple/16 text-sophia-dark-text shadow-[inset_0_0_0_1px_rgba(156,132,216,0.35)]' : 'text-sophia-dark-muted'}`}
                      onclick={() => (sourceMode = 'file')}
                      aria-pressed={sourceMode === 'file'}
                    >
                      Local file
                    </button>
                  </div>

                  {#if sourceMode === 'url'}
                    <label class="mt-4 block space-y-2">
                      <span class="font-mono text-xs text-sophia-dark-muted">Source URL *</span>
                      <input
                        bind:value={sourceUrl}
                        type="url"
                        placeholder="https://plato.stanford.edu/entries/ethics-deontological/"
                        class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 text-sm text-sophia-dark-text"
                      />
                      <span class="block text-xs leading-5 text-sophia-dark-dim">Paste the source you want Sophia to ingest.</span>
                    </label>
                    <label class="mt-4 block space-y-2">
                      <span class="font-mono text-xs text-sophia-dark-muted">Source type *</span>
                      <div class="flex gap-2">
                        <select
                          bind:value={sourceType}
                          class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 font-mono text-sm text-sophia-dark-text"
                        >
                          <option value="">Select source type…</option>
                          {#each SOURCE_TYPES as type}
                            <option value={type}>{type}</option>
                          {/each}
                        </select>
                        {#if suggestedSourceType && !sourceType}
                          <button
                            type="button"
                            class="rounded border border-sophia-dark-sage/40 px-3 py-2 font-mono text-xs text-sophia-dark-sage hover:bg-sophia-dark-sage/10"
                            onclick={applySuggestedSourceType}
                          >
                            Use {suggestedSourceType}
                          </button>
                        {/if}
                      </div>
                      <span class="block text-xs leading-5 text-sophia-dark-dim">Choose the content shape so extraction starts with the right assumptions.</span>
                    </label>
                  {:else}
                    <label class="mt-4 block space-y-2">
                      <span class="font-mono text-xs text-sophia-dark-muted">Source file *</span>
                      <input
                        bind:value={sourceFile}
                        type="text"
                        placeholder="data/sources/example.txt"
                        class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 text-sm text-sophia-dark-text"
                      />
                      <span class="block text-xs leading-5 text-sophia-dark-dim">Use a repo-relative path that the ingestion worker can read.</span>
                    </label>
                  {/if}
                </div>
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/72 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Execution options</div>
                <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">These settings control validation, run safety, and any temporary routing override.</p>

                <div class="mt-4 grid gap-4 lg:grid-cols-4">
                  <label class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 p-4">
                    <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Validation</span>
                    <div class="mt-3 flex items-center justify-between gap-3">
                      <span class="text-sm leading-6 text-sophia-dark-muted">Run validation after import</span>
                      <input bind:checked={validateRun} type="checkbox" class="h-4 w-4 accent-[var(--color-sage)]" />
                    </div>
                  </label>
                  <label class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 p-4">
                    <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Dry run</span>
                    <div class="mt-3 flex items-center justify-between gap-3">
                      <span class="text-sm leading-6 text-sophia-dark-muted">Check the plan without committing downstream changes</span>
                      <input bind:checked={dryRun} type="checkbox" class="h-4 w-4 accent-[var(--color-blue)]" />
                    </div>
                  </label>
                  <label class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 p-4 space-y-2">
                    <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Manual provider</span>
                    <select
                      bind:value={ingestProvider}
                      class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 font-mono text-sm text-sophia-dark-text"
                    >
                      <option value="auto">Automatic routing</option>
                      <option value="vertex">Vertex only</option>
                      <option value="anthropic">Anthropic only</option>
                    </select>
                    <span class="block text-xs leading-5 text-sophia-dark-dim">Leave this on automatic unless you are testing one provider on purpose.</span>
                  </label>
                  <label class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 p-4 space-y-2">
                    <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Domain</span>
                    <input
                      bind:value={domain}
                      type="text"
                      placeholder="ethics"
                      class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 text-sm text-sophia-dark-text"
                    />
                    <span class="block text-xs leading-5 text-sophia-dark-dim">Optional domain hint for classification or routing context.</span>
                  </label>
                </div>
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/72 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Operator note</div>
                <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">Leave a short note if someone else may inspect or continue this run later.</p>
                <label class="mt-4 block space-y-2">
                  <span class="font-mono text-xs text-sophia-dark-muted">Run note</span>
                  <textarea
                    bind:value={notes}
                    rows="3"
                    placeholder="e.g. urgent review before 10am"
                    class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-3 text-sm text-sophia-dark-text"
                  ></textarea>
                </label>
              </div>
            </div>
          {:else if activePhase === 'preflight'}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 2</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Review checks before you proceed.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  This step shows hard blockers, weaker signals, and route gaps so the operator knows exactly what still needs attention.
                </p>
              </div>

              <div class="workbench-split workbench-split-lg grid gap-4">
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Blocking issues</div>
                  <div class="mt-4 space-y-3">
                    {#if preflightBlockerList.length === 0}
                      <div class="rounded border border-sophia-dark-sage/35 bg-sophia-dark-sage/8 px-4 py-3 text-sm text-sophia-dark-sage">
                        No hard blockers. The source and payload are structurally ready.
                      </div>
                    {:else}
                      {#each preflightBlockerList as blocker}
                        <div class="rounded border border-sophia-dark-copper/35 bg-sophia-dark-copper/8 px-4 py-3 text-sm text-sophia-dark-copper">
                          {blocker}
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>

                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Attention points</div>
                  <div class="mt-4 space-y-3">
                    {#if preflightWarningList.length === 0}
                      <div class="rounded border border-sophia-dark-blue/35 bg-sophia-dark-blue/8 px-4 py-3 text-sm text-sophia-dark-blue">
                        Route coverage and provider visibility look ready for a clean run.
                      </div>
                    {:else}
                      {#each preflightWarningList as warning}
                        <div class="rounded border border-sophia-dark-amber/35 bg-sophia-dark-amber/8 px-4 py-3 text-sm text-sophia-dark-amber">
                          {warning}
                        </div>
                      {/each}
                    {/if}
                  </div>

                  <div class="mt-4 flex flex-wrap gap-3">
                    {#if suggestedSourceType && !sourceType}
                      <button
                        type="button"
                        onclick={applySuggestedSourceType}
                        class="rounded border border-sophia-dark-sage/40 px-3 py-2 font-mono text-xs text-sophia-dark-sage hover:bg-sophia-dark-sage/10"
                      >
                        Apply suggested source type
                      </button>
                    {/if}
                    {#if ingestProvider !== 'auto'}
                      <button
                        type="button"
                        onclick={useAutomaticRouting}
                        class="rounded border border-sophia-dark-blue/40 px-3 py-2 font-mono text-xs text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
                      >
                        Revert to automatic routing
                      </button>
                    {/if}
                    <a
                      href="/admin/ingestion-routing"
                      class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    >
                      Open routing studio
                    </a>
                  </div>
                </div>
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Preflight verdict</div>
                <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div class={`inline-flex rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] ${statusTone(phaseSignal('preflight'))}`}>
                      {phaseSignalLabel(phaseSignal('preflight'))}
                    </div>
                    <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">
                      Proceed when the current warnings are acceptable for this run. Use the routing studio if you need to refine the stage plan before launch.
                    </p>
                  </div>
                  <div class="flex gap-3">
                    <button
                      type="button"
                      onclick={() => (activePhase = 'prepare')}
                      class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    >
                      Back to prepare
                    </button>
                    <button
                      type="button"
                      onclick={advancePhase}
                      disabled={!prepareReady}
                      class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10 disabled:opacity-50"
                    >
                      Continue to pipeline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          {:else if activePhase === 'pipeline'}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 3</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Review the staged pipeline.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  Each stage shows whether it has a dedicated route, is borrowing a shared route, or still needs explicit routing. Select a stage to inspect the active and fallback steps.
                </p>
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/72 p-4">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Stage procession</div>
                <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  {#each stageDescriptors as descriptor, index}
                    <button
                      type="button"
                      onclick={() => (selectedStage = descriptor.stage)}
                      class={`rounded border px-3 py-3 text-left transition-colors ${descriptor.stage === selectedStage ? 'border-sophia-dark-purple/45 bg-sophia-dark-purple/10' : 'border-sophia-dark-border bg-sophia-dark-surface-raised/20 hover:bg-sophia-dark-surface-raised/30'}`}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">{index + 1}</span>
                        <span class={`rounded-full border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] ${routeModeTone(descriptor.mode)}`}>
                          {descriptor.mode === 'missing' ? 'Unrouted' : descriptor.mode}
                        </span>
                      </div>
                      <div class="mt-3 font-serif text-xl text-sophia-dark-text">{descriptor.title}</div>
                      <p class="mt-2 text-xs leading-5 text-sophia-dark-muted">{descriptor.summary}</p>
                    </button>
                  {/each}
                </div>
              </div>

              <div class="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {#each stageDescriptors as descriptor}
                  <button
                    type="button"
                    class="route-chamber rounded border p-4 text-left"
                    class:is-active={descriptor.stage === selectedStage}
                    onclick={() => (selectedStage = descriptor.stage)}
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">{descriptor.stage.replace('ingestion_', '').replaceAll('_', ' ')}</div>
                        <div class="mt-2 text-2xl font-serif text-sophia-dark-text">{descriptor.title}</div>
                      </div>
                      <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${routeModeTone(descriptor.mode)}`}>
                        {routeModeLabel(descriptor.mode)}
                      </span>
                    </div>
                    <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{descriptor.summary}</p>
                    <div class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-3 py-3">
                      {#if descriptor.route}
                        <div class="font-mono text-xs text-sophia-dark-text">{descriptor.route.name ?? descriptor.route.id}</div>
                        <div class="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                          v{descriptor.route.version ?? '—'} / published {descriptor.route.publishedVersion ?? '—'}
                        </div>
                      {:else}
                        <div class="font-mono text-xs text-sophia-dark-copper">No bound route</div>
                        <div class="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                          Configure this stage in the routing studio
                        </div>
                      {/if}
                    </div>
                  </button>
                {/each}
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Selected route trace</div>
                    <h3 class="mt-2 text-2xl font-serif text-sophia-dark-text">
                      {selectedStageDescriptor?.title ?? 'No stage selected'}
                    </h3>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                      {selectedStageDescriptor?.route
                        ? `Route ${selectedStageDescriptor.route.name ?? selectedStageDescriptor.route.id} is providing the current path for this stage.`
                        : 'This stage does not yet have a route bound to it.'}
                    </p>
                  </div>
                  <a
                    href="/admin/ingestion-routing"
                    class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                  >
                    Edit in routing studio
                  </a>
                </div>

                <div class="mt-5 space-y-3">
                  {#if selectedStageDescriptor?.route}
                    {#if selectedRouteStepError}
                      <div class="rounded border border-sophia-dark-copper/35 bg-sophia-dark-copper/8 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                        {selectedRouteStepError}
                      </div>
                    {/if}
                    {#if selectedRouteSteps.length > 0}
                      {#each selectedRouteSteps as step, index}
                        <div class="route-lane rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 px-4 py-3">
                          <div class="flex items-center justify-between gap-3">
                            <div>
                              <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Step {index + 1}</div>
                              <div class="mt-1 font-mono text-sm text-sophia-dark-text">
                                {step.providerPreference ?? 'auto'} / {step.modelId ?? 'model unset'}
                              </div>
                            </div>
                            <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${index === 0 ? 'text-sophia-dark-sage border-sophia-dark-sage/35 bg-sophia-dark-sage/8' : 'text-sophia-dark-blue border-sophia-dark-blue/35 bg-sophia-dark-blue/8'}`}>
                              {index === 0 ? 'Primary' : 'Fallback'}
                            </span>
                          </div>
                          <div class="mt-3 grid gap-2 md:grid-cols-3">
                            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-3 py-2 font-mono text-xs text-sophia-dark-muted">
                              Enabled: <span class="text-sophia-dark-text">{step.enabled === false ? 'no' : 'yes'}</span>
                            </div>
                            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-3 py-2 font-mono text-xs text-sophia-dark-muted">
                              Switch: <span class="text-sophia-dark-text">{step.fallbackOn ?? 'custom'}</span>
                            </div>
                            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-3 py-2 font-mono text-xs text-sophia-dark-muted">
                              Cost policy: <span class="text-sophia-dark-text">{step.costPolicy ? 'set' : 'default'}</span>
                            </div>
                          </div>
                        </div>
                      {/each}
                    {:else}
                      <div class="rounded border border-dashed border-sophia-dark-border px-4 py-6 font-mono text-sm text-sophia-dark-dim">
                        No step detail is available for this route yet.
                      </div>
                    {/if}
                  {:else}
                    <div class="rounded border border-dashed border-sophia-dark-border px-4 py-6 font-mono text-sm text-sophia-dark-dim">
                      Choose or configure a route for this stage before expecting a stage-specific trace.
                    </div>
                  {/if}
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-4 py-3">
                <p class="text-sm leading-6 text-sophia-dark-muted">
                  Dedicated routes: {dedicatedRouteCount}. Shared fallback coverage: {sharedFallbackCount}. Missing stages: {missingStageCount}.
                </p>
                <div class="flex gap-3">
                  <button
                    type="button"
                    onclick={() => (activePhase = 'preflight')}
                    class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                  >
                    Back to preflight
                  </button>
                  <button
                    type="button"
                    onclick={advancePhase}
                    class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
                  >
                    Continue to simulate
                  </button>
                </div>
              </div>
            </div>
          {:else if activePhase === 'simulate'}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 4</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Preview the route before launch.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  Use the selected stage as a proxy for readiness. When a stage has dedicated route metadata, the preview sends that context through Restormel. Otherwise it runs in shared mode.
                </p>
              </div>

              <div class="workbench-split workbench-split-lg grid gap-4">
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4 space-y-4">
                  <div>
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Preview focus</div>
                    <h3 class="mt-2 text-2xl font-serif text-sophia-dark-text">{selectedStageDescriptor?.title ?? 'No stage selected'}</h3>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                      Route mode: {selectedStageDescriptor ? routeModeLabel(selectedStageDescriptor.mode) : '—'}
                    </p>
                  </div>

                  <div class="grid gap-3 md:grid-cols-2">
                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Estimated tokens</div>
                      <div class="mt-2 font-mono text-2xl text-sophia-dark-text">{estimatedInputTokens.toLocaleString()}</div>
                    </div>
                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Estimated chars</div>
                      <div class="mt-2 font-mono text-2xl text-sophia-dark-text">{estimatedInputChars.toLocaleString()}</div>
                    </div>
                  </div>

                  <div class="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onclick={runSimulationPreview}
                      disabled={simulationState === 'running'}
                      class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10 disabled:opacity-50"
                    >
                      {simulationState === 'running' ? 'Simulating…' : 'Run route preview'}
                    </button>
                    <button
                      type="button"
                      onclick={() => (activePhase = 'pipeline')}
                      class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    >
                      Back to pipeline
                    </button>
                  </div>

                  {#if simulationError}
                    <div class="rounded border border-sophia-dark-copper/35 bg-sophia-dark-copper/8 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                      {simulationError}
                    </div>
                  {/if}
                </div>

                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Simulation signal</div>
                  {#if simulationResult}
                    <div class="mt-4 space-y-4">
                      <div class="grid gap-3 md:grid-cols-3">
                        <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4">
                          <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Selected step</div>
                          <div class="mt-2 font-mono text-sm text-sophia-dark-text">{simulationResult.selectedStepId ?? '—'}</div>
                        </div>
                        <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4">
                          <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Would run</div>
                          <div class="mt-2 font-mono text-sm text-sophia-dark-text">{simulationResult.wouldRun === false ? 'no' : 'yes'}</div>
                        </div>
                        <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4">
                          <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Estimated cost</div>
                          <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                            {simulationResult.estimatedCostUsd ?? 'not priced'}
                          </div>
                        </div>
                      </div>

                      <div class="space-y-3">
                        {#each (simulationResult.perStepEstimates as Array<Record<string, unknown>> | undefined) ?? [] as estimate}
                          <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 px-4 py-3">
                            <div class="flex items-center justify-between gap-3">
                              <div class="font-mono text-sm text-sophia-dark-text">
                                {estimate.providerType ?? 'provider'} / {estimate.modelId ?? 'model'}
                              </div>
                              <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${estimate.wouldRun ? 'text-sophia-dark-sage border-sophia-dark-sage/35 bg-sophia-dark-sage/8' : 'text-sophia-dark-dim border-sophia-dark-border bg-sophia-dark-surface-raised/30'}`}>
                                {estimate.wouldRun ? 'Active' : 'Standby'}
                              </span>
                            </div>
                            {#if estimate.wouldBeSkippedBecause}
                              <p class="mt-2 font-mono text-xs text-sophia-dark-dim">
                                skipped because {String(estimate.wouldBeSkippedBecause)}
                              </p>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    </div>
                  {:else}
                    <div class="mt-4 rounded border border-dashed border-sophia-dark-border px-4 py-10 text-center font-mono text-sm text-sophia-dark-dim">
                      Run the preview to inspect the route before queueing the operation.
                    </div>
                  {/if}
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-4 py-3">
                <p class="text-sm leading-6 text-sophia-dark-muted">
                  Once the preview reads clearly, move to launch. If not, return to the pipeline or routing studio and adjust the route.
                </p>
                <button
                  type="button"
                  onclick={() => (activePhase = 'run')}
                  class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
                >
                  Continue to launch
                </button>
              </div>
            </div>
          {:else if activePhase === 'run'}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 5</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Launch the run only when the source, route, and warnings all read cleanly.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  This is the final operator checkpoint. Make the route legible, make the risks explicit, then commit the run in one deliberate action.
                </p>
              </div>

              <div class="launch-layout grid gap-5">
                <div class="launch-chamber rounded border border-sophia-dark-border bg-sophia-dark-bg/72 p-5 md:p-6">
                  <div class="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Launch verdict</div>
                      <h3 class="mt-2 text-[2rem] font-serif leading-none text-sophia-dark-text">
                        {canLaunch ? 'Ready to queue this ingestion run.' : 'One final confirmation is still required.'}
                      </h3>
                    </div>
                    <div class={`inline-flex rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] ${statusTone(phaseSignal('run'))}`}>
                      {phaseSignalLabel(phaseSignal('run'))}
                    </div>
                  </div>

                  <p class="mt-4 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
                    {prepareReady
                      ? 'The payload is valid, the route is visible, and the run can proceed once you confirm the checklist below.'
                      : 'Resolve the blockers above before queueing this operation.'}
                  </p>

                  <div class="launch-summary-grid mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                    <div class="launch-summary-card rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/32 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Source</div>
                      <div class="mt-2 text-sm leading-6 text-sophia-dark-text break-all">
                        {sourceMode === 'url' ? sourceUrl || 'Source URL required' : sourceFile || 'Source file required'}
                      </div>
                    </div>
                    <div class="launch-summary-card rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/32 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Route stance</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                        {ingestProvider === 'auto' ? 'Automatic routing' : `${ingestProvider} override`}
                      </div>
                      <p class="mt-2 text-xs leading-5 text-sophia-dark-muted">{routingAdvisory.routeFocus}</p>
                    </div>
                    <div class="launch-summary-card rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/32 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Coverage</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">{routeCoverageSummary.label}</div>
                      <p class="mt-2 text-xs leading-5 text-sophia-dark-muted">{routeCoverageSummary.detail}</p>
                    </div>
                    <div class="launch-summary-card rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/32 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Preview</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                        {simulationResult
                          ? `${String(simulationResult.providerType ?? 'provider')} / ${String(simulationResult.modelId ?? 'model')}`
                          : 'Preview not yet run'}
                      </div>
                      <p class="mt-2 text-xs leading-5 text-sophia-dark-muted">
                        {simulationResult
                          ? `Estimated cost ${String(simulationResult.estimatedCostUsd ?? '—')} · ${((simulationResult.fallbackCandidates as Array<unknown> | undefined) ?? []).length} fallback candidate(s).`
                          : 'Run preview first if you want route and pricing evidence before launch.'}
                      </p>
                    </div>
                  </div>

                  <div class={`mt-5 rounded border px-4 py-4 ${statusTone(systemStatus.tone)}`}>
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em]">Launch notes</div>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-text">{systemStatus.title}</p>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{systemStatus.detail}</p>
                  </div>

                  <label class="mt-5 flex items-start gap-3 rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/28 px-4 py-4">
                    <input
                      bind:checked={launchConfirmed}
                      type="checkbox"
                      class="mt-1 h-4 w-4 rounded border-sophia-dark-border bg-sophia-dark-bg text-sophia-dark-purple focus:ring-sophia-dark-purple"
                    />
                    <span>
                      <span class="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-sophia-dark-text">
                        Launch confirmation
                      </span>
                      <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                        I have reviewed the checks, route coverage, and current warning signals, and I am ready to queue this run.
                      </p>
                    </span>
                  </label>

                  <div class="launch-action-row mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onclick={submitOperation}
                      disabled={!canLaunch}
                      class="launch-primary-button rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-5 py-3 font-mono text-sm text-sophia-dark-text shadow-[inset_0_0_0_1px_rgba(156,132,216,0.18)] hover:bg-sophia-dark-purple/24 disabled:opacity-50"
                    >
                      {requestState === 'submitting' ? 'Queueing…' : activeProfile.launchLabel}
                    </button>
                    <button
                      type="button"
                      onclick={() => (activePhase = 'simulate')}
                      class="rounded border border-sophia-dark-border px-4 py-3 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    >
                      Back to preview
                    </button>
                  </div>
                </div>

                <div class="space-y-4">
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Operation payload</div>
                    <pre class="mt-4 max-h-[21rem] overflow-auto whitespace-pre-wrap break-words rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4 font-mono text-xs text-sophia-dark-text">{payloadText}</pre>
                  </div>

                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Launch checklist</div>
                    <ul class="mt-3 space-y-2 text-sm leading-6 text-sophia-dark-muted">
                      <li>Source path is defined and payload JSON is valid.</li>
                      <li>Routing stance is intentional: automatic by default, manual only for a deliberate test.</li>
                      <li>Warnings about provider visibility or shared coverage are understood before queueing.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          {:else}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 6</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Review the result and decide the next action.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  The selected operation becomes a run workspace. Review the status, timeline, outcome, and log without leaving the staged flow.
                </p>
              </div>

              {#if activeOperation}
                <div class={`rounded border px-4 py-4 ${statusTone(reviewRecommendation.tone)}`}>
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em]">Review verdict</div>
                  <h3 class="mt-2 text-2xl font-serif text-sophia-dark-text">{reviewRecommendation.title}</h3>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{reviewRecommendation.detail}</p>
                </div>

                <div class="grid gap-4 md:grid-cols-5">
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Status</div>
                    <div class="mt-2 font-mono text-sm text-sophia-dark-text">{activeOperation.status}</div>
                  </div>
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Validation</div>
                    <div class="mt-2 font-mono text-sm text-sophia-dark-text">{activeOperation.validation_status}</div>
                  </div>
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Sync</div>
                    <div class="mt-2 font-mono text-sm text-sophia-dark-text">{activeOperation.sync_status}</div>
                  </div>
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Executor</div>
                    <div class="mt-2 font-mono text-sm text-sophia-dark-text">{activeOperation.executor}</div>
                  </div>
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Last updated</div>
                    <div class="mt-2 font-mono text-sm text-sophia-dark-text">{formatDate(activeOperation.updated_at)}</div>
                  </div>
                </div>

                <div class="review-layout grid gap-6">
                  <div class="space-y-4">
                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Outcome summary</div>
                      <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{activeOperation.result_summary ?? 'Job is still in progress.'}</p>
                      {#if activeOperation.last_error && activeOperation.last_error !== activeOperation.result_summary}
                        <p class="mt-3 font-mono text-xs text-sophia-dark-copper">{activeOperation.last_error}</p>
                      {/if}
                    </div>

                    {#if activeOperation.route_decision}
                      <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                        <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Route decision</div>
                        <div class="mt-3 grid gap-3 sm:grid-cols-2">
                          <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-3 py-3">
                            <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Route</div>
                            <div class="mt-2 font-mono text-sm text-sophia-dark-text">{activeOperation.route_decision.routeName ?? '—'}</div>
                          </div>
                          <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-3 py-3">
                            <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Model</div>
                            <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                              {activeOperation.route_decision.providerType ?? 'provider'} / {activeOperation.route_decision.modelId ?? 'model'}
                            </div>
                          </div>
                          <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-3 py-3">
                            <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Switch reason</div>
                            <div class="mt-2 font-mono text-sm text-sophia-dark-text">{activeOperation.route_decision.switchReasonCode ?? '—'}</div>
                          </div>
                          <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-3 py-3">
                            <div class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Estimated cost</div>
                            <div class="mt-2 font-mono text-sm text-sophia-dark-text">{activeOperation.route_decision.estimatedCostUsd ?? '—'}</div>
                          </div>
                        </div>
                      </div>
                    {/if}

                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Run details</div>
                      <dl class="mt-3 space-y-2 font-mono text-xs text-sophia-dark-text">
                        <div class="flex justify-between gap-4"><dt>Action</dt><dd>{activeOperation.requested_action}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Tool</dt><dd>{activeOperation.restormel_tool ?? 'adapter'}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Hosted Run</dt><dd>{activeOperation.hosted_run_id ?? '—'}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Attempts</dt><dd>{activeOperation.attempts ?? '—'}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Created</dt><dd>{formatDate(activeOperation.created_at)}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Started</dt><dd>{formatDate(activeOperation.started_at)}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Completed</dt><dd>{formatDate(activeOperation.completed_at)}</dd></div>
                      </dl>
                    </div>

                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Next actions</div>
                      <div class="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onclick={() => triggerOperationAction(activeOperation.id, 'retry')}
                          class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onclick={() => triggerOperationAction(activeOperation.id, 'cancel')}
                          class="rounded border border-sophia-dark-copper/40 px-4 py-2 font-mono text-sm text-sophia-dark-copper hover:bg-sophia-dark-copper/10"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onclick={() => (activePhase = 'pipeline')}
                          class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                        >
                          Review pipeline
                        </button>
                      </div>
                      <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">
                        Use retry when the route is still appropriate. Return to the pipeline if the failure suggests a stage or policy change first.
                      </p>
                    </div>
                  </div>

                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Live log</div>
                        <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">Read the raw execution output for this selected run.</p>
                      </div>
                      <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${badgeClass(activeOperation.status)}`}>
                        {activeOperation.status}
                      </span>
                    </div>
                    <pre class="mt-4 min-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4 font-mono text-xs text-sophia-dark-text">{activeOperationLogText}</pre>
                  </div>
                </div>
              {:else}
                <div class="rounded border border-dashed border-sophia-dark-border px-4 py-10 text-center font-mono text-sm text-sophia-dark-dim">
                  Queue or select an operation to review the run from here.
                </div>
              {/if}
            </div>
          {/if}

          {#if activePhase !== 'run'}
            <div class="sticky-action-bar mt-6 rounded border border-sophia-dark-purple/30 bg-sophia-dark-surface-raised/90 px-4 py-4 shadow-[0_-12px_30px_rgba(0,0,0,0.28)] backdrop-blur">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Next action</div>
                  <div class="mt-1 text-base font-semibold text-sophia-dark-text">{stickyAction.label}</div>
                  <p class="mt-1 text-sm leading-6 text-sophia-dark-muted">{stickyAction.note}</p>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onclick={() => void handlePrimaryPhaseAction()}
                    disabled={stickyAction.disabled}
                    class="rounded border border-sophia-dark-purple/45 bg-sophia-dark-purple/16 px-5 py-3 font-mono text-sm text-sophia-dark-text shadow-[inset_0_0_0_1px_rgba(156,132,216,0.18)] hover:bg-sophia-dark-purple/24 disabled:opacity-50"
                  >
                    ✦ {stickyAction.label}
                  </button>
                  <button
                    type="button"
                    onclick={() => void handleSecondaryPhaseAction()}
                    class="rounded border border-sophia-dark-border px-4 py-3 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-muted hover:bg-sophia-dark-surface"
                  >
                    {stickyAction.secondaryLabel}
                  </button>
                </div>
              </div>
            </div>
          {/if}

          <details class="mt-6 rounded border border-sophia-dark-border bg-sophia-dark-bg/70" open={advancedMode}>
            <summary class="cursor-pointer list-none px-4 py-3 font-mono text-xs uppercase tracking-[0.16em] text-sophia-dark-muted">
              Advanced payload editor
            </summary>
            <div class="border-t border-sophia-dark-border px-4 py-4">
              <textarea
                bind:value={payloadText}
                rows="16"
                class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-3 font-mono text-xs text-sophia-dark-text"
              ></textarea>
              {#if payloadParseError}
                <p class="mt-3 font-mono text-xs text-sophia-dark-copper">{payloadParseError}</p>
              {/if}
            </div>
          </details>
        </section>

        <aside class="decision-sidebar space-y-4">
          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Needs attention</div>
            <div class={`mt-4 rounded border px-4 py-4 ${statusTone(systemStatus.tone)}`}>
              <div class="flex items-center justify-between gap-3">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em]">{systemStatus.eyebrow}</div>
                <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${statusTone(systemStatus.tone)}`}>
                  {phaseSignalLabel(systemStatus.tone)}
                </span>
              </div>
              <p class="mt-3 text-sm leading-6 text-sophia-dark-text">{systemStatus.title}</p>
              <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{systemStatus.detail}</p>
              <div class="mt-4 flex flex-wrap gap-3">
                {#if systemStatus.ctaHref}
                  <a
                    href={systemStatus.ctaHref}
                    class="rounded border border-current/25 bg-sophia-dark-surface px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
                  >
                    {systemStatus.ctaLabel}
                  </a>
                {:else if systemStatus.ctaAction}
                  <button
                    type="button"
                    onclick={() => (activePhase = systemStatus.ctaAction === 'pipeline' ? 'pipeline' : 'preflight')}
                    class="rounded border border-current/25 bg-sophia-dark-surface px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
                  >
                    {systemStatus.ctaLabel}
                  </button>
                {/if}
              </div>
            </div>

            <div class="mt-4 grid gap-3">
              {#each criticalSignals as signal}
                <div class={`rounded border px-4 py-3 ${statusTone(signal.tone)}`}>
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em]">{signal.label}</div>
                    <div class="font-mono text-sm text-sophia-dark-text">{signal.value}</div>
                  </div>
                  <p class="mt-2 text-xs leading-5 text-sophia-dark-muted">{signal.detail}</p>
                </div>
              {/each}
            </div>
          </section>

          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Decision panel</div>
            <div class="mt-4 space-y-3">
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Selected stage</div>
                    <div class="mt-2 text-2xl font-serif text-sophia-dark-text">{selectedStageDescriptor?.title ?? 'No stage selected'}</div>
                  </div>
                  <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${routeModeTone(selectedStageDescriptor?.mode ?? 'missing')}`}>
                    {selectedStageDescriptor ? routeModeLabel(selectedStageDescriptor.mode) : 'Needs routing'}
                  </span>
                </div>
                <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{selectedStageDescriptor?.summary ?? 'Choose a stage to inspect its route and controls.'}</p>
              </div>

              <div class="decision-metric-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div class="decision-metric-card rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Route summary</div>
                  <div class="mt-2 font-mono text-sm text-sophia-dark-text break-all">
                    {selectedStageDescriptor?.route ? selectedStageDescriptor.route.name ?? selectedStageDescriptor.route.id : 'No route bound'}
                  </div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                    Environment {routingEnvironmentId}. Dedicated {dedicatedRouteCount}, shared {sharedFallbackCount}, missing {missingStageCount}.
                  </p>
                </div>

                <div class="decision-metric-card rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Policy summary</div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{selectedRoutePolicySummary}</p>
                  <p class="mt-3 font-mono text-xs text-sophia-dark-muted">{routingAdvisory.policyFocus}</p>
                </div>

                <div class="decision-metric-card rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Estimated cost</div>
                  <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                    {simulationResult?.estimatedCostUsd ?? 'Run preview to price this stage'}
                  </div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                    {simulationResult
                      ? `Selected step ${String(simulationResult.selectedStepId ?? '—')} with ${((simulationResult.fallbackCandidates as Array<unknown> | undefined) ?? []).length} fallback candidate(s).`
                      : 'Simulation has not been run for the current stage yet.'}
                  </p>
                </div>

                <div class="decision-metric-card rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Provider health</div>
                  <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                    {providerHealthSummary.healthy}/{providerHealthSummary.total || 0} healthy
                  </div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                    {providerHealthSummary.failed > 0
                      ? `${providerHealthSummary.failed} provider${providerHealthSummary.failed === 1 ? '' : 's'} currently failing.`
                      : providerHealthSummary.degraded > 0
                        ? `${providerHealthSummary.degraded} provider${providerHealthSummary.degraded === 1 ? '' : 's'} degraded.`
                        : providerHealthSummary.total > 0
                          ? 'Configured providers are visible to the workbench.'
                          : 'No provider health entries are available yet.'}
                  </p>
                </div>

                <div class={`decision-metric-card rounded border px-4 py-4 ${statusTone(selectedRouteSyncState.tone)}`}>
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em]">Route sync</div>
                  <div class="mt-2 font-mono text-sm text-sophia-dark-text">{selectedRouteSyncState.label}</div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{selectedRouteSyncState.detail}</p>
                  {#if selectedRouteHistoryLatest}
                    <p class="mt-3 font-mono text-xs text-sophia-dark-dim">
                      updated {formatDate(selectedRouteHistoryLatest.createdAt ?? null)}
                      {#if selectedRouteHistoryLatest.updatedBy}
                        {' '}by {selectedRouteHistoryLatest.updatedBy}
                      {/if}
                    </p>
                  {/if}
                </div>

                <div class="decision-metric-card rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Recent route history</div>
                  {#if selectedRouteHistory.length > 0}
                    <div class="mt-3 space-y-3">
                      {#each selectedRouteHistory.slice(0, 2) as entry}
                        <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/20 px-3 py-3">
                          <div class="font-mono text-xs text-sophia-dark-text">
                            version {entry.version ?? '—'} / published {entry.publishedVersion ?? '—'}
                          </div>
                          <div class="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                            {formatDate(entry.createdAt ?? null)}
                          </div>
                          <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{entry.changeSummary ?? 'No change summary provided.'}</p>
                        </div>
                      {/each}
                    </div>
                  {:else if selectedRouteHistoryError}
                    <div class="mt-3 rounded border border-sophia-dark-copper/35 bg-sophia-dark-copper/8 px-4 py-3 text-sm text-sophia-dark-copper">
                      {selectedRouteHistoryError}
                    </div>
                  {:else}
                    <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">No route history is available for the selected stage yet.</p>
                  {/if}
                </div>
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                <div class={`inline-flex rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] ${statusTone(routingAdvisory.tone)}`}>
                  {phaseSignalLabel(routingAdvisory.tone)}
                </div>
                <h3 class="mt-3 text-xl font-serif text-sophia-dark-text">{routingAdvisory.title}</h3>
                <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{routingAdvisory.body}</p>
                <div class="mt-4 flex flex-wrap gap-3">
                  {#if ingestProvider !== 'auto'}
                    <button
                      type="button"
                      onclick={useAutomaticRouting}
                      class="rounded border border-sophia-dark-blue/40 px-3 py-2 font-mono text-xs text-sophia-dark-blue hover:bg-sophia-dark-blue/10"
                    >
                      Apply recommended auto routing
                    </button>
                  {/if}
                  <a
                    href="/admin/ingestion-routing"
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                  >
                    Refine route and policies
                  </a>
                </div>
              </div>

              <details class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                <summary class="flex cursor-pointer items-center justify-between gap-3 list-none">
                  <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">One-click fixes</span>
                  <span class="rounded-full border border-sophia-dark-border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                    {recommendationSupport.available ? 'Ready' : 'Waiting'}
                  </span>
                </summary>
                <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">
                  Ask Restormel for a safer, cheaper, or more reliable route adjustment. Sophia will keep the suggestion in the operator flow instead of forcing a context switch.
                </p>
                <div class="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={!recommendationSupport.available || recommendationState === 'requesting'}
                    onclick={() => void requestRecommendation('fix_automatically')}
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                  >
                    Fix automatically
                  </button>
                  <button
                    type="button"
                    disabled={!recommendationSupport.available || recommendationState === 'requesting'}
                    onclick={() => void requestRecommendation('use_recommended_route')}
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                  >
                    Use recommended route
                  </button>
                  <button
                    type="button"
                    disabled={!recommendationSupport.available || recommendationState === 'requesting'}
                    onclick={() => void requestRecommendation('use_cheaper_route')}
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                  >
                    Use cheaper route
                  </button>
                  <button
                    type="button"
                    disabled={!recommendationSupport.available || recommendationState === 'requesting'}
                    onclick={() => void requestRecommendation('use_more_reliable_route')}
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                  >
                    Use more reliable route
                  </button>
                  <button
                    type="button"
                    disabled={!recommendationSupport.available || recommendationState === 'requesting'}
                    onclick={() => void requestRecommendation('rerun_phase')}
                    class="rounded border border-sophia-dark-border px-3 py-2 font-mono text-xs text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50"
                  >
                    Re-run this phase
                  </button>
                </div>
                <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">
                  {recommendationSupport.available
                    ? 'Recommendations are available for this environment.'
                    : recommendationSupport.reason}
                </p>
                {#if recommendationMessage}
                  <p class="mt-2 font-mono text-xs text-sophia-dark-dim">{recommendationMessage}</p>
                {/if}
              </details>
            </div>
          </section>

          <section class="recent-runs-panel rounded border border-sophia-dark-border bg-sophia-dark-surface p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Recent runs</div>
            <div class="mt-4 space-y-2 max-h-[26rem] overflow-auto pr-1">
              {#each operations as operation}
                <button
                  type="button"
                  onclick={() => {
                    void loadOperation(operation.id);
                    activePhase = 'review';
                  }}
                  class="recent-run-card w-full rounded border px-3 py-3 text-left transition-colors {selectedId === operation.id ? 'border-sophia-dark-blue/50 bg-sophia-dark-blue/10' : 'border-sophia-dark-border bg-sophia-dark-bg hover:bg-sophia-dark-surface-raised'}"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="font-mono text-sm text-sophia-dark-text">{operation.requested_action}</div>
                      <div class="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-muted">{operation.kind}</div>
                    </div>
                    <span class={`px-2 py-1 text-[0.68rem] font-mono border rounded uppercase tracking-[0.12em] ${badgeClass(operation.status)}`}>
                      {operation.status}
                    </span>
                  </div>
                  <p class="recent-run-summary mt-2 text-sm leading-6 text-sophia-dark-muted">
                    {operation.result_summary ?? operation.last_error ?? 'Open this run to inspect status, logs, and next action.'}
                  </p>
                  <div class="mt-2 flex items-center justify-between gap-3 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                    <span>{operation.requested_by_uid}</span>
                    <span>{formatDate(operation.created_at)}</span>
                  </div>
                </button>
              {/each}
              {#if operations.length === 0}
                <div class="rounded border border-dashed border-sophia-dark-border px-4 py-8 text-center font-mono text-sm text-sophia-dark-dim">
                  No operations queued yet.
                </div>
              {/if}
            </div>
          </section>

          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Quick links</div>
            <div class="mt-4 flex flex-wrap gap-3">
              <a
                href="/admin/ingestion-routing"
                class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
              >
                Routing studio
              </a>
              <a
                href="/admin"
                class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
              >
                Back to admin
              </a>
            </div>
          </section>
        </aside>
      </div>
    {/if}
  </div>
</div>

<style>
  .admin-workbench :is(p, label, input, select, textarea, summary, li, dt, dd) {
    font-family: var(--font-ui);
  }

  .admin-workbench :is(h1, h2, h3, .font-serif) {
    font-family: var(--font-display);
  }

  .workbench-hero {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(760px 300px at 14% 0%, rgba(127, 163, 131, 0.1), transparent 68%),
      radial-gradient(720px 260px at 84% 0%, rgba(156, 132, 216, 0.16), transparent 72%),
      linear-gradient(180deg, rgba(32, 31, 29, 0.95), rgba(20, 19, 18, 0.98));
  }

  .workbench-hero::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(111, 163, 212, 0.32) 18%,
      rgba(196, 168, 130, 0.32) 50%,
      rgba(127, 163, 131, 0.32) 82%,
      transparent 100%
    );
  }

  .phase-rail {
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(23, 22, 21, 0.98), rgba(18, 17, 16, 0.98)),
      radial-gradient(160px 200px at 50% 0%, rgba(156, 132, 216, 0.08), transparent 75%);
  }

  .phase-step {
    position: relative;
    background: linear-gradient(180deg, rgba(20, 19, 18, 0.42), rgba(17, 17, 16, 0.76));
    border-color: var(--color-border);
  }

  .phase-step-rail {
    min-height: 8.75rem;
  }

  .phase-step-rail::after {
    content: '';
    position: absolute;
    left: 29px;
    top: calc(100% - 0.5rem);
    width: 2px;
    height: 1.2rem;
    background: linear-gradient(180deg, rgba(156, 132, 216, 0.45), rgba(111, 163, 212, 0.05));
  }

  .phase-step-rail:last-child::after {
    display: none;
  }

  .phase-step-connector {
    position: absolute;
    left: 0.95rem;
    top: 1rem;
  }

  .phase-step-node {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.85rem;
    height: 1.85rem;
    border-radius: 999px;
    border: 1px solid rgba(156, 132, 216, 0.35);
    background: rgba(17, 17, 16, 0.92);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
  }

  .phase-step::before {
    content: '';
    position: absolute;
    inset: auto 18px 0 18px;
    height: 1px;
    background: linear-gradient(90deg, rgba(111, 163, 212, 0), rgba(111, 163, 212, 0.6), rgba(111, 163, 212, 0));
    opacity: 0.22;
  }

  .phase-step.is-active {
    border-color: rgba(156, 132, 216, 0.42);
    background: linear-gradient(180deg, rgba(34, 29, 47, 0.78), rgba(20, 20, 24, 0.94));
    box-shadow:
      inset 0 0 0 1px rgba(156, 132, 216, 0.12),
      0 0 0 1px rgba(156, 132, 216, 0.04);
  }

  .phase-step.is-active .phase-step-node {
    border-color: rgba(156, 132, 216, 0.7);
    background: rgba(156, 132, 216, 0.18);
    box-shadow: 0 0 18px rgba(156, 132, 216, 0.22);
  }

  .phase-step.is-passed::before {
    background: linear-gradient(90deg, rgba(127, 163, 131, 0), rgba(127, 163, 131, 0.65), rgba(127, 163, 131, 0));
    opacity: 0.45;
  }

  .phase-step.is-attention::before {
    background: linear-gradient(90deg, rgba(212, 147, 111, 0), rgba(212, 147, 111, 0.65), rgba(212, 147, 111, 0));
    opacity: 0.45;
  }

  .phase-step.is-blocked {
    border-color: rgba(214, 98, 98, 0.34);
    background: linear-gradient(180deg, rgba(54, 25, 25, 0.68), rgba(31, 18, 18, 0.92));
  }

  .phase-step.is-blocked::before {
    background: linear-gradient(90deg, rgba(214, 98, 98, 0), rgba(214, 98, 98, 0.7), rgba(214, 98, 98, 0));
    opacity: 0.5;
  }

  .phase-step.is-locked {
    opacity: 0.78;
  }

  .phase-step.is-passed .phase-step-node {
    border-color: rgba(127, 163, 131, 0.7);
    background: rgba(127, 163, 131, 0.16);
  }

  .phase-step.is-attention .phase-step-node {
    border-color: rgba(212, 147, 111, 0.7);
    background: rgba(212, 147, 111, 0.16);
  }

  .phase-step.is-blocked .phase-step-node {
    border-color: rgba(214, 98, 98, 0.75);
    background: rgba(214, 98, 98, 0.18);
  }

  .route-chamber {
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(20, 19, 18, 0.5), rgba(17, 17, 16, 0.88)),
      linear-gradient(90deg, rgba(196, 168, 130, 0.06), transparent 35%);
    border-color: var(--color-border);
  }

  .route-chamber::after {
    content: '';
    position: absolute;
    left: 18px;
    right: 18px;
    bottom: 12px;
    height: 2px;
    background: linear-gradient(90deg, rgba(111, 163, 212, 0.05), rgba(111, 163, 212, 0.52), rgba(127, 163, 131, 0.34));
    opacity: 0.45;
  }

  .route-chamber.is-active {
    border-color: rgba(111, 163, 212, 0.4);
    box-shadow: inset 0 0 0 1px rgba(111, 163, 212, 0.08);
  }

  .route-lane {
    position: relative;
  }

  .route-lane::before {
    content: '';
    position: absolute;
    left: 16px;
    top: 12px;
    bottom: 12px;
    width: 2px;
    background: linear-gradient(180deg, rgba(111, 163, 212, 0.62), rgba(127, 163, 131, 0.24));
    opacity: 0.45;
  }

  details summary::-webkit-details-marker {
    display: none;
  }

  .system-status-bar {
    background:
      linear-gradient(90deg, rgba(156, 132, 216, 0.1), rgba(20, 19, 18, 0.9) 24%, rgba(20, 19, 18, 0.98)),
      linear-gradient(180deg, rgba(32, 31, 29, 0.96), rgba(20, 19, 18, 0.98));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .launch-chamber {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(580px 220px at 8% 0%, rgba(196, 168, 130, 0.08), transparent 70%),
      radial-gradient(460px 220px at 100% 0%, rgba(156, 132, 216, 0.12), transparent 72%),
      linear-gradient(180deg, rgba(24, 22, 21, 0.96), rgba(17, 17, 16, 0.98));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.03),
      inset 0 0 0 1px rgba(156, 132, 216, 0.04);
  }

  .launch-chamber::after {
    content: '';
    position: absolute;
    inset: auto 1.25rem 0 1.25rem;
    height: 1px;
    background: linear-gradient(90deg, rgba(196, 168, 130, 0), rgba(196, 168, 130, 0.44), rgba(156, 132, 216, 0.44), rgba(196, 168, 130, 0));
    opacity: 0.8;
  }

  .hero-grid,
  .workbench-layout,
  .workbench-split,
  .launch-layout,
  .review-layout {
    align-items: start;
  }

  .phase-step-summary {
    display: none;
  }

  .phase-step-title {
    font-size: clamp(1.18rem, 1.08rem + 0.42vw, 1.4rem);
  }

  .decision-sidebar {
    align-self: start;
    gap: 1rem;
  }

  .decision-sidebar section,
  .decision-sidebar details {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
  }

  .decision-sidebar > section {
    padding: 1rem;
  }

  .decision-metric-grid {
    gap: 0.75rem;
  }

  .decision-metric-card {
    padding: 0.9rem;
  }

  .decision-metric-card p {
    font-size: 0.84rem;
    line-height: 1.5;
  }

  .launch-summary-card {
    min-height: 8.5rem;
  }

  .launch-action-row {
    align-items: stretch;
  }

  .launch-primary-button {
    min-width: 15rem;
    min-height: 3.35rem;
    background: linear-gradient(135deg, rgba(92, 80, 173, 0.92), rgba(56, 50, 116, 0.98));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 14px 32px rgba(43, 35, 82, 0.34);
  }

  .recent-runs-panel .recent-run-card {
    padding: 0.75rem 0.8rem;
  }

  .recent-run-card {
    overflow: hidden;
  }

  .recent-run-summary {
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .sticky-action-bar {
    position: sticky;
    bottom: 1rem;
    z-index: 20;
    box-shadow:
      0 -12px 30px rgba(0, 0, 0, 0.24),
      inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  @media (min-width: 1024px) {
    .workbench-split-lg {
      grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
    }

    .decision-sidebar {
      position: sticky;
      top: 6rem;
    }
  }

  @media (min-width: 1280px) {
    .hero-grid {
      grid-template-columns: minmax(0, 1fr) 15.5rem;
      align-items: center;
    }

    .workbench-layout {
      grid-template-columns: 13.5rem minmax(0, 1fr) 21.5rem;
    }

    .workbench-split-xl {
      grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
    }

    .launch-layout {
      grid-template-columns: minmax(0, 1.12fr) 20rem;
    }

    .review-layout {
      grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
    }

    .phase-step.is-active .phase-step-summary {
      display: block;
    }
  }

  @media (max-width: 1279px) {
    .phase-step-rail {
      min-height: auto;
    }

    .phase-step-rail::after,
    .phase-step-connector {
      display: none;
    }

    .sticky-action-bar {
      bottom: 0;
    }
  }

  @media (max-width: 767px) {
    .admin-workbench .workbench-hero h1 {
      font-size: clamp(1.95rem, 8.9vw, 2.55rem);
      line-height: 0.98;
    }

    .phase-rail-steps {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(10.5rem, 72vw);
      gap: 0.75rem;
      overflow-x: auto;
      padding-bottom: 0.25rem;
      scrollbar-width: thin;
    }

    .phase-step {
      min-height: 0;
    }

    .phase-step-title {
      font-size: 1.12rem;
    }

    .phase-step .ml-12 {
      margin-left: 0;
    }

    .phase-step-node {
      width: 1.6rem;
      height: 1.6rem;
      font-size: 0.64rem;
    }

    .launch-summary-grid {
      grid-template-columns: 1fr;
    }

    .launch-summary-card {
      min-height: auto;
    }

    .launch-action-row {
      display: grid;
      grid-template-columns: 1fr;
    }

    .launch-primary-button {
      width: 100%;
      justify-content: center;
    }

    .decision-sidebar {
      gap: 1rem;
    }

    .workbench-hero {
      background:
        radial-gradient(460px 180px at 16% 0%, rgba(127, 163, 131, 0.1), transparent 72%),
        radial-gradient(360px 180px at 84% 0%, rgba(156, 132, 216, 0.12), transparent 72%),
        linear-gradient(180deg, rgba(32, 31, 29, 0.95), rgba(20, 19, 18, 0.99));
    }
  }
</style>
