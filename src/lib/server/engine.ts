import { anthropic, MODEL, trackTokens } from './anthropic';
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserPrompt } from './prompts/analysis';
import { CRITIQUE_SYSTEM_PROMPT, buildCritiqueUserPrompt } from './prompts/critique';
import { SYNTHESIS_SYSTEM_PROMPT, buildSynthesisUserPrompt } from './prompts/synthesis';
import type { PassType } from '$lib/types/passes';

export interface EngineCallbacks {
  onPassStart(pass: PassType): void;
  onPassChunk(pass: PassType, content: string): void;
  onPassComplete(pass: PassType): void;
  onMetadata(inputTokens: number, outputTokens: number, durationMs: number): void;
  onError(error: string): void;
}

interface EngineOptions {
  lens?: string;
}

export async function runDialecticalEngine(
  query: string,
  callbacks: EngineCallbacks,
  options?: EngineOptions
): Promise<void> {
  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // ── PASS 1: Analysis (Proponent) ──────────────────────────────────
  let analysisOutput = '';
  try {
    callbacks.onPassStart('analysis');

    const analysisStream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildAnalysisUserPrompt(query, options?.lens) }
      ]
    });

    for await (const event of analysisStream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        analysisOutput += event.delta.text;
        callbacks.onPassChunk('analysis', event.delta.text);
      }
    }

    const analysisMessage = await analysisStream.finalMessage();
    const inputTokens = analysisMessage.usage.input_tokens;
    const outputTokens = analysisMessage.usage.output_tokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    trackTokens(inputTokens, outputTokens);

    callbacks.onPassComplete('analysis');
  } catch (err) {
    callbacks.onError(`Analysis pass failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── PASS 2: Critique (Adversary) ──────────────────────────────────
  let critiqueOutput = '';
  try {
    callbacks.onPassStart('critique');

    const critiqueStream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1536,
      system: CRITIQUE_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildCritiqueUserPrompt(query, analysisOutput) }
      ]
    });

    for await (const event of critiqueStream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        critiqueOutput += event.delta.text;
        callbacks.onPassChunk('critique', event.delta.text);
      }
    }

    const critiqueMessage = await critiqueStream.finalMessage();
    const inputTokens = critiqueMessage.usage.input_tokens;
    const outputTokens = critiqueMessage.usage.output_tokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    trackTokens(inputTokens, outputTokens);

    callbacks.onPassComplete('critique');
  } catch (err) {
    callbacks.onError(`Critique pass failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── PASS 3: Synthesis (Synthesiser) ───────────────────────────────
  try {
    callbacks.onPassStart('synthesis');

    const synthesisStream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 2560,
      system: SYNTHESIS_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildSynthesisUserPrompt(query, analysisOutput, critiqueOutput) }
      ]
    });

    for await (const event of synthesisStream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        callbacks.onPassChunk('synthesis', event.delta.text);
      }
    }

    const synthesisMessage = await synthesisStream.finalMessage();
    const inputTokens = synthesisMessage.usage.input_tokens;
    const outputTokens = synthesisMessage.usage.output_tokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    trackTokens(inputTokens, outputTokens);

    callbacks.onPassComplete('synthesis');
  } catch (err) {
    callbacks.onError(`Synthesis pass failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── Metadata ──────────────────────────────────────────────────────
  const durationMs = Date.now() - startTime;
  callbacks.onMetadata(totalInputTokens, totalOutputTokens, durationMs);
}
