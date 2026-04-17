/**
 * Operator-configured per-phase model pins for ingestion (browser localStorage + merge into runs/jobs).
 * Does not import server modules — safe for `+page.svelte` client bundles.
 */

export const OPERATOR_PHASE_PINS_STORAGE_KEY = 'sophia.operator.ingestPhasePins.v1';

export type OperatorPhaseKey =
  | 'EXTRACTION'
  | 'RELATIONS'
  | 'GROUPING'
  | 'VALIDATION'
  | 'REMEDIATION'
  | 'JSON_REPAIR';

export type OperatorModelChainLabels = {
  extract: string;
  relate: string;
  group: string;
  validate: string;
  remediate: string;
  json_repair: string;
};

export type OperatorPhasePin = {
  /** `auto` or `provider · model` or `provider__modelId`. */
  providerModel: string;
  /**
   * When set on **extraction** only: maps to worker `EXTRACTION_BASE_URL` / `EXTRACTION_MODEL`
   * (OpenAI-compatible fine-tune or custom deployment).
   */
  extractionBaseUrl?: string;
  extractionDeploymentModel?: string;
};

export type OperatorPhasePinsState = {
  phases: Record<OperatorPhaseKey, OperatorPhasePin>;
};

const PHASE_KEYS: OperatorPhaseKey[] = [
  'EXTRACTION',
  'RELATIONS',
  'GROUPING',
  'VALIDATION',
  'REMEDIATION',
  'JSON_REPAIR'
];

export function defaultOperatorPhasePins(): OperatorPhasePinsState {
  const pin: OperatorPhasePin = { providerModel: 'auto' };
  const phases = {} as Record<OperatorPhaseKey, OperatorPhasePin>;
  for (const k of PHASE_KEYS) phases[k] = { ...pin };
  return { phases };
}

function isPhaseKey(k: string): k is OperatorPhaseKey {
  return (PHASE_KEYS as readonly string[]).includes(k);
}

export function loadOperatorPhasePinsFromStorage(): OperatorPhasePinsState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OPERATOR_PHASE_PINS_STORAGE_KEY);
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const phases = (parsed as { phases?: unknown }).phases;
    if (!phases || typeof phases !== 'object' || Array.isArray(phases)) return null;
    const base = defaultOperatorPhasePins();
    for (const k of PHASE_KEYS) {
      const row = (phases as Record<string, unknown>)[k];
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const providerModel =
        typeof (row as { providerModel?: unknown }).providerModel === 'string'
          ? (row as { providerModel: string }).providerModel
          : 'auto';
      const extractionBaseUrl =
        typeof (row as { extractionBaseUrl?: unknown }).extractionBaseUrl === 'string'
          ? (row as { extractionBaseUrl: string }).extractionBaseUrl.trim()
          : undefined;
      const extractionDeploymentModel =
        typeof (row as { extractionDeploymentModel?: unknown }).extractionDeploymentModel === 'string'
          ? (row as { extractionDeploymentModel: string }).extractionDeploymentModel.trim()
          : undefined;
      base.phases[k] = {
        providerModel: providerModel.trim() || 'auto',
        ...(extractionBaseUrl ? { extractionBaseUrl } : {}),
        ...(extractionDeploymentModel ? { extractionDeploymentModel } : {})
      };
    }
    return base;
  } catch {
    return null;
  }
}

export function saveOperatorPhasePinsToStorage(state: OperatorPhasePinsState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OPERATOR_PHASE_PINS_STORAGE_KEY, JSON.stringify(state));
}

const CHAIN_MAP: Record<OperatorPhaseKey, keyof OperatorModelChainLabels> = {
  EXTRACTION: 'extract',
  RELATIONS: 'relate',
  GROUPING: 'group',
  VALIDATION: 'validate',
  REMEDIATION: 'remediate',
  JSON_REPAIR: 'json_repair'
};

/** Maps operator UI state → `model_chain` labels for `IngestRunPayload`. */
export function operatorPhasePinsToModelChain(state: OperatorPhasePinsState): OperatorModelChainLabels {
  const out: OperatorModelChainLabels = {
    extract: 'auto',
    relate: 'auto',
    group: 'auto',
    validate: 'auto',
    remediate: 'auto',
    json_repair: 'auto'
  };
  for (const k of PHASE_KEYS) {
    const label = CHAIN_MAP[k];
    const pm = state.phases[k]?.providerModel?.trim() || 'auto';
    out[label] = pm || 'auto';
  }
  return out;
}

/** Optional worker_defaults / batch fields for OpenAI-compatible extraction override. */
export function operatorPhasePinsToWorkerExtras(state: OperatorPhasePinsState): {
  extractionOpenAiCompatibleBaseUrl?: string;
  extractionOpenAiCompatibleModel?: string;
} {
  const ex = state.phases.EXTRACTION;
  const url = ex?.extractionBaseUrl?.trim();
  const model = ex?.extractionDeploymentModel?.trim();
  const o: { extractionOpenAiCompatibleBaseUrl?: string; extractionOpenAiCompatibleModel?: string } = {};
  if (url) o.extractionOpenAiCompatibleBaseUrl = url;
  if (model) o.extractionOpenAiCompatibleModel = model;
  return o;
}

/**
 * Where operator routing pins are non-`auto`, they override wizard / job defaults for that phase.
 */
export function mergeModelChainWithOperatorPins(
  base: OperatorModelChainLabels,
  operator: OperatorPhasePinsState | null
): OperatorModelChainLabels {
  if (!operator) return base;
  const pins = operatorPhasePinsToModelChain(operator);
  const pick = (op: string, def: string) => {
    const t = op.trim().toLowerCase();
    return t && t !== 'auto' ? op : def;
  };
  return {
    extract: pick(pins.extract, base.extract),
    relate: pick(pins.relate, base.relate),
    group: pick(pins.group, base.group),
    validate: pick(pins.validate, base.validate),
    remediate: pick(pins.remediate, base.remediate),
    json_repair: pick(pins.json_repair, base.json_repair)
  };
}

export function parseStoredPhasePinsForMerge(raw: unknown): OperatorPhasePinsState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const phases = (raw as { phases?: unknown }).phases;
  if (!phases || typeof phases !== 'object') return null;
  const base = defaultOperatorPhasePins();
  for (const k of Object.keys(phases as object)) {
    if (!isPhaseKey(k)) continue;
    const row = (phases as Record<string, unknown>)[k];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const providerModel =
      typeof (row as { providerModel?: unknown }).providerModel === 'string'
        ? (row as { providerModel: string }).providerModel
        : 'auto';
    base.phases[k] = {
      providerModel: providerModel.trim() || 'auto',
      ...(typeof (row as { extractionBaseUrl?: unknown }).extractionBaseUrl === 'string'
        ? { extractionBaseUrl: (row as { extractionBaseUrl: string }).extractionBaseUrl.trim() }
        : {}),
      ...(typeof (row as { extractionDeploymentModel?: unknown }).extractionDeploymentModel === 'string'
        ? {
            extractionDeploymentModel: (row as { extractionDeploymentModel: string }).extractionDeploymentModel.trim()
          }
        : {})
    };
  }
  return base;
}
