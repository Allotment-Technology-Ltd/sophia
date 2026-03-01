import { anthropic, MODEL, trackTokens } from './anthropic';
import { getAnalysisSystemPrompt, buildAnalysisUserPrompt } from './prompts/analysis';
import { getCritiqueSystemPrompt, buildCritiqueUserPrompt } from './prompts/critique';
import { getSynthesisSystemPrompt, buildSynthesisUserPrompt } from './prompts/synthesis';
import { LIVE_EXTRACTION_SYSTEM, buildLiveExtractionPrompt } from './prompts/live-extraction';
import { retrieveContext, buildContextBlock } from './retrieval';
import type { PassType } from '$lib/types/passes';
import type { AnalysisPhase, Claim, RelationBundle } from '$lib/types/references';

export interface EngineCallbacks {
  onPassStart(pass: PassType): void;
  onPassChunk(pass: PassType, content: string): void;
  onPassComplete(pass: PassType): void;
  onClaims(pass: AnalysisPhase, claims: Claim[], relations: RelationBundle[]): void;
  onMetadata(inputTokens: number, outputTokens: number, durationMs: number, retrieval?: { claims_retrieved: number; arguments_retrieved: number }): void;
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

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        segmentOutput += event.delta.text;
        output += event.delta.text;
        callbacks.onPassChunk(pass, event.delta.text);
      }
    }

    const message = await stream.finalMessage();
    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    trackTokens(inputTokens, outputTokens);

    messages.push({ role: 'assistant', content: segmentOutput });

    if (message.stop_reason !== 'max_tokens') {
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
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.2,
    system: LIVE_EXTRACTION_SYSTEM,
    messages: [
      { role: 'user', content: buildLiveExtractionPrompt(passText, phase) }
    ]
  });

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');

  trackTokens(response.usage.input_tokens, response.usage.output_tokens);
  console.log(`[EXTRACTION] ${phase}: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);

  // Strip markdown code blocks if present
  const cleanText = text
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleanText);
  } catch (err) {
    console.error(`[EXTRACTION] ${phase} JSON parse failed. Raw text:`, text);
    throw new Error(`Failed to parse extraction JSON for ${phase}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const claims: Claim[] = (parsed.claims ?? []).map((c: Omit<Claim, 'phase'>) => ({ ...c, phase }));
  const relations: RelationBundle[] = parsed.relations ?? [];
  return { claims, relations };
}

export async function runDialecticalEngine(
  query: string,
  callbacks: EngineCallbacks,
  options?: EngineOptions
): Promise<void> {
  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // ── Retrieve argument-graph context ────────────────────────────────
  let contextBlock = '';
  let claimsRetrieved = 0;
  let argumentsRetrieved = 0;

  try {
    const retrievalResult = await retrieveContext(query);
    contextBlock = buildContextBlock(retrievalResult);
    claimsRetrieved = retrievalResult.claims.length;
    argumentsRetrieved = retrievalResult.arguments.length;

    if (claimsRetrieved > 0) {
      console.log(`[ENGINE] Retrieved ${claimsRetrieved} claims, ${argumentsRetrieved} arguments from graph`);
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
    callbacks.onPassStart('analysis');

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

    callbacks.onPassComplete('analysis');
  } catch (err) {
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
    callbacks.onPassStart('critique');

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

    callbacks.onPassComplete('critique');
  } catch (err) {
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
    callbacks.onPassStart('synthesis');

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

    callbacks.onPassComplete('synthesis');
  } catch (err) {
    callbacks.onError(`Synthesis pass failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Await synthesis extraction before closing stream
  try {
    const { claims, relations } = await extractClaims(synthesisOutput, 'synthesis');
    callbacks.onClaims('synthesis', claims, relations);
  } catch (err) {
    console.error('[EXTRACTION] Synthesis extraction failed (skipping):', err instanceof Error ? err.message : err);
  }

  // ── Metadata ──────────────────────────────────────────────────────
  const durationMs = Date.now() - startTime;
  callbacks.onMetadata(totalInputTokens, totalOutputTokens, durationMs, {
    claims_retrieved: claimsRetrieved,
    arguments_retrieved: argumentsRetrieved
  });
}
