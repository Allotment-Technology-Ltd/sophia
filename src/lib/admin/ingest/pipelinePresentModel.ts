/**
 * Shared pipeline ordering + labels for admin ingest UIs (Monitoring, run console).
 * Keep aligned with `IngestRunState.stages` keys in `ingestRuns.ts`.
 */
export const INGEST_PIPELINE_DISPLAY_ORDER = [
  'fetch',
  'extract',
  'relate',
  'group',
  'embed',
  'validate',
  'remediation',
  'store'
] as const;

export type IngestPipelineStageKey = (typeof INGEST_PIPELINE_DISPLAY_ORDER)[number];

export const INGEST_STAGE_LABELS: Record<string, string> = {
  fetch: 'Fetch & parse',
  extract: 'Extract',
  relate: 'Relate',
  group: 'Group',
  embed: 'Embed',
  validate: 'Validate',
  remediation: 'Remediate',
  store: 'Store'
};

export type PipelineStageRow = {
  key: string;
  label: string;
  status: string;
  summary?: string;
  /** True when this stage is the worker’s current focus (`currentStageKey`). */
  isCurrent: boolean;
};

function readStageMap(stages: unknown): Record<string, { status?: string; summary?: string }> {
  if (!stages || typeof stages !== 'object' || Array.isArray(stages)) return {};
  return stages as Record<string, { status?: string; summary?: string }>;
}

/**
 * Vertical timeline rows: one entry per non-skipped stage, in pipeline order.
 */
export function buildPipelineStageRows(
  stages: unknown,
  currentStageKey: string | null | undefined
): PipelineStageRow[] {
  const s = readStageMap(stages);
  const cur = (currentStageKey ?? '').trim();
  const out: PipelineStageRow[] = [];
  for (const key of INGEST_PIPELINE_DISPLAY_ORDER) {
    const row = s[key];
    if (!row) continue;
    const status = (row.status ?? 'idle').toLowerCase();
    if (status === 'skipped') continue;
    out.push({
      key,
      label: INGEST_STAGE_LABELS[key] ?? key,
      status,
      summary: row.summary,
      isCurrent: Boolean(cur && cur === key)
    });
  }
  return out;
}
