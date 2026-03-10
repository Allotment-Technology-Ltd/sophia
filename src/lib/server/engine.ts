import { generateObject, generateText, streamText } from 'ai';
import { z } from 'zod';
import {
  getExtractionModel,
  getReasoningModelRoute,
  type ReasoningModelRoute,
  trackTokens,
  getGroundingTool
} from './vertex';
import { getAnalysisSystemPrompt, buildAnalysisUserPrompt } from './prompts/analysis';
import { getCritiqueSystemPrompt, buildCritiqueUserPrompt } from './prompts/critique';
import { getSynthesisSystemPrompt, buildSynthesisUserPrompt } from './prompts/synthesis';
import {
  buildReasoningAnalysisUserPrompt,
  getReasoningAnalysisSystemPrompt
} from './prompts/reasoning-analysis';
import {
  buildReasoningCritiqueUserPrompt,
  getReasoningCritiqueSystemPrompt
} from './prompts/reasoning-critique';
import {
  buildReasoningSynthesisUserPrompt,
  getReasoningSynthesisSystemPrompt
} from './prompts/reasoning-synthesis';
import { VERIFICATION_SYSTEM, buildVerificationUserPrompt } from './prompts/verification';
import { ensureHarvardReferencesSection } from './citations/harvard';
import { retrieveContext, buildContextBlock } from './retrieval';
import { classifyQueryDomain, getRetrievalDomain } from './domainClassifier';
import type { PassType } from '$lib/types/passes';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
import type {
  PassSection,
  GraphNode,
  GraphEdge,
  GraphSnapshotMeta,
  GroundingSource
} from '$lib/types/api';
import { projectRetrievalToGraph } from './graphProjection';


// ─── Sophia-Meta Block Parsing ────────────────────────────────────────────
// Inline structured output within pass responses
const SophiaMetaSectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  content: z.string()
});

const SophiaMetaClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  badge: z.enum(['thesis', 'premise', 'objection', 'response', 'definition', 'empirical']),
  source: z.string(),
  tradition: z.string(),
  confidence: z.number().min(0).max(1),
  sourceUrl: z.string().url().optional()
});

const SophiaMetaBlockSchema = z.object({
  sections: z.array(SophiaMetaSectionSchema).default([]),
  claims: z.array(SophiaMetaClaimSchema).default([])
});

export { SophiaMetaBlockSchema, SophiaMetaClaimSchema };

export function extractSophiaMetaBlock<T extends z.ZodTypeAny = typeof SophiaMetaBlockSchema>(
  text: string,
  schema?: T
): { cleanedText: string; metaBlock: z.infer<T> | null } {
  // Find the sophia-meta fenced block
  const metaMatch = text.match(/```sophia-meta\n?([\s\S]*?)\n?```/);
  if (!metaMatch) {
    return { cleanedText: text, metaBlock: null };
  }

  try {
    const metaJson = JSON.parse(metaMatch[1]);
    const parser = schema ?? SophiaMetaBlockSchema;
    const validated = parser.safeParse(metaJson);
    if (!validated.success) {
      console.warn('[SOPHIA-META] Failed to validate block:', validated.error);
      return { cleanedText: text, metaBlock: null };
    }

    // Remove the sophia-meta block from the text
    const cleanedText = text.replace(/```sophia-meta\n?([\s\S]*?)\n?```\n?/, '').trim();
    return { cleanedText, metaBlock: validated.data as z.infer<T> };
  } catch (err) {
    console.warn('[SOPHIA-META] Failed to parse block:', err instanceof Error ? err.message : err);
    return { cleanedText: text, metaBlock: null };
  }
}

export interface EngineCallbacks {
  onPassStart(
    pass: PassType,
    model?: { provider: 'vertex' | 'anthropic'; modelId: string }
  ): void;
  onPassChunk(pass: PassType, content: string): void;
  onPassComplete(pass: PassType): void;
  onPassStructured(pass: PassType, sections: PassSection[], wordCount: number): void;
  onSources(sources: SourceReference[]): void;
  onGroundingSources(pass: PassType, sources: GroundingSource[]): void;
  onGraphSnapshot(
    nodes: GraphNode[],
    edges: GraphEdge[],
    meta?: GraphSnapshotMeta,
    version?: number
  ): void;
  onClaims(pass: AnalysisPhase, claims: Claim[], relations: RelationBundle[]): void;
  onConfidenceSummary?(avgConfidence: number, lowConfidenceCount: number, totalClaims: number): void;
  onMetadata(
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    retrieval?: {
      claims_retrieved: number;
      arguments_retrieved: number;
      retrieval_degraded?: boolean;
      retrieval_degraded_reason?: string;
      detected_domain?: string;
      domain_confidence?: 'high' | 'medium' | 'low';
      selected_domain_mode?: 'auto' | 'manual';
      selected_domain?: 'ethics' | 'philosophy_of_mind';
    },
    modelCostBreakdown?: {
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
    }
  ): void;
  onError(error: string): void;
}

interface EngineOptions {
  lens?: string;
  mode?: 'philosophy' | 'agnostic';
  domainMode?: 'auto' | 'manual';
  domain?: 'ethics' | 'philosophy_of_mind';
  modelProvider?: 'auto' | 'vertex' | 'anthropic';
  modelId?: string;
  queryRunId?: string;
  depthMode?: 'quick' | 'standard' | 'deep';
  reuse?: {
    fromDepth: 'quick' | 'standard';
    analysis?: string;
    critique?: string;
    synthesis?: string;
  };
}

function withPassTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch((err) => reject(err))
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  });
}

const DEFAULT_INPUT_COST_PER_MILLION = Number.parseFloat(
  process.env.MODEL_COST_DEFAULT_INPUT_PER_MILLION ?? '3'
);
const DEFAULT_OUTPUT_COST_PER_MILLION = Number.parseFloat(
  process.env.MODEL_COST_DEFAULT_OUTPUT_PER_MILLION ?? '15'
);
let cachedModelCostOverrides:
  | Record<string, { input_per_million: number; output_per_million: number }>
  | null = null;

function getModelCostOverrides(): Record<string, { input_per_million: number; output_per_million: number }> {
  if (cachedModelCostOverrides) return cachedModelCostOverrides;
  const raw = process.env.MODEL_COST_OVERRIDES_JSON;
  if (!raw) {
    cachedModelCostOverrides = {};
    return cachedModelCostOverrides;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, { input_per_million: number; output_per_million: number }>;
    cachedModelCostOverrides = parsed;
    return cachedModelCostOverrides;
  } catch {
    console.warn('[ENGINE] MODEL_COST_OVERRIDES_JSON is invalid JSON; ignoring overrides');
    cachedModelCostOverrides = {};
    return cachedModelCostOverrides;
  }
}

function getModelCostRates(provider: 'vertex' | 'anthropic', modelId: string): {
  input_per_million: number;
  output_per_million: number;
} {
  const overrides = getModelCostOverrides();
  const exactKey = `${provider}:${modelId}`;
  return (
    overrides[exactKey] ??
    overrides[modelId] ?? {
      input_per_million: DEFAULT_INPUT_COST_PER_MILLION,
      output_per_million: DEFAULT_OUTPUT_COST_PER_MILLION
    }
  );
}

function emitReusedPass(
  pass: Extract<PassType, 'analysis' | 'critique'>,
  rawText: string,
  callbacks: EngineCallbacks,
  model?: { provider: 'vertex' | 'anthropic'; modelId: string }
): string {
  callbacks.onPassStart(pass, model);
  callbacks.onPassChunk(pass, rawText);
  const { cleanedText, metaBlock } = extractSophiaMetaBlock(rawText);
  const phase = pass as AnalysisPhase;

  if (metaBlock) {
    callbacks.onPassStructured(pass, metaBlock.sections, cleanedText.split(/\s+/).length);
    const claims: Claim[] = metaBlock.claims.map((c: z.infer<typeof SophiaMetaClaimSchema>) => ({
      ...c,
      phase,
      detail: c.text
    }));
    callbacks.onClaims(phase, claims, []);
  } else {
    const heading = pass === 'analysis' ? 'Analysis' : 'Critique';
    callbacks.onPassStructured(pass, [{ id: 'content', heading, content: cleanedText }], cleanedText.split(/\s+/).length);
  }

  callbacks.onPassComplete(pass);
  return cleanedText;
}

async function streamPassWithContinuation(
  pass: PassType,
  systemPrompt: string,
  initialUserPrompt: string,
  callbacks: EngineCallbacks,
  modelRoute: ReasoningModelRoute,
  maxTokens = 4096,
  maxContinuationRounds = 6
): Promise<{ output: string; inputTokens: number; outputTokens: number; sources: GroundingSource[] }> {
  let output = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let continuationRound = 0;
  let allSources: GroundingSource[] = [];

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: initialUserPrompt }
  ];

  while (continuationRound <= maxContinuationRounds) {
    let segmentOutput = '';

    const stream = streamText({
      model: modelRoute.model as any,
      maxOutputTokens: maxTokens,
      system: systemPrompt,
      messages,
      ...(modelRoute.supportsGrounding
        ? {
            tools: {
              googleSearch: getGroundingTool() as any
            }
          }
        : {}),
      onError: ({ error }) => {
        console.error(`[ENGINE] streamText error (${pass} round=${continuationRound}):`, error instanceof Error ? error.stack : String(error));
      }
    });

    for await (const delta of stream.textStream) {
      segmentOutput += delta;
      output += delta;
      callbacks.onPassChunk(pass, delta);
    }

    const usage = await stream.totalUsage;
    const finishReason = await stream.finishReason;
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    trackTokens(inputTokens, outputTokens);

    // Extract grounding sources from stream
    const sources = await stream.sources;
    if (sources && sources.length > 0) {
      const groundingSources = sources
        .filter((s): s is Extract<typeof s, { sourceType: 'url' }> => 
          s.type === 'source' && s.sourceType === 'url'
        )
        .map(s => ({
          url: s.url,
          title: s.title,
          pass
        }));
      allSources.push(...groundingSources);
    }

    messages.push({ role: 'assistant', content: segmentOutput });

    if (finishReason !== 'length') {
      break;
    }

    continuationRound += 1;
    messages.push({
      role: 'user',
      content:
        'Continue exactly where you left off. Do not restart or repeat. First finish any incomplete sentence, then complete any remaining required sections and end with a clean closing paragraph.'
    });
  }

  return {
    output,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    sources: allSources
  };
}

export function aggregateConfidenceMetrics(claimsList: Claim[]): {
  avgConfidence: number;
  lowConfidenceCount: number;
  totalClaims: number;
} {
  const claimsWithConfidence = claimsList.filter((c) => c.confidence !== undefined && c.confidence !== null);
  const totalClaims = claimsWithConfidence.length;
  
  if (totalClaims === 0) {
    return { avgConfidence: 0, lowConfidenceCount: 0, totalClaims: 0 };
  }
  
  const sumConfidence = claimsWithConfidence.reduce((sum, c) => sum + (c.confidence ?? 0), 0);
  const avgConfidence = sumConfidence / totalClaims;
  const lowConfidenceCount = claimsWithConfidence.filter((c) => (c.confidence ?? 0) < 0.7).length;
  
  return { avgConfidence, lowConfidenceCount, totalClaims };
}

export async function runDialecticalEngine(
  query: string,
  callbacks: EngineCallbacks,
  options?: EngineOptions
): Promise<void> {
  const startTime = Date.now();
  const queryPreview = query.slice(0, 60).replace(/\n/g, ' ');
  const engineMode = options?.mode ?? 'philosophy';
  const isAgnosticMode = engineMode === 'agnostic';
  const selectedDomainMode = options?.domainMode ?? 'auto';
  const selectedDomain = options?.domain;
  const modelProvider = options?.modelProvider ?? 'auto';
  const modelId = options?.modelId;
  const depthMode = options?.depthMode ?? 'standard';
  const analysisModelRoute = getReasoningModelRoute({
    depthMode,
    pass: 'analysis',
    requestedProvider: modelProvider,
    requestedModelId: modelId
  });
  const critiqueModelRoute = getReasoningModelRoute({
    depthMode,
    pass: 'critique',
    requestedProvider: modelProvider,
    requestedModelId: modelId
  });
  const synthesisModelRoute = getReasoningModelRoute({
    depthMode,
    pass: 'synthesis',
    requestedProvider: modelProvider,
    requestedModelId: modelId
  });
  const allowParallelCritique =
    analysisModelRoute.provider === 'vertex' && critiqueModelRoute.provider === 'vertex';
  const modelUsage = new Map<
    string,
    {
      provider: 'vertex' | 'anthropic';
      model: string;
      passes: Set<string>;
      input_tokens: number;
      output_tokens: number;
      input_cost_per_million: number;
      output_cost_per_million: number;
    }
  >();

  function recordModelUsage(
    route: ReasoningModelRoute,
    pass: 'analysis' | 'critique' | 'synthesis',
    inputTokens: number,
    outputTokens: number
  ): void {
    if (inputTokens <= 0 && outputTokens <= 0) return;
    const key = `${route.provider}:${route.modelId}`;
    const rates = getModelCostRates(route.provider, route.modelId);
    const existing = modelUsage.get(key);
    if (existing) {
      existing.input_tokens += inputTokens;
      existing.output_tokens += outputTokens;
      existing.passes.add(pass);
      return;
    }
    modelUsage.set(key, {
      provider: route.provider,
      model: route.modelId,
      passes: new Set([pass]),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      input_cost_per_million: rates.input_per_million,
      output_cost_per_million: rates.output_per_million
    });
  }

  function buildModelCostBreakdown():
    | {
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
      }
    | undefined {
    if (modelUsage.size === 0) return undefined;
    const byModel = [...modelUsage.values()].map((entry) => {
      const estimated_cost_usd =
        (entry.input_tokens * entry.input_cost_per_million +
          entry.output_tokens * entry.output_cost_per_million) /
        1_000_000;
      return {
        provider: entry.provider,
        model: entry.model,
        passes: [...entry.passes].sort(),
        input_tokens: entry.input_tokens,
        output_tokens: entry.output_tokens,
        input_cost_per_million: entry.input_cost_per_million,
        output_cost_per_million: entry.output_cost_per_million,
        estimated_cost_usd
      };
    }).sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd);
    const total_estimated_cost_usd = byModel.reduce((sum, item) => sum + item.estimated_cost_usd, 0);
    return { total_estimated_cost_usd, by_model: byModel };
  }
  const reusedAnalysis = options?.reuse?.analysis?.trim();
  const reusedCritique = options?.reuse?.critique?.trim();
  const reusedSynthesis = options?.reuse?.synthesis?.trim();
  const PASS_TIMEOUT_MS: Record<'vertex' | 'anthropic', Record<'analysis' | 'critique' | 'synthesis', number>> = {
    vertex: { analysis: 95_000, critique: 95_000, synthesis: 105_000 },
    anthropic: { analysis: 150_000, critique: 180_000, synthesis: 200_000 }
  };

  // ── Domain classification ──────────────────────────────────────────────
  const domainClassification = isAgnosticMode
    ? { domain: null, confidence: 'low' as const, scores: {} }
    : classifyQueryDomain(query);
  const retrievalDomain = isAgnosticMode
    ? undefined
    : selectedDomainMode === 'manual' && selectedDomain
      ? selectedDomain
      : getRetrievalDomain(domainClassification);
  console.log(
    `[ENGINE] Starting — mode=${engineMode} query="${queryPreview}" lens=${options?.lens ?? 'none'} ` +
    `domain=${domainClassification.domain ?? 'unknown'} ` +
    `confidence=${domainClassification.confidence} ` +
    `retrieval_filter=${retrievalDomain ?? 'none'} ` +
    `model_provider=${modelProvider} ` +
    `models={analysis:${analysisModelRoute.provider}:${analysisModelRoute.modelId},` +
    `critique:${critiqueModelRoute.provider}:${critiqueModelRoute.modelId},` +
    `synthesis:${synthesisModelRoute.provider}:${synthesisModelRoute.modelId}} ` +
    `parallel_critique=${allowParallelCritique}`
  );

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // ── Retrieve argument-graph context ─────────────────────────────────────
  // Domain filter applied when classifier is high-confidence and domain has graph data.
  // Falls back to cross-domain search for uncertain or uningested domains.
  let contextBlock = '';
  let claimsRetrieved = 0;
  let argumentsRetrieved = 0;
  let retrievalDegraded = false;
  let retrievalDegradedReason: string | undefined;

  try {
    const t0 = Date.now();
    const retrievalResult = await retrieveContext(query, { domain: retrievalDomain });
    contextBlock = buildContextBlock(retrievalResult);
    claimsRetrieved = retrievalResult.claims.length;
    argumentsRetrieved = retrievalResult.arguments.length;
    retrievalDegraded = retrievalResult.degraded;
    retrievalDegradedReason = retrievalResult.degraded_reason;
    console.log(`[ENGINE] Retrieval done in ${Date.now() - t0}ms — claims=${claimsRetrieved} arguments=${argumentsRetrieved}`);
    if (retrievalDegraded) {
      console.warn('[ENGINE] Retrieval degraded mode active', { reason: retrievalDegradedReason });
    }

    const sourceMap = new Map<string, SourceReference>();
    for (const claim of retrievalResult.claims) {
      const sourceId = `${claim.source_title}::${claim.source_author.join('|')}`;
      const existing = sourceMap.get(sourceId);
      if (existing) {
        existing.claimCount += 1;
        continue;
      }
      sourceMap.set(sourceId, {
        id: sourceId,
        title: claim.source_title,
        author: claim.source_author,
        claimCount: 1
      });
    }

    callbacks.onSources(Array.from(sourceMap.values()));

    // Emit graph snapshot for visualization.
    // Always emit (even empty) so clients can render an explicit degraded reason.
    if (claimsRetrieved > 0) {
      const graphData = projectRetrievalToGraph(retrievalResult);
      const snapshotId = `snapshot:${crypto.randomUUID()}`;
      console.log('[ENGINE] Emitting graph snapshot:', { nodeCount: graphData.nodes.length, edgeCount: graphData.edges.length, claimsRetrieved, argumentsRetrieved });
      callbacks.onGraphSnapshot(
        graphData.nodes,
        graphData.edges,
        {
          ...graphData.meta,
          snapshot_id: snapshotId,
          query_run_id: options?.queryRunId,
          pass_sequence: 0
        },
        2
      );
    } else {
      const snapshotId = `snapshot:${crypto.randomUUID()}`;
      console.log('[ENGINE] No claims retrieved (claimsRetrieved=0), emitting empty degraded snapshot');
      callbacks.onGraphSnapshot(
        [],
        [],
        {
          seedNodeIds: [],
          traversedNodeIds: [],
          relationTypeCounts: {},
          maxHops: 0,
          contextSufficiency: 'sparse',
          retrievalDegraded: true,
          retrievalDegradedReason: retrievalDegradedReason ?? 'no_claims_retrieved',
          retrievalTimestamp: new Date().toISOString(),
          snapshot_id: snapshotId,
          query_run_id: options?.queryRunId,
          pass_sequence: 0
        },
        2
      );
    }
  } catch (err) {
    console.error('[ENGINE] Retrieval failed (continuing without graph context):', err instanceof Error ? err.message : err);
    contextBlock = '';
  }

  // Build system prompts with contextual knowledge injected
  const analysisSystem = isAgnosticMode
    ? getReasoningAnalysisSystemPrompt(contextBlock)
    : getAnalysisSystemPrompt(contextBlock);
  const critiqueSystem = isAgnosticMode
    ? getReasoningCritiqueSystemPrompt(contextBlock)
    : getCritiqueSystemPrompt(contextBlock);
  const synthesisSystem = isAgnosticMode
    ? getReasoningSynthesisSystemPrompt(contextBlock)
    : getSynthesisSystemPrompt(contextBlock);

  // ── HYBRID PARALLELISM: Analysis → Critique (when Analysis ~30% done) → Synthesis ──
  let analysisOutput = '';
  let critiqueOutput = '';
  let synthesisOutput = '';

  // Phase 1: Analysis (or replay from reuse payload)
  let analysisStarted = false;
  let critiqueStarted = false;
  let critiquePromise: Promise<{ output: string; inputTokens: number; outputTokens: number; sources: GroundingSource[] }> | null = null;
  let analysisPromise: Promise<{ output: string; inputTokens: number; outputTokens: number; sources: GroundingSource[] }> | null = null;

  const analysisStartTime = Date.now();

  if (reusedAnalysis) {
    console.log('[ENGINE] Pass 1 (analysis) reused from previous run');
    analysisOutput = emitReusedPass('analysis', reusedAnalysis, callbacks, {
      provider: analysisModelRoute.provider,
      modelId: analysisModelRoute.modelId
    });
  } else {
    try {
      callbacks.onPassStart('analysis', {
        provider: analysisModelRoute.provider,
        modelId: analysisModelRoute.modelId
      });
      console.log('[ENGINE] Pass 1 (analysis) starting');

    // Create a custom promise for analysis that monitors output length to trigger critique
    analysisPromise = (async () => {
      let output = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let continuationRound = 0;
      let allSources: GroundingSource[] = [];

      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        {
          role: 'user',
          content: isAgnosticMode
            ? buildReasoningAnalysisUserPrompt(query, options?.lens)
            : buildAnalysisUserPrompt(query, options?.lens)
        }
      ];

      const analysisMaxOutputTokens = depthMode === 'deep' ? 5500 : 4096;
      const analysisMaxContinuationRounds = depthMode === 'deep' ? 8 : 6;
      const critiqueStartThreshold = depthMode === 'deep' ? 2600 : 2000;

      while (continuationRound <= analysisMaxContinuationRounds) {
        let segmentOutput = '';

        const stream = streamText({
          model: analysisModelRoute.model as any,
          maxOutputTokens: analysisMaxOutputTokens,
          system: analysisSystem,
          messages,
          ...(analysisModelRoute.supportsGrounding
            ? {
                tools: {
                  googleSearch: getGroundingTool() as any
                }
              }
            : {}),
          onError: ({ error }) => {
            console.error(`[ENGINE] streamText error (analysis round=${continuationRound}):`, error instanceof Error ? error.stack : String(error));
          }
        });

        for await (const delta of stream.textStream) {
          segmentOutput += delta;
          output += delta;
          callbacks.onPassChunk('analysis', delta);

          // Trigger critique when analysis reaches threshold (if not already started)
          if (depthMode !== 'quick' && allowParallelCritique && !critiqueStarted && output.length >= critiqueStartThreshold) {
            critiqueStarted = true;
            console.log(`[ENGINE] Analysis reached ${critiqueStartThreshold} chars, starting Critique in parallel (round=${continuationRound})`);
            callbacks.onPassStart('critique', {
              provider: critiqueModelRoute.provider,
              modelId: critiqueModelRoute.modelId
            });
            
            critiquePromise = streamPassWithContinuation(
              'critique',
              critiqueSystem,
              isAgnosticMode
                ? buildReasoningCritiqueUserPrompt(query, `${output}\n[Analysis in progress...]`)
                : buildCritiqueUserPrompt(query, `${output}\n[Analysis in progress...]`),
              callbacks,
              critiqueModelRoute,
              depthMode === 'deep' ? 5200 : 4096,
              depthMode === 'deep' ? 8 : 6
            );
          }
        }

        const usage = await stream.totalUsage;
        const finishReason = await stream.finishReason;
        const inputTokens = usage.inputTokens ?? 0;
        const outputTokens = usage.outputTokens ?? 0;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        trackTokens(inputTokens, outputTokens);

        // Extract grounding sources from stream
        const sources = await stream.sources;
        if (sources && sources.length > 0) {
          const groundingSources = sources
            .filter((s): s is Extract<typeof s, { sourceType: 'url' }> => 
              s.type === 'source' && s.sourceType === 'url'
            )
            .map(s => ({
              url: s.url,
              title: s.title,
              pass: 'analysis' as PassType
            }));
          allSources.push(...groundingSources);
        }

        messages.push({ role: 'assistant', content: segmentOutput });

        if (finishReason !== 'length') {
          break;
        }

        continuationRound += 1;
        messages.push({
          role: 'user',
          content:
            'Continue exactly where you left off. Do not restart or repeat. First finish any incomplete sentence, then complete any remaining required sections and end with a clean closing paragraph.'
        });
      }

      analysisStarted = true;
      return { output, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, sources: allSources };
    })();

    // Wait for analysis to complete
    const analysisResult = await withPassTimeout(
      analysisPromise,
      PASS_TIMEOUT_MS[analysisModelRoute.provider].analysis,
      'Analysis pass'
    );
    analysisOutput = analysisResult.output;
    const analysisInputTokens = analysisResult.inputTokens;
    const analysisOutputTokens = analysisResult.outputTokens;
    totalInputTokens += analysisInputTokens;
    totalOutputTokens += analysisOutputTokens;
    recordModelUsage(analysisModelRoute, 'analysis', analysisInputTokens, analysisOutputTokens);
    
    const analysisElapsed = Date.now() - analysisStartTime;
    console.log(`[ENGINE] Pass 1 (analysis) done in ${analysisElapsed}ms — in=${analysisInputTokens} out=${analysisOutputTokens} chars=${analysisOutput.length}`);

    // Emit grounding sources for analysis
    if (analysisResult.sources.length > 0) {
      console.log(`[ENGINE] Analysis grounding: ${analysisResult.sources.length} sources`);
      callbacks.onGroundingSources('analysis', analysisResult.sources);
    }

    // Parse sophia-meta block for structured output and claims
    const { cleanedText: analysisCleanedText, metaBlock: analysisMeta } = extractSophiaMetaBlock(analysisOutput);
    analysisOutput = analysisCleanedText; // Update output to exclude sophia-meta block
    
    if (analysisMeta) {
      // Emit structured sections
      callbacks.onPassStructured('analysis', analysisMeta.sections, analysisCleanedText.split(/\s+/).length);
      
      // Emit claims
      const claims: Claim[] = analysisMeta.claims.map((c: z.infer<typeof SophiaMetaClaimSchema>) => ({
        ...c,
        phase: 'analysis' as const,
        detail: c.text // Use the claim text as detail since sophia-meta doesn't include a separate detail field
      }));
      callbacks.onClaims('analysis', claims, []);
    } else {
      // Fallback: emit generic structured output without claims
      console.warn('[ENGINE] No sophia-meta block found in analysis output');
      callbacks.onPassStructured('analysis', [{ id: 'content', heading: 'Analysis', content: analysisCleanedText }], analysisCleanedText.split(/\s+/).length);
    }

      callbacks.onPassComplete('analysis');
    } catch (err) {
      console.error('[ENGINE] Pass 1 (analysis) FAILED:', err instanceof Error ? err.stack : String(err));
      callbacks.onError(`Analysis pass failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  if (depthMode === 'quick') {
    const durationMs = Date.now() - startTime;
    console.log(`[ENGINE] Quick mode complete in ${durationMs}ms — totalIn=${totalInputTokens} totalOut=${totalOutputTokens}`);
    callbacks.onMetadata(totalInputTokens, totalOutputTokens, durationMs, {
      claims_retrieved: claimsRetrieved,
      arguments_retrieved: argumentsRetrieved,
      retrieval_degraded: retrievalDegraded,
      retrieval_degraded_reason: retrievalDegradedReason,
      detected_domain: domainClassification.domain ?? undefined,
      domain_confidence: domainClassification.domain ? domainClassification.confidence : undefined,
      selected_domain_mode: selectedDomainMode,
      selected_domain: selectedDomainMode === 'manual' ? selectedDomain : undefined
    }, buildModelCostBreakdown());
    return;
  }

  // Phase 2: Critique (or replay from reuse payload)
  if (reusedCritique) {
    console.log('[ENGINE] Pass 2 (critique) reused from previous run');
    critiqueOutput = emitReusedPass('critique', reusedCritique, callbacks, {
      provider: critiqueModelRoute.provider,
      modelId: critiqueModelRoute.modelId
    });
  } else {
    try {
      const t2 = Date.now();

      // If critique hasn't started yet (very short analysis), start it now
      if (!critiqueStarted) {
        console.log('[ENGINE] Pass 2 (critique) starting (analysis completed before reaching 2000 chars)');
        callbacks.onPassStart('critique', {
          provider: critiqueModelRoute.provider,
          modelId: critiqueModelRoute.modelId
        });

        critiquePromise = streamPassWithContinuation(
          'critique',
          critiqueSystem,
          isAgnosticMode
            ? buildReasoningCritiqueUserPrompt(query, analysisOutput)
            : buildCritiqueUserPrompt(query, analysisOutput),
          callbacks,
          critiqueModelRoute,
          depthMode === 'deep' ? 5200 : 4096,
          depthMode === 'deep' ? 8 : 6
        );
      } else {
        console.log('[ENGINE] Pass 2 (critique) already streaming in parallel, waiting for completion');
      }

      // Wait for critique to complete (may have been running in parallel)
      const critiqueResult = await withPassTimeout(
        critiquePromise!,
        PASS_TIMEOUT_MS[critiqueModelRoute.provider].critique,
        'Critique pass'
      );
      critiqueOutput = critiqueResult.output;
      const critiqueInputTokens = critiqueResult.inputTokens;
      const critiqueOutputTokens = critiqueResult.outputTokens;
      totalInputTokens += critiqueInputTokens;
      totalOutputTokens += critiqueOutputTokens;
      recordModelUsage(critiqueModelRoute, 'critique', critiqueInputTokens, critiqueOutputTokens);
      console.log(`[ENGINE] Pass 2 (critique) done in ${Date.now() - t2}ms — in=${critiqueInputTokens} out=${critiqueOutputTokens} chars=${critiqueOutput.length}`);

      // Emit grounding sources for critique
      if (critiqueResult.sources.length > 0) {
        console.log(`[ENGINE] Critique grounding: ${critiqueResult.sources.length} sources`);
        callbacks.onGroundingSources('critique', critiqueResult.sources);
      }

      // Parse sophia-meta block for structured output and claims
      const { cleanedText: critiqueCleanedText, metaBlock: critiqueMeta } = extractSophiaMetaBlock(critiqueOutput);
      critiqueOutput = critiqueCleanedText; // Update output to exclude sophia-meta block

      if (critiqueMeta) {
        // Emit structured sections
        callbacks.onPassStructured('critique', critiqueMeta.sections, critiqueCleanedText.split(/\s+/).length);

        // Emit claims
        const claims: Claim[] = critiqueMeta.claims.map((c: z.infer<typeof SophiaMetaClaimSchema>) => ({
          ...c,
          phase: 'critique' as const,
          detail: c.text // Use the claim text as detail since sophia-meta doesn't include a separate detail field
        }));
        callbacks.onClaims('critique', claims, []);
      } else {
        // Fallback: emit generic structured output without claims
        console.warn('[ENGINE] No sophia-meta block found in critique output');
        callbacks.onPassStructured('critique', [{ id: 'content', heading: 'Critique', content: critiqueCleanedText }], critiqueCleanedText.split(/\s+/).length);
      }

      callbacks.onPassComplete('critique');
    } catch (err) {
      console.error('[ENGINE] Pass 2 (critique) FAILED:', err instanceof Error ? err.stack : String(err));
      callbacks.onError(`Critique pass failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  // ── PASS 3: Synthesis (Synthesiser) ───────────────────────────────
  try {
    const t3 = Date.now();
    callbacks.onPassStart('synthesis', {
      provider: synthesisModelRoute.provider,
      modelId: synthesisModelRoute.modelId
    });
    console.log('[ENGINE] Pass 3 (synthesis) starting');

    const synthesisUserPrompt = isAgnosticMode
      ? buildReasoningSynthesisUserPrompt(query, analysisOutput, critiqueOutput)
      : buildSynthesisUserPrompt(query, analysisOutput, critiqueOutput);
    const synthesisPromptWithReuse =
      depthMode === 'deep' && reusedSynthesis
        ? `${synthesisUserPrompt}\n\nPREVIOUS SYNTHESIS (for refinement/extension; avoid repeating verbatim):\n${reusedSynthesis}`
        : synthesisUserPrompt;

    const synthesisResult = await withPassTimeout(
      streamPassWithContinuation(
      'synthesis',
      synthesisSystem,
      synthesisPromptWithReuse,
      callbacks,
      synthesisModelRoute,
      depthMode === 'deep' ? 5600 : 4096,
      depthMode === 'deep' ? 8 : 6
      ),
      PASS_TIMEOUT_MS[synthesisModelRoute.provider].synthesis,
      'Synthesis pass'
    );

    synthesisOutput = synthesisResult.output;
    const inputTokens = synthesisResult.inputTokens;
    const outputTokens = synthesisResult.outputTokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    recordModelUsage(synthesisModelRoute, 'synthesis', inputTokens, outputTokens);
    console.log(`[ENGINE] Pass 3 (synthesis) done in ${Date.now() - t3}ms — in=${inputTokens} out=${outputTokens} chars=${synthesisOutput.length}`);

    // Emit grounding sources for synthesis
    if (synthesisResult.sources.length > 0) {
      console.log(`[ENGINE] Synthesis grounding: ${synthesisResult.sources.length} sources`);
      callbacks.onGroundingSources('synthesis', synthesisResult.sources);
    }

    // Parse sophia-meta block for structured output and claims
    const { cleanedText: synthesisCleanedText, metaBlock: synthesisMeta } = extractSophiaMetaBlock(synthesisOutput);
    synthesisOutput = synthesisCleanedText; // Update output to exclude sophia-meta block
    const synthesisHarvard = ensureHarvardReferencesSection(synthesisOutput, 'synthesis');
    synthesisOutput = synthesisHarvard.text;
    if (synthesisHarvard.appendedText) {
      callbacks.onPassChunk('synthesis', synthesisHarvard.appendedText);
    }
    
    let synthesisAllClaims: Claim[] = [];
    if (synthesisMeta) {
      // Emit structured sections
      callbacks.onPassStructured('synthesis', synthesisMeta.sections, synthesisOutput.split(/\s+/).length);
      
      // Emit claims
      synthesisAllClaims = synthesisMeta.claims.map((c: z.infer<typeof SophiaMetaClaimSchema>) => ({
        ...c,
        phase: 'synthesis' as const,
        detail: c.text // Use the claim text as detail since sophia-meta doesn't include a separate detail field
      }));
      callbacks.onClaims('synthesis', synthesisAllClaims, []);
    } else {
      // Fallback: emit generic structured output without claims
      console.warn('[ENGINE] No sophia-meta block found in synthesis output');
      callbacks.onPassStructured('synthesis', [{ id: 'content', heading: 'Synthesis', content: synthesisOutput }], synthesisOutput.split(/\s+/).length);
    }

    callbacks.onPassComplete('synthesis');
    
    // Calculate and emit confidence summary if callback is defined
    if (synthesisAllClaims.length > 0 && callbacks.onConfidenceSummary) {
      const metrics = aggregateConfidenceMetrics(synthesisAllClaims);
      callbacks.onConfidenceSummary(metrics.avgConfidence, metrics.lowConfidenceCount, metrics.totalClaims);
    }
  } catch (err) {
    console.error('[ENGINE] Pass 3 (synthesis) FAILED:', err instanceof Error ? err.stack : String(err));
    callbacks.onError(`Synthesis pass failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── Metadata ──────────────────────────────────────────────────────
  const durationMs = Date.now() - startTime;
  console.log(`[ENGINE] Complete in ${durationMs}ms — totalIn=${totalInputTokens} totalOut=${totalOutputTokens}`);
  callbacks.onMetadata(totalInputTokens, totalOutputTokens, durationMs, {
    claims_retrieved: claimsRetrieved,
    arguments_retrieved: argumentsRetrieved,
    retrieval_degraded: retrievalDegraded,
    retrieval_degraded_reason: retrievalDegradedReason,
    detected_domain: domainClassification.domain ?? undefined,
    domain_confidence: domainClassification.domain ? domainClassification.confidence : undefined,
    selected_domain_mode: selectedDomainMode,
    selected_domain: selectedDomainMode === 'manual' ? selectedDomain : undefined
  }, buildModelCostBreakdown());
}

/**
 * Run Pass 4: Web Verification
 * Verifies claims against academic sources using Google Search grounding
 */
export async function runVerificationPass(
  claims: Claim[],
  synthesisText: string,
  callbacks: EngineCallbacks,
  options?: {
    depthMode?: 'quick' | 'standard' | 'deep';
    modelProvider?: 'auto' | 'vertex' | 'anthropic';
  }
): Promise<{ output: string; inputTokens: number; outputTokens: number }> {
  let output = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const verificationModelRoute = getReasoningModelRoute({
    pass: 'verification',
    depthMode: options?.depthMode ?? 'standard',
    requestedProvider: options?.modelProvider ?? 'auto'
  });

  const stream = streamText({
    model: verificationModelRoute.model as any,
    maxOutputTokens: 4096,
    system: VERIFICATION_SYSTEM,
    prompt: buildVerificationUserPrompt(claims, synthesisText),
    onError: ({ error }) => {
      console.error('[ENGINE] streamText error (verification):', error instanceof Error ? error.stack : String(error));
    }
  });

  for await (const delta of stream.textStream) {
    output += delta;
    callbacks.onPassChunk('verification', delta);
  }

  const usage = await stream.totalUsage;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  totalInputTokens += inputTokens;
  totalOutputTokens += outputTokens;
  trackTokens(inputTokens, outputTokens);
  const verificationHarvard = ensureHarvardReferencesSection(output, 'verification');
  output = verificationHarvard.text;
  if (verificationHarvard.appendedText) {
    callbacks.onPassChunk('verification', verificationHarvard.appendedText);
  }

  return { output, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
