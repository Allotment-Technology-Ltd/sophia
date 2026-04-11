/**
 * Optional per-phase idle thresholds for the Neon ingest watchdog.
 * Complements `INGEST_WATCHDOG_IDLE_MS` when long phases (extraction, store) need shorter silence detection.
 */

import type { IdleStalledIngestCandidateRow } from '../db/ingestRunRepository';

const MIN_THRESHOLD_MS = 60_000;

export type IngestTimingStageMsKey =
  | 'extracting'
  | 'relating'
  | 'grouping'
  | 'embedding'
  | 'validating'
  | 'remediating'
  | 'storing';

/** Map orchestrator `current_stage_key` → `[INGEST_TIMING].stage_ms` property. */
export function ingestCurrentStageToTimingKey(
  current: string | null | undefined
): IngestTimingStageMsKey | null {
  const k = (current ?? '').trim().toLowerCase();
  if (!k) return null;
  if (k === 'extract') return 'extracting';
  if (k === 'relate') return 'relating';
  if (k === 'group') return 'grouping';
  if (k === 'embed') return 'embedding';
  if (k === 'validate') return 'validating';
  if (k === 'remediation') return 'remediating';
  if (k === 'store') return 'storing';
  return null;
}

export function parsePhaseIdleJson(raw: string | undefined | null): Partial<Record<IngestTimingStageMsKey, number>> | null {
  if (raw == null || !raw.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const out: Partial<Record<IngestTimingStageMsKey, number>> = {};
    for (const [key, val] of Object.entries(o)) {
      const n = typeof val === 'number' ? val : parseInt(String(val), 10);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (
        key === 'extracting' ||
        key === 'relating' ||
        key === 'grouping' ||
        key === 'embedding' ||
        key === 'validating' ||
        key === 'remediating' ||
        key === 'storing'
      ) {
        out[key] = Math.min(n, 86_400_000);
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function mergePhaseIdleMaps(
  a: Partial<Record<IngestTimingStageMsKey, number>> | null,
  b: Partial<Record<IngestTimingStageMsKey, number>> | null
): Partial<Record<IngestTimingStageMsKey, number>> | null {
  if (!a && !b) return null;
  return { ...(a ?? {}), ...(b ?? {}) };
}

/** Smallest configured phase threshold from env `INGEST_WATCHDOG_PHASE_IDLE_JSON` (widens SQL listing). */
export function ingestWatchdogListQueryIdleMs(baseIdleMs: number): number {
  const envParsed = parsePhaseIdleJson(process.env.INGEST_WATCHDOG_PHASE_IDLE_JSON?.trim());
  if (!envParsed) return baseIdleMs;
  const vals = Object.values(envParsed).filter((n) => typeof n === 'number' && n > 0) as number[];
  if (vals.length === 0) return baseIdleMs;
  return Math.min(baseIdleMs, ...vals);
}

function parseLastTimingStageMs(line: string | null | undefined): Partial<Record<IngestTimingStageMsKey, number>> {
  if (!line?.trim()) return {};
  const jsonStart = line.indexOf('{');
  if (jsonStart < 0) return {};
  try {
    const payload = JSON.parse(line.slice(jsonStart)) as { stage_ms?: Record<string, number> };
    const sm = payload.stage_ms;
    if (!sm || typeof sm !== 'object') return {};
    const out: Partial<Record<IngestTimingStageMsKey, number>> = {};
    for (const k of Object.keys(sm) as string[]) {
      const v = sm[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
      if (
        k === 'extracting' ||
        k === 'relating' ||
        k === 'grouping' ||
        k === 'embedding' ||
        k === 'validating' ||
        k === 'remediating' ||
        k === 'storing'
      ) {
        out[k as IngestTimingStageMsKey] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function baselineFromCompletedStages(
  stageMs: Partial<Record<IngestTimingStageMsKey, number>>,
  timingKey: IngestTimingStageMsKey,
  multiplier: number
): number | null {
  const order: IngestTimingStageMsKey[] = [
    'extracting',
    'relating',
    'grouping',
    'embedding',
    'validating',
    'remediating',
    'storing'
  ];
  const idx = order.indexOf(timingKey);
  if (idx <= 0) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < idx; i++) {
    const k = order[i]!;
    const v = stageMs[k];
    if (typeof v === 'number' && v > 0) {
      sum += v;
      n += 1;
    }
  }
  if (n === 0) return null;
  const avg = sum / n;
  return Math.round(avg * multiplier);
}

/**
 * Idle threshold for terminalizing this run: env phase map, else optional baseline from last `[INGEST_TIMING]`, else base.
 */
export function resolveWatchdogIdleThresholdMs(
  baseIdleMs: number,
  row: IdleStalledIngestCandidateRow
): number {
  const envMap = parsePhaseIdleJson(process.env.INGEST_WATCHDOG_PHASE_IDLE_JSON?.trim());
  const runMap = parsePhaseIdleJson(row.watchdogPhaseIdleJson);
  const phaseMap = mergePhaseIdleMaps(envMap, runMap);
  const timingKey = ingestCurrentStageToTimingKey(row.currentStageKey);
  if (timingKey && phaseMap && typeof phaseMap[timingKey] === 'number') {
    return Math.max(MIN_THRESHOLD_MS, Math.min(phaseMap[timingKey]!, 86_400_000));
  }

  const multRaw =
    row.watchdogPhaseBaselineMult != null && Number.isFinite(row.watchdogPhaseBaselineMult)
      ? String(row.watchdogPhaseBaselineMult)
      : process.env.INGEST_WATCHDOG_PHASE_BASELINE_MULT?.trim();
  const mult = multRaw ? parseFloat(multRaw) : NaN;
  if (
    timingKey &&
    Number.isFinite(mult) &&
    mult > 0 &&
    mult <= 10 &&
    row.lastIngestTimingLine
  ) {
    const stageMs = parseLastTimingStageMs(row.lastIngestTimingLine);
    const derived = baselineFromCompletedStages(stageMs, timingKey, mult);
    if (derived != null && derived > 0) {
      return Math.max(MIN_THRESHOLD_MS, Math.min(derived, 86_400_000));
    }
  }

  return Math.max(MIN_THRESHOLD_MS, baseIdleMs);
}

export function runActivityMs(row: IdleStalledIngestCandidateRow): number {
  const a = row.lastOutputAt ?? 0;
  const b = row.workerHeartbeatAt ?? 0;
  if (a <= 0 && b <= 0) return row.createdAtMs;
  return Math.max(a, b);
}

export function isPastWatchdogThreshold(
  nowMs: number,
  row: IdleStalledIngestCandidateRow,
  baseIdleMs: number
): boolean {
  const threshold = resolveWatchdogIdleThresholdMs(baseIdleMs, row);
  return nowMs - runActivityMs(row) > threshold;
}
