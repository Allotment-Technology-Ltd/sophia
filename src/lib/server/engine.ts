import { generateObject, streamText } from 'ai';
import { z } from 'zod';
import { getExtractionModel, getReasoningModel, trackTokens, buildGroundingTool } from './vertex';
import { getAnalysisSystemPrompt, buildAnalysisUserPrompt } from './prompts/analysis';
import { getCritiqueSystemPrompt, buildCritiqueUserPrompt } from './prompts/critique';
import { getSynthesisSystemPrompt, buildSynthesisUserPrompt } from './prompts/synthesis';
import { LIVE_EXTRACTION_SYSTEM, buildLiveExtractionPrompt } from './prompts/live-extraction';
import { VERIFICATION_SYSTEM, buildVerificationUserPrompt } from './prompts/verification';
import { retrieveContext, buildContextBlock } from './retrieval';
import type { PassType } from '$lib/types/passes';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
import type { PassSection, GraphNode, GraphEdge } from '$lib/types/api';
import { refinePass } from './passRefinement';
import { projectRetrievalToGraph } from './graphProjection';

// ─── MVP Configuration ────────────────────────────────────────────────────
// Constrain MVP to ethics domain for focused rollout. Remove this in MVP+1.
const MVP_DOMAIN_FILTER = 'ethics' as const;

const LiveClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  badge: z.enum(['thesis', 'premise', 'objection', 'response', 'definition', 'empirical']),
  source: z.string(),
  tradition: z.string(),
  detail: z.string(),
  confidence: z.number().min(0).max(1).optional()
});

const LiveRelationSchema = z.object({
  claimId: z.string(),
  relations: z.array(
    z.object({
      type: z.enum(['supports', 'contradicts', 'responds-to', 'depends-on']),
      target: z.string(),
      label: z.string()
    })
  )
});

const LiveExtractionSchema = z.object({
  claims: z.array(LiveClaimSchema).default([]),
  relations: z.array(LiveRelationSchema).default([])
});

export interface EngineCallbacks {
  onPassStart(pass: PassType): void;
  onPassChunk(pass: PassType, content: string): void;
  onPassComplete(pass: PassType): void;
  onPassStructured(pass: PassType, sections: PassSection[], wordCount: number): void;
  onSources(sources: SourceReference[]): void;
  onGraphSnapshot(nodes: GraphNode[], edges: GraphEdge[]): void;
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
    }
  ): void;
  onError(error: string): void;
}

interface EngineOptions {
  lens?: string;
}

async function streamPassWithContinuation(
  pass: PassType,
  systemPrompt: string,
  initialUserPrompt: string,
  callbacks: EngineCallbacks,
  maxTokens = 4096,
  maxContinuationRounds = 6
): Promise<{ output: string; inputTokens: number; outputTokens: number }> {
  let output = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let continuationRound = 0;

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: initialUserPrompt }
  ];

  while (continuationRound <= maxContinuationRounds) {
    let segmentOutput = '';

    const stream = streamText({
      model: getReasoningModel(),
      maxOutputTokens: maxTokens,
      system: systemPrompt,
      messages
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
    outputTokens: totalOutputTokens
  };
}

async function extractClaims(passText: string, phase: AnalysisPhase): Promise<{ claims: Claim[]; relations: RelationBundle[] }> {
  const response = await generateObject({
    model: getExtractionModel(),
    maxOutputTokens: 1500,
    temperature: 0.2,
    system: LIVE_EXTRACTION_SYSTEM,
    prompt: buildLiveExtractionPrompt(passText, phase),
    schema: LiveExtractionSchema
  });

  trackTokens(response.usage.inputTokens ?? 0, response.usage.outputTokens ?? 0);
  console.log(`[EXTRACTION] ${phase}: ${response.usage.inputTokens ?? 0} in, ${response.usage.outputTokens ?? 0} out`);

  const claims: Claim[] = response.object.claims.map((claim) => ({ ...claim, phase }));
  const relations: RelationBundle[] = response.object.relations;
  return { claims, relations };
}

function aggregateConfidenceMetrics(claimsList: Claim[]): {
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
  console.log(`[ENGINE] Starting — query="${queryPreview}" lens=${options?.lens ?? 'none'}`);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // ── Retrieve argument-graph context (ethics domain only for MVP) ────────
  let contextBlock = '';
  let claimsRetrieved = 0;
  let argumentsRetrieved = 0;
  let retrievalDegraded = false;
  let retrievalDegradedReason: string | undefined;

  try {
    const t0 = Date.now();
    const retrievalResult = await retrieveContext(query, { domain: MVP_DOMAIN_FILTER });
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

    // Emit graph snapshot for visualization (only when retrieval succeeds)
    if (claimsRetrieved > 0) {
      const graphData = projectRetrievalToGraph(retrievalResult);
      console.log('[ENGINE] Emitting graph snapshot:', { nodeCount: graphData.nodes.length, edgeCount: graphData.edges.length, claimsRetrieved, argumentsRetrieved });
      callbacks.onGraphSnapshot(graphData.nodes, graphData.edges);
    } else {
      console.log('[ENGINE] No claims retrieved (claimsRetrieved=0), skipping graph snapshot');
    }
  } catch (err) {
    console.error('[ENGINE] Retrieval failed (continuing without graph context):', err instanceof Error ? err.message : err);
    contextBlock = '';
  }

  // Build system prompts with contextual knowledge injected
  const analysisSystem = getAnalysisSystemPrompt(contextBlock);
  const critiqueSystem = getCritiqueSystemPrompt(contextBlock);
  const synthesisSystem = getSynthesisSystemPrompt(contextBlock);

  // ── PASS 1: Analysis (Proponent) ──────────────────────────────────
  let analysisOutput = '';
  try {
    const t1 = Date.now();
    callbacks.onPassStart('analysis');
    console.log('[ENGINE] Pass 1 (analysis) starting');

    const analysisResult = await streamPassWithContinuation(
      'analysis',
      analysisSystem,
      buildAnalysisUserPrompt(query, options?.lens),
      callbacks
    );

    analysisOutput = analysisResult.output;
    const inputTokens = analysisResult.inputTokens;
    const outputTokens = analysisResult.outputTokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    console.log(`[ENGINE] Pass 1 (analysis) done in ${Date.now() - t1}ms — in=${inputTokens} out=${outputTokens} chars=${analysisOutput.length}`);

    // Refine pass into structured sections
    const refined = await refinePass(analysisOutput, 'analysis');
    callbacks.onPassStructured('analysis', refined.sections, refined.wordCount);

    callbacks.onPassComplete('analysis');
  } catch (err) {
    console.error('[ENGINE] Pass 1 (analysis) FAILED:', err instanceof Error ? err.stack : String(err));
    callbacks.onError(`Analysis pass failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Non-blocking claim extraction for analysis pass
  extractClaims(analysisOutput, 'analysis')
    .then(({ claims, relations }) => callbacks.onClaims('analysis', claims, relations))
    .catch(err => console.error('[EXTRACTION] Analysis extraction failed (skipping):', err instanceof Error ? err.message : err));

  // ── PASS 2: Critique (Adversary) ──────────────────────────────────
  let critiqueOutput = '';
  try {
    const t2 = Date.now();
    callbacks.onPassStart('critique');
    console.log('[ENGINE] Pass 2 (critique) starting');

    const critiqueResult = await streamPassWithContinuation(
      'critique',
      critiqueSystem,
      buildCritiqueUserPrompt(query, analysisOutput),
      callbacks
    );

    critiqueOutput = critiqueResult.output;
    const inputTokens = critiqueResult.inputTokens;
    const outputTokens = critiqueResult.outputTokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    console.log(`[ENGINE] Pass 2 (critique) done in ${Date.now() - t2}ms — in=${inputTokens} out=${outputTokens} chars=${critiqueOutput.length}`);

    // Refine pass into structured sections
    const refined = await refinePass(critiqueOutput, 'critique');
    callbacks.onPassStructured('critique', refined.sections, refined.wordCount);

    callbacks.onPassComplete('critique');
  } catch (err) {
    console.error('[ENGINE] Pass 2 (critique) FAILED:', err instanceof Error ? err.stack : String(err));
    callbacks.onError(`Critique pass failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Non-blocking claim extraction for critique pass
  extractClaims(critiqueOutput, 'critique')
    .then(({ claims, relations }) => callbacks.onClaims('critique', claims, relations))
    .catch(err => console.error('[EXTRACTION] Critique extraction failed (skipping):', err instanceof Error ? err.message : err));

  // ── PASS 3: Synthesis (Synthesiser) ───────────────────────────────
  let synthesisOutput = '';
  try {
    const t3 = Date.now();
    callbacks.onPassStart('synthesis');
    console.log('[ENGINE] Pass 3 (synthesis) starting');

    const synthesisResult = await streamPassWithContinuation(
      'synthesis',
      synthesisSystem,
      buildSynthesisUserPrompt(query, analysisOutput, critiqueOutput),
      callbacks
    );

    synthesisOutput = synthesisResult.output;
    const inputTokens = synthesisResult.inputTokens;
    const outputTokens = synthesisResult.outputTokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    console.log(`[ENGINE] Pass 3 (synthesis) done in ${Date.now() - t3}ms — in=${inputTokens} out=${outputTokens} chars=${synthesisOutput.length}`);

    // Refine pass into structured sections
    const refined = await refinePass(synthesisOutput, 'synthesis');
    callbacks.onPassStructured('synthesis', refined.sections, refined.wordCount);

    callbacks.onPassComplete('synthesis');
  } catch (err) {
    console.error('[ENGINE] Pass 3 (synthesis) FAILED:', err instanceof Error ? err.stack : String(err));
    callbacks.onError(`Synthesis pass failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Await synthesis extraction before closing stream
  let allClaims: Claim[] = [];
  try {
    const { claims, relations } = await extractClaims(synthesisOutput, 'synthesis');
    callbacks.onClaims('synthesis', claims, relations);
    allClaims = claims;
  } catch (err) {
    console.error('[EXTRACTION] Synthesis extraction failed (skipping):', err instanceof Error ? err.message : err);
  }

  // Calculate and emit confidence summary if callback is defined
  if (allClaims.length > 0 && callbacks.onConfidenceSummary) {
    const metrics = aggregateConfidenceMetrics(allClaims);
    callbacks.onConfidenceSummary(metrics.avgConfidence, metrics.lowConfidenceCount, metrics.totalClaims);
  }

  // ── Metadata ──────────────────────────────────────────────────────
  const durationMs = Date.now() - startTime;
  console.log(`[ENGINE] Complete in ${durationMs}ms — totalIn=${totalInputTokens} totalOut=${totalOutputTokens}`);
  callbacks.onMetadata(totalInputTokens, totalOutputTokens, durationMs, {
    claims_retrieved: claimsRetrieved,
    arguments_retrieved: argumentsRetrieved,
    retrieval_degraded: retrievalDegraded,
    retrieval_degraded_reason: retrievalDegradedReason
  });
}

/**
 * Run Pass 4: Web Verification
 * Verifies claims against academic sources using Google Search grounding
 */
export async function runVerificationPass(
  claims: Claim[],
  synthesisText: string,
  callbacks: EngineCallbacks
): Promise<{ output: string; inputTokens: number; outputTokens: number }> {
  let output = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const stream = streamText({
    model: getReasoningModel(),
    maxOutputTokens: 4096,
    system: VERIFICATION_SYSTEM,
    prompt: buildVerificationUserPrompt(claims, synthesisText)
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

  return { output, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
