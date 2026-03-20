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
  type PhaseSignal = 'locked' | 'attention' | 'ready' | 'running' | 'passed';

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

  interface RoutingContextPayload {
    environmentId?: string;
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
      title: 'Prepare',
      cue: 'Define the source and aim',
      summary: 'Choose what to ingest and how much manual control you want.'
    },
    {
      id: 'preflight',
      title: 'Preflight',
      cue: 'Check before burn',
      summary: 'Surface blockers, incomplete routing, and provider visibility before the run starts.'
    },
    {
      id: 'pipeline',
      title: 'Pipeline',
      cue: 'Inspect the chambers',
      summary: 'See each ingestion stage, the route bound to it, and where the work will travel.'
    },
    {
      id: 'simulate',
      title: 'Simulate',
      cue: 'Preview the route',
      summary: 'Test the active route and inspect the likely primary and fallback steps.'
    },
    {
      id: 'run',
      title: 'Run',
      cue: 'Launch the operation',
      summary: 'Queue the job when the source, routing, and checks all read clearly.'
    },
    {
      id: 'review',
      title: 'Review',
      cue: 'Confirm what happened',
      summary: 'Read the live status, review the log, and decide whether to continue or rectify.'
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

  let operations = $state<AdminOperationRecord[]>([]);
  let selectedId = $state<string | null>(null);
  let selectedOperation = $state<AdminOperationRecord | null>(null);
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
  let selectedStage = $state('ingestion_extraction');
  let simulationState = $state<'idle' | 'running' | 'ready' | 'failed'>('idle');
  let simulationResult = $state<Record<string, unknown> | null>(null);
  let simulationError = $state('');

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
  const providerHealthEntries = $derived.by(
    () => routingContext?.providersHealth?.providers ?? []
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
      case 'attention':
        return 'text-sophia-dark-copper border-sophia-dark-copper/35 bg-sophia-dark-copper/8';
      default:
        return 'text-sophia-dark-dim border-sophia-dark-border bg-sophia-dark-surface-raised/30';
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

  function providerStateTone(status: string | null | undefined): string {
    if (status === 'healthy' || status === 'ready') return 'text-sophia-dark-sage border-sophia-dark-sage/35 bg-sophia-dark-sage/8';
    if (status === 'degraded' || status === 'warning') return 'text-sophia-dark-copper border-sophia-dark-copper/35 bg-sophia-dark-copper/8';
    if (status === 'failed' || status === 'unhealthy') return 'text-sophia-dark-coral border-sophia-dark-coral/35 bg-sophia-dark-coral/8';
    return 'text-sophia-dark-dim border-sophia-dark-border bg-sophia-dark-surface-raised/30';
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
  const canLaunch = $derived(prepareReady && requestState !== 'submitting');

  function phaseSignal(id: WorkbenchPhaseId): PhaseSignal {
    const blockers = preflightBlockers();
    const warnings = preflightWarnings();
    const hasSucceeded = activeOperation?.status === 'succeeded';

    if (id === 'prepare') {
      if (activePhase === 'prepare') return prepareReady ? 'ready' : 'attention';
      return prepareReady ? 'passed' : 'attention';
    }

    if (id === 'preflight') {
      if (!prepareReady) return 'locked';
      if (blockers.length > 0 || warnings.length > 0) return activePhase === 'preflight' ? 'attention' : 'attention';
      return activePhase === 'preflight' ? 'ready' : 'passed';
    }

    if (id === 'pipeline') {
      if (!prepareReady) return 'locked';
      if (missingStageCount > 0 || providerHealthEntries.length === 0) return 'attention';
      return activePhase === 'pipeline' ? 'ready' : 'passed';
    }

    if (id === 'simulate') {
      if (!prepareReady) return 'locked';
      if (simulationState === 'running') return 'running';
      if (simulationState === 'ready') return 'passed';
      if (simulationState === 'failed') return 'attention';
      return 'ready';
    }

    if (id === 'run') {
      if (!prepareReady) return 'locked';
      if (activeOperation?.status === 'queued' || activeOperation?.status === 'running') return 'running';
      if (hasSucceeded) return 'passed';
      if (activeOperation) {
        return activeOperation.status === 'succeeded' ? 'passed' : 'attention';
      }
      return 'ready';
    }

    if (!activeOperation) return 'locked';
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

    await Promise.all(
      uniqueRouteIds.map(async (routeId) => {
        try {
          const stepBody = await authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/steps`);
          nextSteps[routeId] = Array.isArray(stepBody.steps) ? stepBody.steps : [];
        } catch (error) {
          nextSteps[routeId] = [];
          nextErrors[routeId] = error instanceof Error ? error.message : 'Failed to load route steps';
        }
      })
    );

    routeStepsById = nextSteps;
    routeStepErrors = nextErrors;
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

<div class="min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
  <div class="mx-auto max-w-[94rem] px-6 py-8 space-y-8">
    <section class="workbench-hero rounded border border-sophia-dark-border bg-sophia-dark-surface p-6 md:p-8">
      <div class="grid gap-8 xl:grid-cols-[minmax(0,1.25fr)_22rem] xl:items-center">
        <div class="space-y-5">
          <div class="flex flex-wrap items-center gap-3">
            <span class="rounded-full border border-sophia-dark-blue/35 bg-sophia-dark-blue/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-blue">
              Admin Ingestion Workbench
            </span>
            <span class="rounded-full border border-sophia-dark-border bg-sophia-dark-surface-raised/70 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">
              Surface clarity, subfloor detail
            </span>
          </div>

          <div>
            <h1 class="text-4xl font-serif leading-tight text-sophia-dark-text md:text-[3.35rem]">
              Guide the ingestion, then inspect the route beneath it.
            </h1>
            <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted md:text-lg">
              This workbench turns the old raw console into a staged walkthrough. Choose the source, clear
              the preflight, inspect the Restormel route plan, simulate the path, then queue the run when the
              signal is clear.
            </p>
          </div>

          <div class="grid gap-3 md:grid-cols-3">
            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Operator signal</div>
              <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                Every phase tells you what happened, what still needs attention, and whether you can proceed.
              </p>
            </div>
            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Routing beneath the floor</div>
              <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                Restormel route steps, provider health, and simulation stay visible, but they no longer drown the workflow.
              </p>
            </div>
            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Advanced control intact</div>
              <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                Raw payload editing is still available whenever you need it, but it is no longer the opening move.
              </p>
            </div>
          </div>
        </div>

        <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/80 p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase signal</div>
              <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
                The triangle is now the process gate. Analysis covers preparation, critique covers route inspection, synthesis confirms readiness to proceed.
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

          <div class="mt-5 space-y-3">
            <div class="flex items-center justify-between rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/50 px-3 py-2">
              <span class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-dim">Current focus</span>
              <span class="font-mono text-sm text-sophia-dark-text">{PHASES.find((phase) => phase.id === activePhase)?.title}</span>
            </div>
            <div class="flex items-center justify-between rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/50 px-3 py-2">
              <span class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-dim">Primary action</span>
              <span class="font-mono text-sm text-sophia-dark-text">{activeProfile.launchLabel}</span>
            </div>
            <div class="flex items-center justify-between rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/50 px-3 py-2">
              <span class="font-mono text-xs uppercase tracking-[0.14em] text-sophia-dark-dim">Live records</span>
              <span class="font-mono text-sm text-sophia-dark-text">{operations.length}</span>
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
      <nav class="phase-rail rounded border border-sophia-dark-border bg-sophia-dark-surface px-4 py-4" aria-label="Ingestion walkthrough phases">
        <div class="grid gap-3 lg:grid-cols-6">
          {#each PHASES as phase}
            <button
              type="button"
              class="phase-step rounded border px-4 py-4 text-left transition-colors"
              class:is-active={phase.id === activePhase}
              class:is-passed={phaseSignal(phase.id) === 'passed'}
              class:is-attention={phaseSignal(phase.id) === 'attention'}
              class:is-locked={phaseSignal(phase.id) === 'locked'}
              onclick={() => (activePhase = phase.id)}
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">{phase.cue}</div>
                  <div class="mt-2 font-serif text-2xl leading-none text-sophia-dark-text">{phase.title}</div>
                </div>
                <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${statusTone(phaseSignal(phase.id))}`}>
                  {phaseSignal(phase.id)}
                </span>
              </div>
              <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{phase.summary}</p>
            </button>
          {/each}
        </div>
      </nav>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_23rem]">
        <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 md:p-6">
          {#if activePhase === 'prepare'}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 1</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Define the operation clearly before you touch the machinery.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  Choose the operation, identify the source, and decide whether this run should validate immediately or remain dry.
                </p>
              </div>

              <div class="grid gap-4 lg:grid-cols-2">
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Operation</div>
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

                  <div class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/40 p-4">
                    <div class="font-serif text-2xl text-sophia-dark-text">{activeProfile.title}</div>
                    <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{activeProfile.summary}</p>
                    <p class="mt-3 font-mono text-xs leading-6 text-sophia-dark-dim">{activeProfile.routeHint}</p>
                  </div>
                </div>

                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Source mode</div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      class={`rounded border px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] ${sourceMode === 'url' ? 'border-sophia-dark-blue/40 bg-sophia-dark-blue/10 text-sophia-dark-blue' : 'border-sophia-dark-border bg-sophia-dark-surface-raised/30 text-sophia-dark-muted'}`}
                      onclick={() => (sourceMode = 'url')}
                    >
                      URL source
                    </button>
                    <button
                      type="button"
                      class={`rounded border px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] ${sourceMode === 'file' ? 'border-sophia-dark-blue/40 bg-sophia-dark-blue/10 text-sophia-dark-blue' : 'border-sophia-dark-border bg-sophia-dark-surface-raised/30 text-sophia-dark-muted'}`}
                      onclick={() => (sourceMode = 'file')}
                    >
                      Local file
                    </button>
                  </div>

                  {#if sourceMode === 'url'}
                    <label class="mt-4 block space-y-2">
                      <span class="font-mono text-xs text-sophia-dark-muted">Source URL</span>
                      <input
                        bind:value={sourceUrl}
                        type="url"
                        placeholder="https://plato.stanford.edu/entries/ethics-deontological/"
                        class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 text-sm text-sophia-dark-text"
                      />
                    </label>
                    <label class="mt-4 block space-y-2">
                      <span class="font-mono text-xs text-sophia-dark-muted">Source type</span>
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
                    </label>
                  {:else}
                    <label class="mt-4 block space-y-2">
                      <span class="font-mono text-xs text-sophia-dark-muted">Source file</span>
                      <input
                        bind:value={sourceFile}
                        type="text"
                        placeholder="data/sources/example.txt"
                        class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 text-sm text-sophia-dark-text"
                      />
                    </label>
                  {/if}
                </div>
              </div>

              <div class="grid gap-4 lg:grid-cols-4">
                <label class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Validation</span>
                  <div class="mt-3 flex items-center justify-between gap-3">
                    <span class="text-sm leading-6 text-sophia-dark-muted">Run validation after import</span>
                    <input bind:checked={validateRun} type="checkbox" class="h-4 w-4 accent-[var(--color-sage)]" />
                  </div>
                </label>
                <label class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Dry run</span>
                  <div class="mt-3 flex items-center justify-between gap-3">
                    <span class="text-sm leading-6 text-sophia-dark-muted">Check the plan without committing downstream changes</span>
                    <input bind:checked={dryRun} type="checkbox" class="h-4 w-4 accent-[var(--color-blue)]" />
                  </div>
                </label>
                <label class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4 space-y-2">
                  <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Manual provider</span>
                  <select
                    bind:value={ingestProvider}
                    class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 font-mono text-sm text-sophia-dark-text"
                  >
                    <option value="auto">Automatic routing</option>
                    <option value="vertex">Vertex only</option>
                    <option value="anthropic">Anthropic only</option>
                  </select>
                </label>
                <label class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4 space-y-2">
                  <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Domain</span>
                  <input
                    bind:value={domain}
                    type="text"
                    placeholder="ethics"
                    class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 text-sm text-sophia-dark-text"
                  />
                </label>
              </div>

              <label class="block space-y-2">
                <span class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Operator note</span>
                <textarea
                  bind:value={notes}
                  rows="3"
                  placeholder="Add rationale, caveats, or handover notes for this run."
                  class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-3 py-3 text-sm text-sophia-dark-text"
                ></textarea>
              </label>

              <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-4 py-3">
                <div>
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Next step</div>
                  <p class="mt-1 text-sm text-sophia-dark-muted">Move into preflight once the source and payload are unambiguous.</p>
                </div>
                <div class="flex gap-3">
                  <button
                    type="button"
                    onclick={() => (advancedMode = !advancedMode)}
                    class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                  >
                    {advancedMode ? 'Hide raw payload' : 'Advanced payload'}
                  </button>
                  <button
                    type="button"
                    onclick={advancePhase}
                    disabled={!prepareReady}
                    class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10 disabled:opacity-50"
                  >
                    Continue to preflight
                  </button>
                </div>
              </div>
            </div>
          {:else if activePhase === 'preflight'}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 2</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Read the warnings before you light the route.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  This pass surfaces hard blockers, weak routing coverage, and empty provider health so the user knows what still needs attention.
                </p>
              </div>

              <div class="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Blocking issues</div>
                  <div class="mt-4 space-y-3">
                    {#if preflightBlockers().length === 0}
                      <div class="rounded border border-sophia-dark-sage/35 bg-sophia-dark-sage/8 px-4 py-3 text-sm text-sophia-dark-sage">
                        No hard blockers. The source and payload are structurally ready.
                      </div>
                    {:else}
                      {#each preflightBlockers() as blocker}
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
                    {#if preflightWarnings().length === 0}
                      <div class="rounded border border-sophia-dark-blue/35 bg-sophia-dark-blue/8 px-4 py-3 text-sm text-sophia-dark-blue">
                        The route coverage and provider surface look ready for a clean walk through the pipeline.
                      </div>
                    {:else}
                      {#each preflightWarnings() as warning}
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
                      {phaseSignal('preflight')}
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
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Walk the chambers above the floor, inspect the route beneath it.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  Each stage shows whether it has a dedicated route, is borrowing a shared route, or still needs explicit routing. Select a stage to inspect its active and fallback steps.
                </p>
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
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Preview the route before the run crosses the threshold.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  Use the selected stage as a proxy for route readiness. When a stage has dedicated route metadata, the preview sends that context through Restormel. Otherwise it runs the route in shared mode.
                </p>
              </div>

              <div class="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
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
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Queue the job when the surface and subfloor both look right.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  You now have the source, the preflight result, the stage coverage, and the route preview. Launch only when the route is legible enough for the user who follows you.
                </p>
              </div>

              <div class="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4 space-y-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Launch verdict</div>
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4">
                    <div class={`inline-flex rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] ${statusTone(phaseSignal('run'))}`}>
                      {phaseSignal('run')}
                    </div>
                    <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">
                      {prepareReady
                        ? 'The payload is structurally valid. Launch now or return to an earlier phase to refine the route.'
                        : 'Resolve the blockers above before queueing this operation.'}
                    </p>
                  </div>

                  <div class="grid gap-3 md:grid-cols-2">
                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Primary route stance</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                        {ingestProvider === 'auto' ? 'Automatic routing' : `${ingestProvider} override`}
                      </div>
                    </div>
                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Validation mode</div>
                      <div class="mt-2 font-mono text-sm text-sophia-dark-text">
                        {validateRun ? 'Validate after ingest' : 'Skip validation'}
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onclick={submitOperation}
                      disabled={!canLaunch}
                      class="rounded border border-sophia-dark-blue/40 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10 disabled:opacity-50"
                    >
                      {requestState === 'submitting' ? 'Queueing…' : activeProfile.launchLabel}
                    </button>
                    <button
                      type="button"
                      onclick={() => (activePhase = 'simulate')}
                      class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                    >
                      Back to simulate
                    </button>
                  </div>
                </div>

                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Operation payload</div>
                  <pre class="mt-4 max-h-[22rem] overflow-auto whitespace-pre-wrap break-words rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4 font-mono text-xs text-sophia-dark-text">{payloadText}</pre>
                </div>
              </div>
            </div>
          {:else}
            <div class="space-y-6">
              <div>
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Phase 6</div>
                <h2 class="mt-2 text-3xl font-serif text-sophia-dark-text">Review the run, then decide whether the next phase is safe.</h2>
                <p class="mt-3 max-w-3xl text-base leading-7 text-sophia-dark-muted">
                  The most recent operation becomes the review surface. Read the status, the lineage, and the log without leaving the walkthrough.
                </p>
              </div>

              {#if activeOperation}
                <div class="grid gap-4 md:grid-cols-4">
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
                </div>

                <div class="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div class="space-y-4">
                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Summary</div>
                      <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{activeOperation.result_summary ?? 'Job is still in progress.'}</p>
                      {#if activeOperation.last_error}
                        <p class="mt-3 font-mono text-xs text-sophia-dark-copper">{activeOperation.last_error}</p>
                      {/if}
                    </div>

                    <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                      <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Lineage</div>
                      <dl class="mt-3 space-y-2 font-mono text-xs text-sophia-dark-text">
                        <div class="flex justify-between gap-4"><dt>Action</dt><dd>{activeOperation.requested_action}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Tool</dt><dd>{activeOperation.restormel_tool ?? 'adapter'}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Hosted Run</dt><dd>{activeOperation.hosted_run_id ?? '—'}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Attempts</dt><dd>{activeOperation.attempts}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Created</dt><dd>{formatDate(activeOperation.created_at)}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Started</dt><dd>{formatDate(activeOperation.started_at)}</dd></div>
                        <div class="flex justify-between gap-4"><dt>Completed</dt><dd>{formatDate(activeOperation.completed_at)}</dd></div>
                      </dl>
                    </div>

                    <div class="flex flex-wrap gap-3">
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
                    </div>
                  </div>

                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                    <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Live log</div>
                    <pre class="mt-4 min-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 p-4 font-mono text-xs text-sophia-dark-text">{activeOperation.log_text || 'No logs captured yet.'}</pre>
                  </div>
                </div>
              {:else}
                <div class="rounded border border-dashed border-sophia-dark-border px-4 py-10 text-center font-mono text-sm text-sophia-dark-dim">
                  Queue or select an operation to review the run from here.
                </div>
              {/if}
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

        <aside class="space-y-6">
          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Restormel advice</div>
            <div class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
              <div class={`inline-flex rounded-full border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] ${statusTone(routingAdvisory.tone)}`}>
                {routingAdvisory.tone}
              </div>
              <h3 class="mt-3 text-2xl font-serif text-sophia-dark-text">{routingAdvisory.title}</h3>
              <p class="mt-3 text-sm leading-6 text-sophia-dark-muted">{routingAdvisory.body}</p>

              <div class="mt-4 space-y-3">
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 px-3 py-3">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Route focus</div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{routingAdvisory.routeFocus}</p>
                </div>
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised/30 px-3 py-3">
                  <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Policy focus</div>
                  <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">{routingAdvisory.policyFocus}</p>
                </div>
              </div>

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
          </section>

          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Routing signal</div>
            <div class="mt-4 space-y-3">
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Environment</div>
                <div class="mt-2 font-mono text-xs text-sophia-dark-text break-all">{routingEnvironmentId}</div>
              </div>
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 p-4">
                <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-dim">Coverage</div>
                <div class="mt-3 grid gap-2">
                  <div class="flex items-center justify-between font-mono text-xs">
                    <span class="text-sophia-dark-muted">Dedicated routes</span>
                    <span class="text-sophia-dark-text">{dedicatedRouteCount}</span>
                  </div>
                  <div class="flex items-center justify-between font-mono text-xs">
                    <span class="text-sophia-dark-muted">Shared fallback</span>
                    <span class="text-sophia-dark-text">{sharedFallbackCount}</span>
                  </div>
                  <div class="flex items-center justify-between font-mono text-xs">
                    <span class="text-sophia-dark-muted">Missing stages</span>
                    <span class="text-sophia-dark-text">{missingStageCount}</span>
                  </div>
                </div>
              </div>
              {#if routingContext?.errors?.routes}
                <div class="rounded border border-sophia-dark-copper/35 bg-sophia-dark-copper/8 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
                  {routingContext.errors.routes.detail}
                </div>
              {/if}
            </div>
          </section>

          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Providers</div>
            <div class="mt-4 space-y-3">
              {#if providerHealthEntries.length > 0}
                {#each providerHealthEntries as provider}
                  <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/70 px-4 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="font-mono text-sm text-sophia-dark-text">{provider.providerType ?? 'provider'}</div>
                      <span class={`rounded-full border px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${providerStateTone(provider.status)}`}>
                        {provider.status ?? 'unknown'}
                      </span>
                    </div>
                    <p class="mt-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                      {provider.source ?? 'source unavailable'}
                    </p>
                  </div>
                {/each}
              {:else}
                <div class="rounded border border-sophia-dark-amber/35 bg-sophia-dark-amber/8 px-4 py-3 text-sm leading-6 text-sophia-dark-amber">
                  Provider health is not yet surfacing configured providers for this project. Routing can still exist, but the operator signal is weaker than it should be.
                </div>
              {/if}
            </div>
          </section>

          <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5">
            <div class="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-sophia-dark-muted">Recent runs</div>
            <div class="mt-4 space-y-3 max-h-[28rem] overflow-auto pr-1">
              {#each operations as operation}
                <button
                  type="button"
                  onclick={() => {
                    void loadOperation(operation.id);
                    activePhase = 'review';
                  }}
                  class="w-full rounded border px-4 py-3 text-left transition-colors {selectedId === operation.id ? 'border-sophia-dark-blue/50 bg-sophia-dark-blue/10' : 'border-sophia-dark-border bg-sophia-dark-bg hover:bg-sophia-dark-surface-raised'}"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="font-mono text-sm text-sophia-dark-text">{operation.requested_action}</div>
                      <div class="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">{operation.kind}</div>
                    </div>
                    <span class={`px-2 py-1 text-[0.68rem] font-mono border rounded uppercase tracking-[0.12em] ${badgeClass(operation.status)}`}>
                      {operation.status}
                    </span>
                  </div>
                  <div class="mt-3 flex items-center justify-between gap-3 font-mono text-xs text-sophia-dark-dim">
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
  .workbench-hero {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(820px 360px at 14% 0%, rgba(127, 163, 131, 0.12), transparent 65%),
      radial-gradient(760px 300px at 84% 0%, rgba(111, 163, 212, 0.12), transparent 70%),
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
  }

  .phase-step {
    position: relative;
    background: linear-gradient(180deg, rgba(20, 19, 18, 0.42), rgba(17, 17, 16, 0.76));
    border-color: var(--color-border);
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
    border-color: rgba(111, 163, 212, 0.42);
    background: linear-gradient(180deg, rgba(25, 33, 41, 0.7), rgba(18, 21, 24, 0.88));
  }

  .phase-step.is-passed::before {
    background: linear-gradient(90deg, rgba(127, 163, 131, 0), rgba(127, 163, 131, 0.65), rgba(127, 163, 131, 0));
    opacity: 0.45;
  }

  .phase-step.is-attention::before {
    background: linear-gradient(90deg, rgba(212, 147, 111, 0), rgba(212, 147, 111, 0.65), rgba(212, 147, 111, 0));
    opacity: 0.45;
  }

  .phase-step.is-locked {
    opacity: 0.78;
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
</style>
