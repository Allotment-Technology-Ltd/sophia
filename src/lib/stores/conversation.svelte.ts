import type { PassType } from '$lib/types/passes';
import type { SSEEvent } from '$lib/types/api';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
import type { ReasoningEvaluation } from '$lib/types/verification';
import { handleSSEEvent } from '$lib/utils/sseHandler';
import { referencesStore } from '$lib/stores/references.svelte';
import { historyStore } from '$lib/stores/history.svelte';
import { graphStore } from '$lib/stores/graph.svelte';
import { getIdToken } from '$lib/firebase';
import { trackEvent } from '$lib/utils/analytics';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  passes?: { analysis: string; critique: string; synthesis: string; verification?: string };
  metadata?: {
    total_input_tokens: number;
    total_output_tokens: number;
    duration_ms: number;
    claims_retrieved?: number;
    arguments_retrieved?: number;
    retrieval_degraded?: boolean;
    retrieval_degraded_reason?: string;
    depth_mode?: 'quick' | 'standard' | 'deep';
    selected_model_provider?: 'auto' | 'vertex' | 'anthropic';
    selected_model_id?: string;
    query_run_id?: string;
    resource_mode?: 'standard' | 'expanded';
    user_links_count?: number;
    runtime_links_processed?: number;
    nightly_queue_enqueued?: number;
    model_cost_breakdown?: {
      total_estimated_cost_usd: number;
      by_model: Array<{
        provider: 'vertex' | 'anthropic';
        model: string;
        passes: string[];
        input_tokens: number;
        output_tokens: number;
        input_cost_per_million: number;
        output_cost_per_million: number;
        estimated_cost_usd: number;
      }>;
    };
  };
  reasoningQuality?: ReasoningEvaluation;
  constitutionDeltas?: Array<{
    pass: 'analysis' | 'critique' | 'synthesis';
    introduced_violations: string[];
    resolved_violations: string[];
    unresolved_violations: string[];
    overall_compliance: 'pass' | 'partial' | 'fail';
  }>;
  structuredPasses?: Partial<Record<PassType, { sections: Array<{ id: string; heading: string; content: string }>; wordCount: number }>>;
  timestamp: Date;
}

interface CachedPassClaims {
  pass: AnalysisPhase;
  claims: Claim[];
}

interface CachedPassRelations {
  pass: AnalysisPhase;
  relations: RelationBundle[];
}

type ModelProvider = 'auto' | 'vertex' | 'anthropic';

type PassModelInfo = {
  provider: 'vertex' | 'anthropic';
  modelId: string;
};

const PASS_WORKING_SEEDS: Record<'analysis' | 'critique' | 'synthesis', string[]> = {
  analysis: [
    'Traversing the argument graph for core claims.',
    'Assessing assumptions and hidden dependencies.',
    'Matching relevant traditions and canonical positions.'
  ],
  critique: [
    'Stress-testing premises for internal contradictions.',
    'Mining counterarguments and qualifier attacks.',
    'Checking weakest links against source evidence.'
  ],
  synthesis: [
    'Reconciling strongest support and strongest objections.',
    'Mapping unresolved tensions and potential resolutions.',
    'Drafting a coherent position with explicit tradeoffs.'
  ]
};

const PHILOSOPHER_NAMES = [
  'Aristotle',
  'Plato',
  'Kant',
  'Mill',
  'Rawls',
  'Hume',
  'Nietzsche',
  'Parfit',
  'Nagel',
  'Dennett',
  'Chalmers',
  'Searle'
];

function buildPassFallbackGraph(
  passes: { analysis: string; critique: string; synthesis: string }
): {
  nodes: Array<{ id: string; type: 'claim'; label: string; phase: AnalysisPhase }>;
  edges: Array<{ from: string; to: string; type: 'responds-to' | 'supports'; phaseOrigin: AnalysisPhase }>;
} {
  const snip = (text: string, fallback: string) => {
    const clean = text.trim();
    if (!clean) return fallback;
    return clean.length > 96 ? `${clean.slice(0, 96)}...` : clean;
  };

  return {
    nodes: [
      { id: 'claim:pass-analysis', type: 'claim', phase: 'analysis', label: snip(passes.analysis, 'Analysis output') },
      { id: 'claim:pass-critique', type: 'claim', phase: 'critique', label: snip(passes.critique, 'Critique output') },
      { id: 'claim:pass-synthesis', type: 'claim', phase: 'synthesis', label: snip(passes.synthesis, 'Synthesis output') }
    ],
    edges: [
      { from: 'claim:pass-analysis', to: 'claim:pass-critique', type: 'responds-to', phaseOrigin: 'critique' },
      { from: 'claim:pass-critique', to: 'claim:pass-synthesis', type: 'responds-to', phaseOrigin: 'synthesis' },
      { from: 'claim:pass-analysis', to: 'claim:pass-synthesis', type: 'supports', phaseOrigin: 'synthesis' }
    ]
  };
}

function createConversationStore() {
  let messages = $state<Message[]>([]);
  let isLoading = $state(false);
  let currentPass = $state<PassType | null>(null);
  let completedPasses = $state<Set<PassType>>(new Set());
  let currentPasses = $state({ analysis: '', critique: '', synthesis: '', verification: '' });
  let currentStructuredPasses = $state<Partial<Record<PassType, { sections: Array<{ id: string; heading: string; content: string }>; wordCount: number }>>>({});
  let error = $state<string | null>(null);
  let confidenceSummary = $state<{ avgConfidence: number; lowConfidenceCount: number; totalClaims: number } | null>(null);
  let questionCount = $state(0);
  let inquiryDepthMode = $state<'quick' | 'standard' | 'deep'>('standard');
  let loadingModelProvider = $state<ModelProvider>('auto');
  let loadingModelId = $state<string | null>(null);
  let passModels = $state<Partial<Record<PassType, PassModelInfo>>>({});
  let passWorkings = $state<Partial<Record<PassType, string[]>>>({});
  let passWorkingLastAt = $state<Partial<Record<PassType, number>>>({});
  let passWorkingLastSig = $state<Partial<Record<PassType, string>>>({});

  const LEGACY_QUESTION_LIMIT = Math.max(1, Number.parseInt(import.meta.env.PUBLIC_QUESTION_LIMIT ?? '1', 10) || 1);
  const QUESTION_LIMIT_BY_DEPTH: Record<'quick' | 'standard' | 'deep', number> = {
    quick: Math.max(1, Number.parseInt(import.meta.env.PUBLIC_QUESTION_LIMIT_QUICK ?? '2', 10) || 2),
    standard: Math.max(1, Number.parseInt(import.meta.env.PUBLIC_QUESTION_LIMIT_STANDARD ?? '2', 10) || 2),
    deep: Math.max(1, Number.parseInt(import.meta.env.PUBLIC_QUESTION_LIMIT_DEEP ?? String(LEGACY_QUESTION_LIMIT), 10) || LEGACY_QUESTION_LIMIT)
  };

  function getActiveQuestionLimit(depthMode: 'quick' | 'standard' | 'deep'): number {
    return QUESTION_LIMIT_BY_DEPTH[depthMode] ?? LEGACY_QUESTION_LIMIT;
  }
  const WORKING_UPDATE_MIN_INTERVAL_MS = 4000;

  function normalizeWorkingSignature(text: string): string {
    const dedupedWords = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((word, idx, arr) => idx === 0 || word !== arr[idx - 1]);
    return dedupedWords.join(' ');
  }

  function addPassWorking(pass: PassType, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const signature = normalizeWorkingSignature(trimmed);
    if (!signature) return;
    const now = Date.now();
    const lastAt = passWorkingLastAt[pass] ?? 0;
    const lastSig = passWorkingLastSig[pass] ?? '';
    if (signature === lastSig) return;
    if (now - lastAt < WORKING_UPDATE_MIN_INTERVAL_MS) return;
    const current = [...(passWorkings[pass] ?? [])];
    if (current.some((line) => normalizeWorkingSignature(line) === signature)) return;
    const next = [...current, trimmed].slice(-6);
    passWorkings = {
      ...passWorkings,
      [pass]: next
    };
    passWorkingLastAt = {
      ...passWorkingLastAt,
      [pass]: now
    };
    passWorkingLastSig = {
      ...passWorkingLastSig,
      [pass]: signature
    };
  }

  function applyCachedResult(
    query: string,
    cached: {
      passes: { analysis: string; critique: string; synthesis: string; verification?: string };
      metadata: NonNullable<Message['metadata']>;
      reasoningQuality?: Message['reasoningQuality'];
      constitutionDeltas?: Message['constitutionDeltas'];
      sources: SourceReference[];
      claimsByPass: CachedPassClaims[];
      relationsByPass: CachedPassRelations[];
    },
    options?: { appendUserMessage?: boolean }
  ): void {
    // Loading from history/cache restarts the depth counter — fresh exploration
    questionCount = 0;
    inquiryDepthMode = cached.metadata?.depth_mode ?? 'standard';
    currentPass = null;
    const cachedCompleted = new Set<PassType>();
    if (cached.passes.analysis) cachedCompleted.add('analysis');
    if (cached.passes.critique) cachedCompleted.add('critique');
    if (cached.passes.synthesis) cachedCompleted.add('synthesis');
    if (cached.passes.verification) cachedCompleted.add('verification');
    completedPasses = cachedCompleted;
    currentPasses = { ...cached.passes, verification: cached.passes.verification ?? '' };
    currentStructuredPasses = {};
    referencesStore.setSources(cached.sources);
    loadingModelProvider = cached.metadata?.selected_model_provider ?? loadingModelProvider;
    loadingModelId = cached.metadata?.selected_model_id ?? loadingModelId;
    passModels = {};
    passWorkings = {};
    passWorkingLastAt = {};
    passWorkingLastSig = {};

    for (const { pass, claims } of cached.claimsByPass as CachedPassClaims[]) {
      referencesStore.addClaims(pass, claims, []);
      graphStore.addFromClaims(pass, claims, []);
    }

    for (const { pass, relations } of cached.relationsByPass as CachedPassRelations[]) {
      referencesStore.addClaims(pass, [], relations);
      graphStore.addFromClaims(pass, [], relations);
    }

    if (graphStore.rawNodes.length === 0 && (cached.passes.analysis || cached.passes.critique || cached.passes.synthesis)) {
      const fallback = buildPassFallbackGraph({
        analysis: cached.passes.analysis ?? '',
        critique: cached.passes.critique ?? '',
        synthesis: cached.passes.synthesis ?? ''
      });
      graphStore.setGraph(
        fallback.nodes,
        fallback.edges,
        {
          seedNodeIds: ['claim:pass-analysis'],
          traversedNodeIds: ['claim:pass-critique', 'claim:pass-synthesis'],
          relationTypeCounts: { 'responds-to': 2, supports: 1 },
          maxHops: 2,
          contextSufficiency: 'sparse',
          retrievalDegraded: true,
          retrievalDegradedReason: 'fallback_pass_graph',
          retrievalTimestamp: new Date().toISOString()
        },
        1
      );
    }

    referencesStore.setLive(false);
    referencesStore.setPhase(null);

    if (options?.appendUserMessage) {
      messages = [...messages, {
        id: crypto.randomUUID(),
        role: 'user',
        content: query,
        timestamp: new Date()
      }];
    }

    messages = [...messages, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: cached.passes.synthesis || cached.passes.critique || cached.passes.analysis,
      passes: { ...cached.passes },
      metadata: { ...cached.metadata },
      reasoningQuality: cached.reasoningQuality,
      constitutionDeltas: cached.constitutionDeltas,
      timestamp: new Date()
    }];
  }

  return {
    get messages() { return messages; },
    get isLoading() { return isLoading; },
    get currentPass() { return currentPass; },
    get completedPasses() { return [...completedPasses]; },
    get currentPasses() { return currentPasses; },
    get currentStructuredPasses() { return currentStructuredPasses; },
    get error() { return error; },
    get confidenceSummary() { return confidenceSummary; },
    get questionCount() { return questionCount; },
    get questionLimit() { return getActiveQuestionLimit(inquiryDepthMode); },
    get isAtQuestionLimit() { return questionCount >= getActiveQuestionLimit(inquiryDepthMode); },
    get loadingModelProvider() { return loadingModelProvider; },
    get loadingModelId() { return loadingModelId; },
    get passModels() { return passModels; },
    get passWorkings() { return passWorkings; },

    async submitQuery(
      query: string,
      lens?: string,
      options?: {
        depthMode?: 'quick' | 'standard' | 'deep';
        modelProvider?: ModelProvider;
        modelId?: string;
        domainMode?: 'auto' | 'manual';
        domain?: 'ethics' | 'philosophy_of_mind';
        resourceMode?: 'standard' | 'expanded';
        userLinks?: string[];
        queueForNightlyIngest?: boolean;
        bypassQuestionLimit?: boolean;
        silentCacheLoad?: boolean;
        reuse?: {
          fromDepth: 'quick' | 'standard';
          analysis?: string;
          critique?: string;
          synthesis?: string;
        };
      }
    ): Promise<void> {
      const depthMode = options?.depthMode ?? 'standard';
      const activeLimit = getActiveQuestionLimit(depthMode);
      // Enforce question limit (only for live queries, not cache hits)
      if (!options?.bypassQuestionLimit && questionCount >= activeLimit) return;

      error = null;
      isLoading = true;
      currentPass = null;
      completedPasses = new Set();
      currentPasses = { analysis: '', critique: '', synthesis: '', verification: '' };
      currentStructuredPasses = {};
      confidenceSummary = null;
      passModels = {};
      passWorkings = {};
      passWorkingLastAt = {};
      passWorkingLastSig = {};
      referencesStore.reset();
      graphStore.reset();

      const domainMode = options?.domainMode ?? 'auto';
      const domain = options?.domain;
      const modelProvider = options?.modelProvider ?? 'auto';
      const modelId = options?.modelId?.trim() || undefined;
      const resourceMode = options?.resourceMode ?? 'standard';
      const normalizedUserLinks = (options?.userLinks ?? [])
        .map((link) => link.trim())
        .filter((link) => link.length > 0);
      const queueForNightlyIngest = options?.queueForNightlyIngest ?? false;
      loadingModelProvider = modelProvider;
      loadingModelId = modelId ?? null;
      trackEvent('query_submitted', {
        query_length: query.length,
        has_lens: !!lens,
        lens: lens || undefined,
        depth_mode: depthMode,
        model_provider: modelProvider,
        model_id: modelId,
        domain_mode: domainMode,
        domain: domain ?? 'auto'
      });

      const cached = historyStore.getCachedResult(query, {
        lens,
        depthMode,
        modelProvider,
        modelId,
        domainMode,
        domain,
        resourceMode,
        userLinks: normalizedUserLinks,
        queueForNightlyIngest
      });
      if (cached) {
        trackEvent('cache_hit');
        applyCachedResult(query, cached, { appendUserMessage: !options?.silentCacheLoad });

        isLoading = false;
        return;
      }

      messages = [...messages, {
        id: crypto.randomUUID(),
        role: 'user',
        content: query,
        timestamp: new Date()
      }];

      // Only count depth for live API queries (not cache/history hits/upgrades)
      if (!options?.bypassQuestionLimit) {
        inquiryDepthMode = depthMode;
        questionCount += 1;
      }

      try {
        const idToken = await getIdToken();
        if (!idToken) {
          throw new Error('Not authenticated');
        }

        const response = await fetch('/api/analyse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            query,
            lens,
            depth: depthMode,
            model_provider: modelProvider,
            model_id: modelId,
            domain_mode: domainMode,
            resource_mode: resourceMode,
            user_links: normalizedUserLinks,
            queue_for_nightly_ingest: queueForNightlyIngest,
            ...(domainMode === 'manual' && domain ? { domain } : {}),
            ...(options?.reuse
              ? {
                  reuse: {
                    from_depth: options.reuse.fromDepth,
                    analysis: options.reuse.analysis,
                    critique: options.reuse.critique,
                    synthesis: options.reuse.synthesis
                  }
                }
              : {})
          })
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errorBody.detail || errorBody.error || `API error: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamedSources: SourceReference[] = [];
        let streamedClaimsByPass: CachedPassClaims[] = [];
        let streamedRelationsByPass: CachedPassRelations[] = [];
        let gotMetadata = false;
        let reasoningQuality: ReasoningEvaluation | null = null;
        const constitutionDeltas: Message['constitutionDeltas'] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: !done });
          }
          if (done) {
            buffer += decoder.decode();
          }

          const parts = buffer.split('\n\n');
          if (done) {
            buffer = '';
          } else {
            buffer = parts.pop() || '';
          }

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;

            const json = line.slice(6);
            let event: SSEEvent;
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }

            if (event.type === 'sources') {
              streamedSources = event.sources;
            }

            if (event.type === 'grounding_sources' && event.sources.length > 0) {
              const titled = event.sources.find((source) => source.title?.trim().length);
              if (titled?.title) {
                addPassWorking(event.pass, `Reviewing source: ${titled.title}`);
              } else {
                addPassWorking(event.pass, 'Reviewing live web sources for corroboration.');
              }
            }

            if (event.type === 'claims') {
              streamedClaimsByPass = [...streamedClaimsByPass, { pass: event.pass, claims: event.claims }];
              if (event.claims.length > 0) {
                const sample = event.claims[0].text.trim();
                const snippet = sample.length > 120 ? `${sample.slice(0, 120)}...` : sample;
                addPassWorking(event.pass, `Assessing claim: ${snippet}`);
              }
            }

            if (event.type === 'relations') {
              streamedRelationsByPass = [...streamedRelationsByPass, { pass: event.pass, relations: event.relations }];
            }

            if (handleSSEEvent(event)) continue;

            switch (event.type) {
              case 'pass_start':
                currentPass = event.pass;
                if (event.model_provider) {
                  loadingModelProvider = event.model_provider;
                }
                if (event.model_id) {
                  loadingModelId = event.model_id;
                }
                if (event.model_provider && event.model_id) {
                  passModels = {
                    ...passModels,
                    [event.pass]: {
                      provider: event.model_provider,
                      modelId: event.model_id
                    }
                  };
                }
                if (event.pass === 'analysis' || event.pass === 'critique' || event.pass === 'synthesis') {
                  for (const seed of PASS_WORKING_SEEDS[event.pass]) {
                    addPassWorking(event.pass, seed);
                  }
                  const matchedPhilosophers = PHILOSOPHER_NAMES
                    .filter((name) => query.toLowerCase().includes(name.toLowerCase()))
                    .slice(0, 2);
                  if (matchedPhilosophers.length > 0) {
                    addPassWorking(
                      event.pass,
                      `Comparing positions from ${matchedPhilosophers.join(' and ')}.`
                    );
                  }
                }
                break;

              case 'pass_chunk':
                currentPasses = {
                  ...currentPasses,
                  [event.pass]: currentPasses[event.pass] + event.content
                };
                if (event.pass === 'analysis' || event.pass === 'critique' || event.pass === 'synthesis') {
                  const passText = `${currentPasses[event.pass]}${event.content}`;
                  if (passText.length > 420) {
                    const sentence = passText
                      .split(/[\n.!?]/)
                      .map((part) => part.trim())
                      .filter((part) => part.length >= 36)
                      .at(-1);
                    if (sentence) {
                      const snippet = sentence.length > 120 ? `${sentence.slice(0, 120)}...` : sentence;
                      addPassWorking(event.pass, `Tracing argument strand: ${snippet}`);
                    }
                  }
                }
                break;

              case 'pass_complete':
                completedPasses = new Set([...completedPasses, event.pass]);
                break;

              case 'pass_structured':
                // Store sections for the structured/summary view.
                // Do NOT overwrite currentPasses[pass] — the full streaming essay is canonical.
                currentStructuredPasses = {
                  ...currentStructuredPasses,
                  [event.pass]: { sections: event.sections, wordCount: event.wordCount }
                };
                break;

              case 'confidence_summary':
                confidenceSummary = {
                  avgConfidence: event.avgConfidence,
                  lowConfidenceCount: event.lowConfidenceCount,
                  totalClaims: event.totalClaims
                };
                break;

              case 'reasoning_quality':
                reasoningQuality = event.reasoning_quality;
                break;

              case 'constitution_delta':
                constitutionDeltas.push({
                  pass: event.pass,
                  introduced_violations: event.introduced_violations,
                  resolved_violations: event.resolved_violations,
                  unresolved_violations: event.unresolved_violations,
                  overall_compliance: event.overall_compliance
                });
                break;

              case 'metadata':
                gotMetadata = true;
                trackEvent('analysis_complete', {
                  duration_ms: event.duration_ms,
                  claims_retrieved: event.claims_retrieved ?? 0,
                  detected_domain: event.detected_domain ?? 'unknown'
                });
                messages = [...messages, {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: currentPasses.synthesis || currentPasses.critique || currentPasses.analysis,
                  passes: { ...currentPasses },
                  structuredPasses: { ...currentStructuredPasses },
                  metadata: {
                    total_input_tokens: event.total_input_tokens,
                    total_output_tokens: event.total_output_tokens,
                    duration_ms: event.duration_ms,
                    claims_retrieved: event.claims_retrieved,
                    arguments_retrieved: event.arguments_retrieved,
                    retrieval_degraded: event.retrieval_degraded,
                    retrieval_degraded_reason: event.retrieval_degraded_reason,
                    depth_mode: event.depth_mode,
                    selected_model_provider: event.selected_model_provider,
                    selected_model_id: event.selected_model_id,
                    query_run_id: event.query_run_id,
                    resource_mode: event.resource_mode,
                    user_links_count: event.user_links_count,
                    runtime_links_processed: event.runtime_links_processed,
                    nightly_queue_enqueued: event.nightly_queue_enqueued,
                    model_cost_breakdown: event.model_cost_breakdown
                  },
                  reasoningQuality: reasoningQuality ?? undefined,
                  constitutionDeltas: constitutionDeltas.length > 0 ? constitutionDeltas : undefined,
                  timestamp: new Date()
                }];

                historyStore.saveCachedResult(query, {
                  lens: lens || undefined,
                  domain_mode: domainMode,
                  domain: domainMode === 'manual' ? domain : undefined,
                  passes: { ...currentPasses },
                  metadata: {
                    total_input_tokens: event.total_input_tokens,
                    total_output_tokens: event.total_output_tokens,
                    duration_ms: event.duration_ms,
                    claims_retrieved: event.claims_retrieved,
                    arguments_retrieved: event.arguments_retrieved,
                    retrieval_degraded: event.retrieval_degraded,
                    retrieval_degraded_reason: event.retrieval_degraded_reason,
                    depth_mode: event.depth_mode,
                    selected_model_provider: event.selected_model_provider,
                    selected_model_id: event.selected_model_id,
                    query_run_id: event.query_run_id,
                    resource_mode: event.resource_mode,
                    user_links_count: event.user_links_count,
                    runtime_links_processed: event.runtime_links_processed,
                    nightly_queue_enqueued: event.nightly_queue_enqueued,
                    model_cost_breakdown: event.model_cost_breakdown
                  },
                  reasoningQuality: reasoningQuality ?? undefined,
                  constitutionDeltas: constitutionDeltas.length > 0 ? constitutionDeltas : undefined,
                  sources: streamedSources,
                  claimsByPass: streamedClaimsByPass,
                  relationsByPass: streamedRelationsByPass
                }, {
                  lens,
                  depthMode,
                  modelProvider,
                  modelId,
                  domainMode,
                  domain,
                  resourceMode,
                  userLinks: normalizedUserLinks,
                  queueForNightlyIngest
                });

                historyStore.addEntry(query, {
                  passCount:
                    depthMode === 'quick'
                      ? 1
                      : currentPasses.synthesis
                        ? 3
                        : currentPasses.critique
                          ? 2
                          : 1,
                  modelProvider: event.selected_model_provider ?? modelProvider,
                  modelId: event.selected_model_id ?? modelId,
                  depthMode: event.depth_mode ?? depthMode
                });

                if (graphStore.rawNodes.length === 0 && (currentPasses.analysis || currentPasses.critique || currentPasses.synthesis)) {
                  const fallback = buildPassFallbackGraph({
                    analysis: currentPasses.analysis,
                    critique: currentPasses.critique,
                    synthesis: currentPasses.synthesis
                  });
                  graphStore.setGraph(
                    fallback.nodes,
                    fallback.edges,
                    {
                      seedNodeIds: ['claim:pass-analysis'],
                      traversedNodeIds: ['claim:pass-critique', 'claim:pass-synthesis'],
                      relationTypeCounts: { 'responds-to': 2, supports: 1 },
                      maxHops: 2,
                      contextSufficiency: 'sparse',
                      retrievalDegraded: true,
                      retrievalDegradedReason: 'fallback_pass_graph',
                      retrievalTimestamp: new Date().toISOString()
                    },
                    1
                  );
                }
                break;

              case 'error':
                error = event.message;
                break;
            }
          }

          if (done) break;
        }

        if (!gotMetadata && (currentPasses.analysis || currentPasses.critique || currentPasses.synthesis)) {
          const fallbackMetadata = {
            total_input_tokens: 0,
            total_output_tokens: 0,
            duration_ms: 0,
            claims_retrieved: 0,
            arguments_retrieved: 0,
            retrieval_degraded: true,
            retrieval_degraded_reason: 'stream_disconnected_before_metadata'
          };

          messages = [...messages, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: currentPasses.synthesis || currentPasses.critique || currentPasses.analysis,
            passes: { ...currentPasses },
            structuredPasses: { ...currentStructuredPasses },
            metadata: fallbackMetadata,
            reasoningQuality: reasoningQuality ?? undefined,
            constitutionDeltas: constitutionDeltas.length > 0 ? constitutionDeltas : undefined,
            timestamp: new Date()
          }];

          historyStore.saveCachedResult(query, {
            lens: lens || undefined,
            domain_mode: domainMode,
            domain: domainMode === 'manual' ? domain : undefined,
            passes: { ...currentPasses },
            metadata: fallbackMetadata,
            reasoningQuality: reasoningQuality ?? undefined,
            constitutionDeltas: constitutionDeltas.length > 0 ? constitutionDeltas : undefined,
            sources: streamedSources,
            claimsByPass: streamedClaimsByPass,
            relationsByPass: streamedRelationsByPass
          }, {
            lens,
            depthMode,
            modelProvider,
            modelId,
            domainMode,
            domain,
            resourceMode,
            userLinks: normalizedUserLinks,
            queueForNightlyIngest
          });

          historyStore.addEntry(query, {
            passCount:
              depthMode === 'quick'
                ? 1
                : currentPasses.synthesis
                  ? 3
                  : currentPasses.critique
                    ? 2
                    : 1,
            modelProvider,
            modelId,
            depthMode
          });
        } else if (!gotMetadata && !error) {
          error = 'Analysis stream ended before a final result was received. Please retry.';
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        isLoading = false;
      }
    },

    async runVerification(): Promise<void> {
      const verificationText =
        currentPasses.synthesis || currentPasses.critique || currentPasses.analysis;
      if (!verificationText) {
        error = 'No completed pass available to verify';
        return;
      }

      error = null;
      isLoading = true;
      currentPass = 'verification';
      currentPasses = { ...currentPasses, verification: '' };
      trackEvent('verification_triggered');

      try {
        const idToken = await getIdToken();
        if (!idToken) {
          throw new Error('Not authenticated');
        }
        const response = await fetch('/api/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            claims: referencesStore.activeClaims,
            synthesisText: verificationText
          })
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errorBody.error || `API error: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: !done });
          }
          if (done) {
            buffer += decoder.decode();
          }

          const parts = buffer.split('\n\n');
          if (done) {
            buffer = '';
          } else {
            buffer = parts.pop() || '';
          }

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;

            const json = line.slice(6);
            let event: any;
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }

            switch (event.type) {
              case 'verification_start':
                break;

              case 'verification_chunk':
                currentPasses = {
                  ...currentPasses,
                  verification: currentPasses.verification + event.content
                };
                break;

              case 'verification_complete':
                currentPass = null;
                completedPasses = new Set([...completedPasses, 'verification']);
                // Patch the last assistant message so verification text persists
                {
                  const lastIdx = messages.findLastIndex(m => m.role === 'assistant');
                  if (lastIdx >= 0) {
                    const prev = messages[lastIdx];
                    const updatedPasses = prev.passes
                      ? { ...prev.passes, verification: currentPasses.verification }
                      : { analysis: '', critique: '', synthesis: '', verification: currentPasses.verification };
                    messages = messages.map((m, i) =>
                      i === lastIdx ? { ...m, passes: updatedPasses } : m
                    );
                  }
                }
                break;

              case 'error':
                error = event.message;
                break;
            }
          }

          if (done) break;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        isLoading = false;
        currentPass = null;
      }
    },

    showCachedVariant(
      query: string,
      options?: {
        lens?: string;
        depthMode?: 'quick' | 'standard' | 'deep';
        modelProvider?: ModelProvider;
        modelId?: string;
        domainMode?: 'auto' | 'manual';
        domain?: 'ethics' | 'philosophy_of_mind';
        resourceMode?: 'standard' | 'expanded';
        userLinks?: string[];
        queueForNightlyIngest?: boolean;
      }
    ): boolean {
      const cached = historyStore.getCachedResult(query, options);
      if (!cached) return false;
      error = null;
      isLoading = false;
      applyCachedResult(query, cached, { appendUserMessage: false });
      return true;
    },

    clear(): void {
      messages = [];
      error = null;
      currentPass = null;
      completedPasses = new Set();
      currentPasses = { analysis: '', critique: '', synthesis: '', verification: '' };
      currentStructuredPasses = {};
      confidenceSummary = null;
      isLoading = false;
      questionCount = 0;
      inquiryDepthMode = 'standard';
      loadingModelProvider = 'auto';
      loadingModelId = null;
      passModels = {};
      passWorkings = {};
      passWorkingLastAt = {};
      passWorkingLastSig = {};
    }
  };
}

export const conversation = createConversationStore();
