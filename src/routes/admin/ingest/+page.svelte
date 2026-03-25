<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getIdToken } from '$lib/firebase';
  import { isEmbeddingModelEntry } from '$lib/ingestionModelCatalogMerge';
  import { INGESTION_SOURCE_MODEL_HINTS } from '$lib/ingestionModelCatalog';
  import { resolveRouteForStage } from '$lib/utils/ingestionRouting';

  type StageStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';
  type FlowState = 'setup' | 'running' | 'awaiting_sync' | 'done';
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

  const STAGE_TEMPLATE: Stage[] = [
    { key: 'fetch', label: 'Fetch & parse', description: 'Download and normalize the source.', status: 'idle' },
    { key: 'extract', label: 'Extract', description: 'Structured claims from passages.', status: 'idle' },
    { key: 'relate', label: 'Relate', description: 'Link claims by support and tension.', status: 'idle' },
    { key: 'group', label: 'Group', description: 'Cluster into arguments.', status: 'idle' },
    { key: 'embed', label: 'Embed', description: 'Embedding vectors for claims.', status: 'idle' },
    { key: 'validate', label: 'Validate', description: 'Optional cross-model validation.', status: 'idle' },
    {
      key: 'store',
      label: 'SurrealDB',
      description: 'Write graph and records (use Sync when prepare finishes).',
      status: 'idle'
    }
  ];

  let flowState = $state<FlowState>('setup');
  let sourceUrl = $state('');
  let sourceType = $state<(typeof SOURCE_TYPES)[number]['value']>('sep_entry');
  let runValidate = $state(false);
  let starting = $state(false);
  let syncing = $state(false);
  let runId = $state('');
  let runError = $state('');
  let urlError = $state('');
  let runLog = $state<string[]>([]);
  let runCurrentStage = $state<string | null>(null);
  let runCurrentAction = $state<string | null>(null);
  let runLastFailureStage = $state<string | null>(null);
  let runResumable = $state(false);
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
    ingestion_extraction: '',
    ingestion_relations: '',
    ingestion_grouping: '',
    ingestion_validation: '',
    ingestion_embedding: '',
    ingestion_json_repair: ''
  });
  let stageModelIds = $state<Record<string, string>>({
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
  let activeStep = $state<'source' | 'pipeline' | 'cost' | 'review'>('source');
  let activePipelineStageKey = $state('ingestion_extraction');
  let selectedPreset = $state<PipelinePreset | null>(null);
  let presetMessage = $state('');

  function stableModelId(e: Pick<CatalogEntry, 'provider' | 'modelId'>): string {
    return `${e.provider}__${e.modelId}`.replace(/\//g, '-');
  }

  function getCatalogEntryByStableId(id: string): CatalogEntry | undefined {
    if (!id.trim()) return undefined;
    return catalogEntries.find((e) => stableModelId(e) === id);
  }

  function modelsForStage(row: (typeof RESTORMEL_STAGES)[number]): CatalogEntry[] {
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

  function stageAdvice(row: (typeof RESTORMEL_STAGES)[number]): { complexityLabel: string; body: string } {
    switch (row.key) {
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

  function isStageMinimumViableModel(
    row: (typeof RESTORMEL_STAGES)[number],
    entry: CatalogEntry
  ): boolean {
    const label = `${entry.label} ${entry.modelId}`.toLowerCase();
    const tiny = /(nano|3b|7b)/i.test(label);
    const strong =
      /(opus|sonnet|gpt-4|gpt-5|o1|o3|gemini.*pro|reasoner|deepseek-r1|mistral-large|command-r\+|llama.*70b|qwen.*72b)/i.test(
        label
      );
    const jsonFriendly = /json|instruct|mini|haiku|flash|lite|nano/i.test(label);

    if (row.embed) return isLikelyEmbeddingModel(entry);
    switch (row.key) {
      case 'ingestion_extraction':
      case 'ingestion_relations':
        return strong || !tiny;
      case 'ingestion_grouping':
        return strong;
      case 'ingestion_validation':
        return !tiny;
      case 'ingestion_json_repair':
        return jsonFriendly || !tiny;
      default:
        return false;
    }
  }

  function choosePresetModelForStage(
    row: (typeof RESTORMEL_STAGES)[number],
    preset: PipelinePreset
  ): CatalogEntry | null {
    const options = modelsForStage(row);
    if (options.length === 0) return null;
    const minimumViable = options.filter((entry) => isStageMinimumViableModel(row, entry));
    if (minimumViable.length === 0) return null;
    const recommendedOptions = minimumViable.filter((entry) => isStageRecommendedModel(row, entry));
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
      const recommendationBoost = isStageRecommendedModel(row, entry) ? 1.5 : 0;
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
    if (flowState !== 'setup') return;
    const nextModelIds = { ...stageModelIds };
    const nextProviders = { ...stageProviders };
    const missingMinimumStages: string[] = [];

    for (const row of RESTORMEL_STAGES) {
      const selected = choosePresetModelForStage(row, preset);
      if (!selected) {
        missingMinimumStages.push(row.label);
        continue;
      }
      nextProviders[row.key] = selected.provider;
      nextModelIds[row.key] = stableModelId(selected);
    }

    stageProviders = nextProviders;
    stageModelIds = nextModelIds;
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

  function isStageRecommendedModel(row: (typeof RESTORMEL_STAGES)[number], entry: CatalogEntry): boolean {
    // Heuristic only: we only have (provider, modelId, label).
    const provider = entry.provider.toLowerCase();
    const label = `${entry.label} ${entry.modelId}`.toLowerCase();

    if (row.embed) {
      if (!isLikelyEmbeddingModel(entry)) return false;
      // For large sources, prefer embedding variants that are less likely to bottleneck.
      return stageTokenPressure(row) !== 'high' || isRateLimitFriendly(row, entry);
    }

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
      const list = catalogEntries.filter((e) =>
        row.embed ? isEmbeddingModelEntry(e) : !isEmbeddingModelEntry(e)
      );
      const first = list[0];
      next[row.key] = first ? stableModelId(first) : '';
      nextProviders[row.key] = first?.provider ?? '';
    }
    stageModelIds = next;
    stageProviders = nextProviders;
  }

  function ingestionModelsReady(): boolean {
    if (catalogEntries.length === 0) return false;
    for (const row of RESTORMEL_STAGES) {
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
      routingMessage = 'Saved model routing for all six ingestion stages.';
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

  function formatInt(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return Math.round(value).toLocaleString();
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
    const rows = phaseCostRows();
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
    const selectedEntry = selectedCatalogEntryForRow(row.key);
    return selectedEntry ? isStageRecommendedModel(row, selectedEntry) : false;
  }

  function sourceStepReady(): boolean {
    return sourceUrl.trim().length > 0 && sourcePreScanResult !== null && sourcePreScanFingerprint === sourceFingerprint();
  }

  function pipelineStepReady(): boolean {
    return ingestionModelsReady();
  }

  function sourceFingerprint(): string {
    return `${sourceType}::${sourceUrl.trim()}`;
  }

  function canOpenStep(step: 'source' | 'pipeline' | 'cost' | 'review'): boolean {
    if (step === 'source') return true;
    if (!sourceStepReady()) return false;
    if (step === 'review') return pipelineStepReady();
    if (step === 'cost') return pipelineStepReady();
    return true;
  }

  function openStep(step: 'source' | 'pipeline' | 'cost' | 'review'): void {
    if (!canOpenStep(step)) return;
    activeStep = step;
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

  async function preScanSource(): Promise<void> {
    if (sourcePreScanBusy) return;
    if (!validateSource()) return;
    sourcePreScanBusy = true;
    sourcePreScanError = '';
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
      sourcePreScanFingerprint = sourceFingerprint();
    } catch (e) {
      sourcePreScanError = e instanceof Error ? e.message : 'Unable to pre-scan this source.';
    } finally {
      sourcePreScanBusy = false;
    }
  }

  async function startIngestion(): Promise<void> {
    if (starting || !validateSource()) return;
    if (!sourceStepReady()) {
      runError = 'Run pre-scan on the current source before starting ingestion.';
      return;
    }
    if (!ingestionModelsReady()) {
      runError =
        'Select a Restormel model for every stage (and ensure your project lists both chat and embedding models where required).';
      return;
    }
    starting = true;
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
      flowState = 'running';
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

    const awaitingSync = body?.awaitingSync === true || body?.status === 'awaiting_sync';
    const syncStart = typeof body?.syncStartedAt === 'number' ? body.syncStartedAt : undefined;
    const syncEnd = typeof body?.syncCompletedAt === 'number' ? body.syncCompletedAt : undefined;
    if (syncStart != null && syncEnd != null) {
      syncDurationLabel = formatDuration(syncEnd - syncStart);
    }

    if (body?.status === 'done') {
      flowState = 'done';
      completionMessage =
        syncEnd != null
          ? `Job completed. SurrealDB sync finished in ${syncDurationLabel || formatDuration((syncEnd ?? 0) - (syncStart ?? 0))}.`
          : 'Job completed. Ingestion finished successfully.';
      clearPolling();
    } else if (awaitingSync) {
      flowState = 'awaiting_sync';
    } else if (body?.status === 'error') {
      runError = typeof body?.error === 'string' ? body.error : 'Ingestion failed.';
      flowState = 'running';
      clearPolling();
    }
  }

  async function fetchRunStatus(): Promise<void> {
    if (!runId) return;
    try {
      const response = await fetch(`/api/admin/ingest/run/${runId}/status`, {
        headers: await authHeaders()
      });
      if (!response.ok) {
        if (response.status === 404) {
          runError = `Run ${runId} not found.`;
          clearPolling();
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
    flowState = 'setup';
    runId = '';
    runError = '';
    runLog = [];
    runCurrentStage = null;
    runCurrentAction = null;
    runLastFailureStage = null;
    runResumable = false;
    completionMessage = '';
    syncDurationLabel = '';
    stages = cloneStages();
    const params = new URLSearchParams(window.location.search);
    params.delete('monitor');
    params.delete('runId');
    const query = params.toString();
    window.history.replaceState({}, '', query ? `/admin/ingest?${query}` : '/admin/ingest');
  }

  onMount(() => {
    void (async () => {
      await loadModelCatalog();
      await loadRoutingContext();
      await hydrateSelectionsFromRoutes();
    })();

    const params = new URLSearchParams(window.location.search);
    const monitor = params.get('monitor');
    const existingRunId = params.get('runId');
    if (monitor === '1' && existingRunId) {
      runId = existingRunId;
      flowState = 'running';
      runLog = [`Monitoring run: ${runId}`];
      startPolling();
    }
  });

  onDestroy(() => clearPolling());
</script>

<svelte:head>
  <title>Ingestion — Expand</title>
</svelte:head>

<main class="expand-page">
  <header class="expand-hero">
    <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Expand</p>
    <h1 class="mt-2 font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">Ingestion orchestration and routing</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
      Configure source setup, pre-scan assumptions, stage-level model choices, and run with a clear cost view.
    </p>
  </header>

  <section class="wizard-layout">
    <div class="expand-card">
      <div class="expand-card-inner">
        <div class="step-tabs">
          <button class:active={activeStep === 'source'} class:done={sourceStepReady()} type="button" onclick={() => openStep('source')}>1. Source</button>
          <button class:active={activeStep === 'pipeline'} class:done={pipelineStepReady()} type="button" disabled={!canOpenStep('pipeline')} onclick={() => openStep('pipeline')}>2. Pipeline setup</button>
          <button class:active={activeStep === 'cost'} class:done={sourceStepReady() && pipelineStepReady()} type="button" disabled={!canOpenStep('cost')} onclick={() => openStep('cost')}>3. Cost review</button>
          <button class:active={activeStep === 'review'} class:done={pipelineStepReady() && sourceStepReady()} type="button" disabled={!canOpenStep('review')} onclick={() => openStep('review')}>4. Review & run</button>
        </div>

        {#if activeStep === 'source'}
          <section class="step-pane">
            <div class="space-y-5">
              <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Source setup</h2>
              <label class="block space-y-2">
                <span class="text-sm text-sophia-dark-muted">URL</span>
                <input bind:value={sourceUrl} type="url" disabled={flowState !== 'setup' || sourceStepReady()} placeholder="https://plato.stanford.edu/entries/pacifism/" class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text disabled:opacity-60" />
                {#if urlError}<span class="font-mono text-xs text-sophia-dark-copper">{urlError}</span>{/if}
              </label>
              <label class="block space-y-2">
                <span class="text-sm text-sophia-dark-muted">Source type</span>
                <select bind:value={sourceType} disabled={flowState !== 'setup' || sourceStepReady()} class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text disabled:opacity-60">
                  {#each SOURCE_TYPES as option}<option value={option.value}>{option.label}</option>{/each}
                </select>
              </label>
              <label class="flex cursor-pointer items-center gap-2 text-sm text-sophia-dark-muted">
                <input type="checkbox" bind:checked={runValidate} disabled={flowState !== 'setup'} class="rounded border-sophia-dark-border" />
                Run optional cross-model validation (slower, higher cost)
              </label>
              <div class="flex flex-wrap items-center gap-3">
                {#if sourceStepReady()}
                  <div class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-sage">
                    Pre-scan complete ✓
                  </div>
                {:else}
                  <button
                    type="button"
                    onclick={() => void preScanSource()}
                    disabled={flowState !== 'setup' || sourcePreScanBusy || !sourceUrl.trim()}
                    class="rounded border border-sophia-dark-blue/45 bg-sophia-dark-blue/14 px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-blue hover:bg-sophia-dark-blue/20 disabled:opacity-50"
                  >
                    {sourcePreScanBusy ? 'Pre-scanning…' : 'Pre-scan source'}
                  </button>
                {/if}
                <button type="button" onclick={() => openStep('pipeline')} disabled={!sourceStepReady()} class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50">Continue</button>
              </div>
              {#if sourcePreScanError}<p class="font-mono text-xs text-sophia-dark-copper">{sourcePreScanError}</p>{/if}
              {#if sourceStepReady()}<p class="font-mono text-xs text-sophia-dark-dim">Source is locked after successful pre-scan.</p>{/if}
              {#if sourcePreScanResult}
                <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/50 p-4">
                  <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Pre-scan summary</p>
                  <div class="mt-3 grid gap-2 text-sm text-sophia-dark-muted sm:grid-cols-2">
                    <p><span class="text-sophia-dark-dim">Title:</span> {sourcePreScanResult.metadata.title || 'Unknown'}</p>
                    <p><span class="text-sophia-dark-dim">Host:</span> {sourcePreScanResult.metadata.hostname || 'Unknown'}</p>
                    <p><span class="text-sophia-dark-dim">Author:</span> {sourcePreScanResult.metadata.author || 'Unknown'}</p>
                    <p><span class="text-sophia-dark-dim">Year:</span> {sourcePreScanResult.metadata.publicationYear || 'Unknown'}</p>
                    <p><span class="text-sophia-dark-dim">Approx chars:</span> {formatInt(sourcePreScanResult.preScan.approxContentChars)}</p>
                    <p><span class="text-sophia-dark-dim">Approx tokens:</span> {formatInt(sourcePreScanResult.preScan.approxContentTokens)}</p>
                  </div>
                </div>
              {/if}
            </div>
          </section>
        {/if}

        {#if activeStep === 'pipeline'}
          <section class="step-pane">
            <div class="space-y-4">
              <div class="flex flex-wrap items-end justify-between gap-3">
                <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Pipeline configuration</h2>
                <button type="button" disabled={flowState !== 'setup'} onclick={() => void refreshModelsAndRoutes()} class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised disabled:opacity-50">Refresh models</button>
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/45 p-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Pipeline presets</p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={flowState !== 'setup'}
                      onclick={() => applyPipelinePreset('budget')}
                      class="rounded border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] disabled:opacity-50 {selectedPreset === 'budget' ? 'border-sophia-dark-sage/45 bg-sophia-dark-sage/14 text-sophia-dark-sage' : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'}"
                    >
                      Budget
                    </button>
                    <button
                      type="button"
                      disabled={flowState !== 'setup'}
                      onclick={() => applyPipelinePreset('balanced')}
                      class="rounded border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] disabled:opacity-50 {selectedPreset === 'balanced' ? 'border-sophia-dark-sage/45 bg-sophia-dark-sage/14 text-sophia-dark-sage' : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'}"
                    >
                      Balanced
                    </button>
                    <button
                      type="button"
                      disabled={flowState !== 'setup'}
                      onclick={() => applyPipelinePreset('complexity')}
                      class="rounded border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] disabled:opacity-50 {selectedPreset === 'complexity' ? 'border-sophia-dark-sage/45 bg-sophia-dark-sage/14 text-sophia-dark-sage' : 'border-sophia-dark-border text-sophia-dark-muted hover:bg-sophia-dark-surface-raised'}"
                    >
                      Complexity
                    </button>
                  </div>
                </div>
                <p class="mt-2 text-xs text-sophia-dark-muted">
                  Presets adapt to source type and only use models currently available in your Restormel/Keys context.
                </p>
                {#if presetMessage}
                  <p class="mt-2 font-mono text-xs text-sophia-dark-sage">{presetMessage}</p>
                {/if}
              </div>

              <div class="pipeline-rail">
                {#each RESTORMEL_STAGES as row}
                  <button type="button" class="pipeline-node {activePipelineStageKey === row.key ? 'is-active' : ''}" onclick={() => activePipelineStageKey = row.key}>
                    <span class="name">{row.label}</span>
                    <span class="meta"><span class="pill {complexityClass(row)}">{stepComplexity(row)}</span><span class="pill latency">{stepLatency(row)}</span></span>
                  </button>
                {/each}
              </div>

              {#if catalogNotice}<p class="font-mono text-xs text-sophia-dark-sage">{catalogNotice}</p>{/if}
              {#if catalogError}<p class="font-mono text-xs text-sophia-dark-copper">{catalogError}</p>{/if}

              <div class="space-y-4">
                {#each RESTORMEL_STAGES as row}
                  <article class="stage-card" id={row.key} style:display={activePipelineStageKey === row.key ? 'block' : 'none'}>
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 class="font-serif text-xl text-sophia-dark-text">{row.label}</h3>
                        <p class="text-sm text-sophia-dark-muted">{row.description}</p>
                      </div>
                      <div class="flex gap-2">
                        <span class="pill {complexityClass(row)}">{stepComplexity(row)}</span>
                        <span class="pill latency">{stepLatency(row)}</span>
                        <span class="pill cost">{formatUsd(estimatedPhaseCostUsd(row.key))}</span>
                      </div>
                    </div>

                    <div class="mt-3 rounded border border-sophia-dark-border bg-sophia-dark-bg/35 p-3 text-sm text-sophia-dark-muted">
                      <strong class="text-sophia-dark-text">{stepComplexity(row).toUpperCase()} complexity stage.</strong> {stageAdvice(row).body}
                    </div>

                    <div class="mt-3 grid gap-2 sm:grid-cols-2">
                      <select bind:value={stageProviders[row.key]} onchange={(e) => setStageProvider(row, (e.currentTarget as HTMLSelectElement).value)} disabled={flowState !== 'setup' || providersForStage(row).length === 0} class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60">
                        {#if providersForStage(row).length === 0}
                          <option value="">No providers available</option>
                        {:else}
                          {#each providersForStage(row) as p}<option value={p}>{p}</option>{/each}
                        {/if}
                      </select>
                      <select bind:value={stageModelIds[row.key]} disabled={flowState !== 'setup' || !stageProviders[row.key] || modelsForStageProvider(row, stageProviders[row.key]).length === 0} class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text disabled:opacity-60">
                        {#if !stageProviders[row.key]}
                          <option value="">Choose provider first</option>
                        {:else if modelsForStageProvider(row, stageProviders[row.key]).length === 0}
                          <option value="">No models for this provider</option>
                        {:else}
                          {#each modelsForStageProvider(row, stageProviders[row.key]) as m}
                            <option value={stableModelId(m)}>{modelOptionLabel(row, m)}</option>
                          {/each}
                        {/if}
                      </select>
                    </div>

                    <div class="mt-3 flex flex-wrap gap-2">
                      <span class="pill cost">Phase cost: {formatUsd(estimatedPhaseCostUsd(row.key))}</span>
                      <span class="pill {stageRecommendationMatch(row) ? 'good' : 'bad'}">{stageRecommendationMatch(row) ? 'Good fit ✓' : 'Review choice ⚠'}</span>
                    </div>

                    {#if selectedCatalogEntryForRow(row.key) && !stageRecommendationMatch(row)}
                      <div class="mt-3 rounded border border-sophia-dark-coral/45 bg-sophia-dark-coral/15 p-3 text-sm text-sophia-dark-text">
                        ⚠ Non-ideal selection for this stage. Consider a recommended model for better reliability at this complexity.
                      </div>
                    {/if}

                    {#if sourcePreScanResult}
                      {#if preScanEstimateForRow(row.key)}
                        <details class="mt-3 rounded border border-sophia-dark-border bg-sophia-dark-bg/25 p-3">
                          <summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">Advanced metrics</summary>
                          <div class="mt-2 grid gap-2 text-xs text-sophia-dark-muted sm:grid-cols-2">
                            <p>Input tokens: <span class="text-sophia-dark-text">{formatInt(preScanEstimateForRow(row.key)?.inputTokens)}</span></p>
                            <p>Output tokens: <span class="text-sophia-dark-text">{formatInt(preScanEstimateForRow(row.key)?.outputTokens)}</span></p>
                            <p>Total tokens: <span class="text-sophia-dark-text">{formatInt(preScanEstimateForRow(row.key)?.totalTokens)}</span></p>
                            <p>Latency profile: <span class="text-sophia-dark-text">{preScanEstimateForRow(row.key)?.latency ?? '—'}</span></p>
                          </div>
                        </details>
                      {/if}
                    {/if}
                  </article>
                {/each}
              </div>
            </div>
          </section>
        {/if}

        {#if activeStep === 'cost'}
          <section class="step-pane">
            <div class="space-y-4">
              <div class="flex flex-wrap items-end justify-between gap-3">
                <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Estimated ingestion cost</h2>
                <p class="font-mono text-xs text-sophia-dark-muted">Approx total: <span class="text-sophia-dark-text">{formatUsd(estimatedIngestionTotalUsd())}</span></p>
              </div>
              {#if costEstimateHint()}
                <p class="rounded border border-sophia-dark-amber/40 bg-sophia-dark-amber/10 p-3 text-sm text-sophia-dark-muted">{costEstimateHint()}</p>
              {/if}
              {#if sourcePreScanResult}
                <div class="overflow-auto rounded border border-sophia-dark-border">
                  <table class="min-w-full text-left font-mono text-xs text-sophia-dark-muted">
                    <thead class="border-b border-sophia-dark-border bg-sophia-dark-bg/60 text-sophia-dark-dim">
                      <tr><th class="px-3 py-2">Phase</th><th class="px-3 py-2">Provider</th><th class="px-3 py-2">Model</th><th class="px-3 py-2">Est. cost</th></tr>
                    </thead>
                    <tbody>
                      {#each phaseCostRows() as row}
                        <tr class="border-b border-sophia-dark-border/60 last:border-b-0">
                          <td class="px-3 py-2 text-sophia-dark-text">{row.label}</td>
                          <td class="px-3 py-2">{row.provider}</td>
                          <td class="px-3 py-2">{row.model}</td>
                          <td class="px-3 py-2 text-sophia-dark-text">{formatUsd(row.costUsd)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else}
                <p class="text-sm text-sophia-dark-muted">Run pre-scan first to calculate phase-level cost estimates.</p>
              {/if}
            </div>
          </section>
        {/if}

        {#if activeStep === 'review'}
          <section class="step-pane">
            <div class="space-y-4">
              <h2 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Final review & run</h2>
              <ul class="list-none space-y-2 p-0 font-mono text-xs">
                <li class={sourceUrl.trim() ? 'text-sophia-dark-sage' : 'text-sophia-dark-copper'}>{sourceUrl.trim() ? '✓' : '⚠'} Source URL provided</li>
                <li class={sourcePreScanResult ? 'text-sophia-dark-sage' : 'text-sophia-dark-copper'}>{sourcePreScanResult ? '✓' : '⚠'} Pre-scan completed</li>
                <li class={pipelineStepReady() ? 'text-sophia-dark-sage' : 'text-sophia-dark-copper'}>{pipelineStepReady() ? '✓' : '⚠'} All stages configured</li>
              </ul>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/30 p-4">
                <div class="flex items-end justify-between gap-4">
                  <h3 class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Run</h3>
                  <span class="font-mono text-xs text-sophia-dark-muted">{flowState === 'setup' ? 'Ready' : 'Monitoring'}</span>
                </div>
                {#if flowState === 'setup'}
                  <button type="button" onclick={() => void startIngestion()} class="mt-4 w-full rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20 disabled:opacity-50" disabled={starting || !ingestionModelsReady()}>
                    {starting ? 'Starting…' : 'Run ingestion'}
                  </button>
                {:else}
                  <div class="mt-4 rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/60 px-4 py-3 font-mono text-xs text-sophia-dark-muted">Run ID: <span class="text-sophia-dark-text">{runId || '—'}</span></div>
                  <div class="mt-3 rounded border border-sophia-dark-border bg-sophia-dark-bg/40 p-3 font-mono text-xs text-sophia-dark-muted">
                    <p>Current stage: <span class="text-sophia-dark-text">{runCurrentStage ? stageName(runCurrentStage) : '—'}</span></p>
                    <p class="mt-1">Current action: <span class="text-sophia-dark-text">{runCurrentAction || 'Waiting for next event…'}</span></p>
                    {#if runLastFailureStage}
                      <p class="mt-1">Last failure stage: <span class="text-sophia-dark-copper">{stageName(runLastFailureStage)}</span></p>
                    {/if}
                  </div>
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
                  {#if flowState === 'done' && completionMessage}<p class="mt-3 text-sm text-sophia-dark-text">{completionMessage}</p>{/if}
                {/if}
                {#if executionNotice}
                  <p class="mt-3 rounded border border-sophia-dark-amber/40 bg-sophia-dark-amber/10 p-2 font-mono text-xs text-sophia-dark-muted">{executionNotice}</p>
                {/if}
              </div>

              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/30 p-4">
                <h3 class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Live execution log</h3>
                <p class="mt-2 text-xs text-sophia-dark-muted">Streaming actions from each stage. Use this to pinpoint where failures occur.</p>
                <div class="mt-3 max-h-56 overflow-auto rounded border border-sophia-dark-border bg-sophia-dark-bg/65 p-3 font-mono text-xs text-sophia-dark-text">
                  {#if runLog.length === 0}
                    <p class="text-sophia-dark-muted">No logs yet.</p>
                  {:else}
                    {#each runLog as line}
                      <p class="leading-5">{line}</p>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          </section>
        {/if}
      </div>
    </div>

    <aside class="sticky-cost">
      <div class="expand-card">
        <div class="expand-card-inner">
          <p class="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Estimated total</p>
          <p class="mt-2 font-mono text-2xl text-sophia-dark-amber">{formatUsd(estimatedIngestionTotalUsd())}</p>
          {#if costEstimateHint()}
            <p class="mt-2 text-xs text-sophia-dark-muted">{costEstimateHint()}</p>
          {/if}
          <div class="mt-4 space-y-2 font-mono text-xs text-sophia-dark-muted">
            {#each phaseCostRows() as row}
              <div class="flex items-center justify-between gap-2">
                <span>{row.label}</span>
                <span class="text-sophia-dark-amber">{formatUsd(row.costUsd)}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </aside>
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
    font-size: var(--text-sm);
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
  .pipeline-rail {
    display: grid;
    grid-template-columns: repeat(6, minmax(140px, 1fr));
    gap: 6px;
    overflow: auto;
    padding-bottom: 4px;
  }
  .pipeline-node {
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
  .pipeline-node .name { display:block; font-family: var(--font-ui); font-size: var(--text-ui); text-transform: uppercase; letter-spacing: 0.08em; }
  .pipeline-node .meta { display:flex; gap:4px; margin-top: 6px; }
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
  @media (min-width: 1160px) {
    .wizard-layout { grid-template-columns: minmax(0, 1fr) 320px; }
  }
  @media (max-width: 900px) {
    .step-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sticky-cost { position: static; }
  }
  @keyframes fadein { from { opacity: 0; transform: translateX(-8px);} to { opacity: 1; transform: translateX(0);} }
</style>
