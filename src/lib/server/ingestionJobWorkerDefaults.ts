import type { IngestRunPayload } from './ingestRuns';
import { INGEST_CLI_FORCE_STAGES } from './ingestRuns';

type BO = NonNullable<IngestRunPayload['batch_overrides']>;

const asInt = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asFloat = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Accepts arbitrary JSON from the admin jobs API and returns only safe, bounded `batch_overrides` fields.
 */
export function sanitizeIngestionJobWorkerDefaults(raw: unknown): BO | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: BO = {};

  const extTok = asInt(o.extractionMaxTokensPerSection);
  if (extTok != null && extTok >= 1000 && extTok <= 20_000) out.extractionMaxTokensPerSection = extTok;

  const grp = asInt(o.groupingTargetTokens);
  if (grp != null && grp >= 10_000 && grp <= 400_000) out.groupingTargetTokens = grp;

  const val = asInt(o.validationTargetTokens);
  if (val != null && val >= 10_000 && val <= 400_000) out.validationTargetTokens = val;

  const rel = asInt(o.relationsTargetTokens);
  if (rel != null && rel >= 5000 && rel <= 250_000) out.relationsTargetTokens = rel;

  const emb = asInt(o.embedBatchSize);
  if (emb != null && emb >= 25 && emb <= 2000) out.embedBatchSize = emb;

  const embDel = asInt(o.embedBatchDelayMs);
  if (embDel != null && embDel >= 0 && embDel <= 3_600_000) out.embedBatchDelayMs = embDel;

  const overlap = asInt(o.relationsBatchOverlapClaims);
  if (overlap != null && overlap >= 1 && overlap <= 99) out.relationsBatchOverlapClaims = overlap;

  const extConc = asInt(o.extractionConcurrency);
  if (extConc != null && extConc >= 1 && extConc <= 16) out.extractionConcurrency = extConc;

  const passConc = asInt(o.passageInsertConcurrency);
  if (passConc != null && passConc >= 1 && passConc <= 12) out.passageInsertConcurrency = passConc;

  const claimConc = asInt(o.claimInsertConcurrency);
  if (claimConc != null && claimConc >= 1 && claimConc <= 24) out.claimInsertConcurrency = claimConc;

  const remMax = asInt(o.remediationMaxClaims);
  if (remMax != null && remMax >= 1 && remMax <= 200) out.remediationMaxClaims = remMax;

  const rf = asInt(o.remediationFaithfulnessMin);
  if (rf != null && rf >= 1 && rf <= 100) out.remediationFaithfulnessMin = rf;

  if (
    o.ingestProvider === 'auto' ||
    o.ingestProvider === 'anthropic' ||
    o.ingestProvider === 'vertex' ||
    o.ingestProvider === 'mistral'
  ) {
    out.ingestProvider = o.ingestProvider;
  }
  if (typeof o.failOnGroupingPositionCollapse === 'boolean') {
    out.failOnGroupingPositionCollapse = o.failOnGroupingPositionCollapse;
  }
  if (typeof o.ingestLogPins === 'boolean') out.ingestLogPins = o.ingestLogPins;
  if (typeof o.googleGenerativeThroughput === 'boolean') {
    out.googleGenerativeThroughput = o.googleGenerativeThroughput;
  }
  const googleFloor = asInt(o.googleExtractionConcurrencyFloor);
  if (googleFloor != null && googleFloor >= 1 && googleFloor <= 12) {
    out.googleExtractionConcurrencyFloor = googleFloor;
  }
  if (typeof o.ingestRemediationEnabled === 'boolean') {
    out.ingestRemediationEnabled = o.ingestRemediationEnabled;
  }
  if (typeof o.ingestRemediationRevalidate === 'boolean') {
    out.ingestRemediationRevalidate = o.ingestRemediationRevalidate;
  }
  if (typeof o.ingestRemediationTargetedRevalidate === 'boolean') {
    out.ingestRemediationTargetedRevalidate = o.ingestRemediationTargetedRevalidate;
  }
  if (typeof o.ingestRemediationForceRelationsRerun === 'boolean') {
    out.ingestRemediationForceRelationsRerun = o.ingestRemediationForceRelationsRerun;
  }
  const forceStageRaw = o.forceStage;
  if (
    typeof forceStageRaw === 'string' &&
    (INGEST_CLI_FORCE_STAGES as readonly string[]).includes(forceStageRaw)
  ) {
    out.forceStage = forceStageRaw as BO['forceStage'];
  }

  if (typeof o.forceReingest === 'boolean') {
    out.forceReingest = o.forceReingest;
  }
  // `INGEST_FORCE_REINGEST` is equivalent to `--force-stage extracting` and would override a validation tail.
  if (out.forceStage && out.forceStage !== 'extracting') {
    delete out.forceReingest;
  }

  const fsckRaw = o.forceStageMissingCheckpoint ?? o.ingestForceStageMissingCheckpoint;
  if (typeof fsckRaw === 'string') {
    const t = fsckRaw.trim().toLowerCase();
    if (t === 'error' || t === 'full' || t === 'resume') {
      out.forceStageMissingCheckpoint = t as BO['forceStageMissingCheckpoint'];
    }
  }
  if (out.forceStage === 'validating' && out.forceStageMissingCheckpoint === undefined) {
    out.forceStageMissingCheckpoint = 'resume';
  }

  const tBounds = (n: number | null) => n != null && n >= 10_000 && n <= 3_600_000;
  const mt = asInt(o.ingestModelTimeoutMs);
  if (tBounds(mt)) out.ingestModelTimeoutMs = mt!;
  const vt = asInt(o.validationModelTimeoutMs);
  if (tBounds(vt)) out.validationModelTimeoutMs = vt!;
  const vTo = asInt(o.ingestStageValidationTimeoutMs);
  if (tBounds(vTo)) out.ingestStageValidationTimeoutMs = vTo!;
  const exTo = asInt(o.ingestStageExtractionTimeoutMs);
  if (tBounds(exTo)) out.ingestStageExtractionTimeoutMs = exTo!;
  const relTo = asInt(o.ingestStageRelationsTimeoutMs);
  if (tBounds(relTo)) out.ingestStageRelationsTimeoutMs = relTo!;
  const grpTo = asInt(o.ingestStageGroupingTimeoutMs);
  if (tBounds(grpTo)) out.ingestStageGroupingTimeoutMs = grpTo!;
  const embTo = asInt(o.ingestStageEmbeddingTimeoutMs);
  if (tBounds(embTo)) out.ingestStageEmbeddingTimeoutMs = embTo!;
  const jrTo = asInt(o.ingestStageJsonRepairTimeoutMs);
  if (tBounds(jrTo)) out.ingestStageJsonRepairTimeoutMs = jrTo!;
  const remTo = asInt(o.ingestStageRemediationTimeoutMs);
  if (tBounds(remTo)) out.ingestStageRemediationTimeoutMs = remTo!;

  const idleRaw = o.watchdogPhaseIdleJson;
  if (typeof idleRaw === 'string' && idleRaw.trim().length > 2) {
    try {
      const parsed = JSON.parse(idleRaw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out.watchdogPhaseIdleJson = JSON.stringify(parsed);
      }
    } catch {
      /* skip */
    }
  }

  const mult = asFloat(o.watchdogPhaseBaselineMult);
  if (mult != null && mult >= 0.5 && mult <= 10) out.watchdogPhaseBaselineMult = mult;

  return Object.keys(out).length > 0 ? out : undefined;
}
