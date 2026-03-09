import { generateObject, generateText, streamText } from 'ai';
import { z } from 'zod';
import { getExtractionModel, getReasoningModel, trackTokens, getGroundingTool } from './vertex';
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
import { retrieveContext, buildContextBlock } from './retrieval';
import { classifyQueryDomain, getRetrievalDomain } from './domainClassifier';
import type { PassType } from '$lib/types/passes';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
import type { PassSection, GraphNode, GraphEdge, GroundingSource } from '$lib/types/api';
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
  onPassStart(pass: PassType): void;
  onPassChunk(pass: PassType, content: string): void;
  onPassComplete(pass: PassType): void;
  onPassStructured(pass: PassType, sections: PassSection[], wordCount: number): void;
  onSources(sources: SourceReference[]): void;
  onGroundingSources(pass: PassType, sources: GroundingSource[]): void;
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
      detected_domain?: string;
      domain_confidence?: 'high' | 'medium' | 'low';
    }
  ): void;
  onError(error: string): void;
}

interface EngineOptions {
  lens?: string;
  mode?: 'philosophy' | 'agnostic';
}

async function streamPassWithContinuation(
  pass: PassType,
  systemPrompt: string,
  initialUserPrompt: string,
  callbacks: EngineCallbacks,
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
      model: getReasoningModel(),
      maxOutputTokens: maxTokens,
      system: systemPrompt,
      messages,
      tools: {
        googleSearch: getGroundingTool()
      },
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

  // ── Domain classification ──────────────────────────────────────────────
  const domainClassification = isAgnosticMode
    ? { domain: null, confidence: 'low' as const, scores: {} }
    : classifyQueryDomain(query);
  const retrievalDomain = isAgnosticMode ? undefined : getRetrievalDomain(domainClassification);
  console.log(
    `[ENGINE] Starting — mode=${engineMode} query="${queryPreview}" lens=${options?.lens ?? 'none'} ` +
    `domain=${domainClassification.domain ?? 'unknown'} ` +
    `confidence=${domainClassification.confidence} ` +
    `retrieval_filter=${retrievalDomain ?? 'none'}`
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

  // Phase 1: Start Analysis
  let analysisStarted = false;
  let critiqueStarted = false;
  let critiquePromise: Promise<{ output: string; inputTokens: number; outputTokens: number; sources: GroundingSource[] }> | null = null;
  let analysisPromise: Promise<{ output: string; inputTokens: number; outputTokens: number; sources: GroundingSource[] }> | null = null;

  const analysisStartTime = Date.now();

  try {
    callbacks.onPassStart('analysis');
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

      while (continuationRound <= 6) {
        let segmentOutput = '';

        const stream = streamText({
          model: getReasoningModel(),
          maxOutputTokens: 4096,
          system: analysisSystem,
          messages,
          tools: {
            googleSearch: getGroundingTool()
          },
          onError: ({ error }) => {
            console.error(`[ENGINE] streamText error (analysis round=${continuationRound}):`, error instanceof Error ? error.stack : String(error));
          }
        });

        for await (const delta of stream.textStream) {
          segmentOutput += delta;
          output += delta;
          callbacks.onPassChunk('analysis', delta);

          // Trigger critique when analysis reaches ~2000 characters (if not already started)
          if (!critiqueStarted && output.length >= 2000) {
            critiqueStarted = true;
            console.log(`[ENGINE] Analysis reached 2000 chars, starting Critique in parallel (round=${continuationRound})`);
            callbacks.onPassStart('critique');
            
            critiquePromise = streamPassWithContinuation(
              'critique',
              critiqueSystem,
              isAgnosticMode
                ? buildReasoningCritiqueUserPrompt(query, `${output}\n[Analysis in progress...]`)
                : buildCritiqueUserPrompt(query, `${output}\n[Analysis in progress...]`),
              callbacks
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
    const analysisResult = await analysisPromise;
    analysisOutput = analysisResult.output;
    const analysisInputTokens = analysisResult.inputTokens;
    const analysisOutputTokens = analysisResult.outputTokens;
    totalInputTokens += analysisInputTokens;
    totalOutputTokens += analysisOutputTokens;
    
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

  // Phase 2: Critique (may already be running in parallel, or starts now if analysis was very short)
  try {
    const t2 = Date.now();
    
    // If critique hasn't started yet (very short analysis), start it now
    if (!critiqueStarted) {
      console.log('[ENGINE] Pass 2 (critique) starting (analysis completed before reaching 2000 chars)');
      callbacks.onPassStart('critique');
      
      critiquePromise = streamPassWithContinuation(
        'critique',
        critiqueSystem,
        isAgnosticMode
          ? buildReasoningCritiqueUserPrompt(query, analysisOutput)
          : buildCritiqueUserPrompt(query, analysisOutput),
        callbacks
      );
    } else {
      console.log('[ENGINE] Pass 2 (critique) already streaming in parallel, waiting for completion');
    }

    // Wait for critique to complete (may have been running in parallel)
    const critiqueResult = await critiquePromise!;
    critiqueOutput = critiqueResult.output;
    const critiqueInputTokens = critiqueResult.inputTokens;
    const critiqueOutputTokens = critiqueResult.outputTokens;
    totalInputTokens += critiqueInputTokens;
    totalOutputTokens += critiqueOutputTokens;
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

  // ── PASS 3: Synthesis (Synthesiser) ───────────────────────────────
  try {
    const t3 = Date.now();
    callbacks.onPassStart('synthesis');
    console.log('[ENGINE] Pass 3 (synthesis) starting');

    const synthesisResult = await streamPassWithContinuation(
      'synthesis',
      synthesisSystem,
      isAgnosticMode
        ? buildReasoningSynthesisUserPrompt(query, analysisOutput, critiqueOutput)
        : buildSynthesisUserPrompt(query, analysisOutput, critiqueOutput),
      callbacks
    );

    synthesisOutput = synthesisResult.output;
    const inputTokens = synthesisResult.inputTokens;
    const outputTokens = synthesisResult.outputTokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    console.log(`[ENGINE] Pass 3 (synthesis) done in ${Date.now() - t3}ms — in=${inputTokens} out=${outputTokens} chars=${synthesisOutput.length}`);

    // Emit grounding sources for synthesis
    if (synthesisResult.sources.length > 0) {
      console.log(`[ENGINE] Synthesis grounding: ${synthesisResult.sources.length} sources`);
      callbacks.onGroundingSources('synthesis', synthesisResult.sources);
    }

    // Parse sophia-meta block for structured output and claims
    const { cleanedText: synthesisCleanedText, metaBlock: synthesisMeta } = extractSophiaMetaBlock(synthesisOutput);
    synthesisOutput = synthesisCleanedText; // Update output to exclude sophia-meta block
    
    let synthesisAllClaims: Claim[] = [];
    if (synthesisMeta) {
      // Emit structured sections
      callbacks.onPassStructured('synthesis', synthesisMeta.sections, synthesisCleanedText.split(/\s+/).length);
      
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
      callbacks.onPassStructured('synthesis', [{ id: 'content', heading: 'Synthesis', content: synthesisCleanedText }], synthesisCleanedText.split(/\s+/).length);
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
    domain_confidence: domainClassification.domain ? domainClassification.confidence : undefined
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

  return { output, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
