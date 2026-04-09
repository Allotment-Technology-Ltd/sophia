/**
 * Conservative max batch *target* tokens for ingest stages (used when splitting
 * claims into API calls). Lower cap ⇒ more batches ⇒ less context overflow.
 *
 * Compared against estimated prompt tokens (including safety multipliers) in scripts/ingest.ts.
 */

export type IngestReasoningStage = 'relations' | 'grouping' | 'validation';

const MIN_TARGET = 2_500;
const DEFAULT_UNKNOWN_VALIDATION = 48_000;
const DEFAULT_UNKNOWN_GROUPING = 80_000;
const DEFAULT_UNKNOWN_RELATIONS = 16_000;

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

/** Order: more specific patterns before broader `gpt-4` / `claude` matches. */
function maxBatchTargetForModel(stage: IngestReasoningStage, modelLower: string): number {
  const m = modelLower;

  if (stage === 'validation') {
    if (m.includes('gpt-3.5')) return 10_000;
    if (m.includes('gpt-4o-mini')) return 90_000;
    if (m.includes('gpt-4-turbo')) return 100_000;
    if (m.includes('gpt-4o')) return 100_000;
    if (m.startsWith('gpt-4') || m.includes('gpt-4')) return 72_000;
    if (m.includes('o1') || m.includes('o3')) return 80_000;
    if (m.includes('claude-3-haiku') || m.includes('claude-haiku')) return 22_000;
    if (m.includes('claude-3-5-sonnet') || m.includes('claude-sonnet-4')) return 120_000;
    if (m.includes('claude')) return 100_000;
    if (m.includes('gemini') && (m.includes('flash') || m.includes('2.5'))) return 90_000;
    if (m.includes('gemini')) return 72_000;
    return DEFAULT_UNKNOWN_VALIDATION;
  }

  if (stage === 'grouping') {
    if (m.includes('gpt-3.5')) return 12_000;
    if (m.includes('gpt-4o-mini')) return 90_000;
    if (m.includes('gpt-4-turbo') || m.includes('gpt-4o')) return 100_000;
    if (m.startsWith('gpt-4') || m.includes('gpt-4')) return 80_000;
    if (m.includes('claude-3-haiku') || m.includes('claude-haiku')) return 28_000;
    if (m.includes('claude')) return 100_000;
    if (m.includes('gemini') && m.includes('flash')) return 90_000;
    if (m.includes('gemini')) return 72_000;
    return DEFAULT_UNKNOWN_GROUPING;
  }

  // relations
  if (m.includes('gpt-3.5')) return 8_000;
  if (m.includes('gpt-4o-mini')) return 24_000;
  if (m.includes('gpt-4o')) return 36_000;
  if (m.includes('gpt-4-turbo')) return 28_000;
  if (m.startsWith('gpt-4') || m.includes('gpt-4')) return 22_000;
  if (m.includes('claude-3-haiku') || m.includes('claude-haiku')) return 14_000;
  if (m.includes('claude')) return 24_000;
  if (m.includes('gemini') && m.includes('flash')) return 22_000;
  if (m.includes('gemini')) return 18_000;
  return DEFAULT_UNKNOWN_RELATIONS;
}

export interface CapIngestBatchTargetResult {
  /** Value passed to batch builders (after min(requested, modelMax) and floor). */
  value: number;
  /** Original env / requested target. */
  requested: number;
  /** Model-specific ceiling used. */
  modelCeiling: number;
  /** True when value < requested. */
  capped: boolean;
}

/**
 * Caps the batch target toward a model-safe maximum. Does not raise above `requested`.
 */
export function capIngestBatchTargetForPlan(args: {
  stage: IngestReasoningStage;
  requested: number;
  provider: string;
  model: string;
}): CapIngestBatchTargetResult {
  const requested = Math.max(MIN_TARGET, Math.trunc(args.requested));
  const modelLower = normalizeModelId(args.model);
  const ceiling = maxBatchTargetForModel(args.stage, modelLower);
  const value = Math.max(MIN_TARGET, Math.min(requested, ceiling));
  return {
    value,
    requested,
    modelCeiling: ceiling,
    capped: value < requested
  };
}

export function isContextLengthExceededError(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err);
  return (
    /context_length_exceeded/i.test(s) ||
    /exceeds the context window/i.test(s) ||
    /context window of this model/i.test(s) ||
    /maximum context length/i.test(s)
  );
}
