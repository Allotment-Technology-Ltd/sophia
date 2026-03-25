<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getIdToken } from '$lib/firebase';
  import { isEmbeddingModelEntry } from '$lib/ingestionModelCatalogMerge';
  import { INGESTION_SOURCE_MODEL_HINTS } from '$lib/ingestionModelCatalog';
  import { entryMeetsPresetStageMinimum } from '$lib/ingestionPipelineModelRequirements';
  import { resolveRouteForStage } from '$lib/utils/ingestionRouting';

  type StageStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';
  type FlowState = 'setup' | 'running' | 'awaiting_sync' | 'done' | 'error';
  type PipelinePreset = 'budget' | 'balanced' | 'complexity';

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
    { value: 'journal_article', label: 'Academic paper / journal article' },
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
  /** Server-reported error line after a run ends in error/cancel; Source step shows next steps. */
  let sourceRunEndedDetail = $state<string | null>(null);
  let syncing = $state(false);
  let runId = $state('');
  let runError = $state('');
  let urlError = $state('');
  let runLog = $state<string[]>([]);
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
  let pollingInterval: ReturnType<typeof setInterval> | null = null;

  let routingBusy = $state(false);
  let routingMessage = $state('');
  let routingError = $state('');
  let routes = $state<AdminRouteRecord[]>([]);
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
  let coachResult = $state<{
    executiveSummary: string;
    recommendations: string[];
    priority: string;
    suggestedNextExperiments?: string[];
  } | null>(null);
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
    const current = getCatalogEntryByStableId(stageModelIds[row.key] ?? '');
    if (current && !validationModelConflicts(current)) return;

    const nonConflicting = list.filter((e) => !validationModelConflicts(e));
    if (nonConflicting.length === 0) return;

    const presetForFloor = selectedPreset ?? 'balanced';
    const pick =
      nonConflicting.find(
        (e) => isStageRecommendedModel(row, e) && isStageMinimumViableModel(row, e, presetForFloor)
      ) ??
      nonConflicting.find((e) => isStageMinimumViableModel(row, e, presetForFloor)) ??
      nonConflicting[0];

    stageModelIds = { ...stageModelIds, [row.key]: stableModelId(pick) };
    stageProviders = { ...stageProviders, [row.key]: pick.provider };
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
      case 'journal_article':
        return 'journal_article';
      case 'iep_entry':
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

  /** Preset-aware floors: budget / balanced / complexity (see `ingestionPipelineModelRequirements.ts`). */
  function isStageMinimumViableModel(
    row: (typeof RESTORMEL_STAGES)[number],
    entry: CatalogEntry,
    preset: PipelinePreset = 'balanced'
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

    const hints = INGESTION_SOURCE_MODEL_HINTS[sourceTypeForHints()];
    const hintedLabel =
      preset === 'budget' ? hints.budget : preset === 'complexity' ? hints.quality : hints.balanced;
    const hinted = parseHintLabel(hintedLabel);
    const sourceTokens = sourcePreScanResult?.preScan?.approxContentTokens ?? 0;
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
      if (preset === 'budget') {
        score =
          sourceBoost + costSignal * 1.4 + speedSignal + rateFriendly + (row.embed ? 0.5 : 0) - qualitySignal * 0.35;
      } else if (preset === 'balanced') {
        score = sourceBoost + recommendationBoost + speedSignal * 0.7 + qualitySignal * 0.9 + rateFriendly + (2 - Math.abs(cost - 1.2));
      } else {
        score =
          sourceBoost + recommendationBoost * 1.2 + qualitySignal * 1.8 + rateFriendly * 0.4 + Math.min(cost, 8) * 0.25 - speedSignal * 0.2;
      }

      // Hardening from prior ingestion runs:
      // - very heavy reasoning models are fragile under high token pressure/rate limits
      // - JSON repair should prioritize deterministic/faster options
      // - embedding on large sources should prefer throughput-friendly variants
      if ((heavyGroupingStage || heavyValidationStage || veryLargeSource) && heavyweightReasoner) {
        score -= preset === 'complexity' ? 0.6 : 2.2;
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

  function applyPipelinePreset(preset: PipelinePreset): void {
    if (runInProgress()) return;
    const nextModelIds = { ...stageModelIds };
    const nextProviders = { ...stageProviders };
    const missingMinimumStages: string[] = [];

    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') {
        nextModelIds[row.key] = '';
        nextProviders[row.key] = '';
        continue;
      }
      if (row.key === 'ingestion_validation' && !runValidate) {
        nextModelIds[row.key] = '';
        nextProviders[row.key] = '';
        continue;
      }
      const selected = choosePresetModelForStage(row, preset, nextModelIds);
      if (!selected) {
        missingMinimumStages.push(row.label);
        continue;
      }
      nextProviders[row.key] = selected.provider;
      nextModelIds[row.key] = stableModelId(selected);
    }

    stageProviders = nextProviders;
    stageModelIds = nextModelIds;
    ensureValidationModelIsIndependent();
    selectedPreset = preset;
    const sourceLabel = SOURCE_TYPES.find((option) => option.value === sourceType)?.label ?? sourceType;
    const presetLabel = preset === 'budget' ? 'Budget' : preset === 'complexity' ? 'Complexity' : 'Balanced';
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
      /(opus|sonnet|gpt-4|gpt-5|gpt-4o|o1|o3|gemini.*pro|grok-[23]|deepseek-r1|mistral-large|command-r\+|llama.*70b|qwen.*72b)/i.test(
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
      return;
    }
    const next: Record<string, string> = {};
    const nextProviders: Record<string, string> = {};
    for (const row of RESTORMEL_STAGES) {
      if (row.key === 'ingestion_fetch') {
        next[row.key] = '';
        nextProviders[row.key] = '';
        continue;
      }
      const list = catalogEntries.filter((e) =>
        row.embed ? isEmbeddingModelEntry(e) : !isEmbeddingModelEntry(e)
      );
      if (row.key === 'ingestion_validation') {
        const firstNonConflict =
          list.find((e) => !validationModelConflictsWithMap(e, next)) ?? list[0];
        next[row.key] = firstNonConflict ? stableModelId(firstNonConflict) : '';
        nextProviders[row.key] = firstNonConflict?.provider ?? '';
      } else {
        const first = list[0];
        next[row.key] = first ? stableModelId(first) : '';
        nextProviders[row.key] = first?.provider ?? '';
      }
    }
    stageModelIds = next;
    stageProviders = nextProviders;
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
      status: stage.key === 'validate' ? (runValidate ? 'idle' : 'skipped') : 'idle'
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
      throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`);
    }
    return body;
  }

  async function loadRoutingContext(): Promise<void> {
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/context');
      routes = Array.isArray(body.routes) ? (body.routes as AdminRouteRecord[]) : [];
    } catch {
      routes = [];
    }
  }

  async function loadModelCatalog(): Promise<void> {
    catalogError = '';
    catalogNotice = '';
    try {
      const body = await authorizedJson('/api/admin/ingestion-routing/model-catalog');
      catalogEntries = Array.isArray(body.entries) ? (body.entries as CatalogEntry[]) : [];
      const sync = body.catalogSync as { status?: string; reason?: string } | undefined;
      const supplementation = body.supplementation as { staticEmbeddingCount?: number } | undefined;
      if (sync?.status === 'unavailable') {
        catalogError =
          'Restormel model list is currently unavailable. Check your project model index and provider configuration, then refresh.';
      } else if (catalogEntries.length > 0) {
        const staticEmbeddingCount = supplementation?.staticEmbeddingCount ?? 0;
        catalogNotice =
          staticEmbeddingCount > 0
            ? `${catalogEntries.length} models available (${staticEmbeddingCount} static embedding fallbacks added).`
            : `${catalogEntries.length} models from Restormel Keys.`;
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
    for (const row of RESTORMEL_STAGES) {
      const route = resolveRouteForStage(routes, row.key);
      if (!route?.id) continue;
      try {
        const body = await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/steps`);
        const steps = Array.isArray(body.steps) ? body.steps : [];
        const ordered = [...steps].sort(
          (a, b) => (Number((a as { orderIndex?: number }).orderIndex) || 0) - (Number((b as { orderIndex?: number }).orderIndex) || 0)
        );
        const first = ordered[0] as { providerPreference?: string | null; modelId?: string | null } | undefined;
        const pid = first?.providerPreference?.trim() ?? '';
        const mid = first?.modelId?.trim() ?? '';
        if (!pid || !mid) continue;
        const entry = catalogEntries.find((e) => e.provider === pid && e.modelId === mid);
        if (!entry) continue;
        const sid = stableModelId(entry);
        const list = modelsForStage(row);
        if (list.some((e) => stableModelId(e) === sid)) {
          next[row.key] = sid;
          nextProviders[row.key] = entry.provider;
        }
      } catch {
        /* ignore */
      }
    }
    stageModelIds = next;
    stageProviders = nextProviders;
    for (const row of RESTORMEL_STAGES) ensureStageProviderSelection(row);
    ensureValidationModelIsIndependent();
  }

  async function refreshModelsAndRoutes(): Promise<void> {
    await loadModelCatalog();
    await loadRoutingContext();
    await hydrateSelectionsFromRoutes();
  }

  async function applyStageRouting(): Promise<void> {
    routingBusy = true;
    routingError = '';
    routingMessage = '';
    try {
      await loadRoutingContext();
      for (const row of RESTORMEL_STAGES) {
        if (row.key === 'ingestion_fetch') continue;
        const route = resolveRouteForStage(routes, row.key);
        if (!route?.id) {
          routingError = `No Restormel route is available for “${row.label}”. Configure routes in Restormel Keys, then refresh.`;
          return;
        }
        const sid = stageModelIds[row.key];
        const opt = getCatalogEntryByStableId(sid);
        if (!opt) {
          routingError = `Choose a Restormel model for “${row.label}”.`;
          return;
        }
        await authorizedJson(`/api/admin/ingestion-routing/routes/${route.id}/steps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              orderIndex: 0,
              enabled: true,
              providerPreference: opt.provider,
              modelId: opt.modelId
            }
          ])
        });
      }
      routingMessage = 'Saved model routing for all six LLM ingestion stages.';
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
    embed: 'ingestion_embedding',
    embedding: 'ingestion_embedding',
    json_repair: 'ingestion_json_repair',
    jsonrepair: 'ingestion_json_repair',
    repair: 'ingestion_json_repair'
  };

  function parseCostStageFromLine(line: string): string | null {
    const fromCostTag = line.match(/\[COST\]\s+([A-Z_]+)/i)?.[1] ?? '';
    const norm = fromCostTag.trim().toLowerCase().replace(/[^a-z_]/g, '');
    if (norm && RUN_COST_STAGE_KEY_MAP[norm]) return RUN_COST_STAGE_KEY_MAP[norm];
    if (norm.startsWith('fetch')) return 'ingestion_fetch';
    if (norm.startsWith('extract')) return 'ingestion_extraction';
    if (norm.startsWith('relat')) return 'ingestion_relations';
    if (norm.startsWith('group')) return 'ingestion_grouping';
    if (norm.startsWith('validat')) return 'ingestion_validation';
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
    return selected ? validationModelConflicts(selected) : false;
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
    return items;
  }

  const pipelineNoticeList = $derived.by(() => pipelineNoticeItems());

  function providerHint(provider: string): string {
    const p = provider.trim().toLowerCase();
    if (p === 'openai') return 'Broad catalog; strong defaults for many tasks.';
    if (p === 'anthropic') return 'Strong reasoning; good for long, careful passes.';
    if (p === 'google') return 'Often cost-competitive; good multimodal and long-context options.';
    if (p === 'mistral') return 'Frequently fast and economical for mid-tier workloads.';
    if (p === 'cohere') return 'Solid embeddings and enterprise throughput options.';
    if (p === 'xai' || p === 'x.ai') return 'Alternative frontier options; compare latency in your project.';
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
    return selectedPreset !== null;
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
          sourceType
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
    try {
      const body = await authorizedJson('/api/admin/ingest/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 30 })
      });
      const output = body.output as
        | {
            executiveSummary?: string;
            recommendations?: string[];
            priority?: string;
            suggestedNextExperiments?: string[];
          }
        | undefined;
      if (output && typeof output.executiveSummary === 'string' && Array.isArray(output.recommendations)) {
        coachResult = {
          executiveSummary: output.executiveSummary,
          recommendations: output.recommendations,
          priority: typeof output.priority === 'string' ? output.priority : 'medium',
          suggestedNextExperiments: output.suggestedNextExperiments
        };
      } else {
        coachError = 'Unexpected coach response.';
      }
    } catch (e) {
      coachError = e instanceof Error ? e.message : 'Coach request failed.';
    } finally {
      coachBusy = false;
    }
  }

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
    starting = true;
    monitorRunNotice = '';
    sourceRunEndedDetail = null;
    runError = '';
    runLog = [];
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
          stop_before_store: true,
          embedding_model: stageModelIds.ingestion_embedding,
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
          'Running in simulation mode. To execute real ingestion from localhost, set ADMIN_INGEST_RUN_REAL=1 and provide live SURREAL_URL plus Firebase Admin credentials.';
      } else if (execution.mode === 'real') {
        const surreal = execution.surrealTarget ?? 'configured target';
        const firestore = execution.firestoreProject ? `, Firestore project ${execution.firestoreProject}` : '';
        executionNotice = `Real execution mode enabled (Surreal ${surreal}${firestore}).`;
      }

      runId = id;
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
      'Stop this ingestion run? The worker will be stopped if it is still running. This run will be marked cancelled; you can start a new run when you are ready.'
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
      const response = await fetch(`/api/admin/ingest/run/${runId}/resume`, {
        method: 'POST',
        headers: await authHeaders()
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

  function stripMonitorParamsFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    params.delete('monitor');
    params.delete('runId');
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
    if (body?.stages && typeof body.stages === 'object') {
      stages = STAGE_TEMPLATE.map((stage) => ({
        ...stage,
        status: ((body.stages as Record<string, { status?: StageStatus }>)[stage.key]?.status ??
          stage.status) as StageStatus,
        result: typeof (body.stages as Record<string, { summary?: string }>)[stage.key]?.summary === 'string'
          ? (body.stages as Record<string, { summary?: string }>)[stage.key].summary
          : undefined
      }));
    }
    if (Array.isArray(body?.logLines)) {
      runLog = body.logLines as string[];
    }
    runCurrentStage = typeof body?.currentStageKey === 'string' ? body.currentStageKey : null;
    runCurrentAction = typeof body?.currentAction === 'string' ? body.currentAction : null;
    runLastFailureStage = typeof body?.lastFailureStageKey === 'string' ? body.lastFailureStageKey : null;
    runResumable = body?.resumable === true;
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

  async function fetchRunStatus(): Promise<void> {
    if (!runId) return;
    try {
      const response = await fetch(`/api/admin/ingest/run/${runId}/status`, {
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

  function startPolling(): void {
    if (!runId) return;
    if (pollingInterval) clearInterval(pollingInterval);

    void fetchRunStatus();

    pollingInterval = setInterval(() => {
      void fetchRunStatus();
    }, 1500);
  }

  function clearPolling(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
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
    void (async () => {
      await loadModelCatalog();
      await loadRoutingContext();
      await hydrateSelectionsFromRoutes();
    })();

    const params = new URLSearchParams(window.location.search);
    const existingRunId = params.get('runId')?.trim();
    if (existingRunId) {
      runId = existingRunId;
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
      </nav>
    </div>
  </header>

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
                      To reconnect to the same run (for example to monitor logs or run SurrealDB sync), open
                      <a href="/admin/ingest/runs" class="text-sophia-dark-text underline decoration-sophia-dark-border underline-offset-2 hover:decoration-sophia-dark-text"
                        >All runs</a
                      >
                      and select it if it still appears. Runs are kept in memory on this server only until it restarts—then the list is empty.
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
                  <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Pipeline presets</p>
                  <button
                    type="button"
                    disabled={runInProgress()}
                    onclick={() => void refreshModelsAndRoutes()}
                    class="shrink-0 rounded border border-sophia-dark-border/70 bg-transparent px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim hover:border-sophia-dark-border hover:bg-sophia-dark-surface-raised hover:text-sophia-dark-muted disabled:opacity-50"
                  >
                    Refresh models
                  </button>
                </div>

                <div class="mt-4 rounded border border-sophia-dark-border/70 bg-sophia-dark-bg/30 p-4" role="group" aria-labelledby="ingestion-depth-label">
                  <p id="ingestion-depth-label" class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
                    Ingestion depth
                  </p>
                  <p class="mt-2 text-xs text-sophia-dark-muted">
                    Choose how strongly models are weighted for each stage—budget (lean), balanced, or complexity (heavier reasoning). You need to pick one before continuing.
                  </p>
                  <div class="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={runInProgress()}
                      onclick={() => applyPipelinePreset('budget')}
                      class="rounded border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] disabled:opacity-50 {selectedPreset === 'budget' ? 'border-sophia-dark-sage/45 bg-sophia-dark-sage/14 text-sophia-dark-sage' : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'}"
                    >
                      Budget
                    </button>
                    <button
                      type="button"
                      disabled={runInProgress()}
                      onclick={() => applyPipelinePreset('balanced')}
                      class="rounded border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] disabled:opacity-50 {selectedPreset === 'balanced' ? 'border-sophia-dark-sage/45 bg-sophia-dark-sage/14 text-sophia-dark-sage' : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'}"
                    >
                      Balanced
                    </button>
                    <button
                      type="button"
                      disabled={runInProgress()}
                      onclick={() => applyPipelinePreset('complexity')}
                      class="rounded border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] disabled:opacity-50 {selectedPreset === 'complexity' ? 'border-sophia-dark-sage/45 bg-sophia-dark-sage/14 text-sophia-dark-sage' : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'}"
                    >
                      Complexity
                    </button>
                  </div>
                </div>
                <p class="mt-3 text-xs text-sophia-dark-muted">
                  Presets adapt to source type and only use models currently available in your Restormel/Keys context.
                </p>
                {#if presetMessage}
                  <p class="mt-2 font-mono text-xs text-sophia-dark-sage">{presetMessage}</p>
                {/if}
              </div>

              {#if sourcePreScanResult?.advisor}
                {@const adv = sourcePreScanResult.advisor}
                <div class="rounded border border-sophia-dark-border/80 bg-sophia-dark-bg/35 p-4" role="region" aria-label="Ingestion advisor">
                  <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Ingestion advisor</p>
                  <p class="mt-2 text-xs text-sophia-dark-muted">
                    <span class="font-mono text-sophia-dark-text">{adv.mode}</span>
                    {#if adv.enabled}
                      · active
                    {:else if adv.mode === 'off'}
                      · disabled via <span class="font-mono">INGESTION_ADVISOR_MODE</span>
                    {/if}
                    {#if adv.model}
                      · {adv.model.provider}/{adv.model.modelId}
                    {/if}
                  </p>
                  {#if adv.error}
                    <p class="mt-2 font-mono text-xs text-sophia-dark-copper">{adv.error}</p>
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
                      Summarizes recent <span class="font-mono">ingestion_run_reports</span> and suggests pipeline improvements.
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
                {#if coachResult}
                  <div class="mt-4 space-y-3 border-t border-sophia-dark-border/50 pt-4">
                    <p class="text-xs leading-relaxed text-sophia-dark-muted">{coachResult.executiveSummary}</p>
                    <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Priority: {coachResult.priority}</p>
                    <ul class="list-disc space-y-2 pl-5 text-xs text-sophia-dark-muted">
                      {#each coachResult.recommendations as line}
                        <li>{line}</li>
                      {/each}
                    </ul>
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
                    <tr class="border-b border-sophia-dark-border/60 last:border-b-0">
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
  .pill.latency { color: var(--color-dim); }
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
    color: var(--color-dim);
  }
  .run-stage-node--done {
    border-color: var(--color-sage-border);
    background: var(--color-sage-bg);
  }
  .run-stage-node--done .run-stage-glyph { color: var(--color-sage); }
  .run-stage-node--running {
    border-color: var(--color-blue-border);
    background: var(--color-blue-bg);
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
    color: var(--color-dim);
    font-size: 0.85em;
  }
  .pipeline-theory-details[open] summary::after {
    content: ' ▾';
  }
</style>
