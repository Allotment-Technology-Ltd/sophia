<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getIdToken } from '$lib/authClient';
  import { isEmbeddingModelEntry } from '$lib/ingestionModelCatalogMerge';
  import { INGESTION_SOURCE_MODEL_HINTS } from '$lib/ingestionModelCatalog';
  import {
    entryMeetsPresetStageMinimum,
    INGESTION_PIPELINE_PRESET
  } from '$lib/ingestionPipelineModelRequirements';
  import { resolveRouteForStage } from '$lib/utils/ingestionRouting';
  import {
    COACH_UI_VARIABLE_LABELS,
    CODE_CHANGE_AREA_LABELS,
    type CoachAggregatedSignals,
    type CoachSettingTweak,
    type IngestionCoachOutput
  } from '$lib/ingestionCoachSchema';
  import {
    ADMIN_INGEST_WORKER_UI_DEFAULTS as W,
    ADMIN_INGEST_WORKER_UI_TOOLTIPS as WT
  } from '$lib/adminIngestWorkerUiDefaults';

  type StageStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';
  type FlowState = 'setup' | 'running' | 'awaiting_sync' | 'done' | 'error';
  type PipelinePreset = typeof INGESTION_PIPELINE_PRESET;

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
    /** e.g. 128k, 200k, 1M — from catalog / merge */
    contextWindow?: string;
    costTier?: 'low' | 'medium' | 'high';
    qualityTier?: 'capable' | 'strong' | 'frontier';
    speed?: 'fast' | 'balanced' | 'thorough';
    pricing?: {
      inputPerMillion?: number | null;
      outputPerMillion?: number | null;
    } | null;
  }

  interface IngestExecutionInfo {
    mode?: 'simulated' | 'real';
    surrealTarget?: string;
    firestoreProject?: string | null;
  }

  interface SourcePreScanPhaseEstimate {
    stage: string;
    latency: 'low' | 'balanced' | 'high';
    complexity: 'low' | 'medium' | 'high';
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }

  type IngestionAdvisorMode = 'off' | 'shadow' | 'auto';

  interface AdvisorApiEnvelope {
    mode: IngestionAdvisorMode;
    enabled: boolean;
    heuristicBaseline: {
      recommendedPreset: PipelinePreset;
      suggestCrossModelValidation: boolean;
      basis: string;
    };
    suggestion: {
      recommendedPreset: PipelinePreset;
      confidence: number;
      rationale: string;
      suggestCrossModelValidation: boolean;
      efficiencyNotes?: string;
      riskSignals?: string[];
    } | null;
    applied: { preset: PipelinePreset; runValidate: boolean };
    autoApplied: { preset: boolean; validation: boolean };
    shadowDiff: {
      presetChangedVsHeuristic: boolean;
      presetChangedVsAdvisor: boolean;
      validationChangedVsHeuristic: boolean;
    };
    model?: { provider: string; modelId: string };
    error?: string;
  }

  interface SourcePreScanResult {
    metadata: {
      title?: string;
      author?: string;
      publicationYear?: string;
      contentType?: string;
      contentLengthBytes?: number | null;
      finalUrl?: string;
      hostname?: string;
      sepCitation?: {
        entrySlug: string;
        archiveInfoUrl: string;
        stableArchiveUrl: string | null;
        citationText: string | null;
        firstPublished: string | null;
        lastModified: string | null;
      } | null;
    };
    preScan: {
      approxContentChars: number;
      approxContentTokens: number;
      previewChars: number;
      previewTokens: number;
      phaseEstimates: SourcePreScanPhaseEstimate[];
    };
    advisor?: AdvisorApiEnvelope;
  }

  const SOURCE_TYPES = [
    { value: 'sep_entry', label: 'Stanford Encyclopedia of Philosophy' },
    { value: 'iep_entry', label: 'Internet Encyclopedia of Philosophy' },
    { value: 'journal_article', label: 'Academic paper / PhilPapers / journal' },
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
      key: 'ingestion_fetch',
      label: 'Fetch & parse',
      description: 'Download and normalize source text before model stages.',
      embed: false
    },
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

  /** One-line summary per stage (long copy stays in “Learn more”). */
  const STAGE_ONE_LINE: Record<string, string> = {
    ingestion_fetch: 'HTTP fetch, HTML or text cleanup, and canonical file layout (no LLM).',
    ingestion_extraction: 'Structured claims and passages from the source.',
    ingestion_relations: 'Support, tension, and dependency links between claims.',
    ingestion_grouping: 'Argument clusters and positions.',
    ingestion_validation: 'Quality and confidence checks.',
    ingestion_embedding: 'Vectors for retrieval.',
    ingestion_json_repair: 'Repair malformed model output.'
  };

  const STAGE_TEMPLATE: Stage[] = [
    { key: 'fetch', label: 'Fetch & parse', description: 'Download and normalize the source.', status: 'idle' },
    { key: 'extract', label: 'Extract', description: 'Structured claims from passages.', status: 'idle' },
    { key: 'relate', label: 'Relate', description: 'Link claims by support and tension.', status: 'idle' },
    { key: 'group', label: 'Group', description: 'Cluster into arguments.', status: 'idle' },
    { key: 'embed', label: 'Embed', description: 'Embedding vectors for claims.', status: 'idle' },
    { key: 'validate', label: 'Validate', description: 'Optional cross-model validation.', status: 'idle' },
    {
      key: 'remediation',
      label: 'Remediate',
      description: 'Passage-bounded repair of low-faithfulness claims after validation.',
      status: 'idle'
    },
    {
      key: 'store',
      label: 'Store',
      description: 'Write graph and records to SurrealDB (use Sync when prepare finishes).',
      status: 'idle'
    }
  ];

  /** Narrative copy for the pipeline progress panel (keys match `runCurrentStage` from the worker). */
  type PipelineStageTheory = {
    headline: string;
    summary: string;
    readMore: string[];
  };

  const PIPELINE_STAGE_THEORY: Record<string, PipelineStageTheory> = {
    fetch: {
      headline: 'Establishing a stable text layer',
      summary:
        'The pipeline turns a URL into clean, normalized source text so everything downstream works on the same canonical material—preserving provenance and reducing format noise.',
      readMore: [
        'At this step Sophia fetches the article or entry and normalizes it for processing. That matters because extraction and retrieval are only as trustworthy as the text they see; duplicates, boilerplate, and encoding quirks can silently skew later stages.',
        'Restormel/Sophia is designed for philosophy corpora (SEP-style entries, IEP, papers): the fetch layer aims for reproducible snapshots so you can cite and revisit the same intellectual object over time.',
        'Technology: HTTP fetch, HTML or plain-text handling, and canonical paths into your local corpus (e.g. hashed source files). When you see DB warnings here, they often relate to logging or progress tracking while the text is prepared—not necessarily to the philosophical content itself.'
      ]
    },
    extract: {
      headline: 'From prose to structured claims',
      summary:
        'Language models segment the text into discrete claims and spans so reasoning can be grounded in explicit units instead of loose paragraphs.',
      readMore: [
        'Extraction is where philosophy stops being “just text” and becomes data you can query: candidate claims, positions, and citations tied to spans in the source.',
        'Why this is strong for research: claims can be compared, contradicted, and aggregated across sources. The pipeline is not merely summarizing; it is building an interpretable layer for downstream graph and retrieval work.',
        'Models are chosen per stage (Restormel routing); you can favour economy or depth depending on preset. Outputs are structured (JSON) so later stages consume deterministic fields, not free-form prose.'
      ]
    },
    relate: {
      headline: 'Building the argument graph',
      summary:
        'Claims are linked by support, tension, and dependency so the corpus reflects argumentative structure—not only topical similarity.',
      readMore: [
        'At this stage Sophia adds relations between claims: who supports whom, what conflicts, and what depends on what. That is the difference between a keyword index and a map of philosophical debate.',
        'This matters for theory: you can trace lines of argument, locate objections, and see how positions cluster—useful for literature reviews and thesis-level work.',
        'The graph is explicit and typed, which supports later querying in SurrealDB and visualization. Relation quality is a function of the extraction plus the model’s grasp of philosophical nuance in context.'
      ]
    },
    group: {
      headline: 'Arguments, positions, and clusters',
      summary:
        'Related claims are grouped into arguments and stance clusters so you can navigate positions at a higher level than single sentences.',
      readMore: [
        'Grouping turns the relation graph into human-meaningful units: which claims belong to the same argumentative move, which positions oppose each other, and how debates are structured.',
        'For researchers, this is the bridge between fine-grained extraction and big-picture narrative: you can zoom from a single claim to a map of a debate.',
        'Sophia uses model-driven clustering with constraints from the graph; the goal is interpretability for philosophy, not just statistical clustering.'
      ]
    },
    embed: {
      headline: 'Semantic vectors for retrieval',
      summary:
        'Embeddings place claims in a semantic space so similarity search and RAG-style retrieval align with meaning, not just lexical overlap.',
      readMore: [
        'Each embedded unit can be retrieved by natural-language questions or by proximity to other claims. That supports discovery: “what else is near this idea?” across your corpus.',
        'Embedding models are chosen for compatibility with your stack (e.g. dimension and provider). The pipeline separates embedding from chat completion so you can tune cost and quality per concern.',
        'This is why Sophia’s ingestion is retrieval-aware: the system is not only storing text but preparing for question-answering and evidence gathering over time.'
      ]
    },
    validate: {
      headline: 'Second-pass quality and cross-checks',
      summary:
        'Optional validation runs another model (or checks) over claims and relations to catch hallucinations, omissions, or inconsistencies in sensitive stages.',
      readMore: [
        'Philosophy is high-stakes semantically: a misread premise can break a chain of inference. Validation is designed to reduce single-model blind spots by introducing an independent pass or a different model family.',
        'When enabled, this stage can flag weak support, missing relations, or tension that should exist given the text—helping you trust the graph before you publish or query.',
        'You can disable validation for speed or cost; when on, it is a deliberate trade of latency for robustness.',
        'This is a differentiator from “one-shot” ingestion: Sophia treats quality as a pipeline concern, not a single prompt.'
      ]
    },
    remediation: {
      headline: 'Targeted repair before storage',
      summary:
        'When validation is enabled, passage-bounded remediation rewrites a small set of low-faithfulness claims using local context, then refreshes embeddings for those claims.',
      readMore: [
        'Remediation is intentionally narrow: it does not re-run the whole pipeline; it repairs specific positions the validator flagged, bounded by source spans.',
        'This stage can dominate wall time when many claims need repair; the live log shows per-claim progress so long silences are easier to interpret.',
        'Operators can tune `INGEST_REMEDIATION_MAX_CLAIMS` and related env vars when cost or latency needs to be capped.'
      ]
    },
    store: {
      headline: 'Persisting the knowledge graph',
      summary:
        'Claims, relations, embeddings, and metadata are written to SurrealDB so your work becomes durable, queryable, and integrable with the rest of Sophia.',
      readMore: [
        'Storage is not a dump of files: the graph schema is designed for philosophical objects (claims, relations, sources) and for vector search where configured.',
        'In admin workflows, prepare phases may finish before a deliberate “Sync” step so you can review cost and correctness before committing to the database.',
        'SurrealDB gives you graph queries, records, and (in the full stack) operational access for apps and research tools. The ingestion pipeline is the on-ramp from text to that environment.',
        'After a successful store, the same corpus can power retrieval, analytics, and downstream agents—without re-ingesting from scratch unless you change models or source policy.'
      ]
    }
  };

  const PIPELINE_STAGE_THEORY_DEFAULT: PipelineStageTheory = {
    headline: 'Why Sophia’s ingestion pipeline exists',
    summary:
        'Sophia turns philosophical texts into a structured, relational, and retrieval-ready corpus—so research is grounded in explicit claims and provenance, not opaque summaries.',
    readMore: [
      'Each stage has a narrow job: normalize text, extract structured claims, relate them, group them into arguments, embed them for search, optionally validate, then persist. That separation is intentional: it improves control, observability, and cost.',
      'Compared to “one prompt to rule them all,” a staged pipeline lets you route different models per stage, measure failure, and resume—critical for long sources and for operator trust.',
      'When a stage is active, the box below highlights what is happening in theory and in practice. Expand “Read more” for technical context and how this fits research workflows.'
    ]
  };

  function pipelineStageTheory(stageKey: string | null | undefined): PipelineStageTheory {
    const k = (stageKey ?? '').trim().toLowerCase();
    if (k && PIPELINE_STAGE_THEORY[k]) return PIPELINE_STAGE_THEORY[k];
    return PIPELINE_STAGE_THEORY_DEFAULT;
  }

  let flowState = $state<FlowState>('setup');
  /** Last `status` from a successful `/status` poll; used to tell live failure vs reopening an already-failed run. */
  let lastAppliedRunStatus = $state<string | null>(null);
  let sourceUrl = $state('');
  let sourceType = $state<(typeof SOURCE_TYPES)[number]['value']>('sep_entry');
  let runValidate = $state(true);
  let starting = $state(false);
  let cancelling = $state(false);
  /** Shown after a monitored run disappears server-side (e.g. restart) so the operator can continue. */
  let monitorRunNotice = $state('');
  /** Firestore `ingestion_run_reports` snapshot loaded via `?reportRunId=` (read-only; no in-memory run). */
  type FirestoreReportDetail = {
    runId: string;
    status: string | null;
    sourceUrl: string;
    sourceType: string;
    modelChain: Record<string, string> | null;
    pipelinePreset: string | null;
    embeddingModel: string | null;
    validate: boolean;
    issueCount: number;
    issueSummary: Record<string, number>;
    terminalError: string | null;
    lastFailureStageKey: string | null;
    completedAtMs: number | null;
    createdAtMs: number | null;
    /** Rule-based fleet tuning hints (no LLM); from report envelope */
    metricsAdvisory?: {
      severity?: string;
      recommendations?: string[];
      guardrails?: string[];
      signals?: Record<string, number>;
    } | null;
  };
  let firestoreReportDetail = $state<FirestoreReportDetail | null>(null);
  let firestoreReportLoadError = $state('');
  /** Server-reported error line after a run ends in error/cancel; Source step shows next steps. */
  let sourceRunEndedDetail = $state<string | null>(null);
  let syncing = $state(false);
  let runId = $state('');
  let runError = $state('');
  let urlError = $state('');
  let runLog = $state<string[]>([]);
  /** Server log line count for incremental `/status?since=` polling */
  let runLogCursor = $state(0);
  let pollRunKey = $state('');
  /** Parsed from worker `[INGEST_TIMING]` line when present */
  let ingestTimingSummary = $state<Record<string, unknown> | null>(null);
  let runCurrentStage = $state<string | null>(null);
  let runCurrentAction = $state<string | null>(null);
  let runLastFailureStage = $state<string | null>(null);
  let runResumable = $state(false);
  let runProcessAlive = $state(false);
  let runProcessId = $state<number | null>(null);
  let runLastOutputAt = $state<number | null>(null);
  let runIdleForMs = $state<number | null>(null);
  let runProcessStartedAt = $state<number | null>(null);
  let runProcessExitedAt = $state<number | null>(null);
  /** Neon `exclude_from_batch_suggest`: keep URL out of SEP catalog batch helper when excluding ingested. */
  let runExcludeFromBatchSuggest = $state(false);
  let batchSuggestFlagBusy = $state(false);
  let batchSuggestFlagError = $state('');
  let showRawLog = $state(false);
  /** Structured issues parsed from worker logs (also persisted to Firestore when the run ends or pauses for sync). */
  type RunCapturedIssue = {
    seq: number;
    ts: number;
    kind: string;
    severity: string;
    stageHint: string | null;
    message: string;
    rawLine: string;
  };
  let runCapturedIssues = $state<RunCapturedIssue[]>([]);
  let stages = $state<Stage[]>(cloneStages());
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  let routingBusy = $state(false);
  let routingMessage = $state('');
  let routingError = $state('');
  let routes = $state<AdminRouteRecord[]>([]);
  let batchOverridesOpen = $state(false);
  let batchExtractionMaxTokensPerSection = $state(W.extractionMaxTokensPerSection);
  let batchGroupingTargetTokens = $state(W.groupingTargetTokens);
  let batchValidationTargetTokens = $state(W.validationTargetTokens);
  let batchRelationsTargetTokens = $state(W.relationsTargetTokens);
  let batchEmbedBatchSize = $state(W.embedBatchSize);
  /** Per-run worker timeouts (ms); merged into ingest child env via `batch_overrides`. */
  let batchIngestModelTimeoutMs = $state(W.ingestModelTimeoutMs);
  let batchValidationModelTimeoutMs = $state(W.validationModelTimeoutMs);
  let batchValidationStageTimeoutMs = $state(W.validationStageTimeoutMs);
  let batchExtractionStageTimeoutMs = $state(W.extractionStageTimeoutMs);
  let batchRelationsStageTimeoutMs = $state(W.relationsStageTimeoutMs);
  let batchGroupingStageTimeoutMs = $state(W.groupingStageTimeoutMs);
  let batchEmbeddingStageTimeoutMs = $state(W.embeddingStageTimeoutMs);
  let batchJsonRepairStageTimeoutMs = $state(W.jsonRepairStageTimeoutMs);
  let pipelineDebugOpen = $state(false);
  type IngestWorkerDiagnostics = {
    keysBaseHost: string | null;
    environmentId: string;
    projectIdConfigured: boolean;
    gatewayKeyConfigured: boolean;
  };
  type EmbeddingHealthSnapshot = {
    activeProvider: string | null;
    activeModel: string | null;
    expectedDimensions: number | null;
    detectedDbVectorDimension: number | null;
    detectedDbDimensions: number[];
    sampledVectors: number;
    drift: boolean | null;
  };
  let ingestWorkerDiagnostics = $state<IngestWorkerDiagnostics | null>(null);
  let embeddingHealth = $state<EmbeddingHealthSnapshot | null>(null);
  let embeddingHealthWarnings = $state<string[]>([]);
  let embeddingHealthBusy = $state(false);
  let embeddingHealthError = $state('');
  let batchOverridesError = $state('');
  const INGEST_SETTINGS_STORAGE_KEY = 'sophia.admin.ingestSettings.v2';
  type IngestionAdvisorModeUi = 'off' | 'shadow' | 'auto';
  let ingestionAdvisorModeUi = $state<IngestionAdvisorModeUi>('off');
  let ingestionAdvisorAutoApplyPreset = $state(true);
  let ingestionAdvisorAutoApplyValidation = $state(true);
  let workerIngestProvider = $state<'auto' | 'anthropic' | 'vertex'>('auto');
  let workerRelationsOverlapClaims = $state(W.relationsBatchOverlapClaims);
  let workerGoogleThroughputEnabled = $state(true);
  let workerGoogleExtractionFloor = $state(W.googleExtractionConcurrencyFloor);
  let workerFailOnGroupingCollapse = $state(true);
  /** Maps to `INGEST_LOG_PINS` on the ingest worker. */
  let workerIngestLogPins = $state(false);
  let ingestSettingsHydrated = $state(false);
  let catalogEntries = $state<CatalogEntry[]>([]);
  let catalogError = $state('');
  let catalogNotice = $state('');
  let stageProviders = $state<Record<string, string>>({
    ingestion_fetch: '',
    ingestion_extraction: '',
    ingestion_relations: '',
    ingestion_grouping: '',
    ingestion_validation: '',
    ingestion_embedding: '',
    ingestion_json_repair: ''
  });
  let stageModelIds = $state<Record<string, string>>({
    ingestion_fetch: '',
    ingestion_extraction: '',
    ingestion_relations: '',
    ingestion_grouping: '',
    ingestion_validation: '',
    ingestion_embedding: '',
    ingestion_json_repair: ''
  });
  let stageFallbackProviders = $state<Record<string, string>>({
    ingestion_fetch: '',
    ingestion_extraction: '',
    ingestion_relations: '',
    ingestion_grouping: '',
    ingestion_validation: '',
    ingestion_embedding: '',
    ingestion_json_repair: ''
  });
  let stageFallbackModelIds = $state<Record<string, string>>({
    ingestion_fetch: '',
    ingestion_extraction: '',
    ingestion_relations: '',
    ingestion_grouping: '',
    ingestion_validation: '',
    ingestion_embedding: '',
    ingestion_json_repair: ''
  });

  function isLikelyEmbeddingModel(entry: Pick<CatalogEntry, 'provider' | 'modelId'>): boolean {
    if (isEmbeddingModelEntry(entry)) return true;
    const low = entry.modelId.toLowerCase();
    // Broaden detection for providers that don't always use "embedding" explicitly.
    return /(textembedding|vector|gecko|e5-|bge-|ada-|embed-|embedding-)/i.test(low);
  }

  let chatModels = $derived(catalogEntries.filter((e) => !isLikelyEmbeddingModel(e)));
  let embeddingModels = $derived(catalogEntries.filter((e) => isLikelyEmbeddingModel(e)));

  let syncDurationLabel = $state('');
  let completionMessage = $state('');
  let executionNotice = $state('');
  let sourcePreScanBusy = $state(false);
  let sourcePreScanError = $state('');
  let sourcePreScanResult = $state<SourcePreScanResult | null>(null);
  let sourcePreScanFingerprint = $state('');
  /** When server auto-applies preset, models must be loaded before `applyPipelinePreset` runs. */
  let advisorAutoApplyPreset = $state<PipelinePreset | null>(null);
  let coachBusy = $state(false);
  let coachError = $state('');
  let coachAggregatedSignals = $state<CoachAggregatedSignals | null>(null);
  let coachResult = $state<IngestionCoachOutput | null>(null);
  const coachUiTweaks = $derived(
    coachResult?.settingTweaks?.filter((t) => t.scope !== 'repo_implementation') ?? []
  );
  const coachRepoTweaks = $derived(
    coachResult?.settingTweaks?.filter((t) => t.scope === 'repo_implementation') ?? []
  );
  let activeStep = $state<'source' | 'pipeline' | 'cost' | 'review'>('source');
  let activePipelineStageKey = $state('ingestion_extraction');
  const activePipelineStage = $derived(
    RESTORMEL_STAGES.find((r) => r.key === activePipelineStageKey) ?? RESTORMEL_STAGES[0]
  );
  let selectedPreset = $state<PipelinePreset | null>(null);
  let presetMessage = $state('');
  /** User accepted cost estimates / billing disclaimer on the Cost review step (tab ✓). */
  let costEstimateAcknowledged = $state(false);

  function stableModelId(e: Pick<CatalogEntry, 'provider' | 'modelId'>): string {
    return `${e.provider}__${e.modelId}`.replace(/\//g, '-');
  }

  function getCatalogEntryByStableId(id: string): CatalogEntry | undefined {
    if (!id.trim()) return undefined;
    return catalogEntries.find((e) => stableModelId(e) === id);
  }

  /** Providers implied by Restormel stage picks + worker ingest preference (for infra checklist). */
  const routingInfraProviders = $derived.by(() => {
    const out = new Set<string>();
    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') continue;
      const sid = stageModelIds[row.key];
      const p = getCatalogEntryByStableId(sid);
      if (p?.provider) out.add(p.provider.trim().toLowerCase());
      const fb = stageFallbackModelIds[row.key]?.trim();
      if (fb) {
        const fe = getCatalogEntryByStableId(fb);
        if (fe?.provider) out.add(fe.provider.trim().toLowerCase());
      }
    }
    const wp = workerIngestProvider?.trim().toLowerCase();
    if (wp && wp !== 'auto') out.add(wp);
    return [...out].sort();
  });

  /** Chat vs embedding split of the merged catalog (same surface as Model availability). Save routing still enforces Restormel route-step providers separately. */
  function modelsForStage(row: (typeof RESTORMEL_STAGES)[number]): CatalogEntry[] {
    if (row.key === 'ingestion_fetch') return [];
    return row.embed ? embeddingModels : chatModels;
  }

  function providersForStage(row: (typeof RESTORMEL_STAGES)[number]): string[] {
    const unique = new Set<string>();
    for (const entry of modelsForStage(row)) {
      if (entry.provider?.trim()) unique.add(entry.provider);
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }

  function modelsForStageProvider(row: (typeof RESTORMEL_STAGES)[number], provider: string): CatalogEntry[] {
    const pid = provider.trim();
    if (!pid) return [];
    return modelsForStage(row).filter((entry) => entry.provider === pid);
  }

  function validationModelConflicts(entry: CatalogEntry): boolean {
    const sid = stableModelId(entry);
    const primaryStages = ['ingestion_extraction', 'ingestion_relations', 'ingestion_grouping'];
    return primaryStages.some((key) => stageModelIds[key]?.trim() === sid);
  }

  /** Same as {@link validationModelConflicts} but reads IDs from a map (used while applying presets before `stageModelIds` commits). */
  function validationModelConflictsWithMap(entry: CatalogEntry, map: Record<string, string>): boolean {
    const sid = stableModelId(entry);
    const primaryStages = ['ingestion_extraction', 'ingestion_relations', 'ingestion_grouping'];
    return primaryStages.some((key) => map[key]?.trim() === sid);
  }

  /**
   * After any change to primary-stage models, ensure validation uses a different model when enabled.
   * Picks the best-scoring non-conflicting chat model from the catalog for this stage.
   */
  function ensureValidationModelIsIndependent(): void {
    if (!runValidate) return;
    const row = RESTORMEL_STAGES.find((r) => r.key === 'ingestion_validation');
    if (!row) return;
    const list = modelsForStage(row);
    if (list.length === 0) return;
    const presetForFloor = INGESTION_PIPELINE_PRESET;

    // Ensure validation PRIMARY differs from Extraction / Relations / Grouping to avoid self-review bias.
    const currentPrimary = getCatalogEntryByStableId(stageModelIds[row.key] ?? '');
    const nonConflictingPrimary = list.filter((e) => !validationModelConflicts(e));
    if (nonConflictingPrimary.length === 0) return;

    let primaryPick = currentPrimary && !validationModelConflicts(currentPrimary) ? currentPrimary : null;
    if (!primaryPick) {
      primaryPick =
        nonConflictingPrimary.find(
          (e) => isStageRecommendedModel(row, e) && isStageMinimumViableModel(row, e, presetForFloor)
        ) ??
        nonConflictingPrimary.find((e) => isStageMinimumViableModel(row, e, presetForFloor)) ??
        nonConflictingPrimary[0];
    }

    const primarySid = stableModelId(primaryPick);
    stageModelIds = { ...stageModelIds, [row.key]: primarySid };
    stageProviders = { ...stageProviders, [row.key]: primaryPick.provider };

    // Ensure validation FALLBACK is also independent (and not identical to primary).
    const currentFallback = getCatalogEntryByStableId(stageFallbackModelIds[row.key] ?? '');
    const nonConflictingFallback = nonConflictingPrimary.filter((e) => stableModelId(e) !== primarySid);

    let fallbackPick: CatalogEntry | null = null;
    if (currentFallback) {
      const fallbackSid = stableModelId(currentFallback);
      const isIndependent = !validationModelConflicts(currentFallback) && fallbackSid !== primarySid;
      if (isIndependent) fallbackPick = currentFallback;
    }

    if (!fallbackPick && nonConflictingFallback.length > 0) {
      fallbackPick =
        nonConflictingFallback.find(
          (e) =>
            isStageRecommendedModel(row, e) && isStageMinimumViableModel(row, e, presetForFloor)
        ) ??
        nonConflictingFallback.find((e) => isStageMinimumViableModel(row, e, presetForFloor)) ??
        nonConflictingFallback[0];
    }

    if (fallbackPick) {
      stageFallbackModelIds = { ...stageFallbackModelIds, [row.key]: stableModelId(fallbackPick) };
      stageFallbackProviders = { ...stageFallbackProviders, [row.key]: fallbackPick.provider };
    } else {
      stageFallbackModelIds = { ...stageFallbackModelIds, [row.key]: '' };
      stageFallbackProviders = { ...stageFallbackProviders, [row.key]: '' };
    }
  }

  function stageAdvice(row: (typeof RESTORMEL_STAGES)[number]): { complexityLabel: string; body: string } {
    switch (row.key) {
      case 'ingestion_fetch':
        return {
          complexityLabel: 'low',
          body:
            'Fetch is HTTP, redirects, and HTML or plain-text normalization into your corpus paths. It does not call a frontier LLM; separate it from extraction so costs and failure modes stay clear.'
        };
      case 'ingestion_extraction':
        return {
          complexityLabel: 'high',
          body:
            'Needs long-context reading of the source plus disciplined structure: identifying discrete claims, quoting supporting passages, and keeping IDs stable across the document. Strong instruction-following and low hallucination risk matter most.'
        };
      case 'ingestion_relations':
        return {
          complexityLabel: 'high',
          body:
            'Needs a coherent local map of the extracted claims: detecting support/attack/depends-on relations, resolving references, and avoiding duplicate edges. Benefits from models that can keep many claim IDs in working memory.'
        };
      case 'ingestion_grouping':
        return {
          complexityLabel: 'medium-high',
          body:
            'Needs clustering and synthesis across many claims: grouping by position/argument, naming clusters, and keeping boundaries consistent. Models with strong reasoning help; ultra-small models can produce noisy or unstable groupings.'
        };
      case 'ingestion_validation':
        return {
          complexityLabel: 'medium',
          body:
            'Needs critical checking rather than creativity: spot contradictions, missing citations, schema mistakes, and low-confidence claims. Smaller/cheaper models can work if they reliably follow the schema, but stronger models reduce false negatives.'
        };
      case 'ingestion_embedding':
        return {
          complexityLabel: 'low-medium',
          body:
            'Needs stable, high-quality embeddings for retrieval. Choose an embedding model you want consistency from over time; capability is less about “reasoning” and more about embedding quality and dimensionality stability.'
        };
      case 'ingestion_json_repair':
        return {
          complexityLabel: 'low',
          body:
            'Needs strict, deterministic formatting: repairing malformed JSON and aligning to the expected schema. Prefer models that are reliable at constrained output; huge models are rarely necessary here.'
        };
      default:
        return { complexityLabel: 'medium', body: 'Choose a model appropriate for the stage goals.' };
    }
  }

  function stageSuitabilityLabel(row: (typeof RESTORMEL_STAGES)[number]): string {
    const advice = stageAdvice(row);
    return advice.complexityLabel;
  }

  function sourceTypeForHints(): keyof typeof INGESTION_SOURCE_MODEL_HINTS {
    switch (sourceType) {
      case 'book':
        return 'gutenberg_text';
      case 'sep_entry':
        return 'sep_entry';
      case 'iep_entry':
        return 'iep_entry';
      case 'journal_article':
        return 'philpapers_paper';
      case 'web_article':
      default:
        return 'web_article';
    }
  }

  function parseHintLabel(label: string): { provider: string; modelId: string } | null {
    const parts = label.split('·').map((part) => part.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { provider: parts[0], modelId: parts[1] };
  }

  function averageCostPerMillion(entry: CatalogEntry): number {
    const values = [entry.pricing?.inputPerMillion, entry.pricing?.outputPerMillion].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
    );
    if (values.length === 0) return 1.5;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  function stageTokens(row: (typeof RESTORMEL_STAGES)[number]): number {
    return preScanEstimateForRow(row.key)?.totalTokens ?? 0;
  }

  /** Production quality floors (see `ingestionPipelineModelRequirements.ts`). */
  function isStageMinimumViableModel(
    row: (typeof RESTORMEL_STAGES)[number],
    entry: CatalogEntry,
    preset: PipelinePreset = INGESTION_PIPELINE_PRESET
  ): boolean {
    if (row.key === 'ingestion_fetch') return true;
    const embeddingHighPressure = row.embed && stageTokens(row) >= 180_000;
    return entryMeetsPresetStageMinimum(preset, row.key, entry, {
      embed: row.embed,
      embeddingHighPressure
    });
  }

  function choosePresetModelForStage(
    row: (typeof RESTORMEL_STAGES)[number],
    preset: PipelinePreset,
    /** IDs already chosen for earlier stages in this preset apply (must include extraction/relations/grouping before validation). */
    provisionalModelIds?: Record<string, string>
  ): CatalogEntry | null {
    if (row.key === 'ingestion_fetch') return null;
    const options = modelsForStage(row);
    if (options.length === 0) return null;
    let minimumViable = options.filter((entry) => isStageMinimumViableModel(row, entry, preset));
    if (minimumViable.length === 0) return null;

    if (row.key === 'ingestion_validation' && runValidate && provisionalModelIds) {
      const nonConflictingAll = options.filter(
        (entry) => !validationModelConflictsWithMap(entry, provisionalModelIds)
      );
      let viable = minimumViable.filter(
        (entry) => !validationModelConflictsWithMap(entry, provisionalModelIds)
      );
      if (viable.length === 0) {
        viable = nonConflictingAll.filter((entry) => isStageMinimumViableModel(row, entry, preset));
      }
      if (viable.length === 0) {
        const labelTiny = (e: CatalogEntry) => /(nano|3b|7b)/i.test(`${e.label} ${e.modelId}`);
        viable = nonConflictingAll.filter((e) => !labelTiny(e));
      }
      if (viable.length === 0) {
        viable = nonConflictingAll;
      }
      if (viable.length === 0) {
        return null;
      }
      minimumViable = viable;
    }

    const recommendedOptions = minimumViable.filter((entry) =>
      isStageRecommendedModel(row, entry, provisionalModelIds)
    );
    // Presets should always respect phase minimums, then prefer recommended fits.
    const candidateOptions = recommendedOptions.length > 0 ? recommendedOptions : minimumViable;

    const sourceTokens = sourcePreScanResult?.preScan?.approxContentTokens ?? 0;
    const hints = INGESTION_SOURCE_MODEL_HINTS[sourceTypeForHints()];
    const hintedLabel = sourceTokens >= 40_000 ? hints.quality : hints.balanced;
    const hinted = parseHintLabel(hintedLabel);
    const phaseTokens = stageTokens(row);
    const largeSource = sourceTokens >= 18_000;
    const veryLargeSource = sourceTokens >= 40_000;
    const heavyGroupingStage = row.key === 'ingestion_grouping' && phaseTokens >= 12_000;
    const heavyValidationStage = row.key === 'ingestion_validation' && phaseTokens >= 8_000;
    const embeddingRateRisk = row.embed && (phaseTokens >= 20_000 || sourceTokens >= 18_000);
    const isBookLikeSource = sourceType === 'book';

    let best: CatalogEntry | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const entry of candidateOptions) {
      const label = `${entry.label} ${entry.modelId}`.toLowerCase();
      const strong =
        /(opus|sonnet|gpt-4|gpt-5|o1|o3|gemini.*pro|reasoner|deepseek-r1|mistral-large|command-r\+|llama.*70b|qwen.*72b)/i.test(
          label
        );
      const fast = /(haiku|mini|small|flash|lite|nano|8b|7b|3b|turbo|fast)/i.test(label);
      const cost = averageCostPerMillion(entry);
      const sourceBoost =
        hinted && entry.provider === hinted.provider && entry.modelId === hinted.modelId
          ? 3
          : hinted && entry.provider === hinted.provider
            ? 1.5
            : 0;
      const recommendationBoost = isStageRecommendedModel(row, entry, provisionalModelIds) ? 1.5 : 0;
      const rateFriendly = isRateLimitFriendly(row, entry) ? 1 : 0;
      const qualitySignal = strong ? 2 : 0;
      const speedSignal = fast ? 1.2 : 0;
      const costSignal = 6 / (1 + Math.max(cost, 0.01));
      const heavyweightReasoner = /(opus|gpt-5|o1|o3|deepseek-r1|reasoner|thinking)/i.test(label);
      const jsonFriendly = /json|instruct|mini|haiku|flash|lite|nano/i.test(label);
      const embeddingThroughputFriendly = /lite|nano|small|flash|text-embedding|multilingual|gecko|e5-|bge-/i.test(
        label
      );

      let score = 0;
      score =
        sourceBoost +
        recommendationBoost +
        speedSignal * 0.7 +
        qualitySignal * 0.9 +
        rateFriendly +
        (2 - Math.abs(cost - 1.2));

      // Hardening from prior ingestion runs:
      // - very heavy reasoning models are fragile under high token pressure/rate limits
      // - JSON repair should prioritize deterministic/faster options
      // - embedding on large sources should prefer throughput-friendly variants
      if ((heavyGroupingStage || heavyValidationStage || veryLargeSource) && heavyweightReasoner) {
        score -= 2.2;
      }
      if ((heavyGroupingStage || heavyValidationStage) && rateFriendly) {
        score += 0.9;
      }
      if (row.key === 'ingestion_json_repair') {
        score += jsonFriendly ? 2 : -2.5;
      }
      if (embeddingRateRisk) {
        score += embeddingThroughputFriendly ? 1.6 : -2.2;
      }
      if (isBookLikeSource && (row.key === 'ingestion_extraction' || row.key === 'ingestion_relations')) {
        // Long Gutenberg-style sources benefit from long-context families.
        if (/gemini|claude|sonnet|pro/i.test(label)) score += 0.8;
      }
      if (largeSource && !rateFriendly) {
        score -= 0.8;
      }

      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    return best;
  }

  function applyPipelinePreset(preset: PipelinePreset = INGESTION_PIPELINE_PRESET): void {
    if (runInProgress()) return;
    const nextModelIds = { ...stageModelIds };
    const nextProviders = { ...stageProviders };
    const nextFallbackModelIds = { ...stageFallbackModelIds };
    const nextFallbackProviders = { ...stageFallbackProviders };
    const missingMinimumStages: string[] = [];

    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') {
        nextModelIds[row.key] = '';
        nextProviders[row.key] = '';
        nextFallbackModelIds[row.key] = '';
        nextFallbackProviders[row.key] = '';
        continue;
      }
      if (row.key === 'ingestion_validation' && !runValidate) {
        nextModelIds[row.key] = '';
        nextProviders[row.key] = '';
        nextFallbackModelIds[row.key] = '';
        nextFallbackProviders[row.key] = '';
        continue;
      }
      const selected = choosePresetModelForStage(row, preset, nextModelIds);
      if (!selected) {
        missingMinimumStages.push(row.label);
        continue;
      }
      nextProviders[row.key] = selected.provider;
      nextModelIds[row.key] = stableModelId(selected);

      const list = modelsForStage(row);
      const primarySid = stableModelId(selected);
      let fallbackCandidates = list.filter((e) => stableModelId(e) !== primarySid);
      if (row.key === 'ingestion_validation') {
        fallbackCandidates = fallbackCandidates.filter((e) => !validationModelConflictsWithMap(e, nextModelIds));
      }

      const fallbackPick =
        fallbackCandidates.find(
          (e) =>
            isStageRecommendedModel(row, e, nextModelIds) && isStageMinimumViableModel(row, e, preset)
        ) ??
        fallbackCandidates.find((e) => isStageMinimumViableModel(row, e, preset)) ??
        fallbackCandidates[0];

      nextFallbackModelIds[row.key] = fallbackPick ? stableModelId(fallbackPick) : '';
      nextFallbackProviders[row.key] = fallbackPick?.provider ?? '';
    }

    stageProviders = nextProviders;
    stageModelIds = nextModelIds;
    stageFallbackProviders = nextFallbackProviders;
    stageFallbackModelIds = nextFallbackModelIds;
    ensureValidationModelIsIndependent();
    selectedPreset = preset;
    const sourceLabel = SOURCE_TYPES.find((option) => option.value === sourceType)?.label ?? sourceType;
    const presetLabel = 'Production';
    const hardened = sourcePreScanResult ? ' with hardening heuristics from pre-scan load profile.' : '.';
    if (missingMinimumStages.length > 0) {
      presetMessage = `${presetLabel} preset applied for ${sourceLabel}${hardened} No minimum-viable model available for: ${missingMinimumStages.join(', ')}.`;
    } else {
      presetMessage = `${presetLabel} preset applied for ${sourceLabel} using currently available models${hardened}`;
    }
  }

  function stageTokenPressure(row: (typeof RESTORMEL_STAGES)[number]): 'low' | 'medium' | 'high' {
    const tokens = preScanEstimateForRow(row.key)?.totalTokens ?? 0;
    if (tokens >= 180_000) return 'high';
    if (tokens >= 80_000) return 'medium';
    return 'low';
  }

  function isRateLimitFriendly(row: (typeof RESTORMEL_STAGES)[number], entry: CatalogEntry): boolean {
    const label = `${entry.label} ${entry.modelId}`.toLowerCase();
    if (row.embed) return !/(large|xl|xlarge)/i.test(label);
    const likelySlow = /(opus|gpt-5|o1|o3|reasoner|deepseek-r1|thinking)/i.test(label);
    const likelyFast = /(haiku|mini|small|flash|lite|nano|8b|7b|3b|turbo)/i.test(label);
    if (likelyFast) return true;
    if (likelySlow) return false;
    return true;
  }

  function isStageRecommendedModel(
    row: (typeof RESTORMEL_STAGES)[number],
    entry: CatalogEntry,
    /** When set (e.g. during preset apply), validation self-review uses this map instead of `stageModelIds`. */
    modelIdMap?: Record<string, string>
  ): boolean {
    // Heuristic only: we only have (provider, modelId, label).
    const provider = entry.provider.toLowerCase();
    const label = `${entry.label} ${entry.modelId}`.toLowerCase();

    if (row.embed) {
      if (!isLikelyEmbeddingModel(entry)) return false;
      // For large sources, prefer embedding variants that are less likely to bottleneck.
      return stageTokenPressure(row) !== 'high' || isRateLimitFriendly(row, entry);
    }

    if (row.key === 'ingestion_fetch') return false;

    // Cross-provider "strong" and "fast" buckets.
    const strong =
      /(opus|sonnet|gpt-4|gpt-5|gpt-4o|o1|o3|gemini.*pro|deepseek-r1|mistral-large|command-r\+|llama.*70b|qwen.*72b)/i.test(
        label
      ) || (provider === 'google' && /gemini-2\.5/.test(label));
    const fast = /(haiku|mini|small|flash|lite|nano|8b|7b|3b|fast)/i.test(label);
    const tokenPressure = stageTokenPressure(row);

    let qualityFit = false;

    switch (row.key) {
      case 'ingestion_extraction':
      case 'ingestion_relations':
        qualityFit = strong || (provider === 'google' && /gemini/.test(label) && !fast);
        break;
      case 'ingestion_grouping':
        qualityFit = strong;
        break;
      case 'ingestion_validation':
        if (modelIdMap) {
          if (validationModelConflictsWithMap(entry, modelIdMap)) return false;
        } else if (validationModelConflicts(entry)) {
          return false;
        }
        qualityFit = strong || !fast; // allow solid mid-tier defaults too
        break;
      case 'ingestion_json_repair':
        // Prefer cheaper/faster deterministic models for repair.
        qualityFit = fast || /json|instruct/.test(label);
        break;
      default:
        return false;
    }

    if (!qualityFit) return false;
    // Under heavy token pressure, avoid starring options that are likely to hit tight throughput limits.
    if (tokenPressure === 'high' && !isRateLimitFriendly(row, entry)) return false;
    return true;
  }

  function modelOptionLabel(row: (typeof RESTORMEL_STAGES)[number], entry: CatalogEntry): string {
    const star = isStageRecommendedModel(row, entry) ? ' *' : '';
    return `${entry.label}${star}`;
  }

  function ensureStageProviderSelection(row: (typeof RESTORMEL_STAGES)[number]): void {
    if (row.key === 'ingestion_fetch') return;
    const providers = providersForStage(row);
    const current = stageProviders[row.key]?.trim() ?? '';
    if (!current || !providers.includes(current)) {
      stageProviders = { ...stageProviders, [row.key]: providers[0] ?? '' };
    }
  }

  function setStageProvider(row: (typeof RESTORMEL_STAGES)[number], provider: string): void {
    const pid = provider.trim();
    stageProviders = { ...stageProviders, [row.key]: pid };
    const list = modelsForStageProvider(row, pid);
    const nextSid = list[0] ? stableModelId(list[0]) : '';
    stageModelIds = { ...stageModelIds, [row.key]: nextSid };
    if (
      row.key === 'ingestion_extraction' ||
      row.key === 'ingestion_relations' ||
      row.key === 'ingestion_grouping'
    ) {
      ensureValidationModelIsIndependent();
    }
  }

  function applyDefaultStageSelections(): void {
    if (catalogEntries.length === 0) {
      stageModelIds = Object.fromEntries(RESTORMEL_STAGES.map((r) => [r.key, ''])) as Record<string, string>;
      stageProviders = Object.fromEntries(RESTORMEL_STAGES.map((r) => [r.key, ''])) as Record<string, string>;
      stageFallbackModelIds = Object.fromEntries(RESTORMEL_STAGES.map((r) => [r.key, ''])) as Record<string, string>;
      stageFallbackProviders = Object.fromEntries(RESTORMEL_STAGES.map((r) => [r.key, ''])) as Record<string, string>;
      return;
    }
    const next: Record<string, string> = {};
    const nextProviders: Record<string, string> = {};
    const nextFallback: Record<string, string> = {};
    const nextFallbackProviders: Record<string, string> = {};
    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') {
        next[row.key] = '';
        nextProviders[row.key] = '';
        nextFallback[row.key] = '';
        nextFallbackProviders[row.key] = '';
        continue;
      }
      const list = catalogEntries.filter((e) =>
        row.embed ? isEmbeddingModelEntry(e) : !isEmbeddingModelEntry(e)
      );
      if (row.key === 'ingestion_validation') {
        const nonConflicting = list.filter((e) => !validationModelConflictsWithMap(e, next));
        const primary = nonConflicting[0] ?? list[0];
        const primarySid = primary ? stableModelId(primary) : '';
        const fallback = nonConflicting.find((e) => stableModelId(e) !== primarySid) ?? null;

        next[row.key] = primarySid;
        nextProviders[row.key] = primary?.provider ?? '';
        nextFallback[row.key] = fallback ? stableModelId(fallback) : '';
        nextFallbackProviders[row.key] = fallback?.provider ?? '';
      } else {
        const primary = list[0];
        const primarySid = primary ? stableModelId(primary) : '';
        const fallback = list.find((e) => stableModelId(e) !== primarySid) ?? null;

        next[row.key] = primarySid;
        nextProviders[row.key] = primary?.provider ?? '';
        nextFallback[row.key] = fallback ? stableModelId(fallback) : '';
        nextFallbackProviders[row.key] = fallback?.provider ?? '';
      }
    }
    stageModelIds = next;
    stageProviders = nextProviders;
    stageFallbackModelIds = nextFallback;
    stageFallbackProviders = nextFallbackProviders;
    ensureValidationModelIsIndependent();
  }

  function ingestionModelsReady(): boolean {
    if (catalogEntries.length === 0) return false;
    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') continue;
      if (row.key === 'ingestion_validation' && !runValidate) continue;
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
      status:
        stage.key === 'validate' || stage.key === 'remediation'
          ? runValidate
            ? 'idle'
            : 'skipped'
          : 'idle'
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
      const rm = body.restormel as {
        detail?: string;
        userMessage?: string;
        routeStepAllowedProviders?: string[];
      } | undefined;
      if (body.error === 'restormel_dashboard_error' && rm) {
        let fromRm =
          typeof rm.userMessage === 'string' && rm.userMessage.trim()
            ? rm.userMessage.trim()
            : typeof rm.detail === 'string' && rm.detail.trim()
              ? rm.detail.trim()
              : '';
        if (Array.isArray(rm.routeStepAllowedProviders) && rm.routeStepAllowedProviders.length > 0) {
          const allow = rm.routeStepAllowedProviders.join(', ');
          fromRm = fromRm
            ? `${fromRm} Allowed route-step providers (from Keys): ${allow}.`
            : `Route-step provider not allowed. Keys accepts: ${allow}.`;
        }
        if (fromRm) throw new Error(fromRm);
      }
      throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`);
    }
    return body;
  }

  function isRoutingConflictError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return /(^|\b)(409|conflict)(\b|$)/i.test(msg);
  }

  function normalizeProviderPreference(provider: string): string {
    const p = provider.trim().toLowerCase();
    if (p.includes('voyage')) return 'voyage';
    return p === 'vertex' ? 'google' : p;
  }

  /** Matches Restormel Keys route-step `providerPreference` (OpenAPI 1.3.4+; still narrower than full catalog / registry). */
  function isSupportedRouteProvider(provider: string): boolean {
    return [
      'anthropic',
      'deepseek',
      'google',
      'mistral',
      'openai',
      'openrouter',
      'portkey',
      'together',
      'vercel',
      'voyage'
    ].includes(normalizeProviderPreference(provider));
  }

  const ROUTE_STEP_PROVIDER_HINT =
    'anthropic, deepseek, google (Vertex uses google), mistral, openai, openrouter, portkey, together, vercel, voyage';

  async function fetchRouteStepsOrdered(routeId: string): Promise<Record<string, unknown>[]> {
    const body = await authorizedJson(`/api/admin/ingestion-routing/routes/${routeId}/steps`);
    const raw = Array.isArray(body.steps) ? (body.steps as Record<string, unknown>[]) : [];
    return [...raw].sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
  }

  function mergeStepsForSave(
    existing: Record<string, unknown>[],
    primaryOpt: CatalogEntry,
    fallbackOpt: CatalogEntry | undefined
  ): Record<string, unknown>[] {
    const sortedEnabled = [...existing]
      .filter((s) => s.enabled !== false)
      .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
    const managedExisting = sortedEnabled.slice(0, 2);
    const primaryExisting = managedExisting[0] ?? existing.find((s) => Number(s.orderIndex) === 0) ?? {};
    const fallbackExisting = managedExisting[1] ?? existing.find((s) => Number(s.orderIndex) === 1) ?? {};

    const primary: Record<string, unknown> = {
      ...(primaryExisting ?? {}),
      orderIndex: 0,
      enabled: true,
      providerPreference: normalizeProviderPreference(primaryOpt.provider),
      modelId: primaryOpt.modelId
    };

    if (!fallbackOpt) {
      return [primary];
    }

    const fallback: Record<string, unknown> = {
      ...(fallbackExisting ?? { orderIndex: 1, enabled: true }),
      orderIndex: 1,
      enabled: true,
      providerPreference: normalizeProviderPreference(fallbackOpt.provider),
      modelId: fallbackOpt.modelId
    };

    // Preserve all unmanaged route rules from Restormel so Sophia ↔ Restormel stays bidirectional.
    const managedSet = new Set(managedExisting);
    const preserved = existing.filter((step) => !managedSet.has(step));
    return [primary, fallback, ...preserved];
  }

  function comparableStepChain(
    steps: Record<string, unknown>[]
  ): Array<{ orderIndex: number; provider: string; model: string }> {
    const sorted = [...steps].sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
    return sorted
      .filter((s) => s.enabled !== false)
      .slice(0, 2)
      .map((s, idx) => ({
        orderIndex: idx,
        provider: String(s.providerPreference ?? '').trim().toLowerCase(),
        model: String(s.modelId ?? '').trim()
      }))
      .filter((s) => s.provider.length > 0 && s.model.length > 0);
  }

  function desiredStepChain(
    primaryOpt: CatalogEntry,
    fallbackOpt: CatalogEntry | undefined
  ): Array<{ orderIndex: number; provider: string; model: string }> {
    const out: Array<{ orderIndex: number; provider: string; model: string }> = [
      {
        orderIndex: 0,
        provider: normalizeProviderPreference(primaryOpt.provider),
        model: primaryOpt.modelId.trim()
      }
    ];
    if (fallbackOpt) {
      out.push({
        orderIndex: 1,
        provider: normalizeProviderPreference(fallbackOpt.provider),
        model: fallbackOpt.modelId.trim()
      });
    }
    return out;
  }

  function stepChainsEqual(
    a: Array<{ orderIndex: number; provider: string; model: string }>,
    b: Array<{ orderIndex: number; provider: string; model: string }>
  ): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (
        a[i].provider.toLowerCase() !== b[i].provider.toLowerCase() ||
        a[i].model !== b[i].model
      ) {
        return false;
      }
    }
    return true;
  }

  function sleepRoutingThrottle(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Detect multiple LLM stages resolving to the same route (shared fallback) — repeated saves fight the same draft and return 409. */
  function findRestormelRouteSharingProblem(): string | null {
    const byRoute = new Map<string, string[]>();
    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') continue;
      const route = resolveRouteForStage(routes, row.key);
      if (!route?.id) continue;
      const list = byRoute.get(route.id) ?? [];
      list.push(row.label);
      byRoute.set(route.id, list);
    }
    for (const [routeId, labels] of byRoute) {
      if (labels.length > 1) {
        return `These stages share one Restormel route (${routeId}), so saving hits the same draft repeatedly and can return HTTP 409: ${labels.join('; ')}. Create dedicated ingestion routes per stage (e.g. \`pnpm restormel:ingestion-bootstrap apply\`), publish them in Keys, then refresh this page.`;
      }
    }
    return null;
  }

  async function loadRoutingContext(): Promise<void> {
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/context');
      routes = Array.isArray(body.routes) ? (body.routes as AdminRouteRecord[]) : [];
      const raw = body.ingestWorkerDiagnostics as Record<string, unknown> | undefined;
      if (
        raw &&
        typeof raw.environmentId === 'string' &&
        typeof raw.projectIdConfigured === 'boolean' &&
        typeof raw.gatewayKeyConfigured === 'boolean'
      ) {
        const host = raw.keysBaseHost;
        ingestWorkerDiagnostics = {
          keysBaseHost: typeof host === 'string' ? host : null,
          environmentId: raw.environmentId,
          projectIdConfigured: raw.projectIdConfigured,
          gatewayKeyConfigured: raw.gatewayKeyConfigured
        };
      } else {
        ingestWorkerDiagnostics = null;
      }
    } catch {
      routes = [];
      ingestWorkerDiagnostics = null;
    }
  }

  async function loadModelCatalog(): Promise<void> {
    catalogError = '';
    catalogNotice = '';
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/model-catalog');
      catalogEntries = Array.isArray(body.entries) ? (body.entries as CatalogEntry[]) : [];
      const sync = body.catalogSync as { status?: string; reason?: string } | undefined;
      const gate = body.operatorByokGate as
        | {
            applied?: boolean;
            reason?: string;
            activeProviders?: string[];
            entryCountBefore?: number;
            entryCountAfter?: number;
          }
        | undefined;

      if (sync?.status === 'unavailable') {
        catalogError =
          'Restormel model list is currently unavailable. Check your project model index and provider configuration, then refresh.';
      } else if (gate?.applied && (gate.entryCountAfter ?? catalogEntries.length) === 0) {
        catalogError =
          'No models match providers with Active Operator BYOK. Activate keys under Admin → Operator BYOK, then refresh.';
      } else if (catalogEntries.length > 0) {
        if (gate?.applied && Array.isArray(gate.activeProviders)) {
          catalogNotice = `${catalogEntries.length} models (Active Operator BYOK only: ${gate.activeProviders.join(', ')}).`;
        } else if (gate?.applied === false && gate?.reason === 'no_owner_uids') {
          catalogNotice = `${catalogEntries.length} models in picker list. Set OWNER_UIDS to restrict pickers to Active Operator BYOK providers.`;
        } else {
          catalogNotice = `${catalogEntries.length} models in picker list (Restormel project index merged with catalog).`;
        }
      }
      applyDefaultStageSelections();
      for (const row of RESTORMEL_STAGES) ensureStageProviderSelection(row);
    } catch (e) {
      catalogEntries = [];
      catalogError = e instanceof Error ? e.message : 'Failed to load models from Restormel.';
      applyDefaultStageSelections();
    }
  }

  async function hydrateSelectionsFromRoutes(): Promise<void> {
    if (catalogEntries.length === 0) return;
    const next = { ...stageModelIds };
    const nextProviders = { ...stageProviders };
    const nextFallback = { ...stageFallbackModelIds };
    const nextFallbackProviders = { ...stageFallbackProviders };
    for (const row of RESTORMEL_STAGES) {
      const route = resolveRouteForStage(routes, row.key);
      if (!route?.id) continue;
      try {
        const body = await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/steps`);
        const steps = Array.isArray(body.steps) ? body.steps : [];
        const orderedEnabled = [...steps]
          .filter((s) => (s as { enabled?: boolean | null }).enabled !== false)
          .sort(
          (a, b) => (Number((a as { orderIndex?: number }).orderIndex) || 0) - (Number((b as { orderIndex?: number }).orderIndex) || 0)
        );
        const primaryStep = orderedEnabled[0];
        const fallbackStep = orderedEnabled[1];

        const primaryPid = (primaryStep as { providerPreference?: string | null } | undefined)?.providerPreference
          ?.trim() ?? '';
        const primaryMid = (primaryStep as { modelId?: string | null } | undefined)?.modelId?.trim() ?? '';

        if (!primaryPid || !primaryMid) continue;

        const primaryEntry = catalogEntries.find((e) => e.provider === primaryPid && e.modelId === primaryMid);
        if (!primaryEntry) continue;
        const primarySid = stableModelId(primaryEntry);
        const list = modelsForStage(row);
        if (list.some((e) => stableModelId(e) === primarySid)) {
          next[row.key] = primarySid;
          nextProviders[row.key] = primaryEntry.provider;
        }

        nextFallback[row.key] = '';
        nextFallbackProviders[row.key] = '';

        const fallbackPid = (fallbackStep as { providerPreference?: string | null } | undefined)?.providerPreference
          ?.trim() ?? '';
        const fallbackMid = (fallbackStep as { modelId?: string | null } | undefined)?.modelId?.trim() ?? '';

        if (fallbackPid && fallbackMid) {
          const fallbackEntry = catalogEntries.find((e) => e.provider === fallbackPid && e.modelId === fallbackMid);
          if (fallbackEntry && list.some((e) => stableModelId(e) === stableModelId(fallbackEntry))) {
            const fallbackSid = stableModelId(fallbackEntry);
            nextFallback[row.key] = fallbackSid;
            nextFallbackProviders[row.key] = fallbackEntry.provider;
          }
        }
      } catch {
        /* ignore */
      }
    }
    stageModelIds = next;
    stageProviders = nextProviders;
    stageFallbackModelIds = nextFallback;
    stageFallbackProviders = nextFallbackProviders;
    for (const row of RESTORMEL_STAGES) ensureStageProviderSelection(row);
    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') continue;
      const sid = stageFallbackModelIds[row.key]?.trim() ?? '';
      if (!sid) continue;
      const entry = getCatalogEntryByStableId(sid);
      if (entry) {
        stageFallbackProviders = { ...stageFallbackProviders, [row.key]: entry.provider };
      }
    }
    ensureValidationModelIsIndependent();
  }

  async function refreshModelsAndRoutes(): Promise<void> {
    await loadModelCatalog();
    await loadRoutingContext();
    await hydrateSelectionsFromRoutes();
    await loadEmbeddingHealth();
  }

  async function loadEmbeddingHealth(): Promise<void> {
    embeddingHealthBusy = true;
    embeddingHealthError = '';
    try {
      const body = await authorizedJson('/api/admin/ingest/embedding-health');
      const snapshot = body.embeddingHealth as EmbeddingHealthSnapshot | undefined;
      embeddingHealth = snapshot ?? null;
      embeddingHealthWarnings = Array.isArray(body.warnings)
        ? body.warnings.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : [];
    } catch (error) {
      embeddingHealth = null;
      embeddingHealthWarnings = [];
      embeddingHealthError =
        error instanceof Error ? error.message : 'Failed to load embedding health.';
    } finally {
      embeddingHealthBusy = false;
    }
  }

  async function applyStageRouting(): Promise<void> {
    routingBusy = true;
    routingError = '';
    routingMessage = '';
    try {
      let publishFailures = 0;
      let skippedAlreadyMatching = 0;
      await loadRoutingContext();
      const sharing = findRestormelRouteSharingProblem();
      if (sharing) {
        routingError = sharing;
        return;
      }
      for (const row of RESTORMEL_STAGES) {
        if (row.key === 'ingestion_fetch') continue;
        const route = resolveRouteForStage(routes, row.key);
        if (!route?.id) {
          routingError = `No Restormel route is available for “${row.label}”. Configure routes in Restormel Keys, then refresh.`;
          return;
        }
        const primarySid = stageModelIds[row.key];
        const primaryOpt = getCatalogEntryByStableId(primarySid);
        if (!primaryOpt) {
          routingError = `Choose a Restormel model for “${row.label}”.`;
          return;
        }
        if (!isSupportedRouteProvider(primaryOpt.provider)) {
          routingError = `“${row.label}” uses provider “${primaryOpt.provider}”, but Restormel Keys route steps only allow: ${ROUTE_STEP_PROVIDER_HINT}. Use a listed provider (Mistral / DeepSeek / Together need Keys OpenAPI 1.3.4+ and catalog seed), OpenRouter, or another supported slug. For Together, use the catalog model id (e.g. together-…), not the raw vendor API id.`;
          return;
        }

        const fallbackSid = stageFallbackModelIds[row.key]?.trim() ?? '';
        const fallbackOpt = fallbackSid ? getCatalogEntryByStableId(fallbackSid) : undefined;
        if (fallbackOpt && !isSupportedRouteProvider(fallbackOpt.provider)) {
          routingError = `Fallback for “${row.label}” uses provider “${fallbackOpt.provider}”, which Keys route steps do not accept (${ROUTE_STEP_PROVIDER_HINT}).`;
          return;
        }

        const existingSteps = await fetchRouteStepsOrdered(route.id);
        const desired = desiredStepChain(primaryOpt, fallbackOpt);
        if (stepChainsEqual(comparableStepChain(existingSteps), desired)) {
          skippedAlreadyMatching++;
          try {
            await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/publish`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({})
            });
          } catch (publishError) {
            publishFailures++;
            console.warn('Failed to publish ingestion route (steps already matched)', {
              routeId: route.id,
              error: publishError instanceof Error ? publishError.message : String(publishError)
            });
          }
          await sleepRoutingThrottle(120);
          continue;
        }

        let savedSteps = false;
        for (let attempt = 0; attempt < 3 && !savedSteps; attempt++) {
          try {
            if (attempt > 0) {
              await refreshModelsAndRoutes();
              await sleepRoutingThrottle(200 * attempt);
            }
            const freshSteps = attempt === 0 ? existingSteps : await fetchRouteStepsOrdered(route.id);
            const merged = mergeStepsForSave(freshSteps, primaryOpt, fallbackOpt);
            await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/steps`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(merged)
            });
            savedSteps = true;
          } catch (e) {
            if (attempt < 2 && isRoutingConflictError(e)) {
              continue;
            }
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`“${row.label}” (${route.id}): ${msg}`);
          }
        }

        // Keys installations often require publishing for resolve to see updated steps.
        try {
          await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
        } catch (publishError) {
          publishFailures++;
          console.warn('Failed to publish ingestion route after saving steps', {
            routeId: route.id,
            error: publishError instanceof Error ? publishError.message : String(publishError)
          });
        }
        await sleepRoutingThrottle(120);
      }
      const skipNote =
        skippedAlreadyMatching > 0
          ? ` ${skippedAlreadyMatching} stage(s) already matched Restormel (no step write).`
          : '';
      routingMessage =
        publishFailures > 0
          ? `Saved model routing for all six LLM ingestion stages, but publishing failed for ${publishFailures} route(s). Resolve may still use prior published steps.${skipNote}`
          : `Saved model routing for all six LLM ingestion stages.${skipNote}`;
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

  function formatDateTime(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return new Date(value).toLocaleTimeString();
  }

  function processHealthLabel(): string {
    if (runProcessAlive) {
      if (typeof runIdleForMs === 'number' && runIdleForMs > 45_000) {
        return `Running (quiet ${formatDuration(runIdleForMs)})`;
      }
      return 'Running';
    }
    if (runProcessExitedAt != null) return `Not running (exited ${formatDateTime(runProcessExitedAt)})`;
    if (flowState === 'awaiting_sync') return 'Waiting for Sync';
    return 'Not running';
  }

  type LogVisualKind = 'milestone' | 'stage' | 'event' | 'plain';
  type LogLevelUi = 'info' | 'success' | 'warn' | 'error' | 'muted';

  type ParsedLogLine = {
    kind: LogVisualKind;
    level: LogLevelUi;
    badge: string | null;
    body: string;
  };

  type RunCostLedgerRow = {
    key: string;
    label: string;
    estimatedUsd: number | null;
    runningUsd: number | null;
  };

  function isLogNoise(line: string): boolean {
    const t = line.trim();
    if (!t) return true;
    if (/^[═╚╔╠╝┌┐└┘─│\s]+$/.test(t)) return true;
    if (/^║\s*$/.test(t)) return true;
    return false;
  }

  function parseLogLineForUi(line: string): ParsedLogLine {
    const trimmed = line.trim();
    if (!trimmed) {
      return { kind: 'plain', level: 'muted', badge: null, body: '' };
    }

    if (/SOPHIA\s+—\s+INGESTION/i.test(trimmed) || /INGESTION\s+PIPELINE/i.test(trimmed)) {
      const body = trimmed
        .replace(/^[║╔╚╠═\s]+/g, '')
        .replace(/\s*║\s*$/g, '')
        .trim();
      return { kind: 'milestone', level: 'info', badge: 'Pipeline', body: body || 'Ingestion pipeline' };
    }

    const stageMatch = trimmed.match(/STAGE\s+\d+:\s*(.+)/i);
    if (stageMatch) {
      return { kind: 'stage', level: 'info', badge: 'Stage', body: stageMatch[1].trim() };
    }

    const bracket = trimmed.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/i);
    if (bracket) {
      const tag = bracket[1].toUpperCase();
      const rest = bracket[2].trim();
      let level: LogLevelUi = 'info';
      if (tag === 'WARN' || tag === 'WARNING') level = 'warn';
      else if (tag === 'ERROR' || tag === 'FATAL') level = 'error';
      else if (tag === 'SUMMARY' || tag === 'OK' || tag === 'SAVE' || tag === 'DONE') level = 'success';
      else if (tag === 'COST' || tag === 'RESUME') level = 'muted';
      return { kind: 'event', level, badge: tag, body: rest || trimmed };
    }

    if (/^[║╔╚╠]/.test(trimmed)) {
      const body = trimmed.replace(/^[║╔╚╠═\s]+/g, '').replace(/\s*║\s*$/g, '').trim();
      if (body.length > 2) {
        return { kind: 'event', level: 'info', badge: null, body };
      }
    }

    if (/failed|exited with code|ERR_/i.test(trimmed)) {
      return { kind: 'event', level: 'error', badge: null, body: trimmed };
    }

    return { kind: 'plain', level: 'muted', badge: null, body: trimmed };
  }

  let logFeedItems = $derived(
    runLog
      .map((line, idx) => ({ line, idx, parsed: parseLogLineForUi(line) }))
      .filter((x) => !isLogNoise(x.line))
  );

  const RUN_COST_STAGE_KEY_MAP: Record<string, string> = {
    fetch: 'ingestion_fetch',
    extract: 'ingestion_extraction',
    extraction: 'ingestion_extraction',
    relate: 'ingestion_relations',
    relations: 'ingestion_relations',
    group: 'ingestion_grouping',
    grouping: 'ingestion_grouping',
    validate: 'ingestion_validation',
    validation: 'ingestion_validation',
    remediation: 'ingestion_remediation',
    remediat: 'ingestion_remediation',
    embed: 'ingestion_embedding',
    embedding: 'ingestion_embedding',
    json_repair: 'ingestion_json_repair',
    jsonrepair: 'ingestion_json_repair',
    repair: 'ingestion_json_repair'
  };

  const RUN_STAGE_TO_COST_KEY: Record<string, string> = {
    fetch: 'ingestion_fetch',
    extract: 'ingestion_extraction',
    relate: 'ingestion_relations',
    group: 'ingestion_grouping',
    embed: 'ingestion_embedding',
    validate: 'ingestion_validation',
    remediation: 'ingestion_remediation',
    store: 'ingestion_json_repair'
  };

  function runStageToCostKey(stageKey: string | null | undefined): string | null {
    const key = (stageKey ?? '').trim().toLowerCase();
    if (!key) return null;
    return RUN_STAGE_TO_COST_KEY[key] ?? null;
  }

  function parseRunStageFromLogLine(line: string): string | null {
    const text = line.trim().toLowerCase();
    if (!text) return null;
    if (/\[stage\].*fetch/.test(text) || /stage\s+\d+:\s*fetch/.test(text)) return 'fetch';
    if (/\[stage\].*extract/.test(text) || /stage\s+\d+:\s*extract/.test(text)) return 'extract';
    if (/\[stage\].*relat/.test(text) || /stage\s+\d+:\s*relat/.test(text)) return 'relate';
    if (/\[stage\].*group/.test(text) || /stage\s+\d+:\s*group/.test(text)) return 'group';
    if (/\[stage\].*embed/.test(text) || /stage\s+\d+:\s*embed/.test(text)) return 'embed';
    if (/\[stage\].*validat/.test(text) || /stage\s+\d+:\s*validat/.test(text)) return 'validate';
    if (
      /\[stage\].*remediat/.test(text) ||
      /stage\s+5b:\s*remediat/.test(text) ||
      /^stage\s+5b:\s*remediation/i.test(text.trim())
    ) {
      return 'remediation';
    }
    if (/\[stage\].*store/.test(text) || /stage\s+\d+:\s*store/.test(text)) return 'store';
    return null;
  }

  function inferRunStageFromLogLines(lines: string[]): string | null {
    for (let i = lines.length - 1; i >= 0; i--) {
      const parsed = parseRunStageFromLogLine(lines[i] ?? '');
      if (parsed) return parsed;
    }
    return null;
  }

  function harmonizePipelineStages(nextStages: Stage[], currentStageKey: string | null): Stage[] {
    const current = (currentStageKey ?? '').trim().toLowerCase();
    if (!current) return nextStages;
    const currentIndex = STAGE_TEMPLATE.findIndex((stage) => stage.key === current);
    if (currentIndex === -1) return nextStages;
    const runIsActive = flowState === 'running' || flowState === 'awaiting_sync';
    return nextStages.map((stage, idx) => {
      if (idx < currentIndex && stage.status === 'idle') {
        return { ...stage, status: 'done' };
      }
      if (idx === currentIndex && runIsActive && stage.status === 'idle') {
        return { ...stage, status: 'running' };
      }
      if (idx > currentIndex && stage.status === 'running') {
        return { ...stage, status: 'idle' };
      }
      return stage;
    });
  }

  function parseCostStageFromLine(line: string): string | null {
    const fromCostTag = line.match(/\[COST\]\s+([A-Z_]+)/i)?.[1] ?? '';
    const norm = fromCostTag.trim().toLowerCase().replace(/[^a-z_]/g, '');
    if (norm && RUN_COST_STAGE_KEY_MAP[norm]) return RUN_COST_STAGE_KEY_MAP[norm];
    if (norm.startsWith('fetch')) return 'ingestion_fetch';
    if (norm.startsWith('extract')) return 'ingestion_extraction';
    if (norm.startsWith('relat')) return 'ingestion_relations';
    if (norm.startsWith('group')) return 'ingestion_grouping';
    if (norm.startsWith('validat')) return 'ingestion_validation';
    if (norm.startsWith('remediat')) return 'ingestion_remediation';
    if (norm.startsWith('embed')) return 'ingestion_embedding';
    if (norm.startsWith('json') || norm.startsWith('repair')) return 'ingestion_json_repair';
    return null;
  }

  /** JSON repair calls only log `[ROUTE] json_repair: … cost~$x` (see scripts/ingest.ts callStageModel); they never emit `[COST] … stage=$`. */
  function parseJsonRepairRouteCostUsd(line: string): number | null {
    if (!/\[ROUTE\]\s+json_repair\s*:/i.test(line)) return null;
    const m = line.match(/cost~\$([0-9]+(?:\.[0-9]+)?)/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  let runCostLedger = $derived.by(() => {
    const rows: RunCostLedgerRow[] = phaseCostRows().map((row) => ({
      key: row.key,
      label: row.label,
      estimatedUsd: row.costUsd,
      runningUsd: null
    }));
    const runningByKey: Record<string, number> = {};
    let latestTotal: number | null = null;
    let resumeCheckpointTotal: number | null = null;

    for (const line of runLog) {
      const stageKey = parseCostStageFromLine(line);
      const stageMatch = line.match(/stage=\$([0-9]+(?:\.[0-9]+)?)/i);
      const totalMatch = line.match(/total=\$([0-9]+(?:\.[0-9]+)?)/i);
      const resumeMatch = line.match(/\[COST_RESUME\].*total=\$([0-9]+(?:\.[0-9]+)?)/i);

      if (stageKey && stageMatch) {
        const delta = Number(stageMatch[1]);
        if (Number.isFinite(delta) && delta >= 0) {
          runningByKey[stageKey] = (runningByKey[stageKey] ?? 0) + delta;
        }
      }
      const repairRouteUsd = parseJsonRepairRouteCostUsd(line);
      if (repairRouteUsd !== null) {
        const k = 'ingestion_json_repair';
        runningByKey[k] = (runningByKey[k] ?? 0) + repairRouteUsd;
      }
      if (totalMatch) {
        const total = Number(totalMatch[1]);
        if (Number.isFinite(total) && total >= 0) latestTotal = total;
      }
      if (resumeMatch) {
        const t = Number(resumeMatch[1]);
        if (Number.isFinite(t) && t >= 0) resumeCheckpointTotal = t;
      }
    }

    for (const row of rows) {
      if (typeof runningByKey[row.key] === 'number') {
        row.runningUsd = runningByKey[row.key];
      }
    }

    const sumStageRunning = rows
      .map((row) => row.runningUsd)
      .filter((v): v is number => typeof v === 'number')
      .reduce((sum, v) => sum + v, 0);

    // Prefer summing per-stage [COST] deltas across the whole log (survives resume + new process).
    // Do not use last line's total= alone — it resets each ingest.ts process and understates after resume.
    let rollingTotal: number | null = null;
    if (sumStageRunning > 0) {
      rollingTotal = sumStageRunning;
    } else if (latestTotal != null && latestTotal > 0) {
      rollingTotal = latestTotal;
    } else if (resumeCheckpointTotal != null && resumeCheckpointTotal > 0) {
      rollingTotal = resumeCheckpointTotal;
    }

    return {
      rows,
      estimatedTotalUsd: estimatedIngestionTotalUsd(),
      runningTotalUsd: rollingTotal != null && rollingTotal > 0 ? rollingTotal : null
    };
  });

  function formatInt(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return Math.round(value).toLocaleString();
  }

  /** Parse catalog strings like 128k, 32k, 1M into token counts. */
  function parseContextWindowTokens(raw: string | undefined | null): number | null {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim().toLowerCase().replace(/\s/g, '');
    const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    const suf = m[2];
    if (suf === 'k') return Math.round(n * 1000);
    if (suf === 'm') return Math.round(n * 1_000_000);
    return Math.round(n);
  }

  /** Fixed ladder so raw counts are interpretable without a model selected (not API limits). */
  const TOKEN_REFERENCE_MARKERS: { label: string; tokens: number }[] = [
    { label: '10k', tokens: 10_000 },
    { label: '60k', tokens: 60_000 },
    { label: '200k', tokens: 200_000 }
  ];

  function formatPercentOfReferenceTokens(tokens: number): string {
    return TOKEN_REFERENCE_MARKERS.map(({ label, tokens: cap }) => {
      const pct = Math.round((tokens / cap) * 1000) / 10;
      return `${pct}% of ${label}`;
    }).join(' · ');
  }

  function formatTokensVsReferenceLadder(tokens: number): string {
    return `${formatInt(tokens)} (${formatPercentOfReferenceTokens(tokens)})`;
  }

  /** Compare an estimate to the selected stage model’s advertised context window. */
  function formatTokensVsSelectedModelWindow(tokens: number, entry: CatalogEntry | null): string {
    if (!entry?.contextWindow) return '';
    const cap = parseContextWindowTokens(entry.contextWindow);
    if (cap === null || cap <= 0) return '';
    const pct = Math.min(999, Math.round((tokens / cap) * 1000) / 10);
    return `${formatInt(tokens)} / ${formatInt(cap)} (${pct}% of ${entry.contextWindow} context)`;
  }

  function formatUsd(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
    return `$${value.toFixed(value < 0.1 ? 4 : 2)}`;
  }

  function stageName(stage: string): string {
    return stage.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function preScanStageForRow(rowKey: string): string {
    switch (rowKey) {
      case 'ingestion_fetch':
        return 'fetch';
      case 'ingestion_extraction':
        return 'extraction';
      case 'ingestion_relations':
        return 'relations';
      case 'ingestion_grouping':
        return 'grouping';
      case 'ingestion_validation':
        return 'validation';
      case 'ingestion_embedding':
        return 'embedding';
      case 'ingestion_json_repair':
        return 'json_repair';
      default:
        return '';
    }
  }

  function preScanEstimateForRow(rowKey: string): SourcePreScanPhaseEstimate | null {
    const stage = preScanStageForRow(rowKey);
    if (!stage || !sourcePreScanResult?.preScan?.phaseEstimates) return null;
    return sourcePreScanResult.preScan.phaseEstimates.find((phase) => phase.stage === stage) ?? null;
  }

  function selectedCatalogEntryForRow(rowKey: string): CatalogEntry | null {
    const sid = stageModelIds[rowKey]?.trim() ?? '';
    if (!sid) return null;
    return getCatalogEntryByStableId(sid) ?? null;
  }

  function estimatedPhaseCostUsd(rowKey: string): number | null {
    if (rowKey === 'ingestion_fetch') return null;
    if (rowKey === 'ingestion_validation' && !runValidate) return null;
    const phase = preScanEstimateForRow(rowKey);
    const model = selectedCatalogEntryForRow(rowKey);
    if (!phase || !model) return null;
    const inputPerMillion = model.pricing?.inputPerMillion;
    const outputPerMillion = model.pricing?.outputPerMillion;
    if (typeof inputPerMillion !== 'number' && typeof outputPerMillion !== 'number') return null;
    const inputComponent = ((inputPerMillion ?? 0) * phase.inputTokens) / 1_000_000;
    const outputComponent = ((outputPerMillion ?? 0) * phase.outputTokens) / 1_000_000;
    return inputComponent + outputComponent;
  }

  function phaseCostRows(): {
    key: string;
    label: string;
    provider: string;
    model: string;
    costUsd: number | null;
  }[] {
    return RESTORMEL_STAGES.map((row) => {
      const entry = selectedCatalogEntryForRow(row.key);
      if (row.key === 'ingestion_fetch') {
        return {
          key: row.key,
          label: row.label,
          provider: '—',
          model: 'No LLM (HTTP / parse)',
          costUsd: null
        };
      }
      return {
        key: row.key,
        label: row.label,
        provider: entry?.provider ?? '—',
        model: entry?.modelId ?? 'Not selected',
        costUsd: estimatedPhaseCostUsd(row.key)
      };
    });
  }

  function estimatedIngestionTotalUsd(): number | null {
    const rows = phaseCostRows();
    const priced = rows.map((row) => row.costUsd).filter((value): value is number => typeof value === 'number');
    if (priced.length === 0) return null;
    return priced.reduce((sum, value) => sum + value, 0);
  }

  function costCoverage(): { priced: number; total: number } {
    const rows = phaseCostRows().filter((row) => row.key !== 'ingestion_fetch');
    return {
      priced: rows.filter((row) => typeof row.costUsd === 'number').length,
      total: rows.length
    };
  }

  function costEstimateHint(): string {
    if (!sourcePreScanResult) {
      return 'Run pre-scan to generate phase token estimates before cost can be calculated.';
    }
    const coverage = costCoverage();
    if (coverage.priced === 0) {
      return 'Select provider and model for each phase to see cost estimates.';
    }
    if (coverage.priced < coverage.total) {
      return `Cost currently shown for ${coverage.priced}/${coverage.total} phases. Select models for remaining phases to complete estimate.`;
    }
    return '';
  }

  function stageRecommendationMatch(row: (typeof RESTORMEL_STAGES)[number]): boolean {
    if (row.key === 'ingestion_fetch') return true;
    if (row.key === 'ingestion_validation' && !runValidate) return true;
    const selectedEntry = selectedCatalogEntryForRow(row.key);
    return selectedEntry ? isStageRecommendedModel(row, selectedEntry) : false;
  }

  function validationSelectionConflictActive(): boolean {
    if (!runValidate) return false;
    const selected = selectedCatalogEntryForRow('ingestion_validation');
    const primaryConflict = selected ? validationModelConflicts(selected) : false;
    const fallback = getCatalogEntryByStableId(stageFallbackModelIds['ingestion_validation'] ?? '');
    const fallbackConflict = fallback ? validationModelConflicts(fallback) : false;
    return primaryConflict || fallbackConflict;
  }

  function pipelineNoticeItems(): { severity: 'warn' | 'bad'; text: string }[] {
    const items: { severity: 'warn' | 'bad'; text: string }[] = [];
    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') continue;
      if (row.key === 'ingestion_validation' && !runValidate) continue;
      const sid = stageModelIds[row.key]?.trim() ?? '';
      if (!sid) continue;
      if (!stageRecommendationMatch(row)) {
        items.push({
          severity: 'bad',
          text: `${row.label}: review model choice — current pick may be a weak fit for this stage.`
        });
      }
    }
    if (validationSelectionConflictActive()) {
      items.push({
        severity: 'bad',
        text:
          'Validation: must use a different model than Extraction / Relations / Grouping (self-review bias). Choose another model or use Refresh models after fixing routes.'
      });
    }
    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') continue;
      if (row.key === 'ingestion_validation' && !runValidate) continue;
      const primary = getCatalogEntryByStableId(stageModelIds[row.key] ?? '');
      if (primary && !isSupportedRouteProvider(primary.provider)) {
        items.push({
          severity: 'bad',
          text: `${row.label}: primary uses provider “${primary.provider}”, which Restormel route steps do not allow (${ROUTE_STEP_PROVIDER_HINT}). Pick a supported provider or upgrade Keys; registry-only catalog rows still need OpenRouter or another listed slug here.`
        });
      }
      const fbSid = stageFallbackModelIds[row.key]?.trim() ?? '';
      const fallback = fbSid ? getCatalogEntryByStableId(fbSid) : undefined;
      if (fallback && !isSupportedRouteProvider(fallback.provider)) {
        items.push({
          severity: 'bad',
          text: `${row.label}: fallback uses provider “${fallback.provider}”, which Keys route steps do not accept (${ROUTE_STEP_PROVIDER_HINT}).`
        });
      }
    }
    return items;
  }

  const pipelineNoticeList = $derived.by(() => pipelineNoticeItems());

  function providerHint(provider: string): string {
    const p = provider.trim().toLowerCase();
    if (p === 'openai') return 'Broad catalog; strong defaults for many tasks.';
    if (p === 'anthropic') return 'Strong reasoning; good for long, careful passes.';
    if (p === 'google') return 'Often cost-competitive; good multimodal and long-context options.';
    if (p === 'mistral') return 'Frequently fast and economical for mid-tier workloads.';
    if (p === 'deepseek') return 'Strong reasoning/coder lines; confirm Keys catalog + route steps for your deployment.';
    if (p === 'together') return 'Open-models gateway; use catalog together-… ids for Restormel route steps.';
    if (p === 'cohere') return 'Solid embeddings and enterprise throughput options.';
    return 'Compare pricing, limits, and latency in your provider dashboard.';
  }

  function selectPipelineStage(key: string): void {
    activePipelineStageKey = key;
    queueMicrotask(() => {
      document.getElementById('pipeline-stage-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function onStageModelSelect(row: (typeof RESTORMEL_STAGES)[number], stableId: string): void {
    selectedPreset = null;
    const entry = getCatalogEntryByStableId(stableId);
    stageModelIds = { ...stageModelIds, [row.key]: stableId };
    if (entry) {
      stageProviders = { ...stageProviders, [row.key]: entry.provider };
    }
    if (
      row.key === 'ingestion_extraction' ||
      row.key === 'ingestion_relations' ||
      row.key === 'ingestion_grouping'
    ) {
      ensureValidationModelIsIndependent();
    }
  }

  function onStageFallbackModelSelect(row: (typeof RESTORMEL_STAGES)[number], stableId: string): void {
    selectedPreset = null;
    const entry = getCatalogEntryByStableId(stableId);
    stageFallbackModelIds = { ...stageFallbackModelIds, [row.key]: stableId };
    stageFallbackProviders = {
      ...stageFallbackProviders,
      [row.key]: entry?.provider ?? ''
    };
  }

  function sourceStepReady(): boolean {
    return sourceUrl.trim().length > 0 && sourcePreScanResult !== null && sourcePreScanFingerprint === sourceFingerprint();
  }

  /** True while a worker run is actively executing (not failed/done/setup). */
  function runInProgress(): boolean {
    return flowState === 'running' || flowState === 'awaiting_sync';
  }

  function pipelineStepReady(): boolean {
    return ingestionModelsReady();
  }

  function sourceFingerprint(): string {
    return `${sourceType}::${sourceUrl.trim()}`;
  }

  function resetPreScanLock(): void {
    if (runInProgress()) return;
    sourcePreScanResult = null;
    sourcePreScanError = '';
    sourcePreScanFingerprint = '';
    advisorAutoApplyPreset = null;
    costEstimateAcknowledged = false;
    sourceRunEndedDetail = null;
  }

  function canOpenStep(step: 'source' | 'pipeline' | 'cost' | 'review'): boolean {
    const monitoring = runId.trim() !== '' && flowState !== 'setup';
    if (monitoring) return true;
    if (step === 'source') return true;
    if (!sourceStepReady()) return false;
    if (step === 'cost') return pipelineStepReady();
    if (step === 'review') return pipelineStepReady() && costEstimateAcknowledged;
    return true;
  }

  function openStep(step: 'source' | 'pipeline' | 'cost' | 'review'): void {
    if (!canOpenStep(step)) return;
    activeStep = step;
  }

  function pipelinePresetChosen(): boolean {
    return ingestionModelsReady();
  }

  function costTabComplete(): boolean {
    return (
      costEstimateAcknowledged ||
      flowState === 'running' ||
      flowState === 'awaiting_sync' ||
      flowState === 'done' ||
      flowState === 'error'
    );
  }

  function reviewTabComplete(): boolean {
    return (
      flowState === 'running' ||
      flowState === 'awaiting_sync' ||
      flowState === 'done' ||
      flowState === 'error'
    );
  }

  function stepComplexity(row: (typeof RESTORMEL_STAGES)[number]): 'low' | 'medium' | 'high' {
    const fromPreScan = preScanEstimateForRow(row.key)?.complexity;
    if (fromPreScan === 'low' || fromPreScan === 'medium' || fromPreScan === 'high') return fromPreScan;
    const fallback = stageSuitabilityLabel(row);
    if (fallback.includes('high')) return 'high';
    if (fallback.includes('low')) return 'low';
    return 'medium';
  }

  function stepLatency(row: (typeof RESTORMEL_STAGES)[number]): 'low' | 'balanced' | 'high' {
    const latency = preScanEstimateForRow(row.key)?.latency;
    return latency === 'low' || latency === 'high' || latency === 'balanced' ? latency : 'balanced';
  }

  function complexityClass(row: (typeof RESTORMEL_STAGES)[number]): string {
    const c = stepComplexity(row);
    return c === 'high' ? 'cx-high' : c === 'medium' ? 'cx-medium' : 'cx-low';
  }

  /** Cost rail pill: workload tier, or an explicit conflict state when validation reuses a primary model. */
  function pipelineCostPill(row: (typeof RESTORMEL_STAGES)[number]): { text: string; pillClass: string } {
    if (row.key === 'ingestion_validation' && runValidate && validationSelectionConflictActive()) {
      return { text: 'conflict', pillClass: 'cx-conflict' };
    }
    return { text: stepComplexity(row), pillClass: complexityClass(row) };
  }

  async function preScanSource(): Promise<void> {
    if (sourcePreScanBusy) return;
    if (!validateSource()) return;
    sourcePreScanBusy = true;
    sourcePreScanError = '';
    sourceRunEndedDetail = null;
    sourcePreScanResult = null;
    try {
      const body = await authorizedJson('/api/admin/ingestion-source/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: sourceUrl.trim(),
          sourceType,
          ingestionAdvisorMode: ingestionAdvisorModeUi,
          ingestionAdvisorAutoApply: {
            preset: ingestionAdvisorAutoApplyPreset,
            validation: ingestionAdvisorAutoApplyValidation
          }
        })
      });
      sourcePreScanResult = body as unknown as SourcePreScanResult;
      const adv = sourcePreScanResult.advisor;
      if (adv?.mode === 'auto') {
        runValidate = adv.applied.runValidate;
        if (adv.autoApplied.preset) {
          advisorAutoApplyPreset = adv.applied.preset;
        }
      }
      sourcePreScanFingerprint = sourceFingerprint();
    } catch (e) {
      sourcePreScanError = e instanceof Error ? e.message : 'Unable to pre-scan this source.';
    } finally {
      sourcePreScanBusy = false;
    }
  }

  $effect(() => {
    if (advisorAutoApplyPreset === null) return;
    if (catalogEntries.length === 0) return;
    if (runInProgress()) return;
    const preset = advisorAutoApplyPreset;
    advisorAutoApplyPreset = null;
    applyPipelinePreset(preset);
  });

  async function runOfflineCoach(): Promise<void> {
    if (coachBusy) return;
    coachBusy = true;
    coachError = '';
    coachAggregatedSignals = null;
    try {
      const body = await authorizedJson('/api/admin/ingest/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 30 })
      });
      const output = body.output as IngestionCoachOutput | undefined;
      const signals = body.aggregatedSignals as CoachAggregatedSignals | null | undefined;
      if (output && typeof output.executiveSummary === 'string' && Array.isArray(output.recommendations)) {
        coachResult = output;
        coachAggregatedSignals = signals ?? null;
      } else {
        coachError = 'Unexpected coach response.';
      }
    } catch (e) {
      coachError = e instanceof Error ? e.message : 'Coach request failed.';
    } finally {
      coachBusy = false;
    }
  }

  function coachPipelineVariableLabel(tw: CoachSettingTweak): string {
    if (tw.uiVariableId) return COACH_UI_VARIABLE_LABELS[tw.uiVariableId] ?? tw.uiVariableId;
    return 'Pipeline control';
  }

  function applyCoachSettingTweak(tw: CoachSettingTweak): void {
    if (runInProgress()) return;
    switch (tw.scope) {
      case 'ui_preset': {
        const p = tw.preset;
        if (p === 'production' || p === 'budget' || p === 'balanced' || p === 'complexity') {
          applyPipelinePreset(INGESTION_PIPELINE_PRESET);
        }
        break;
      }
      case 'ui_validation': {
        if (typeof tw.runValidation === 'boolean') {
          runValidate = tw.runValidation;
          ensureValidationModelIsIndependent();
        }
        break;
      }
      case 'batch_override': {
        const k = tw.batchOverrideKey;
        const v = tw.batchOverrideValue;
        if (k == null || v == null) break;
        batchOverridesOpen = true;
        const s = String(Math.trunc(v));
        if (k === 'extractionMaxTokensPerSection') batchExtractionMaxTokensPerSection = s;
        else if (k === 'groupingTargetTokens') batchGroupingTargetTokens = s;
        else if (k === 'validationTargetTokens') batchValidationTargetTokens = s;
        else if (k === 'relationsTargetTokens') batchRelationsTargetTokens = s;
        else if (k === 'embedBatchSize') batchEmbedBatchSize = s;
        break;
      }
      default:
        break;
    }
  }

  function parseOptionalBoundedInt(
    input: string,
    min: number,
    max: number,
    label: string
  ): number | null {
    const t = input.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
    const i = Math.trunc(n);
    if (i < min || i > max) throw new Error(`${label} must be between ${min.toLocaleString()} and ${max.toLocaleString()}.`);
    return i;
  }

  function buildBatchOverridesFromUi(): { overrides?: Record<string, number>; error?: string } {
    try {
      const extractionMaxTokensPerSection = parseOptionalBoundedInt(
        batchExtractionMaxTokensPerSection,
        1000,
        20000,
        'Extraction max tokens per section'
      );
      const groupingTargetTokens = parseOptionalBoundedInt(batchGroupingTargetTokens, 10_000, 400_000, 'Grouping target tokens');
      const validationTargetTokens = parseOptionalBoundedInt(batchValidationTargetTokens, 10_000, 400_000, 'Validation target tokens');
      const relationsTargetTokens = parseOptionalBoundedInt(batchRelationsTargetTokens, 5_000, 250_000, 'Relations batch target tokens');
      const embedBatchSize = parseOptionalBoundedInt(batchEmbedBatchSize, 25, 2000, 'Embedding batch size');
      const ingestModelTimeoutMs = parseOptionalBoundedInt(
        batchIngestModelTimeoutMs,
        10_000,
        3_600_000,
        'Ingest model timeout (ms)'
      );
      const validationModelTimeoutMs = parseOptionalBoundedInt(
        batchValidationModelTimeoutMs,
        10_000,
        3_600_000,
        'Validation model timeout (ms)'
      );
      const ingestStageValidationTimeoutMs = parseOptionalBoundedInt(
        batchValidationStageTimeoutMs,
        10_000,
        3_600_000,
        'Validation stage timeout (ms)'
      );
      const ingestStageExtractionTimeoutMs = parseOptionalBoundedInt(
        batchExtractionStageTimeoutMs,
        10_000,
        3_600_000,
        'Extraction stage timeout (ms)'
      );
      const ingestStageRelationsTimeoutMs = parseOptionalBoundedInt(
        batchRelationsStageTimeoutMs,
        10_000,
        3_600_000,
        'Relations stage timeout (ms)'
      );
      const ingestStageGroupingTimeoutMs = parseOptionalBoundedInt(
        batchGroupingStageTimeoutMs,
        10_000,
        3_600_000,
        'Grouping stage timeout (ms)'
      );
      const ingestStageEmbeddingTimeoutMs = parseOptionalBoundedInt(
        batchEmbeddingStageTimeoutMs,
        10_000,
        3_600_000,
        'Embedding stage timeout (ms)'
      );
      const ingestStageJsonRepairTimeoutMs = parseOptionalBoundedInt(
        batchJsonRepairStageTimeoutMs,
        10_000,
        3_600_000,
        'JSON repair stage timeout (ms)'
      );

      const hasAny =
        extractionMaxTokensPerSection != null ||
        groupingTargetTokens != null ||
        validationTargetTokens != null ||
        relationsTargetTokens != null ||
        embedBatchSize != null ||
        ingestModelTimeoutMs != null ||
        validationModelTimeoutMs != null ||
        ingestStageValidationTimeoutMs != null ||
        ingestStageExtractionTimeoutMs != null ||
        ingestStageRelationsTimeoutMs != null ||
        ingestStageGroupingTimeoutMs != null ||
        ingestStageEmbeddingTimeoutMs != null ||
        ingestStageJsonRepairTimeoutMs != null;

      if (!hasAny) return {};

      const overrides: Record<string, number> = {};
      if (extractionMaxTokensPerSection != null) overrides.extractionMaxTokensPerSection = extractionMaxTokensPerSection;
      if (groupingTargetTokens != null) overrides.groupingTargetTokens = groupingTargetTokens;
      if (validationTargetTokens != null) overrides.validationTargetTokens = validationTargetTokens;
      if (relationsTargetTokens != null) overrides.relationsTargetTokens = relationsTargetTokens;
      if (embedBatchSize != null) overrides.embedBatchSize = embedBatchSize;
      if (ingestModelTimeoutMs != null) overrides.ingestModelTimeoutMs = ingestModelTimeoutMs;
      if (validationModelTimeoutMs != null) overrides.validationModelTimeoutMs = validationModelTimeoutMs;
      if (ingestStageValidationTimeoutMs != null) {
        overrides.ingestStageValidationTimeoutMs = ingestStageValidationTimeoutMs;
      }
      if (ingestStageExtractionTimeoutMs != null) {
        overrides.ingestStageExtractionTimeoutMs = ingestStageExtractionTimeoutMs;
      }
      if (ingestStageRelationsTimeoutMs != null) {
        overrides.ingestStageRelationsTimeoutMs = ingestStageRelationsTimeoutMs;
      }
      if (ingestStageGroupingTimeoutMs != null) {
        overrides.ingestStageGroupingTimeoutMs = ingestStageGroupingTimeoutMs;
      }
      if (ingestStageEmbeddingTimeoutMs != null) {
        overrides.ingestStageEmbeddingTimeoutMs = ingestStageEmbeddingTimeoutMs;
      }
      if (ingestStageJsonRepairTimeoutMs != null) {
        overrides.ingestStageJsonRepairTimeoutMs = ingestStageJsonRepairTimeoutMs;
      }
      return { overrides };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: msg };
    }
  }

  function buildWorkerTuningOverrides(): {
    ingestProvider: 'auto' | 'anthropic' | 'vertex';
    failOnGroupingPositionCollapse: boolean;
    ingestLogPins: boolean;
    relationsBatchOverlapClaims?: number;
    googleGenerativeThroughput?: boolean;
    googleExtractionConcurrencyFloor?: number;
  } {
    const o: {
      ingestProvider: 'auto' | 'anthropic' | 'vertex';
      failOnGroupingPositionCollapse: boolean;
      ingestLogPins: boolean;
      relationsBatchOverlapClaims?: number;
      googleGenerativeThroughput?: boolean;
      googleExtractionConcurrencyFloor?: number;
    } = {
      ingestProvider: workerIngestProvider,
      failOnGroupingPositionCollapse: workerFailOnGroupingCollapse,
      ingestLogPins: workerIngestLogPins
    };
    const t = workerRelationsOverlapClaims.trim();
    if (t !== '') {
      const n = Number(t);
      if (Number.isFinite(n)) {
        const i = Math.trunc(n);
        if (i >= 1 && i <= 99) o.relationsBatchOverlapClaims = i;
      }
    }
    if (!workerGoogleThroughputEnabled) o.googleGenerativeThroughput = false;
    const gRaw = workerGoogleExtractionFloor.trim();
    if (gRaw !== '') {
      const gn = Number(gRaw);
      if (Number.isFinite(gn)) {
        const gi = Math.trunc(gn);
        if (gi >= 1 && gi <= 12) o.googleExtractionConcurrencyFloor = gi;
      }
    }
    return o;
  }

  $effect(() => {
    if (!ingestSettingsHydrated || typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        INGEST_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          ingestionAdvisorMode: ingestionAdvisorModeUi,
          ingestionAdvisorAutoApplyPreset,
          ingestionAdvisorAutoApplyValidation,
          workerIngestProvider,
          workerRelationsOverlapClaims,
          workerGoogleThroughputEnabled,
          workerGoogleExtractionFloor,
          workerFailOnGroupingCollapse,
          workerIngestLogPins,
          batchExtractionMaxTokensPerSection,
          batchGroupingTargetTokens,
          batchValidationTargetTokens,
          batchRelationsTargetTokens,
          batchEmbedBatchSize,
          batchIngestModelTimeoutMs,
          batchValidationModelTimeoutMs,
          batchValidationStageTimeoutMs,
          batchExtractionStageTimeoutMs,
          batchRelationsStageTimeoutMs,
          batchGroupingStageTimeoutMs,
          batchEmbeddingStageTimeoutMs,
          batchJsonRepairStageTimeoutMs,
          pipelineDebugOpen
        })
      );
    } catch {
      /* quota / private mode */
    }
  });

  async function startIngestion(): Promise<void> {
    if (starting || !validateSource()) return;
    if (!sourceStepReady()) {
      runError = 'Run pre-scan on the current source before starting ingestion.';
      return;
    }
    if (!costEstimateAcknowledged) {
      runError = 'Confirm cost estimates on the Cost review step before starting ingestion.';
      return;
    }
    if (!ingestionModelsReady()) {
      runError =
        'Select a Restormel model for every stage (and ensure your project lists both chat and embedding models where required).';
      return;
    }

    const batchBuild = buildBatchOverridesFromUi();
    batchOverridesError = batchBuild.error ?? '';
    if (batchBuild.error) {
      runError = batchBuild.error;
      return;
    }
    const batchOverrides = batchBuild.overrides ?? {};
    const workerTuning = buildWorkerTuningOverrides();
    const mergedBatchOverrides = { ...batchOverrides, ...workerTuning };

    starting = true;
    monitorRunNotice = '';
    sourceRunEndedDetail = null;
    runError = '';
    runLog = [];
    runLogCursor = 0;
    pollRunKey = '';
    ingestTimingSummary = null;
    completionMessage = '';
    executionNotice = '';
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
          pipeline_preset: INGESTION_PIPELINE_PRESET,
          embedding_model: stageModelIds.ingestion_embedding,
          batch_overrides: mergedBatchOverrides,
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
      const execution = (body?.execution ?? {}) as IngestExecutionInfo;
      if (execution.mode === 'simulated') {
        executionNotice =
          'Running in simulation mode. To execute real ingestion from localhost, set ADMIN_INGEST_RUN_REAL=1, DATABASE_URL, live SURREAL_URL, and model API keys.';
      } else if (execution.mode === 'real') {
        const surreal = execution.surrealTarget ?? 'configured target';
        const firestore = execution.firestoreProject ? `, Firestore project ${execution.firestoreProject}` : '';
        executionNotice = `Real execution mode enabled (Surreal ${surreal}${firestore}).`;
      }

      runId = id;
      runExcludeFromBatchSuggest = false;
      batchSuggestFlagError = '';
      lastAppliedRunStatus = null;
      flowState = 'running';
      runCapturedIssues = [];
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

  async function cancelIngestion(): Promise<void> {
    if (!runId || cancelling) return;
    const ok = window.confirm(
      'Stop this ingestion run? The worker will be stopped if it is still running. The run will be marked cancelled and can be resumed from checkpoint when available.'
    );
    if (!ok) return;
    cancelling = true;
    runError = '';
    try {
      const response = await fetch(`/api/admin/ingest/run/${runId}/cancel`, {
        method: 'POST',
        headers: await authHeaders()
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 404) {
        recoverFromMissingRun('cancel');
        return;
      }
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Cancel request failed.');
      }
      await fetchRunStatus();
    } catch (e) {
      runError = e instanceof Error ? e.message : 'Cancel failed.';
    } finally {
      cancelling = false;
    }
  }

  async function resumeFromFailure(): Promise<void> {
    if (!runId || !runResumable || syncing) return;
    syncing = true;
    runError = '';
    try {
      const batchBuild = buildBatchOverridesFromUi();
      batchOverridesError = batchBuild.error ?? '';
      if (batchBuild.error) {
        runError = batchBuild.error;
        return;
      }
      const batchOverrides = batchBuild.overrides ?? {};
      const workerTuning = buildWorkerTuningOverrides();
      const mergedBatchOverrides = { ...batchOverrides, ...workerTuning };

      const response = await fetch(`/api/admin/ingest/run/${runId}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders())
        },
        body: JSON.stringify({
          model_chain: {
            extract: stageModelIds.ingestion_extraction,
            relate: stageModelIds.ingestion_relations,
            group: stageModelIds.ingestion_grouping,
            validate: stageModelIds.ingestion_validation
          },
          batch_overrides: mergedBatchOverrides
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Resume request failed.');
      }
      flowState = 'running';
      runResumable = false;
      startPolling();
    } catch (e) {
      runError = e instanceof Error ? e.message : 'Resume failed.';
    } finally {
      syncing = false;
    }
  }

  /** Re-attach `ingest.ts` when Neon still shows running but this server has no child (e.g. after deploy). */
  async function respawnStaleWorker(): Promise<void> {
    if (!runId || syncing) return;
    syncing = true;
    runError = '';
    try {
      const batchBuild = buildBatchOverridesFromUi();
      batchOverridesError = batchBuild.error ?? '';
      if (batchBuild.error) {
        runError = batchBuild.error;
        return;
      }
      const batchOverrides = batchBuild.overrides ?? {};
      const workerTuning = buildWorkerTuningOverrides();
      const mergedBatchOverrides = { ...batchOverrides, ...workerTuning };

      const response = await fetch(`/api/admin/ingest/run/${runId}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders())
        },
        body: JSON.stringify({
          respawn_stale_worker: true,
          model_chain: {
            extract: stageModelIds.ingestion_extraction,
            relate: stageModelIds.ingestion_relations,
            group: stageModelIds.ingestion_grouping,
            validate: stageModelIds.ingestion_validation
          },
          batch_overrides: mergedBatchOverrides
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Respawn request failed.');
      }
      flowState = 'running';
      runResumable = false;
      startPolling();
    } catch (e) {
      runError = e instanceof Error ? e.message : 'Respawn failed.';
    } finally {
      syncing = false;
    }
  }

  function stripMonitorParamsFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    params.delete('monitor');
    params.delete('runId');
    const query = params.toString();
    window.history.replaceState({}, '', query ? `/admin/ingest?${query}` : '/admin/ingest');
  }

  function dismissFirestoreReportPanel(): void {
    firestoreReportDetail = null;
    firestoreReportLoadError = '';
    const params = new URLSearchParams(window.location.search);
    params.delete('reportRunId');
    const query = params.toString();
    window.history.replaceState({}, '', query ? `/admin/ingest?${query}` : '/admin/ingest');
  }

  /** After a failed or cancelled run: free Source for a new URL, clear pre-scan lock, return to setup. */
  function unlockSourceAfterFailedRun(errorMessage: string): void {
    clearPolling();
    monitorRunNotice = '';
    sourceRunEndedDetail = errorMessage;
    sourcePreScanResult = null;
    sourcePreScanFingerprint = '';
    sourcePreScanError = '';
    costEstimateAcknowledged = false;
    selectedPreset = null;
    presetMessage = '';
    runId = '';
    runError = '';
    runLog = [];
    runLogCursor = 0;
    pollRunKey = '';
    ingestTimingSummary = null;
    runCurrentStage = null;
    runCurrentAction = null;
    runLastFailureStage = null;
    runResumable = false;
    runProcessAlive = false;
    runProcessId = null;
    runLastOutputAt = null;
    runIdleForMs = null;
    runProcessStartedAt = null;
    runProcessExitedAt = null;
    runExcludeFromBatchSuggest = false;
    batchSuggestFlagError = '';
    completionMessage = '';
    syncDurationLabel = '';
    executionNotice = '';
    cancelling = false;
    stages = cloneStages();
    flowState = 'setup';
    activeStep = 'source';
    lastAppliedRunStatus = null;
    stripMonitorParamsFromUrl();
  }

  /** Failed run viewed from history (or first poll already terminal): keep logs/run id, stay on Review. */
  function applyTerminalErrorView(errorMessage: string): void {
    clearPolling();
    monitorRunNotice = '';
    runError = errorMessage;
    sourceRunEndedDetail = errorMessage;
    flowState = 'error';
    activeStep = 'review';
  }

  function applyStatusBody(body: Record<string, unknown>): void {
    let nextStages = stages;
    if (body?.stages && typeof body.stages === 'object') {
      nextStages = STAGE_TEMPLATE.map((stage) => ({
        ...stage,
        status: ((body.stages as Record<string, { status?: StageStatus }>)[stage.key]?.status ??
          stage.status) as StageStatus,
        result: typeof (body.stages as Record<string, { summary?: string }>)[stage.key]?.summary === 'string'
          ? (body.stages as Record<string, { summary?: string }>)[stage.key].summary
          : undefined
      }));
    }
    let incomingLogLines: string[] = [];
    if (body?.logIncremental === true && Array.isArray(body?.logLines)) {
      incomingLogLines = body.logLines as string[];
      runLog = [...runLog, ...incomingLogLines];
    } else if (Array.isArray(body?.logLines)) {
      incomingLogLines = body.logLines as string[];
      runLog = incomingLogLines;
    }
    if (typeof body?.logLineTotal === 'number') {
      runLogCursor = body.logLineTotal as number;
    } else if (Array.isArray(body?.logLines) && body?.logIncremental !== true) {
      runLogCursor = runLog.length;
    }
    tryParseIngestTimingFromLog(runLog);
    const stageFromStatus =
      typeof body?.currentStageKey === 'string' && body.currentStageKey.trim().length > 0
        ? body.currentStageKey.trim().toLowerCase()
        : null;
    const stageFromLog =
      inferRunStageFromLogLines(incomingLogLines) ??
      inferRunStageFromLogLines(runLog.slice(Math.max(0, runLog.length - 40)));
    runCurrentStage = stageFromStatus ?? stageFromLog ?? null;
    stages = harmonizePipelineStages(nextStages, runCurrentStage);
    runCurrentAction = typeof body?.currentAction === 'string' ? body.currentAction : null;
    runLastFailureStage = typeof body?.lastFailureStageKey === 'string' ? body.lastFailureStageKey : null;
    runResumable = body?.resumable === true;
    if (typeof body?.excludeFromBatchSuggest === 'boolean') {
      runExcludeFromBatchSuggest = body.excludeFromBatchSuggest;
    }
    runProcessAlive = body?.processAlive === true;
    runProcessId = typeof body?.processId === 'number' ? body.processId : null;
    runLastOutputAt = typeof body?.lastOutputAt === 'number' ? body.lastOutputAt : null;
    runIdleForMs = typeof body?.idleForMs === 'number' ? body.idleForMs : null;
    runProcessStartedAt = typeof body?.processStartedAt === 'number' ? body.processStartedAt : null;
    runProcessExitedAt = typeof body?.processExitedAt === 'number' ? body.processExitedAt : null;

    if (Array.isArray(body?.issues)) {
      runCapturedIssues = body.issues as RunCapturedIssue[];
    }

    const awaitingSync = body?.awaitingSync === true || body?.status === 'awaiting_sync';
    const syncStart = typeof body?.syncStartedAt === 'number' ? body.syncStartedAt : undefined;
    const syncEnd = typeof body?.syncCompletedAt === 'number' ? body.syncCompletedAt : undefined;
    if (syncStart != null && syncEnd != null) {
      syncDurationLabel = formatDuration(syncEnd - syncStart);
    }

    if (body?.status === 'done') {
      flowState = 'done';
      lastAppliedRunStatus = 'done';
      completionMessage =
        syncEnd != null
          ? `Job completed. SurrealDB sync finished in ${syncDurationLabel || formatDuration((syncEnd ?? 0) - (syncStart ?? 0))}. A structured issue report was saved to Firestore (ingestion_run_reports) for review.`
          : 'Job completed. Ingestion finished successfully. A structured issue report was saved to Firestore (ingestion_run_reports) for review.';
      clearPolling();
    } else if (awaitingSync) {
      flowState = 'awaiting_sync';
      lastAppliedRunStatus = 'awaiting_sync';
    } else if (body?.status === 'error') {
      const err = typeof body?.error === 'string' ? body.error : 'Ingestion failed.';
      const wasActive =
        lastAppliedRunStatus === 'running' || lastAppliedRunStatus === 'awaiting_sync';
      if (wasActive) {
        lastAppliedRunStatus = null;
        unlockSourceAfterFailedRun(err);
      } else {
        applyTerminalErrorView(err);
        lastAppliedRunStatus = 'error';
      }
    } else if (typeof body?.status === 'string') {
      lastAppliedRunStatus = body.status;
    }
  }

  /**
   * Run record is gone (restart, different instance, expired in-memory run). Clear monitor UI and URL
   * without wiping source / cost wizard state so the operator can start a new run immediately.
   */
  function recoverFromMissingRun(context: 'status' | 'cancel'): void {
    clearPolling();
    runId = '';
    runError = '';
    runLog = [];
    runLogCursor = 0;
    pollRunKey = '';
    ingestTimingSummary = null;
    runCurrentStage = null;
    runCurrentAction = null;
    runLastFailureStage = null;
    runResumable = false;
    runProcessAlive = false;
    runProcessId = null;
    runLastOutputAt = null;
    runIdleForMs = null;
    runProcessStartedAt = null;
    runProcessExitedAt = null;
    runCapturedIssues = [];
    runExcludeFromBatchSuggest = false;
    batchSuggestFlagError = '';
    completionMessage = '';
    syncDurationLabel = '';
    executionNotice = '';
    cancelling = false;
    stages = cloneStages();
    flowState = 'setup';
    activeStep = 'review';
    lastAppliedRunStatus = null;
    stripMonitorParamsFromUrl();
    sourceRunEndedDetail = null;
    monitorRunNotice =
      context === 'cancel'
        ? 'That run no longer exists on the server (for example after a restart). The monitor was cleared—you can start a new ingestion below.'
        : 'This run is no longer on the server (in-memory runs are cleared when the app restarts). Your source and pipeline settings are unchanged—start a new run when ready.';
  }

  async function patchExcludeFromBatchSuggest(next: boolean): Promise<void> {
    if (!runId.trim()) return;
    batchSuggestFlagBusy = true;
    batchSuggestFlagError = '';
    try {
      const response = await fetch(`/api/admin/ingest/run/${encodeURIComponent(runId)}/exclude-batch-suggest`, {
        method: 'PATCH',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludeFromBatchSuggest: next })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to update batch-suggest flag.');
      }
      runExcludeFromBatchSuggest = next;
    } catch (e) {
      batchSuggestFlagError = e instanceof Error ? e.message : 'Failed to update flag.';
    } finally {
      batchSuggestFlagBusy = false;
    }
  }

  function tryParseIngestTimingFromLog(lines: string[]): void {
    const prefix = '[INGEST_TIMING]';
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = (lines[i] ?? '').trim();
      if (!line.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(line.slice(prefix.length).trim()) as Record<string, unknown>;
        ingestTimingSummary = parsed;
      } catch {
        ingestTimingSummary = null;
      }
      return;
    }
  }

  async function fetchRunStatus(): Promise<void> {
    if (!runId) return;
    if (runId !== pollRunKey) {
      pollRunKey = runId;
      runLogCursor = 0;
    }
    try {
      const qs = runLogCursor > 0 ? `?since=${runLogCursor}` : '';
      const response = await fetch(`/api/admin/ingest/run/${runId}/status${qs}`, {
        headers: await authHeaders()
      });
      if (!response.ok) {
        if (response.status === 404) {
          recoverFromMissingRun('status');
        }
        return;
      }
      const body = await response.json();
      applyStatusBody(body);
    } catch {
      /* transient */
    }
  }

  function schedulePollTick(): void {
    if (!runId) return;
    if (pollTimer) clearTimeout(pollTimer);
    const delay =
      runProcessAlive &&
      (lastAppliedRunStatus === 'running' || lastAppliedRunStatus === 'awaiting_sync')
        ? 550
        : 1800;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (!runId) return;
      await fetchRunStatus();
      if (!runId) return;
      if (flowState === 'done' || flowState === 'setup' || flowState === 'error') return;
      schedulePollTick();
    }, delay);
  }

  function startPolling(): void {
    if (!runId) return;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    void fetchRunStatus().then(() => {
      schedulePollTick();
    });
  }

  function clearPolling(): void {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function resetFlow(): void {
    clearPolling();
    monitorRunNotice = '';
    sourceRunEndedDetail = null;
    costEstimateAcknowledged = false;
    flowState = 'setup';
    runId = '';
    runError = '';
    runLog = [];
    runLogCursor = 0;
    pollRunKey = '';
    ingestTimingSummary = null;
    runCurrentStage = null;
    runCurrentAction = null;
    runLastFailureStage = null;
    runResumable = false;
    runProcessAlive = false;
    runProcessId = null;
    runLastOutputAt = null;
    runIdleForMs = null;
    runProcessStartedAt = null;
    runProcessExitedAt = null;
    completionMessage = '';
    syncDurationLabel = '';
    stages = cloneStages();
    lastAppliedRunStatus = null;
    stripMonitorParamsFromUrl();
  }

  onMount(() => {
    try {
      const raw =
        localStorage.getItem(INGEST_SETTINGS_STORAGE_KEY) ?? localStorage.getItem('sophia.admin.ingestSettings.v1');
      if (raw) {
        const p = JSON.parse(raw) as Record<string, unknown>;
        if (p.ingestionAdvisorMode === 'off' || p.ingestionAdvisorMode === 'shadow' || p.ingestionAdvisorMode === 'auto') {
          ingestionAdvisorModeUi = p.ingestionAdvisorMode;
        }
        if (typeof p.ingestionAdvisorAutoApplyPreset === 'boolean') {
          ingestionAdvisorAutoApplyPreset = p.ingestionAdvisorAutoApplyPreset;
        }
        if (typeof p.ingestionAdvisorAutoApplyValidation === 'boolean') {
          ingestionAdvisorAutoApplyValidation = p.ingestionAdvisorAutoApplyValidation;
        }
        if (
          p.workerIngestProvider === 'auto' ||
          p.workerIngestProvider === 'anthropic' ||
          p.workerIngestProvider === 'vertex'
        ) {
          workerIngestProvider = p.workerIngestProvider;
        }
        if (typeof p.workerRelationsOverlapClaims === 'string') {
          workerRelationsOverlapClaims = p.workerRelationsOverlapClaims;
        }
        if (typeof p.workerGoogleThroughputEnabled === 'boolean') {
          workerGoogleThroughputEnabled = p.workerGoogleThroughputEnabled;
        }
        if (typeof p.workerGoogleExtractionFloor === 'string') {
          workerGoogleExtractionFloor = p.workerGoogleExtractionFloor;
        }
        if (typeof p.workerFailOnGroupingCollapse === 'boolean') {
          workerFailOnGroupingCollapse = p.workerFailOnGroupingCollapse;
        }
        if (typeof p.workerIngestLogPins === 'boolean') {
          workerIngestLogPins = p.workerIngestLogPins;
        }
        if (typeof p.batchIngestModelTimeoutMs === 'string') {
          batchIngestModelTimeoutMs = p.batchIngestModelTimeoutMs;
        }
        if (typeof p.batchValidationModelTimeoutMs === 'string') {
          batchValidationModelTimeoutMs = p.batchValidationModelTimeoutMs;
        }
        if (typeof p.batchValidationStageTimeoutMs === 'string') {
          batchValidationStageTimeoutMs = p.batchValidationStageTimeoutMs;
        }
        if (typeof p.batchExtractionStageTimeoutMs === 'string') {
          batchExtractionStageTimeoutMs = p.batchExtractionStageTimeoutMs;
        }
        if (typeof p.batchRelationsStageTimeoutMs === 'string') {
          batchRelationsStageTimeoutMs = p.batchRelationsStageTimeoutMs;
        }
        if (typeof p.batchGroupingStageTimeoutMs === 'string') {
          batchGroupingStageTimeoutMs = p.batchGroupingStageTimeoutMs;
        }
        if (typeof p.batchEmbeddingStageTimeoutMs === 'string') {
          batchEmbeddingStageTimeoutMs = p.batchEmbeddingStageTimeoutMs;
        }
        if (typeof p.batchJsonRepairStageTimeoutMs === 'string') {
          batchJsonRepairStageTimeoutMs = p.batchJsonRepairStageTimeoutMs;
        }
        if (typeof p.batchExtractionMaxTokensPerSection === 'string') {
          batchExtractionMaxTokensPerSection = p.batchExtractionMaxTokensPerSection;
        }
        if (typeof p.batchGroupingTargetTokens === 'string') {
          batchGroupingTargetTokens = p.batchGroupingTargetTokens;
        }
        if (typeof p.batchValidationTargetTokens === 'string') {
          batchValidationTargetTokens = p.batchValidationTargetTokens;
        }
        if (typeof p.batchRelationsTargetTokens === 'string') {
          batchRelationsTargetTokens = p.batchRelationsTargetTokens;
        }
        if (typeof p.batchEmbedBatchSize === 'string') {
          batchEmbedBatchSize = p.batchEmbedBatchSize;
        }
        if (typeof p.pipelineDebugOpen === 'boolean') {
          pipelineDebugOpen = p.pipelineDebugOpen;
        }
      }
      const nz = (s: string, d: string) => (String(s ?? '').trim() === '' ? d : String(s));
      workerRelationsOverlapClaims = nz(workerRelationsOverlapClaims, W.relationsBatchOverlapClaims);
      workerGoogleExtractionFloor = nz(workerGoogleExtractionFloor, W.googleExtractionConcurrencyFloor);
      batchExtractionMaxTokensPerSection = nz(batchExtractionMaxTokensPerSection, W.extractionMaxTokensPerSection);
      batchGroupingTargetTokens = nz(batchGroupingTargetTokens, W.groupingTargetTokens);
      batchValidationTargetTokens = nz(batchValidationTargetTokens, W.validationTargetTokens);
      batchRelationsTargetTokens = nz(batchRelationsTargetTokens, W.relationsTargetTokens);
      batchEmbedBatchSize = nz(batchEmbedBatchSize, W.embedBatchSize);
      batchIngestModelTimeoutMs = nz(batchIngestModelTimeoutMs, W.ingestModelTimeoutMs);
      batchValidationModelTimeoutMs = nz(batchValidationModelTimeoutMs, W.validationModelTimeoutMs);
      batchValidationStageTimeoutMs = nz(batchValidationStageTimeoutMs, W.validationStageTimeoutMs);
      batchExtractionStageTimeoutMs = nz(batchExtractionStageTimeoutMs, W.extractionStageTimeoutMs);
      batchRelationsStageTimeoutMs = nz(batchRelationsStageTimeoutMs, W.relationsStageTimeoutMs);
      batchGroupingStageTimeoutMs = nz(batchGroupingStageTimeoutMs, W.groupingStageTimeoutMs);
      batchEmbeddingStageTimeoutMs = nz(batchEmbeddingStageTimeoutMs, W.embeddingStageTimeoutMs);
      batchJsonRepairStageTimeoutMs = nz(batchJsonRepairStageTimeoutMs, W.jsonRepairStageTimeoutMs);
    } catch {
      /* ignore */
    }
    ingestSettingsHydrated = true;

    void (async () => {
      await loadModelCatalog();
      await loadRoutingContext();
      await hydrateSelectionsFromRoutes();
      await loadEmbeddingHealth();
    })();

    const params = new URLSearchParams(window.location.search);
    const prefillSourceUrl = params.get('sourceUrl')?.trim() ?? '';
    const prefillSourceType = params.get('sourceType')?.trim() ?? '';
    const autoInspect = params.get('inspect') === '1';
    if (prefillSourceUrl) {
      sourceUrl = prefillSourceUrl;
      if (
        prefillSourceType === 'sep_entry' ||
        prefillSourceType === 'iep_entry' ||
        prefillSourceType === 'journal_article' ||
        prefillSourceType === 'book' ||
        prefillSourceType === 'web_article'
      ) {
        sourceType = prefillSourceType;
      }
      if (autoInspect) {
        void preScanSource();
      }
    }

    const reportRunId = params.get('reportRunId')?.trim();
    if (reportRunId) {
      void (async () => {
        try {
          const res = await fetch(`/api/admin/ingest/reports/${encodeURIComponent(reportRunId)}`, {
            headers: await authHeaders()
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            firestoreReportLoadError =
              typeof body?.error === 'string' ? body.error : `Failed to load report (${res.status})`;
            return;
          }
          firestoreReportDetail = body as FirestoreReportDetail;
        } catch {
          firestoreReportLoadError = 'Failed to load report';
        }
      })();
    }

    const existingRunId = params.get('runId')?.trim();
    if (existingRunId) {
      runId = existingRunId;
      runLogCursor = 0;
      pollRunKey = '';
      ingestTimingSummary = null;
      flowState = 'running';
      runLog = [`Monitoring run: ${runId}`];
      activeStep = 'review';
      if (params.get('monitor') !== '1') {
        params.set('monitor', '1');
        window.history.replaceState({}, '', `/admin/ingest?${params.toString()}`);
      }
      startPolling();
    }
  });

  onDestroy(() => clearPolling());
</script>

<svelte:head>
  <title>Ingestion — Admin</title>
</svelte:head>

<main class="expand-page">
  <header class="expand-hero">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
        <h1 class="mt-2 font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">Ingestion orchestration and routing</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
          Configure source setup, pre-scan assumptions, stage-level model choices, and run with a clear cost view.
        </p>
      </div>
      <nav class="flex flex-wrap items-center gap-2" aria-label="Admin shortcuts">
        <a href="/admin" class="admin-hub-action">Admin home</a>
        <a href="/admin/ingest/runs" class="admin-hub-action">All runs</a>
        <a href="/admin/ingest/batch" class="admin-hub-action">STOA batches</a>
        <a href="/admin/operator-byok" class="admin-hub-action">Operator BYOK</a>
      </nav>
    </div>
  </header>

  <section class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/45 px-4 py-3" aria-label="Embedding health">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Embedding health</p>
      {#if embeddingHealthBusy}
        <span class="font-mono text-xs text-sophia-dark-muted">Checking…</span>
      {/if}
    </div>

    {#if embeddingHealth}
      <div class="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-sophia-dark-muted">
        <p>
          <span class="text-sophia-dark-dim">Provider:</span>
          <span class="text-sophia-dark-text">{embeddingHealth.activeProvider ?? 'unknown'}</span>
          {#if embeddingHealth.activeModel}
            <span class="text-sophia-dark-dim"> · </span>
            <span class="text-sophia-dark-text break-all">{embeddingHealth.activeModel}</span>
          {/if}
        </p>
        <p>
          <span class="text-sophia-dark-dim">Expected:</span>
          <span class="text-sophia-dark-text">{embeddingHealth.expectedDimensions ?? 'unknown'} dims</span>
        </p>
        <p>
          <span class="text-sophia-dark-dim">DB detected:</span>
          <span
            class={embeddingHealth.drift === true ? 'text-sophia-dark-copper' : 'text-sophia-dark-text'}
          >
            {embeddingHealth.detectedDbVectorDimension ?? 'unknown'} dims
          </span>
          {#if embeddingHealth.detectedDbDimensions.length > 1}
            <span class="text-sophia-dark-dim">
              (mixed: {embeddingHealth.detectedDbDimensions.join(', ')})
            </span>
          {/if}
          {#if embeddingHealth.sampledVectors > 0}
            <span class="text-sophia-dark-dim"> · sample {embeddingHealth.sampledVectors}</span>
          {/if}
        </p>
      </div>

      {#if embeddingHealth.drift === true}
        <p class="mt-2 max-w-3xl font-mono text-xs leading-relaxed text-sophia-dark-copper">
          Drift detected: a random sample of existing claim vectors in Surreal does not match the dimension of the
          current embedding stack (new writes use that stack). Retried or restarted ingests only re-embed claims touched by
          those runs; most of the corpus can stay on an older dimension until you run a full re-embed or migrate the vector
          index — see <code class="text-sophia-dark-muted">docs/local/operations/ingestion-embedding-lock.md</code>.
        </p>
      {/if}
    {:else if embeddingHealthError}
      <p class="mt-2 font-mono text-xs text-sophia-dark-copper">{embeddingHealthError}</p>
    {/if}

    {#if embeddingHealthWarnings.length > 0}
      <ul class="mt-2 space-y-1">
        {#each embeddingHealthWarnings as warning (warning)}
          <li class="font-mono text-xs text-sophia-dark-muted">{warning}</li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if monitorRunNotice}
    <div
      class="mt-6 flex flex-col gap-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/45 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <p class="max-w-3xl font-mono text-sm leading-relaxed text-sophia-dark-muted">{monitorRunNotice}</p>
      <button
        type="button"
        class="shrink-0 rounded border border-sophia-dark-border/80 bg-sophia-dark-bg px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:border-sophia-dark-border hover:bg-sophia-dark-surface-raised hover:text-sophia-dark-text"
        onclick={() => (monitorRunNotice = '')}
      >
        Dismiss
      </button>
    </div>
  {/if}

  {#if firestoreReportLoadError}
    <div
      class="mt-6 flex flex-col gap-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/45 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <p class="font-mono text-sm text-sophia-dark-copper">{firestoreReportLoadError}</p>
      <button
        type="button"
        class="shrink-0 rounded border border-sophia-dark-border/80 bg-sophia-dark-bg px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:border-sophia-dark-border hover:bg-sophia-dark-surface-raised hover:text-sophia-dark-text"
        onclick={() => dismissFirestoreReportPanel()}>Dismiss</button
      >
    </div>
  {/if}

  {#if firestoreReportDetail}
    <div
      class="mt-6 rounded border border-sophia-dark-border bg-sophia-dark-bg/45 px-4 py-4"
      role="region"
      aria-label="Saved ingestion report"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Saved report (Firestore)</p>
          <p class="mt-1 font-mono text-sm text-sophia-dark-text">
            Run <span class="text-sophia-dark-sage">{firestoreReportDetail.runId}</span>
            <span class="text-sophia-dark-muted"> — </span>
            {firestoreReportDetail.status ?? 'unknown'}
          </p>
          <p class="mt-2 max-w-3xl text-sm text-sophia-dark-muted">
            This is a read-only snapshot. Live log polling only works for runs still held in memory on the server (see
            <a href="/admin/ingest/runs" class="text-sophia-dark-text underline underline-offset-2">All runs</a>). To
            continue the pipeline, use the same source URL below so checkpoints can resume.
          </p>
        </div>
        <button
          type="button"
          class="rounded border border-sophia-dark-border/80 bg-sophia-dark-bg px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:border-sophia-dark-border hover:bg-sophia-dark-surface-raised hover:text-sophia-dark-text"
          onclick={() => dismissFirestoreReportPanel()}>Close</button
        >
      </div>
      <dl class="mt-4 grid gap-2 font-mono text-xs text-sophia-dark-muted sm:grid-cols-2">
        <div>
          <dt class="text-sophia-dark-dim">Source</dt>
          <dd class="mt-0.5 break-all text-sophia-dark-text">{firestoreReportDetail.sourceUrl}</dd>
        </div>
        <div>
          <dt class="text-sophia-dark-dim">Type</dt>
          <dd class="mt-0.5 text-sophia-dark-text">{firestoreReportDetail.sourceType}</dd>
        </div>
        <div>
          <dt class="text-sophia-dark-dim">Preset / validation</dt>
          <dd class="mt-0.5 text-sophia-dark-text">
            {firestoreReportDetail.pipelinePreset ?? '—'} · validate {firestoreReportDetail.validate ? 'on' : 'off'}
          </dd>
        </div>
        <div>
          <dt class="text-sophia-dark-dim">Embedding</dt>
          <dd class="mt-0.5 break-all text-sophia-dark-text">{firestoreReportDetail.embeddingModel ?? '—'}</dd>
        </div>
      </dl>
      {#if firestoreReportDetail.modelChain && typeof firestoreReportDetail.modelChain === 'object'}
        <div class="mt-4">
          <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Model chain (UI selection)</p>
          <ul class="mt-2 space-y-1 font-mono text-xs text-sophia-dark-text">
            {#each Object.entries(firestoreReportDetail.modelChain) as [k, v] (k)}
              <li><span class="text-sophia-dark-dim">{k}:</span> {v}</li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if firestoreReportDetail.metricsAdvisory && typeof firestoreReportDetail.metricsAdvisory === 'object'}
        {@const adv = firestoreReportDetail.metricsAdvisory}
        <div class="mt-4 rounded border border-sophia-dark-border/70 bg-sophia-dark-bg/30 p-4" role="region" aria-label="Metrics advisory">
          <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">
            Metrics advisory (rule-based)
          </p>
          <p class="mt-2 font-mono text-xs text-sophia-dark-muted">
            Severity: <span class="text-sophia-dark-text">{adv.severity ?? '—'}</span> — from
            <span class="font-mono text-sophia-dark-text">timingTelemetry</span> + log heuristics. Not an LLM; see
            <span class="font-mono text-sophia-dark-text">pnpm ops:ingest-tuning-report-neon</span> for fleet rollups.
          </p>
          {#if Array.isArray(adv.recommendations) && adv.recommendations.length > 0}
            <p class="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Recommendations</p>
            <ul class="mt-2 list-disc space-y-2 pl-5 text-xs leading-relaxed text-sophia-dark-muted">
              {#each adv.recommendations as rec (rec)}
                <li>{rec}</li>
              {/each}
            </ul>
          {/if}
          {#if Array.isArray(adv.guardrails) && adv.guardrails.length > 0}
            <p class="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Guardrails</p>
            <ul class="mt-2 list-disc space-y-2 pl-5 text-xs leading-relaxed text-sophia-dark-muted">
              {#each adv.guardrails as g (g)}
                <li>{g}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      {#if firestoreReportDetail.terminalError}
        <p class="mt-4 font-mono text-xs text-sophia-dark-copper">{firestoreReportDetail.terminalError}</p>
      {/if}
      {#if firestoreReportDetail.issueCount > 0}
        <p class="mt-2 font-mono text-xs text-sophia-dark-muted">
          Issues logged: {firestoreReportDetail.issueCount}
        </p>
      {/if}
    </div>
  {/if}

  <section class="wizard-layout">
    <div class="expand-card">
      <div class="expand-card-inner expand-wizard">
        <div class="step-tabs">
          <button class:active={activeStep === 'source'} class:done={sourceStepReady()} type="button" onclick={() => openStep('source')}>1. Source</button>
          <button class:active={activeStep === 'pipeline'} class:done={pipelinePresetChosen()} type="button" disabled={!canOpenStep('pipeline')} onclick={() => openStep('pipeline')}>2. Pipeline setup</button>
          <button class:active={activeStep === 'cost'} class:done={costTabComplete()} type="button" disabled={!canOpenStep('cost')} onclick={() => openStep('cost')}>3. Cost review</button>
          <button class:active={activeStep === 'review'} class:done={reviewTabComplete()} type="button" disabled={!canOpenStep('review')} onclick={() => openStep('review')}>4. Review & run</button>
        </div>

        {#if activeStep === 'source'}
          <section class="step-pane">
            <div class="source-step-layout flex flex-col gap-6">
              <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Source setup</h2>
              {#if sourceRunEndedDetail}
                <div
                  class="flex flex-col gap-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/45 p-4 sm:flex-row sm:items-start sm:justify-between"
                  role="status"
                >
                  <div class="min-w-0 space-y-3">
                    <p class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Run ended</p>
                    <p class="font-mono text-sm text-sophia-dark-copper">{sourceRunEndedDetail}</p>
                    {#if runCapturedIssues.length > 0}
                      <p class="font-mono text-xs text-sophia-dark-muted">
                        Structured issues captured: <span class="text-sophia-dark-text">{runCapturedIssues.length}</span>
                        — open <strong class="text-sophia-dark-text">Review &amp; run</strong> to inspect, or query Firestore
                        <code class="text-sophia-dark-text">ingestion_run_reports</code> for the saved report.
                      </p>
                    {/if}
                    <p class="max-w-2xl text-sm leading-relaxed text-sophia-dark-muted">
                      You can enter a new URL and source type, then run pre-scan to start a completely new ingestion. Cost review will ask for acknowledgement again after pre-scan.
                    </p>
                    <p class="max-w-2xl text-sm leading-relaxed text-sophia-dark-muted">
                      To reopen a finished or orphaned run after a deploy, open
                      <a href="/admin/ingest/runs" class="text-sophia-dark-text underline decoration-sophia-dark-border underline-offset-2 hover:decoration-sophia-dark-text">All runs</a>
                      and use <strong class="text-sophia-dark-text">View report</strong> for the Firestore snapshot, or
                      <strong class="text-sophia-dark-text">Open live</strong> only if this instance still holds the run in
                      memory.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 rounded border border-sophia-dark-border/80 bg-sophia-dark-bg px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:border-sophia-dark-border hover:bg-sophia-dark-surface-raised hover:text-sophia-dark-text"
                    onclick={() => {
                      sourceRunEndedDetail = null;
                      runCapturedIssues = [];
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              {/if}
              <div class="flex flex-col gap-2">
                <span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">URL</span>
                <div class="flex items-center gap-4">
                  <div class="min-w-0 flex-1 max-w-[52rem]">
                    <input bind:value={sourceUrl} type="url" disabled={runInProgress() || sourceStepReady()} placeholder="https://plato.stanford.edu/entries/pacifism/" class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text disabled:opacity-60" />
                  </div>
                  <button
                    type="button"
                    onclick={resetPreScanLock}
                    disabled={runInProgress() || !sourceStepReady()}
                    class="shrink-0 rounded border border-sophia-dark-amber/45 bg-sophia-dark-amber/12 font-mono text-xs uppercase tracking-[0.02em] text-sophia-dark-amber hover:bg-sophia-dark-amber/18 disabled:opacity-50"
                  >
                    Reset
                  </button>
                </div>
                {#if urlError}<span class="font-mono text-xs text-sophia-dark-copper">{urlError}</span>{/if}
              </div>
              <div class="flex flex-col gap-2">
                <span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Source type</span>
                <select bind:value={sourceType} disabled={runInProgress() || sourceStepReady()} class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text disabled:opacity-60">
                  {#each SOURCE_TYPES as option}<option value={option.value}>{option.label}</option>{/each}
                </select>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                {#if sourceStepReady()}
                  <div class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-sage">
                    Pre-scan complete ✓
                  </div>
                {:else}
                  <button
                    type="button"
                    onclick={() => void preScanSource()}
                    disabled={runInProgress() || sourcePreScanBusy || !sourceUrl.trim()}
                    class="rounded border border-sophia-dark-blue/45 bg-sophia-dark-blue/14 px-6 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-blue hover:bg-sophia-dark-blue/20 disabled:opacity-50"
                  >
                    {sourcePreScanBusy ? 'Pre-scanning…' : 'Pre-scan source'}
                  </button>
                {/if}
              </div>
              {#if sourcePreScanError}<p class="font-mono text-xs text-sophia-dark-copper">{sourcePreScanError}</p>{/if}
              {#if sourceStepReady()}<p class="font-mono text-xs text-sophia-dark-dim">Source is locked after successful pre-scan. Use “Reset pre-scan” to edit URL/source type.</p>{/if}
              {#if sourcePreScanResult}
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/50 px-6 py-5 sm:px-8 sm:py-6">
                  <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Pre-scan summary</p>
                  <div class="mt-4 grid gap-4 font-mono text-sm leading-6 text-sophia-dark-muted sm:grid-cols-2">
                    <p><span class="text-sophia-dark-dim">Title:</span> {sourcePreScanResult.metadata.title || 'Unknown'}</p>
                    <p><span class="text-sophia-dark-dim">Host:</span> {sourcePreScanResult.metadata.hostname || 'Unknown'}</p>
                    <p><span class="text-sophia-dark-dim">Author:</span> {sourcePreScanResult.metadata.author || 'Unknown'}</p>
                    <p><span class="text-sophia-dark-dim">Year:</span> {sourcePreScanResult.metadata.publicationYear || 'Unknown'}</p>
                    <p><span class="text-sophia-dark-dim">Approx chars:</span> {formatInt(sourcePreScanResult.preScan.approxContentChars)}</p>
                    <p>
                      <span class="text-sophia-dark-dim">Approx tokens:</span>
                      {formatTokensVsReferenceLadder(sourcePreScanResult.preScan.approxContentTokens)}
                    </p>
                    <p class="text-xs text-sophia-dark-muted">
                      Reference sizes (10k / 60k / 200k) are common context benchmarks; your pipeline batches and models determine real limits.
                    </p>
                  </div>
                </div>
              {/if}
            </div>
          </section>
        {/if}

        {#if activeStep === 'pipeline'}
          <section class="step-pane">
            <div class="space-y-4">
              <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Pipeline configuration</h2>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/45 p-3">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Production pipeline</p>
                  <button
                    type="button"
                    disabled={runInProgress()}
                    onclick={() => void refreshModelsAndRoutes()}
                    class="shrink-0 rounded border border-sophia-dark-border/70 bg-transparent px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim hover:border-sophia-dark-border hover:bg-sophia-dark-surface-raised hover:text-sophia-dark-muted disabled:opacity-50"
                  >
                    Load from Restormel
                  </button>
                </div>

                <div class="mt-4 rounded border border-sophia-dark-border/70 bg-sophia-dark-bg/30 p-4" role="group" aria-labelledby="ingestion-depth-label">
                  <p id="ingestion-depth-label" class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                    Model defaults
                  </p>
                  <p class="mt-2 text-xs text-sophia-dark-muted">
                    Ingestion uses one production profile: per-stage models below follow production quality floors, tuned for
                    your source type. The worker also applies canonical model fallbacks when a stage’s primary fails after
                    retries (unless you pin stages via env). Use <span class="font-mono">Apply production defaults</span> to
                    repopulate picks from the current catalog and routes.
                  </p>
                  <div class="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={runInProgress()}
                      onclick={() => applyPipelinePreset()}
                      class="min-h-11 rounded border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] disabled:opacity-50 {selectedPreset === INGESTION_PIPELINE_PRESET ? 'border-sophia-dark-sage/45 bg-sophia-dark-sage/14 text-sophia-dark-sage' : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'}"
                    >
                      Apply production defaults
                    </button>
                  </div>
                </div>
                <p class="mt-3 text-xs text-sophia-dark-muted">
                  Picks adapt to source type and only use models currently available in your Restormel/Keys context.
                </p>
                {#if presetMessage}
                  <p class="mt-2 font-mono text-xs text-sophia-dark-sage">{presetMessage}</p>
                {/if}
              </div>

              <div
                id="ingest-worker-defaults"
                class="rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-4"
                role="region"
                aria-label="Worker and advisor defaults"
              >
                <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Worker and advisor defaults</p>
                <p class="mt-1 text-xs text-sophia-dark-muted">
                  Saved in this browser (v2 settings). Numeric fields load the same baseline as the ingest worker / scripts defaults; hover
                  controls for env var names, rate-limit tradeoffs, and what to lower if you raise something else. CLI-only ingest can still use
                  environment variables. After changing the advisor mode, run <span class="font-mono">Source</span> pre-scan again so the Cost tab
                  “last pre-scan” summary updates.
                </p>
                <div class="mt-4 space-y-4">
                  <div>
                    <label
                      class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                      for="ingest-advisor-mode"
                      title={WT.ingestionAdvisorMode}
                    >
                      Ingestion advisor (pre-scan)
                    </label>
                    <select
                      id="ingest-advisor-mode"
                      disabled={runInProgress()}
                      bind:value={ingestionAdvisorModeUi}
                      title={WT.ingestionAdvisorMode}
                      class="mt-1 w-full max-w-md rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                    >
                      <option value="off">Off — heuristics only (no extra model on pre-scan)</option>
                      <option value="shadow">Shadow — show AI preset/validation vs heuristics</option>
                      <option value="auto">Auto — apply AI suggestions when enabled below</option>
                    </select>
                    {#if ingestionAdvisorModeUi === 'auto'}
                      <div class="mt-3 flex flex-wrap gap-4">
                        <label
                          class="flex cursor-pointer items-center gap-2 font-mono text-xs text-sophia-dark-muted"
                          title={WT.ingestionAdvisorAutoApplyPreset}
                        >
                          <input
                            type="checkbox"
                            disabled={runInProgress()}
                            bind:checked={ingestionAdvisorAutoApplyPreset}
                            class="rounded border-sophia-dark-border"
                            title={WT.ingestionAdvisorAutoApplyPreset}
                          />
                          Auto-apply production model picks
                        </label>
                        <label
                          class="flex cursor-pointer items-center gap-2 font-mono text-xs text-sophia-dark-muted"
                          title={WT.ingestionAdvisorAutoApplyValidation}
                        >
                          <input
                            type="checkbox"
                            disabled={runInProgress()}
                            bind:checked={ingestionAdvisorAutoApplyValidation}
                            class="rounded border-sophia-dark-border"
                            title={WT.ingestionAdvisorAutoApplyValidation}
                          />
                          Auto-apply validation toggle
                        </label>
                      </div>
                    {/if}
                  </div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                        for="ingest-provider"
                        title={WT.ingestProvider}
                      >
                        Ingest provider preference
                      </label>
                      <select
                        id="ingest-provider"
                        disabled={runInProgress()}
                        bind:value={workerIngestProvider}
                        title={WT.ingestProvider}
                        class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                      >
                        <option value="auto">auto</option>
                        <option value="vertex">vertex</option>
                        <option value="anthropic">anthropic</option>
                      </select>
                      <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                        Passed to <span class="font-mono">scripts/ingest.ts</span> as <span class="font-mono">INGEST_PROVIDER</span>. Hover the
                        control for tradeoffs.
                      </p>
                    </div>
                    <div>
                      <label
                        class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                        for="relations-overlap"
                        title={WT.relationsBatchOverlapClaims}
                      >
                        Relations batch overlap (claims)
                      </label>
                      <input
                        id="relations-overlap"
                        type="number"
                        min="1"
                        max="99"
                        step="1"
                        title={WT.relationsBatchOverlapClaims}
                        value={workerRelationsOverlapClaims}
                        oninput={(e) => (workerRelationsOverlapClaims = (e.currentTarget as HTMLInputElement).value)}
                        disabled={runInProgress()}
                        class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                      />
                      <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                        Default <span class="font-mono text-sophia-dark-text">4</span> — maps to <span class="font-mono">RELATIONS_BATCH_OVERLAP_CLAIMS</span>.
                      </p>
                    </div>
                  </div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <label
                      class="flex cursor-pointer items-start gap-2 font-mono text-xs text-sophia-dark-muted sm:col-span-2"
                      title={WT.googleThroughput}
                    >
                      <input
                        type="checkbox"
                        disabled={runInProgress()}
                        bind:checked={workerGoogleThroughputEnabled}
                        class="mt-0.5 rounded border-sophia-dark-border"
                        title={WT.googleThroughput}
                      />
                      <span>
                        Google / Vertex throughput mode (parallel extraction + Vertex embed pacing when embedding is Vertex).
                        <span class="block text-[0.65rem] text-sophia-dark-dim mt-1">INGEST_GOOGLE_GENERATIVE_THROUGHPUT</span>
                      </span>
                    </label>
                    <div>
                      <label
                        class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                        for="google-extract-floor"
                        title={WT.googleExtractionFloor}
                      >
                        Google extraction concurrency floor
                      </label>
                      <input
                        id="google-extract-floor"
                        type="number"
                        min="1"
                        max="12"
                        title={WT.googleExtractionFloor}
                        step="1"
                        bind:value={workerGoogleExtractionFloor}
                        disabled={runInProgress()}
                        class="mt-1 w-full max-w-xs rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                      />
                      <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                        <span class="font-mono">INGEST_GOOGLE_EXTRACTION_CONCURRENCY_FLOOR</span> when extraction is Vertex/Gemini.
                      </p>
                    </div>
                  </div>
                  <label class="flex cursor-pointer items-start gap-2 font-mono text-xs text-sophia-dark-muted" title={WT.failOnGroupingCollapse}>
                    <input
                      type="checkbox"
                      disabled={runInProgress()}
                      bind:checked={workerFailOnGroupingCollapse}
                      class="mt-0.5 rounded border-sophia-dark-border"
                      title={WT.failOnGroupingCollapse}
                    />
                    <span>
                      Fail ingest when grouping positions collapse (strict integrity). Uncheck to only warn.
                      <span class="block text-[0.65rem] text-sophia-dark-dim mt-1">INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE</span>
                    </span>
                  </label>
                  <label class="flex cursor-pointer items-start gap-2 font-mono text-xs text-sophia-dark-muted" title={WT.ingestLogPins}>
                    <input
                      type="checkbox"
                      disabled={runInProgress()}
                      bind:checked={workerIngestLogPins}
                      class="mt-0.5 rounded border-sophia-dark-border"
                      title={WT.ingestLogPins}
                    />
                    <span>
                      Log Expand pin and routing diagnostics on the worker (extra <span class="font-mono">[INGEST_PINS]</span> lines in
                      Cloud Logging / run output).
                      <span class="block text-[0.65rem] text-sophia-dark-dim mt-1">INGEST_LOG_PINS</span>
                    </span>
                  </label>
                </div>
              </div>

              <div
                class="rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-4"
                role="region"
                aria-label="Pipeline debugging"
              >
                <details bind:open={pipelineDebugOpen} class="group">
                  <summary
                    class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted"
                  >
                    Pipeline debugging
                  </summary>
                  <div class="mt-4 space-y-4">
                    <p class="text-xs text-sophia-dark-muted">
                      Per-run worker timeout overrides (milliseconds). Fields default to the same 360000 ms baseline as the ingest worker /
                      <span class="font-mono">scripts/ingest.ts</span>; the server may still apply stricter caps from
                      <span class="font-mono">.env</span>. Stage-specific values map to
                      <span class="font-mono">INGEST_STAGE_*_TIMEOUT_MS</span>. Saved in this browser with worker defaults above; hover each control
                      for pairing advice.
                    </p>
                    {#if ingestWorkerDiagnostics}
                      <div class="rounded border border-sophia-dark-border/70 bg-sophia-dark-bg/25 p-4">
                        <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">
                          Server Restormel resolve env (redacted)
                        </p>
                        <ul class="mt-3 list-none space-y-2 font-mono text-xs text-sophia-dark-muted">
                          <li>
                            <span class="text-sophia-dark-dim">Keys base host:</span>
                            {ingestWorkerDiagnostics.keysBaseHost ?? '—'}
                          </li>
                          <li>
                            <span class="text-sophia-dark-dim">RESTORMEL_ENVIRONMENT_ID:</span>
                            {ingestWorkerDiagnostics.environmentId}
                          </li>
                          <li>
                            <span class="text-sophia-dark-dim">RESTORMEL_PROJECT_ID:</span>
                            {ingestWorkerDiagnostics.projectIdConfigured ? 'set' : 'missing'}
                          </li>
                          <li>
                            <span class="text-sophia-dark-dim">RESTORMEL_GATEWAY_KEY:</span>
                            {ingestWorkerDiagnostics.gatewayKeyConfigured ? 'set' : 'missing'}
                          </li>
                        </ul>
                        <p class="mt-3 text-[0.65rem] leading-relaxed text-sophia-dark-dim">
                          If logs show routing degraded, publish ingestion routes per stage and fix missing credentials in the deployment
                          environment. Reference:
                          <span class="font-mono">src/lib/server/restormelIngestionRoutes.ts</span>.
                        </p>
                      </div>
                    {/if}
                    <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">
                      Default model timeouts
                    </p>
                    <div class="mt-2 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="dbg-ingest-timeout"
                          title={WT.ingestModelTimeoutMs}
                        >
                          Ingest model timeout (ms)
                        </label>
                        <input
                          id="dbg-ingest-timeout"
                          type="number"
                          min="10000"
                          max="3600000"
                          step="1000"
                          title={WT.ingestModelTimeoutMs}
                          value={batchIngestModelTimeoutMs}
                          oninput={(e) =>
                            (batchIngestModelTimeoutMs = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                        <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                          <span class="font-mono">INGEST_MODEL_TIMEOUT_MS</span> — fallback for stages without a per-stage override.
                        </p>
                      </div>
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="dbg-validation-timeout"
                          title={WT.validationModelTimeoutMs}
                        >
                          Validation model timeout (ms)
                        </label>
                        <input
                          id="dbg-validation-timeout"
                          type="number"
                          min="10000"
                          max="3600000"
                          step="1000"
                          title={WT.validationModelTimeoutMs}
                          value={batchValidationModelTimeoutMs}
                          oninput={(e) =>
                            (batchValidationModelTimeoutMs = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                        <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                          <span class="font-mono">VALIDATION_MODEL_TIMEOUT_MS</span> — worker fallback when
                          <span class="font-mono">INGEST_STAGE_VALIDATION_TIMEOUT_MS</span> is unset.
                        </p>
                      </div>
                    </div>

                    <p class="mt-6 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">
                      Per-stage timeouts
                    </p>
                    <p class="mt-1 text-[0.65rem] leading-relaxed text-sophia-dark-dim">
                      Optional overrides for each <span class="font-mono">StageKey</span> budget in the worker. When set, these win over the ingest /
                      validation defaults above for that stage only.
                    </p>
                    <div class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="dbg-validation-stage-timeout"
                          title={WT.validationStageTimeoutMs}
                        >
                          Validation (ms)
                        </label>
                        <input
                          id="dbg-validation-stage-timeout"
                          type="number"
                          min="10000"
                          max="3600000"
                          step="1000"
                          title={WT.validationStageTimeoutMs}
                          value={batchValidationStageTimeoutMs}
                          oninput={(e) =>
                            (batchValidationStageTimeoutMs = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                        <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                          <span class="font-mono">INGEST_STAGE_VALIDATION_TIMEOUT_MS</span>
                        </p>
                      </div>
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="dbg-extraction-timeout"
                          title={WT.extractionStageTimeoutMs}
                        >
                          Extraction (ms)
                        </label>
                        <input
                          id="dbg-extraction-timeout"
                          type="number"
                          min="10000"
                          max="3600000"
                          step="1000"
                          title={WT.extractionStageTimeoutMs}
                          value={batchExtractionStageTimeoutMs}
                          oninput={(e) =>
                            (batchExtractionStageTimeoutMs = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                        <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                          <span class="font-mono">INGEST_STAGE_EXTRACTION_TIMEOUT_MS</span>
                        </p>
                      </div>
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="dbg-relations-timeout"
                          title={WT.relationsStageTimeoutMs}
                        >
                          Relations (ms)
                        </label>
                        <input
                          id="dbg-relations-timeout"
                          type="number"
                          min="10000"
                          max="3600000"
                          step="1000"
                          title={WT.relationsStageTimeoutMs}
                          value={batchRelationsStageTimeoutMs}
                          oninput={(e) =>
                            (batchRelationsStageTimeoutMs = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                        <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                          <span class="font-mono">INGEST_STAGE_RELATIONS_TIMEOUT_MS</span>
                        </p>
                      </div>
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="dbg-grouping-timeout"
                          title={WT.groupingStageTimeoutMs}
                        >
                          Grouping (ms)
                        </label>
                        <input
                          id="dbg-grouping-timeout"
                          type="number"
                          min="10000"
                          max="3600000"
                          step="1000"
                          title={WT.groupingStageTimeoutMs}
                          value={batchGroupingStageTimeoutMs}
                          oninput={(e) =>
                            (batchGroupingStageTimeoutMs = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                        <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                          <span class="font-mono">INGEST_STAGE_GROUPING_TIMEOUT_MS</span>
                        </p>
                      </div>
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="dbg-embedding-timeout"
                          title={WT.embeddingStageTimeoutMs}
                        >
                          Embedding (ms)
                        </label>
                        <input
                          id="dbg-embedding-timeout"
                          type="number"
                          min="10000"
                          max="3600000"
                          step="1000"
                          title={WT.embeddingStageTimeoutMs}
                          value={batchEmbeddingStageTimeoutMs}
                          oninput={(e) =>
                            (batchEmbeddingStageTimeoutMs = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                        <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                          <span class="font-mono">INGEST_STAGE_EMBEDDING_TIMEOUT_MS</span>
                        </p>
                      </div>
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="dbg-json-repair-timeout"
                          title={WT.jsonRepairStageTimeoutMs}
                        >
                          JSON repair (ms)
                        </label>
                        <input
                          id="dbg-json-repair-timeout"
                          type="number"
                          min="10000"
                          max="3600000"
                          step="1000"
                          title={WT.jsonRepairStageTimeoutMs}
                          value={batchJsonRepairStageTimeoutMs}
                          oninput={(e) =>
                            (batchJsonRepairStageTimeoutMs = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full min-h-11 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                        <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                          <span class="font-mono">INGEST_STAGE_JSON_REPAIR_TIMEOUT_MS</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </details>
              </div>

              {#if routingInfraProviders.length > 0 || sourcePreScanResult?.advisor?.model}
                <div
                  class="mt-4 rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/25 p-4"
                  role="region"
                  aria-label="Model and infrastructure checklist"
                >
                  <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                    Model &amp; infra checklist
                  </p>
                  <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                    Based on your Restormel routing picks and worker defaults (not a second pre-scan). Use it to anticipate
                    IAM, keys, and quotas before running Source pre-scan or a full ingest.
                  </p>
                  <ul class="mt-3 list-disc space-y-2 pl-5 text-xs leading-relaxed text-sophia-dark-muted">
                    {#if routingInfraProviders.includes('vertex')}
                      <li>
                        <span class="font-mono text-sophia-dark-text">vertex</span> — Google Cloud: the runtime identity (e.g. ingestion worker
                        service account) needs <span class="font-mono">roles/aiplatform.user</span> (Vertex AI User) and permission to call
                        <span class="font-mono">aiplatform.endpoints.predict</span> for the Gemini / publisher models you selected. Enable the Vertex
                        AI API on the project if it is not already.
                      </li>
                    {/if}
                    {#if routingInfraProviders.includes('anthropic')}
                      <li>
                        <span class="font-mono text-sophia-dark-text">anthropic</span> — Restormel Keys must have a usable Anthropic key for this
                        environment; routing resolves against that workspace configuration.
                      </li>
                    {/if}
                    {#if routingInfraProviders.includes('openai')}
                      <li>
                        <span class="font-mono text-sophia-dark-text">openai</span> — Restormel Keys must expose a valid OpenAI key for this
                        environment.
                      </li>
                    {/if}
                    {#if sourcePreScanResult?.advisor?.model}
                      <li>
                        Last pre-scan advisor call used
                        <span class="font-mono text-sophia-dark-text"
                          >{sourcePreScanResult.advisor.model.provider}/{sourcePreScanResult.advisor.model.modelId}</span
                        >
                        — the same provider rules apply (e.g. Vertex IAM for Google publisher models).
                      </li>
                    {/if}
                  </ul>
                </div>
              {/if}

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-4">
                <div class="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Restormel routing steps</p>
                    <p class="mt-1 text-xs text-sophia-dark-muted">
                      Two-way sync: load stage routing from Restormel, or edit in Sophia and save back to Restormel.
                    </p>
                    <p class="mt-2 text-[0.65rem] leading-relaxed text-sophia-dark-dim">
                      Sophia manages only primary/fallback slots and preserves additional Restormel route rules when saving. Route-step providers follow Keys OpenAPI 1.3.4+ ({ROUTE_STEP_PROVIDER_HINT}) — still narrower than the full merged catalog (e.g. xAI, Groq). Together models must use the catalog id (together-…) in steps. If Keys returns an error, it may include the current allowed list from the server.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={runInProgress() || routingBusy}
                    onclick={() => void applyStageRouting()}
                    class="shrink-0 rounded border border-sophia-dark-border/70 bg-transparent px-4 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim hover:border-sophia-dark-border hover:bg-sophia-dark-surface-raised hover:text-sophia-dark-text disabled:opacity-50"
                  >
                    {routingBusy ? 'Saving…' : 'Save to Restormel'}
                  </button>
                </div>
                {#if routingError}
                  <p class="mt-2 font-mono text-xs text-sophia-dark-copper">{routingError}</p>
                {/if}
                {#if routingMessage}
                  <p class="mt-2 font-mono text-xs text-sophia-dark-sage">{routingMessage}</p>
                {/if}
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/25 p-4">
                <details bind:open={batchOverridesOpen} class="group">
                  <summary
                    class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted"
                  >
                    Advanced: batch overrides
                  </summary>
                  <div class="mt-3 space-y-3">
                    <p class="text-xs text-sophia-dark-muted">
                      Values default to the current ingest script / worker baseline (same as durable jobs). Hover each field for env vars and
                      rate-limit pairing notes. Overrides are merged into the child process environment for
                      <code class="text-sophia-dark-text">scripts/ingest.ts</code>.
                    </p>

                    <div class="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="bo-extraction"
                          title={WT.extractionMaxTokensPerSection}
                        >
                          Extraction max tokens per section
                        </label>
                        <details class="mt-1 rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/30 px-3 py-2">
                          <summary class="cursor-pointer font-mono text-[0.65rem] text-sophia-dark-dim">
                            When to change this
                          </summary>
                          <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                            Lower if you see many <span class="font-mono">truncation</span>, <span class="font-mono">batch_split</span>,
                            or <span class="font-mono">json_repair</span> issues in extraction: smaller sections reduce output
                            size per call and often stabilize JSON. Raising can reduce the number of extraction calls on very
                            long coherent passages, but stays within the min/max shown; watch for the same failure modes.
                          </p>
                        </details>
                        <input
                          id="bo-extraction"
                          type="number"
                          min="1000"
                          max="20000"
                          step="100"
                          title={WT.extractionMaxTokensPerSection}
                          value={batchExtractionMaxTokensPerSection}
                          oninput={(e) => (batchExtractionMaxTokensPerSection = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                      </div>

                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="bo-grouping"
                          title={WT.groupingTargetTokens}
                        >
                          Grouping target tokens
                        </label>
                        <details class="mt-1 rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/30 px-3 py-2">
                          <summary class="cursor-pointer font-mono text-[0.65rem] text-sophia-dark-dim">
                            When to change this
                          </summary>
                          <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                            Lower if <span class="font-mono">grouping_integrity</span> warnings, timeouts, or huge sources
                            suggest the model is juggling too many claims at once. Higher values batch more claims per grouping
                            call (fewer round trips) but increase load per request.
                          </p>
                        </details>
                        <input
                          id="bo-grouping"
                          type="number"
                          min="10000"
                          max="400000"
                          step="1000"
                          title={WT.groupingTargetTokens}
                          value={batchGroupingTargetTokens}
                          oninput={(e) => (batchGroupingTargetTokens = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                      </div>

                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="bo-validation"
                          title={WT.validationTargetTokens}
                        >
                          Validation target tokens
                        </label>
                        <details class="mt-1 rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/30 px-3 py-2">
                          <summary class="cursor-pointer font-mono text-[0.65rem] text-sophia-dark-dim">
                            When to change this
                          </summary>
                          <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                            Only applies when cross-model validation is on. Lower if the validation stage hits truncation,
                            timeouts, or schema pressure on large bundled inputs. Raise only when batches are unnecessarily
                            small and the model is stable.
                          </p>
                        </details>
                        <input
                          id="bo-validation"
                          type="number"
                          min="10000"
                          max="400000"
                          step="1000"
                          title={WT.validationTargetTokens}
                          value={batchValidationTargetTokens}
                          oninput={(e) => (batchValidationTargetTokens = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress() || !runValidate}
                          class="mt-2 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                      </div>

                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="bo-relations"
                          title={WT.relationsTargetTokens}
                        >
                          Relations batch target tokens
                        </label>
                        <details class="mt-1 rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/30 px-3 py-2">
                          <summary class="cursor-pointer font-mono text-[0.65rem] text-sophia-dark-dim">
                            When to change this
                          </summary>
                          <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                            Lower if the relations stage shows <span class="font-mono">retry</span>, rate limits, truncation,
                            or you chunked relations to stay under provider limits. Smaller batches mean more relation calls
                            but less context per call.
                          </p>
                        </details>
                        <input
                          id="bo-relations"
                          type="number"
                          min="5000"
                          max="250000"
                          step="1000"
                          title={WT.relationsTargetTokens}
                          value={batchRelationsTargetTokens}
                          oninput={(e) => (batchRelationsTargetTokens = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                      </div>

                      <div>
                        <label
                          class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                          for="bo-embed"
                          title={WT.embedBatchSize}
                        >
                          Embedding batch size
                        </label>
                        <details class="mt-1 rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/30 px-3 py-2">
                          <summary class="cursor-pointer font-mono text-[0.65rem] text-sophia-dark-dim">
                            When to change this
                          </summary>
                          <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                            Lower if embedding shows throttling, <span class="font-mono">retry</span>, or provider rate limits on
                            large sources. Higher batches reduce HTTP round trips but can hit quotas faster.
                          </p>
                        </details>
                        <input
                          id="bo-embed"
                          type="number"
                          min="25"
                          max="2000"
                          step="25"
                          title={WT.embedBatchSize}
                          value={batchEmbedBatchSize}
                          oninput={(e) => (batchEmbedBatchSize = (e.currentTarget as HTMLInputElement).value)}
                          disabled={runInProgress()}
                          class="mt-2 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </div>

              {#if sourcePreScanResult?.advisor}
                {@const adv = sourcePreScanResult.advisor}
                {@const advisorStale = ingestionAdvisorModeUi !== adv.mode}
                <div class="rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/35 p-4" role="region" aria-label="Ingestion advisor">
                  <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Ingestion advisor (last pre-scan)</p>
                  <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                    This block is the snapshot from your last Source pre-scan, not the live
                    <span class="font-mono">Pipeline setup</span> dropdown. Change Worker defaults, then run pre-scan again on step 1 so this card
                    matches.
                  </p>
                  <dl class="mt-3 grid gap-2 font-mono text-xs text-sophia-dark-muted sm:grid-cols-2">
                    <div>
                      <dt class="text-sophia-dark-dim">Pipeline setting (saved now)</dt>
                      <dd class="mt-0.5 text-sophia-dark-text">{ingestionAdvisorModeUi}</dd>
                    </div>
                    <div>
                      <dt class="text-sophia-dark-dim">Last pre-scan used</dt>
                      <dd class="mt-0.5 text-sophia-dark-text">
                        {adv.mode}
                        {#if adv.enabled}
                          · advisor model ran
                        {:else if adv.mode === 'off'}
                          · heuristics only (no advisor call that run)
                        {/if}
                        {#if adv.model}
                          · {adv.model.provider}/{adv.model.modelId}
                        {/if}
                      </dd>
                    </div>
                  </dl>
                  {#if advisorStale}
                    <p class="mt-3 rounded border border-sophia-dark-amber/40 bg-sophia-dark-amber/10 px-3 py-2 text-xs text-sophia-dark-muted" role="status">
                      Pipeline is set to <span class="font-mono text-sophia-dark-text">{ingestionAdvisorModeUi}</span> but this summary is from a
                      pre-scan that used <span class="font-mono text-sophia-dark-text">{adv.mode}</span>. Go to
                      <span class="font-mono">Source</span> and run pre-scan again to refresh.
                    </p>
                  {/if}
                  {#if adv.mode === 'off' && !advisorStale}
                    <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                      With advisor off, that pre-scan used heuristics only. To get AI preset/validation suggestions on the next pre-scan, set
                      <a href="#ingest-worker-defaults" class="text-sophia-dark-sage underline-offset-2 hover:underline">Worker and advisor defaults</a>
                      to Shadow or Auto, then pre-scan again.
                    </p>
                  {/if}
                  {#if adv.error}
                    <p class="mt-2 font-mono text-xs text-sophia-dark-copper">{adv.error}</p>
                    {#if /aiplatform\.endpoints\.predict|aiplatform\.googleapis\.com|Vertex AI/i.test(adv.error)}
                      <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                        In Google Cloud IAM, grant the identity used for ingestion (often the worker service account) the
                        <span class="font-mono">Vertex AI User</span> role (<span class="font-mono">roles/aiplatform.user</span>) on the project, or
                        ensure it can call <span class="font-mono">aiplatform.endpoints.predict</span> for the model in the error above.
                      </p>
                    {/if}
                  {/if}
                  <dl class="mt-3 grid gap-2 font-mono text-xs text-sophia-dark-muted sm:grid-cols-2">
                    <div>
                      <dt class="text-sophia-dark-dim">Heuristic baseline</dt>
                      <dd class="mt-0.5 text-sophia-dark-text">
                        Preset {adv.heuristicBaseline.recommendedPreset}; validation {adv.heuristicBaseline.suggestCrossModelValidation ? 'on' : 'off'}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-sophia-dark-dim">Applied (UI / run)</dt>
                      <dd class="mt-0.5 text-sophia-dark-text">
                        Preset {adv.applied.preset}; validation {adv.applied.runValidate ? 'on' : 'off'}
                        {#if adv.mode === 'auto'}
                          <span class="text-sophia-dark-dim">
                            (auto: preset {adv.autoApplied.preset ? 'yes' : 'no'}, validation {adv.autoApplied.validation ? 'yes' : 'no'})
                          </span>
                        {/if}
                      </dd>
                    </div>
                  </dl>
                  {#if adv.mode === 'auto'}
                    <p class="mt-2 text-[0.7rem] leading-relaxed text-sophia-dark-dim">
                      In auto mode, “preset yes/no” and “validation yes/no” mean whether the advisor <em>overrode</em> heuristics for that run. If both
                      are no, the advisor matched the baseline—preset and validation above still reflect the applied run.
                    </p>
                  {/if}
                  {#if adv.suggestion}
                    <div class="mt-3 rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/40 p-3">
                      <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Model suggestion</p>
                      <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">{adv.suggestion.rationale}</p>
                      {#if adv.suggestion.riskSignals?.length}
                        <p class="mt-2 font-mono text-[0.65rem] text-sophia-dark-amber">Risks: {adv.suggestion.riskSignals.join('; ')}</p>
                      {/if}
                    </div>
                  {/if}
                  {#if adv.mode === 'shadow' && adv.suggestion}
                    <p class="mt-3 font-mono text-xs text-sophia-dark-dim">
                      Shadow diff — preset vs heuristic: {adv.shadowDiff.presetChangedVsHeuristic ? 'yes' : 'no'}; validation vs heuristic: {adv.shadowDiff.validationChangedVsHeuristic ? 'yes' : 'no'}
                    </p>
                  {/if}
                </div>
              {/if}

              <div class="rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/30 p-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Offline coach</p>
                    <p class="mt-1 text-xs text-sophia-dark-muted">
                      Uses aggregated signals from recent
                      <span class="font-mono">ingestion_run_reports</span>, then suggests UI variables you can apply on this page and engineering items that need code or infra.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={runInProgress() || coachBusy}
                    onclick={() => void runOfflineCoach()}
                    class="shrink-0 rounded border border-sophia-dark-blue/45 bg-sophia-dark-blue/14 px-5 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-blue hover:bg-sophia-dark-blue/20 disabled:opacity-50"
                  >
                    {coachBusy ? 'Running…' : 'Run coach'}
                  </button>
                </div>
                {#if coachError}<p class="mt-2 font-mono text-xs text-sophia-dark-copper">{coachError}</p>{/if}
                {#if coachAggregatedSignals}
                  <div class="mt-4 rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/35 p-3">
                    <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Signals from sampled reports</p>
                    <dl class="mt-2 grid gap-2 font-mono text-xs text-sophia-dark-muted sm:grid-cols-2">
                      <div><dt class="text-sophia-dark-dim">Reports</dt><dd>{coachAggregatedSignals.reportsInSample}</dd></div>
                      <div><dt class="text-sophia-dark-dim">Total issue rows</dt><dd>{coachAggregatedSignals.totalIssues}</dd></div>
                      <div><dt class="text-sophia-dark-dim">Routing degraded (sum)</dt><dd>{coachAggregatedSignals.sumRoutingDegradedCalls}</dd></div>
                      <div><dt class="text-sophia-dark-dim">Fallback steps used (sum)</dt><dd>{coachAggregatedSignals.sumRoutingFallbackUsed}</dd></div>
                      <div class="sm:col-span-2"><dt class="text-sophia-dark-dim">Runs with terminal error</dt><dd>{coachAggregatedSignals.runsWithTerminalError}</dd></div>
                    </dl>
                    {#if Object.keys(coachAggregatedSignals.issueKindTotals).length > 0}
                      <p class="mt-2 font-mono text-[0.65rem] text-sophia-dark-dim">Issue kinds (merged)</p>
                      <ul class="mt-1 list-none space-y-1 p-0 font-mono text-[0.7rem] text-sophia-dark-muted">
                        {#each Object.entries(coachAggregatedSignals.issueKindTotals).sort((a, b) => b[1] - a[1]) as [kind, cnt]}
                          <li><span class="text-sophia-dark-text">{kind}</span> — {cnt}</li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/if}
                {#if coachResult}
                  <div class="mt-4 space-y-3 border-t border-sophia-dark-border/50 pt-4">
                    <p class="text-xs leading-relaxed text-sophia-dark-muted">{coachResult.executiveSummary}</p>
                    <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Priority: {coachResult.priority}</p>
                    <ul class="list-disc space-y-2 pl-5 text-xs text-sophia-dark-muted">
                      {#each coachResult.recommendations as line}
                        <li>{line}</li>
                      {/each}
                    </ul>
                    {#if coachUiTweaks.length > 0}
                      <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Tweak on this page</p>
                      <p class="mt-1 text-xs text-sophia-dark-muted">
                        Maps to pipeline controls below (preset, validation, or Advanced batch overrides). Use Apply to set the value; review before starting the next run.
                      </p>
                      <ul class="mt-2 list-none space-y-3 p-0">
                        {#each coachUiTweaks as tw}
                          <li class="rounded border border-sophia-dark-border/55 bg-sophia-dark-bg/30 p-3">
                            <div class="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p class="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-sophia-dark-dim">
                                  {coachPipelineVariableLabel(tw)}
                                </p>
                                <p class="mt-1 font-mono text-xs text-sophia-dark-text">{tw.label}</p>
                                <p class="mt-1 text-xs leading-relaxed text-sophia-dark-muted">{tw.detail}</p>
                                {#if tw.evidenceIssueKinds?.length}
                                  <p class="mt-2 font-mono text-[0.65rem] text-sophia-dark-dim">
                                    Evidence kinds: {tw.evidenceIssueKinds.join(', ')}
                                  </p>
                                {/if}
                                <p class="mt-1 font-mono text-[0.65rem] text-sophia-dark-dim">Confidence: {tw.confidence.toFixed(2)} · {tw.scope}</p>
                              </div>
                              {#if tw.scope === 'ui_preset' || tw.scope === 'ui_validation' || tw.scope === 'batch_override'}
                                <button
                                  type="button"
                                  disabled={runInProgress()}
                                  onclick={() => applyCoachSettingTweak(tw)}
                                  class="shrink-0 rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-sage hover:bg-sophia-dark-sage/22 disabled:opacity-50"
                                >
                                  Apply
                                </button>
                              {/if}
                            </div>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    {#if coachRepoTweaks.length > 0}
                      <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Not in this UI (track externally)</p>
                      <p class="mt-1 text-xs text-sophia-dark-muted">
                        Restormel publish, env outside this form, or other steps — no Apply button here.
                      </p>
                      <ul class="mt-2 list-none space-y-3 p-0">
                        {#each coachRepoTweaks as tw}
                          <li class="rounded border border-sophia-dark-border/55 bg-sophia-dark-bg/30 p-3">
                            <p class="font-mono text-xs text-sophia-dark-text">{tw.label}</p>
                            <p class="mt-1 text-xs leading-relaxed text-sophia-dark-muted">{tw.detail}</p>
                            {#if tw.evidenceIssueKinds?.length}
                              <p class="mt-2 font-mono text-[0.65rem] text-sophia-dark-dim">
                                Evidence kinds: {tw.evidenceIssueKinds.join(', ')}
                              </p>
                            {/if}
                            <p class="mt-1 font-mono text-[0.65rem] text-sophia-dark-dim">Confidence: {tw.confidence.toFixed(2)}</p>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    {#if coachResult.codeChangeReports?.length}
                      <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Engineering / code follow-ups</p>
                      <p class="mt-1 text-xs text-sophia-dark-muted">
                        These need changes in the repo, prompts, or hosted config — not a single field on this screen.
                      </p>
                      <ul class="mt-2 list-none space-y-3 p-0">
                        {#each coachResult.codeChangeReports as rep}
                          <li class="rounded border border-sophia-dark-border/55 bg-sophia-dark-bg/30 p-3">
                            <div class="flex flex-wrap items-center gap-2">
                              <p class="font-mono text-xs text-sophia-dark-text">{rep.title}</p>
                              {#if rep.suggestedArea}
                                <span class="rounded border border-sophia-dark-border/80 px-2 py-0.5 font-mono text-[0.65rem] text-sophia-dark-muted">
                                  {CODE_CHANGE_AREA_LABELS[rep.suggestedArea] ?? rep.suggestedArea}
                                </span>
                              {/if}
                            </div>
                            <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">{rep.detail}</p>
                            {#if rep.evidenceIssueKinds?.length}
                              <p class="mt-2 font-mono text-[0.65rem] text-sophia-dark-dim">
                                Evidence kinds: {rep.evidenceIssueKinds.join(', ')}
                              </p>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    {#if coachResult.suggestedNextExperiments?.length}
                      <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Next experiments</p>
                      <ul class="list-disc space-y-1 pl-5 text-xs text-sophia-dark-muted">
                        {#each coachResult.suggestedNextExperiments as ex}
                          <li>{ex}</li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/if}
              </div>

              <div class="border-t border-sophia-dark-border/60 pt-6">
                <div class="pipeline-cost-sticky">
                  <div class="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Estimated total</p>
                      <p class="mt-1 font-mono text-2xl text-sophia-dark-amber">{formatUsd(estimatedIngestionTotalUsd())}</p>
                    </div>
                    {#if costEstimateHint()}
                      <p class="max-w-md font-mono text-xs text-sophia-dark-muted">{costEstimateHint()}</p>
                    {/if}
                  </div>
                </div>

                <div class="pipeline-rail mt-6">
                  {#each RESTORMEL_STAGES as row}
                    {@const costPill = pipelineCostPill(row)}
                    <button
                      type="button"
                      class="pipeline-node {activePipelineStageKey === row.key ? 'is-active' : ''} {row.key === 'ingestion_validation' && !runValidate ? 'pipeline-node--validation-off' : ''}"
                      onclick={() => selectPipelineStage(row.key)}
                    >
                      <span class="name">{row.label}</span>
                      <span class="pipeline-node-mid">
                        <span class="pill {costPill.pillClass}" title={costPill.text === 'conflict' ? 'Validation uses the same model as Extraction, Relations, or Grouping — pick another model' : undefined}>{costPill.text}</span>
                        <span class="pill cost">{formatUsd(estimatedPhaseCostUsd(row.key))}</span>
                      </span>
                    </button>
                  {/each}
                </div>
              </div>

              {#if pipelineNoticeList.length > 0}
                <div class="rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/35 p-3">
                  <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Pipeline notices</p>
                  <ul class="mt-2 list-none space-y-2 p-0 font-mono text-xs">
                    {#each pipelineNoticeList as n}
                      <li class={n.severity === 'bad' ? 'text-sophia-dark-copper' : 'text-sophia-dark-amber'}>{n.text}</li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if catalogNotice}<p class="font-mono text-xs text-sophia-dark-sage">{catalogNotice}</p>{/if}
              {#if catalogError}<p class="font-mono text-xs text-sophia-dark-copper">{catalogError}</p>{/if}

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/30 p-4">
                <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                  Project model index
                </p>
                <p class="mt-2 text-xs leading-relaxed text-sophia-dark-muted">
                  Stage pickers use models from the Restormel project index merged with this catalog. Add, remove, and
                  sync bindings in
                  <a
                    href="/admin/model-availability"
                    class="text-sophia-dark-text underline decoration-sophia-dark-border underline-offset-2 hover:decoration-sophia-dark-text"
                    >Model availability</a
                  >
                  (save updates Firestore and replaces the Keys project allowlist). Per-binding POST/PATCH/DELETE on this
                  page is no longer offered here to avoid drifting from that policy.
                </p>
              </div>

              <div class="border-t border-sophia-dark-border/60 pt-6">
                {#key activePipelineStageKey}
                  {@const row = activePipelineStage}
                  <article class="stage-card" id="pipeline-stage-detail">
                    <div>
                      <h3 class="font-mono text-lg text-sophia-dark-text">{row.label}</h3>
                      <p class="text-sm text-sophia-dark-muted">{STAGE_ONE_LINE[row.key] ?? row.description}</p>
                    </div>

                    {#if row.key === 'ingestion_validation'}
                      <div class="mt-3 rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/35 p-3">
                        <label class="flex cursor-pointer items-start gap-2 font-mono text-sm text-sophia-dark-muted">
                          <input
                            type="checkbox"
                            checked={runValidate}
                            disabled={runInProgress()}
                            onchange={(e) => {
                              runValidate = (e.currentTarget as HTMLInputElement).checked;
                              if (runValidate) ensureValidationModelIsIndependent();
                            }}
                            class="mt-0.5 rounded border-sophia-dark-border"
                          />
                          <span>
                            Run cross-model validation. Recommended: pick a validation model different from Extraction / Relations / Grouping to avoid self-review.
                          </span>
                        </label>
                      </div>
                    {/if}

                    <div
                      class="mt-3"
                      class:validation-stage-dimmed={row.key === 'ingestion_validation' && !runValidate}
                    >
                      <details class="rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-3">
                        <summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Learn more</summary>
                        <p class="mt-2 text-sm text-sophia-dark-muted">{stageAdvice(row).body}</p>
                      </details>

                      {#if row.key === 'ingestion_fetch'}
                        <p class="mt-3 font-mono text-xs leading-relaxed text-sophia-dark-muted">
                          This step uses <span class="text-sophia-dark-text">HTTP fetch and HTML/text normalization</span> only (see
                          <code class="text-sophia-dark-dim">scripts/fetch-source.ts</code>). It does not call a Restormel-routed LLM, so there is no model picker here. Source volume below is for sizing; dollar estimates apply to extraction and later stages.
                        </p>
                      {:else if row.key !== 'ingestion_validation' || runValidate}
                        <div class="mt-3">
                          <label class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim" for="model-select-{row.key}">Model</label>
                          <select
                            id="model-select-{row.key}"
                            value={stageModelIds[row.key]}
                            onchange={(e) => onStageModelSelect(row, (e.currentTarget as HTMLSelectElement).value)}
                            disabled={runInProgress() || providersForStage(row).length === 0 || (row.key === 'ingestion_validation' && !runValidate)}
                            class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                          >
                            {#if providersForStage(row).length === 0}
                              <option value="">No providers available</option>
                            {:else}
                              {#each providersForStage(row) as p}
                                <optgroup label={p} title={providerHint(p)}>
                                  {#each modelsForStageProvider(row, p) as m}
                                    <option value={stableModelId(m)} title={providerHint(p)}>
                                      {modelOptionLabel(row, m)} — {p}
                                    </option>
                                  {/each}
                                </optgroup>
                              {/each}
                            {/if}
                          </select>
                        </div>

                        <div class="mt-3">
                          <label class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim" for="fallback-model-select-{row.key}">Fallback model</label>
                          <select
                            id="fallback-model-select-{row.key}"
                            value={stageFallbackModelIds[row.key]}
                            onchange={(e) => onStageFallbackModelSelect(row, (e.currentTarget as HTMLSelectElement).value)}
                            disabled={runInProgress() || providersForStage(row).length === 0 || (row.key === 'ingestion_validation' && !runValidate)}
                            class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60"
                          >
                            <option value="">No fallback (primary only)</option>
                            {#if providersForStage(row).length === 0}
                              <option value="">No providers available</option>
                            {:else}
                              {#each providersForStage(row) as p}
                                <optgroup label={p} title={providerHint(p)}>
                                  {#each modelsForStageProvider(row, p) as m}
                                    <option value={stableModelId(m)} title={providerHint(p)}>
                                      {modelOptionLabel(row, m)} — {p}
                                    </option>
                                  {/each}
                                </optgroup>
                              {/each}
                            {/if}
                          </select>

                          {#if (stageFallbackModelIds[row.key]?.trim() ?? '') !== ''}
                            {#if stageFallbackModelIds[row.key] === stageModelIds[row.key]}
                              <p class="mt-1 text-xs text-sophia-dark-copper">Fallback equals primary; redundancy is lost.</p>
                            {/if}
                          {:else}
                            <p class="mt-1 text-xs text-sophia-dark-dim">This stage uses only the primary model step.</p>
                          {/if}
                        </div>
                      {:else}
                        <p class="mt-3 font-mono text-xs text-sophia-dark-dim">
                          Turn validation on above to choose a model for this stage.
                        </p>
                      {/if}

                    {#if sourcePreScanResult && preScanEstimateForRow(row.key)}
                      {@const stageEntry = selectedCatalogEntryForRow(row.key)}
                      {@const est = preScanEstimateForRow(row.key)}
                      <div class="mt-3 space-y-2">
                        <details class="rounded border border-sophia-dark-border bg-sophia-dark-bg/25 p-3">
                          <summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Input tokens</summary>
                          <p class="mt-2 text-xs text-sophia-dark-muted">
                            <span class="text-sophia-dark-text">{formatInt(est?.inputTokens)}</span>
                            {#if est?.inputTokens != null}
                              <span class="text-sophia-dark-dim"> ({formatPercentOfReferenceTokens(est.inputTokens)})</span>
                            {/if}
                          </p>
                          {#if stageEntry && est?.inputTokens != null}
                            <p class="mt-1 font-mono text-[0.65rem] text-sophia-dark-sage">
                              {formatTokensVsSelectedModelWindow(est.inputTokens, stageEntry)}
                            </p>
                          {:else if est?.inputTokens != null && row.key !== 'ingestion_fetch'}
                            <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">Select a model above to compare input size to its context window.</p>
                          {:else if est?.inputTokens != null && row.key === 'ingestion_fetch'}
                            <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">Token-equivalent volume for normalized source text; not billed as LLM input.</p>
                          {/if}
                        </details>
                        <details class="rounded border border-sophia-dark-border bg-sophia-dark-bg/25 p-3">
                          <summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Output tokens</summary>
                          <p class="mt-2 text-xs text-sophia-dark-muted">
                            <span class="text-sophia-dark-text">{formatInt(est?.outputTokens)}</span>
                            {#if est?.outputTokens != null}
                              <span class="text-sophia-dark-dim"> ({formatPercentOfReferenceTokens(est.outputTokens)})</span>
                            {/if}
                          </p>
                          {#if stageEntry && est?.outputTokens != null}
                            <p class="mt-1 font-mono text-[0.65rem] text-sophia-dark-sage">
                              {formatTokensVsSelectedModelWindow(est.outputTokens, stageEntry)}
                            </p>
                          {:else if est?.outputTokens != null && row.key !== 'ingestion_fetch'}
                            <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">Select a model above to compare output estimate to its context window.</p>
                          {/if}
                        </details>
                        <details class="rounded border border-sophia-dark-border bg-sophia-dark-bg/25 p-3">
                          <summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Total tokens</summary>
                          <p class="mt-2 text-xs text-sophia-dark-muted">
                            <span class="text-sophia-dark-text">{formatInt(est?.totalTokens)}</span>
                            {#if est?.totalTokens != null}
                              <span class="text-sophia-dark-dim"> ({formatPercentOfReferenceTokens(est.totalTokens)})</span>
                            {/if}
                          </p>
                          {#if stageEntry && est?.totalTokens != null}
                            <p class="mt-1 font-mono text-[0.65rem] text-sophia-dark-sage">
                              {formatTokensVsSelectedModelWindow(est.totalTokens, stageEntry)}
                            </p>
                            <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">
                              Input + output for one stage call vs the model’s total context (providers may reserve part of the window for tools or cap output separately).
                            </p>
                          {:else if est?.totalTokens != null}
                            <p class="mt-1 text-[0.65rem] text-sophia-dark-dim">Select a model above to compare total request size to its context window.</p>
                          {/if}
                        </details>
                        <details class="rounded border border-sophia-dark-border bg-sophia-dark-bg/25 p-3">
                          <summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Latency profile</summary>
                          <p class="mt-2 text-xs text-sophia-dark-muted">
                            <span class="text-sophia-dark-text">{preScanEstimateForRow(row.key)?.latency ?? '—'}</span>
                          </p>
                        </details>
                      </div>
                    {/if}
                    </div>
                  </article>
                {/key}
              </div>
            </div>
          </section>
        {/if}

        {#if activeStep === 'cost'}
          <section class="step-pane">
            <div class="space-y-4">
              <div>
                <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Cost review</h2>
                <p class="mt-2 max-w-xl font-mono text-xs leading-relaxed text-sophia-dark-muted">
                  Per-stage estimates and running totals are shown in the <strong class="text-sophia-dark-text">Cost ledger</strong> panel on the right.
                </p>
              </div>
              {#if costEstimateHint()}
                <p class="rounded border border-sophia-dark-amber/40 bg-sophia-dark-amber/10 p-3 font-mono text-sm text-sophia-dark-muted">{costEstimateHint()}</p>
              {/if}
              {#if !sourcePreScanResult}
                <p class="font-mono text-sm text-sophia-dark-muted">Run pre-scan on the Source step to populate the ledger.</p>
              {/if}

              {#if flowState === 'setup'}
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-4">
                  <p class="font-mono text-xs leading-relaxed text-sophia-dark-muted">
                    Figures shown are <strong class="text-sophia-dark-text">estimates</strong> from pre-scan token counts and catalog pricing. They do not include retries, partial failures, re-runs, rate-limit backoff, or model changes mid-run. Actual usage is billed through your Restormel Keys / provider project and may be higher or lower than these numbers.
                  </p>
                  <label class="mt-4 flex cursor-pointer items-start gap-3 font-mono text-sm text-sophia-dark-muted">
                    <input
                      type="checkbox"
                      bind:checked={costEstimateAcknowledged}
                      disabled={!sourcePreScanResult}
                      class="mt-0.5 rounded border-sophia-dark-border disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <span>
                      I understand that real costs may differ from these estimates and that usage may be charged to my Restormel Keys (or provider) account as configured for this project.
                    </span>
                  </label>
                </div>
              {/if}
            </div>
          </section>
        {/if}

        {#if activeStep === 'review'}
          <section class="step-pane">
            <div class="space-y-4">
              <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Run</h2>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/30 p-4">
                <div class="flex items-end justify-between gap-4">
                  <h3 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Run ingestion</h3>
                  <span class="font-mono text-xs text-sophia-dark-muted">{flowState === 'setup' ? 'Ready' : flowState === 'done' ? 'Complete' : flowState === 'error' ? 'Failed' : 'Monitoring'}</span>
                </div>
                {#if flowState === 'setup'}
                  <button type="button" onclick={() => void startIngestion()} class="mt-4 w-full rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20 disabled:opacity-50" disabled={starting || !ingestionModelsReady() || !costEstimateAcknowledged}>
                    {starting ? 'Starting…' : 'Run ingestion'}
                  </button>
                {:else}
                  <div class="mt-4 rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/60 px-4 py-3 font-mono text-xs text-sophia-dark-muted">Run ID: <span class="text-sophia-dark-text">{runId || '—'}</span></div>
                  {#if runId.trim() !== ''}
                    <div class="mt-3 rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-3">
                      <label class="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          class="mt-1 rounded border-sophia-dark-border"
                          checked={runExcludeFromBatchSuggest}
                          disabled={batchSuggestFlagBusy}
                          onchange={(e) =>
                            void patchExcludeFromBatchSuggest((e.currentTarget as HTMLInputElement).checked)}
                        />
                        <span class="min-w-0 text-sm leading-snug text-sophia-dark-muted">
                          <span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
                            >Batch URL helper</span
                          >
                          <span class="mt-1 block"
                            >Exclude this source URL from the durable jobs SEP catalog helper when “Exclude already ingested” is on (Neon <code class="text-sophia-dark-text">exclude_from_batch_suggest</code>).</span
                          >
                        </span>
                      </label>
                      {#if batchSuggestFlagError}
                        <p class="mt-2 font-mono text-xs text-sophia-dark-copper">{batchSuggestFlagError}</p>
                      {/if}
                    </div>
                  {/if}
                  <div class="mt-3 rounded border border-sophia-dark-border bg-sophia-dark-bg/40 p-3 font-mono text-xs text-sophia-dark-muted">
                    <p>Worker: <span class={runProcessAlive ? 'text-sophia-dark-sage' : 'text-sophia-dark-copper'}>{processHealthLabel()}</span></p>
                    <p class="mt-1">PID: <span class="text-sophia-dark-text">{runProcessId ?? '—'}</span></p>
                    <p class="mt-1">Last output: <span class="text-sophia-dark-text">{formatDateTime(runLastOutputAt)}</span>{#if runIdleForMs != null} <span class="text-sophia-dark-dim">(idle {formatDuration(runIdleForMs)})</span>{/if}</p>
                    <p class="mt-1">Started: <span class="text-sophia-dark-text">{formatDateTime(runProcessStartedAt)}</span></p>
                    <p>Current stage: <span class="text-sophia-dark-text">{runCurrentStage ? stageName(runCurrentStage) : '—'}</span></p>
                    <p class="mt-1">Current action: <span class="text-sophia-dark-text">{runCurrentAction || 'Waiting for next event…'}</span></p>
                    {#if runLastFailureStage}
                      <p class="mt-1">Last failure stage: <span class="text-sophia-dark-copper">{stageName(runLastFailureStage)}</span></p>
                    {/if}
                  </div>
                  {#if flowState === 'running' || flowState === 'awaiting_sync'}
                    <button
                      type="button"
                      onclick={() => void cancelIngestion()}
                      disabled={cancelling || syncing}
                      class="mt-4 w-full rounded border border-sophia-dark-copper/55 bg-sophia-dark-copper/10 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-copper hover:bg-sophia-dark-copper/16 disabled:opacity-50"
                    >
                      {cancelling ? 'Cancelling…' : 'Cancel ingestion'}
                    </button>
                  {/if}
                  {#if flowState === 'running' && !runProcessAlive}
                    <button
                      type="button"
                      onclick={() => void respawnStaleWorker()}
                      disabled={syncing}
                      class="mt-4 w-full rounded border border-sophia-dark-sage/50 bg-sophia-dark-sage/15 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/24 disabled:opacity-50"
                    >
                      {syncing ? 'Respawning…' : 'Respawn worker (deploy / lost process)'}
                    </button>
                    <p class="mt-2 font-mono text-[0.65rem] text-sophia-dark-muted">
                      Neon may still show this run as running while this revision has no child process. This starts
                      ingest.ts from checkpoints on <em>this</em> instance.
                    </p>
                  {/if}
                  {#if flowState === 'awaiting_sync'}
                    <button type="button" onclick={() => void syncToSurreal()} disabled={syncing} class="mt-4 rounded border border-sophia-dark-sage/55 bg-sophia-dark-sage/20 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/28 disabled:opacity-50">
                      {syncing ? 'Starting sync…' : 'Sync to SurrealDB'}
                    </button>
                  {/if}
                  {#if runError && runResumable}
                    <button type="button" onclick={() => void resumeFromFailure()} disabled={syncing} class="mt-4 rounded border border-sophia-dark-amber/55 bg-sophia-dark-amber/12 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-amber hover:bg-sophia-dark-amber/18 disabled:opacity-50">
                      {syncing ? 'Resuming…' : 'Resume from failure'}
                    </button>
                  {/if}
                  {#if runError}<p class="mt-3 font-mono text-xs text-sophia-dark-copper">{runError}</p>{/if}
                  {#if flowState === 'done' && completionMessage}<p class="mt-3 font-mono text-sm text-sophia-dark-text">{completionMessage}</p>{/if}
                {/if}
                {#if ingestTimingSummary}
                  <div class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-3">
                    <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Throughput telemetry</p>
                    <p class="mt-1 text-xs text-sophia-dark-muted">
                      Parsed from the worker’s latest <code class="text-sophia-dark-text">[INGEST_TIMING]</code> line. The same object is merged into Firestore{' '}
                      <code class="text-sophia-dark-text">timingTelemetry</code> on the run report.
                    </p>
                    <pre
                      class="mt-3 max-h-48 overflow-auto rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/60 p-3 font-mono text-[0.65rem] leading-relaxed text-sophia-dark-text"
                    >{JSON.stringify(ingestTimingSummary, null, 2)}</pre>
                  </div>
                {/if}
                {#if runCapturedIssues.length > 0}
                  <div class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-3">
                    <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Captured issues</p>
                    <p class="mt-1 text-xs text-sophia-dark-muted">
                      Parsed from worker output in real time. The same report is merged into Firestore (<code class="text-sophia-dark-text">ingestion_run_reports</code>) when the run pauses for sync, finishes, fails, or is cancelled — use it for tuning prompts, routing, and budgets.
                    </p>
                    <ul class="mt-3 max-h-56 list-none space-y-2 overflow-y-auto p-0">
                      {#each runCapturedIssues as iss}
                        <li class="rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/40 px-3 py-2 font-mono text-[0.65rem] leading-snug">
                          <span class="text-sophia-dark-text">{iss.kind.replace(/_/g, ' ')}</span>
                          <span class="text-sophia-dark-dim"> · {iss.severity}</span>
                          {#if iss.stageHint}<span class="text-sophia-dark-dim"> · {iss.stageHint}</span>{/if}
                          <span class="mt-0.5 block text-sophia-dark-muted">{iss.message}</span>
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {#if executionNotice}
                  <p class="mt-3 rounded border border-sophia-dark-amber/40 bg-sophia-dark-amber/10 p-2 font-mono text-xs text-sophia-dark-muted">{executionNotice}</p>
                {/if}
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/30 p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Pipeline activity</h3>
                    <p class="mt-1 max-w-xl text-xs text-sophia-dark-muted">
                      Live timeline of stages and actions. Switch to raw output when you need exact lines for support.
                    </p>
                  </div>
                  <label class="flex cursor-pointer select-none items-center gap-2 rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/40 px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim hover:border-sophia-dark-border">
                    <input type="checkbox" class="rounded border-sophia-dark-border" bind:checked={showRawLog} />
                    Raw
                  </label>
                </div>

                {#if showRawLog}
                  <div
                    class="mt-3 max-h-[min(520px,55vh)] overflow-auto rounded border border-sophia-dark-border bg-sophia-dark-bg/65 p-3 font-mono text-xs leading-relaxed text-sophia-dark-text"
                  >
                    {#if runLog.length === 0}
                      <p class="text-sophia-dark-muted">No logs yet.</p>
                    {:else}
                      {#each runLog as line}
                        <p class="whitespace-pre-wrap break-words">{line}</p>
                      {/each}
                    {/if}
                  </div>
                {:else}
                  <div
                    class="log-feed-scroller mt-3 max-h-[min(520px,55vh)] overflow-auto rounded border border-sophia-dark-border bg-sophia-dark-bg/40"
                  >
                    {#if runLog.length === 0}
                      <p class="p-4 font-mono text-sm text-sophia-dark-muted">No activity yet. Start a run to stream events here.</p>
                    {:else}
                      <ol class="log-feed" aria-label="Pipeline activity timeline">
                        {#each logFeedItems as item}
                          <li
                            class="log-feed-row log-feed-row--{item.parsed.level}"
                            class:log-feed-row--milestone={item.parsed.kind === 'milestone'}
                            class:log-feed-row--stage={item.parsed.kind === 'stage'}
                          >
                            <div class="log-feed-rail" aria-hidden="true">
                              <span class="log-feed-dot"></span>
                            </div>
                            <div class="log-feed-content">
                              {#if item.parsed.badge}
                                <span class="log-feed-badge">{item.parsed.badge}</span>
                              {/if}
                              <p class="log-feed-body" title={item.line}>{item.parsed.body}</p>
                            </div>
                          </li>
                        {/each}
                      </ol>
                    {/if}
                  </div>
                {/if}
              </div>

              {#if flowState !== 'setup'}
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/30 p-4">
                  <h3 class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Pipeline progress</h3>
                  <p class="mt-2 text-xs text-sophia-dark-muted">
                    One active stage at a time: completed (✓), running (●), not started (○), skipped (—), failed (!).
                  </p>
                  <ol class="run-stage-path mt-8" aria-label="Run stage progression">
                    {#each stages as stage}
                      <li
                        class="run-stage-node run-stage-node--{stage.status}"
                        title="{stage.status === 'done'
                          ? 'Completed'
                          : stage.status === 'running'
                            ? 'Running now'
                            : stage.status === 'error'
                              ? 'Failed'
                              : stage.status === 'skipped'
                                ? 'Skipped'
                                : 'Not started yet'}"
                      >
                        <span class="run-stage-label">{stage.label}</span>
                        <span class="run-stage-glyph" aria-hidden="true">
                          {#if stage.status === 'done'}✓{:else if stage.status === 'running'}●{:else if stage.status === 'error'}!{:else if stage.status === 'skipped'}—{:else}○{/if}
                        </span>
                      </li>
                    {/each}
                  </ol>
                  {#key runCurrentStage ?? 'waiting'}
                    {@const theory = pipelineStageTheory(runCurrentStage)}
                    <div class="mt-8 rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/25 p-4">
                      <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">
                        {runCurrentStage ? 'At this stage' : 'While you wait'}
                      </p>
                      <h4 class="mt-2 font-serif text-lg leading-snug text-sophia-dark-text">{theory.headline}</h4>
                      <p class="mt-3 text-sm leading-relaxed text-sophia-dark-muted">{theory.summary}</p>
                      <details class="pipeline-theory-details group mt-4 rounded border border-sophia-dark-border/60 bg-sophia-dark-bg/30 p-3">
                        <summary
                          class="cursor-pointer list-none font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim marker:content-none [&::-webkit-details-marker]:hidden"
                        >
                          Read more — process, technology, research notes
                        </summary>
                        <div class="mt-4 space-y-3 border-t border-sophia-dark-border/50 pt-4 text-sm leading-relaxed text-sophia-dark-muted">
                          {#each theory.readMore as para}
                            <p>{para}</p>
                          {/each}
                        </div>
                      </details>
                    </div>
                  {/key}
                  <p class="mt-6 text-xs text-sophia-dark-muted">
                    Current focus:
                    <span class="text-sophia-dark-text">{runCurrentStage ? stageName(runCurrentStage) : 'Waiting for next stage'}</span>
                    {#if runCurrentAction}
                      <span class="text-sophia-dark-dim"> — {runCurrentAction}</span>
                    {/if}
                  </p>
                </div>

              {/if}
            </div>
          </section>
        {/if}
      </div>
    </div>

    {#if activeStep !== 'pipeline'}
      <aside class="sticky-cost" aria-label="Cost ledger">
        <div class="expand-card">
          <div class="expand-card-inner expand-wizard">
            <p class="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Cost ledger</p>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/45 p-3">
                <p class="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Estimated total</p>
                <p class="mt-1 font-mono text-xl text-sophia-dark-amber">{formatUsd(runCostLedger.estimatedTotalUsd)}</p>
              </div>
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/45 p-3">
                <p class="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Running total</p>
                <p class="mt-1 font-mono text-xl text-sophia-dark-sage">{formatUsd(runCostLedger.runningTotalUsd)}</p>
              </div>
            </div>
            {#if costEstimateHint()}
              <p class="mt-3 text-xs text-sophia-dark-muted">{costEstimateHint()}</p>
            {/if}
            <div class="mt-3 overflow-auto rounded border border-sophia-dark-border">
              <table class="min-w-full text-left font-mono text-xs text-sophia-dark-muted">
                <thead class="border-b border-sophia-dark-border bg-sophia-dark-bg/60 text-sophia-dark-dim">
                  <tr>
                    <th class="px-3 py-2">Stage</th>
                    <th class="px-3 py-2 text-right">Est.</th>
                    <th class="px-3 py-2 text-right">Running</th>
                  </tr>
                </thead>
                <tbody>
                  {#each runCostLedger.rows as row}
                    {@const activeCostStageKey = runStageToCostKey(runCurrentStage)}
                    {@const rowTone = row.key === activeCostStageKey ? 'active' : typeof row.runningUsd === 'number' ? 'done' : 'idle'}
                    <tr class="ledger-row ledger-row--{rowTone} border-b border-sophia-dark-border/60 last:border-b-0">
                      <td class="px-3 py-2 text-sophia-dark-text">{row.label}</td>
                      <td class="px-3 py-2 text-right">{formatUsd(row.estimatedUsd)}</td>
                      <td class="px-3 py-2 text-right {typeof row.runningUsd === 'number' ? 'text-sophia-dark-sage' : 'text-sophia-dark-dim'}">
                        {formatUsd(row.runningUsd)}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </aside>
    {/if}
  </section>
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
  .wizard-layout {
    margin-top: 24px;
    display: grid;
    gap: 20px;
  }
  .expand-card {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
  }
  .expand-card-inner {
    padding: 20px;
  }
  .expand-wizard {
    font-family: var(--font-ui);
  }
  .step-tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }
  .step-tabs button {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted);
    padding: 10px;
    text-align: left;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition: all 0.2s ease;
  }
  .step-tabs button:hover { background: var(--color-surface-raised); }
  .step-tabs button.active {
    border-color: var(--color-blue-border);
    background: var(--color-blue-bg);
    color: var(--color-text);
  }
  .step-tabs button.done::after { content: ' ✓'; color: var(--color-sage); }
  .step-pane { animation: fadein 0.2s ease; }
  .pipeline-cost-sticky {
    position: sticky;
    top: 0;
    z-index: 3;
    margin: 0 -4px;
    padding: 12px 12px 16px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    backdrop-filter: blur(8px);
  }
  .pipeline-rail {
    display: grid;
    grid-template-columns: repeat(6, minmax(120px, 1fr));
    gap: 6px;
    overflow: auto;
    padding-bottom: 4px;
  }
  .pipeline-node {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface-raised);
    color: var(--color-text);
    padding: 8px 10px;
    text-align: left;
    transition: all 0.2s ease;
  }
  .pipeline-node:hover { border-color: var(--color-blue-border); }
  .pipeline-node.is-active { border-color: var(--color-blue-border); background: var(--color-blue-bg); }
  .pipeline-node--validation-off {
    opacity: 0.5;
  }
  .validation-stage-dimmed {
    opacity: 0.45;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }
  .pipeline-node .name {
    display: block;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    line-height: 1.25;
  }
  .pipeline-node-mid {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .pipeline-node-mid .pill {
    display: block;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
  }
  #pipeline-stage-detail {
    scroll-margin-top: 96px;
  }
  .pill {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 3px 8px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .pill.cx-high { color: var(--color-coral); border-color: var(--color-coral-border); background: var(--color-coral-bg); }
  .pill.cx-medium { color: var(--color-amber); border-color: var(--color-amber-border); background: var(--color-amber-bg); }
  .pill.cx-low { color: var(--color-sage); border-color: var(--color-sage-border); background: var(--color-sage-bg); }
  .pill.latency { color: var(--color-muted); }
  .pill.cost { color: var(--color-amber); border-color: var(--color-amber-border); background: var(--color-amber-bg); }
  .pill.good { color: var(--color-sage); border-color: var(--color-sage-border); background: var(--color-sage-bg); }
  .pill.bad { color: var(--color-coral); border-color: var(--color-coral-border); background: var(--color-coral-bg); }
  .stage-card {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface-raised);
    padding: 16px;
  }
  .sticky-cost { position: sticky; top: 72px; align-self: start; }
  .run-stage-path {
    list-style: none;
    /* Do not use margin: 0 — it overrides Tailwind margin-top on this element */
    margin-left: 0;
    margin-right: 0;
    margin-bottom: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(7, minmax(96px, 1fr));
    gap: 8px;
    overflow: auto;
  }
  .run-stage-node {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface-raised);
    padding: 10px 8px;
    text-align: center;
    min-width: 96px;
    transition:
      border-color 180ms ease,
      background-color 180ms ease,
      transform 180ms ease,
      box-shadow 180ms ease;
  }
  .run-stage-label {
    display: block;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
    line-height: 1.2;
  }
  .run-stage-glyph {
    display: block;
    margin-top: 6px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
    transition: color 180ms ease;
  }
  .run-stage-node--done {
    border-color: var(--color-sage-border);
    background: var(--color-sage-bg);
  }
  .run-stage-node--done .run-stage-glyph { color: var(--color-sage); }
  .run-stage-node--running {
    border-color: var(--color-blue-border);
    background: var(--color-blue-bg);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-blue-border) 35%, transparent);
    transform: translateY(-1px);
  }
  .run-stage-node--running .run-stage-glyph { color: var(--color-blue); }
  .run-stage-node--error {
    border-color: var(--color-coral-border);
    background: var(--color-coral-bg);
  }
  .run-stage-node--error .run-stage-glyph { color: var(--color-coral); }
  .run-stage-node--skipped {
    opacity: 0.7;
  }
  .ledger-row {
    transition: background-color 180ms ease;
  }
  .ledger-row--active {
    background: color-mix(in srgb, var(--color-blue-bg) 72%, transparent);
  }
  .ledger-row--done {
    background: color-mix(in srgb, var(--color-sage-bg) 40%, transparent);
  }
  @media (min-width: 1160px) {
    .wizard-layout { grid-template-columns: minmax(0, 1fr) 320px; }
  }
  @media (max-width: 900px) {
    .step-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sticky-cost { position: static; }
  }
  @keyframes fadein { from { opacity: 0; transform: translateX(-8px);} to { opacity: 1; transform: translateX(0);} }

  .log-feed-scroller {
    scrollbar-gutter: stable;
  }
  .log-feed {
    list-style: none;
    margin: 0;
    padding: 12px 14px 16px;
  }
  .log-feed-row {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr);
    gap: 12px;
    align-items: flex-start;
    padding: 8px 0;
    position: relative;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
  }
  .log-feed-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .log-feed-rail {
    position: relative;
    width: 14px;
    min-height: 100%;
    display: flex;
    justify-content: center;
    padding-top: 4px;
  }
  .log-feed-rail::before {
    content: '';
    position: absolute;
    top: 10px;
    bottom: -10px;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    background: color-mix(in srgb, var(--color-border) 70%, transparent);
  }
  .log-feed-row:last-child .log-feed-rail::before {
    display: none;
  }
  .log-feed-dot {
    position: relative;
    z-index: 1;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--color-blue);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-blue-bg) 90%, transparent);
  }
  .log-feed-row--success .log-feed-dot {
    background: var(--color-sage);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-sage-bg) 90%, transparent);
  }
  .log-feed-row--warn .log-feed-dot {
    background: var(--color-amber);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-amber-bg) 90%, transparent);
  }
  .log-feed-row--error .log-feed-dot {
    background: var(--color-coral);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-coral-bg) 90%, transparent);
  }
  .log-feed-row--muted .log-feed-dot {
    background: var(--color-dim);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-surface) 90%, transparent);
  }
  .log-feed-content {
    min-width: 0;
  }
  .log-feed-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    padding: 2px 8px;
    margin-bottom: 4px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted);
    background: color-mix(in srgb, var(--color-surface-raised) 88%, transparent);
  }
  .log-feed-row--warn .log-feed-badge {
    color: var(--color-amber);
    border-color: var(--color-amber-border);
    background: var(--color-amber-bg);
  }
  .log-feed-row--error .log-feed-badge {
    color: var(--color-coral);
    border-color: var(--color-coral-border);
    background: var(--color-coral-bg);
  }
  .log-feed-row--success .log-feed-badge {
    color: var(--color-sage);
    border-color: var(--color-sage-border);
    background: var(--color-sage-bg);
  }
  .log-feed-body {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--color-text);
    word-break: break-word;
  }
  .log-feed-row--muted .log-feed-body {
    color: var(--color-muted);
    font-size: var(--text-meta);
  }
  .log-feed-row--milestone .log-feed-body,
  .log-feed-row--stage .log-feed-body {
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .log-feed-row--milestone .log-feed-rail::before,
  .log-feed-row--stage .log-feed-rail::before {
    background: color-mix(in srgb, var(--color-blue) 35%, var(--color-border));
  }
  .pipeline-theory-details summary:focus-visible {
    outline: 2px solid var(--color-blue-border);
    outline-offset: 3px;
    border-radius: 4px;
  }
  .pipeline-theory-details summary::after {
    content: ' ▸';
    margin-left: 6px;
    color: var(--color-muted);
    font-size: 0.85em;
  }
  .pipeline-theory-details[open] summary::after {
    content: ' ▾';
  }
</style>
