/**
 * Build cost-ordered LLM fallback chains for ingestion from Restormel catalog + model surfaces.
 * Used by the admin ingest worker to pass `INGEST_CATALOG_ROUTING_JSON` into `scripts/ingest.ts`.
 */

import { estimateCost, defaultProviders } from '@restormel/keys';
import type { ReasoningProvider } from '@restormel/contracts/providers';
import {
  entryMeetsPresetStageMinimum,
  INGESTION_PIPELINE_PRESET,
  resolveCatalogQualityCost,
  type CatalogLikeEntry
} from '$lib/ingestionPipelineModelRequirements';
import type { IngestionLlmStageKey } from '$lib/ingestionCanonicalPipeline';
import { loadModelSurfacesConfig, resolveSurfaceRole } from '$lib/server/modelSurfaces';
import {
  catalogSurfaceStableKey,
  listCatalogSurfaceCandidatesWithEmbeddingSupplement,
  reasoningProviderForCatalogProvider,
  type CatalogSurfaceRow
} from '$lib/server/restormelCatalogRows';
import { restormelFetchCatalogPayloadUncached } from '$lib/server/restormel';

const STAGE_TO_PIPELINE_KEY: Record<IngestionLlmStageKey, string> = {
  extraction: 'ingestion_extraction',
  relations: 'ingestion_relations',
  grouping: 'ingestion_grouping',
  validation: 'ingestion_validation',
  remediation: 'ingestion_remediation',
  json_repair: 'ingestion_json_repair'
};

const COST_ORDER: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 1,
  high: 2
};

function surfaceRoleAllowsIngestion(role: string): boolean {
  return role === 'ingestion_only' || role === 'ingestion_and_inquiries';
}

function catalogLikeFromRow(row: CatalogSurfaceRow): CatalogLikeEntry {
  const raw = row.raw;
  const label =
    typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : `${row.providerType} · ${row.modelId}`;
  const q = raw.qualityTier ?? raw.quality_tier;
  const c = raw.costTier ?? raw.cost_tier;
  const qualityTier =
    q === 'capable' || q === 'strong' || q === 'frontier' ? q : undefined;
  const costTier = c === 'low' || c === 'medium' || c === 'high' ? c : undefined;
  return { provider: row.providerType, modelId: row.modelId, label, qualityTier, costTier };
}

function estimatedUsdPer1Mtokens(modelId: string): number {
  const est = estimateCost(modelId, defaultProviders);
  if (!est) return Number.POSITIVE_INFINITY;
  return (est.inputPerMillion ?? 0) + (est.outputPerMillion ?? 0);
}

function rowToCanonicalRef(row: CatalogSurfaceRow): { provider: ReasoningProvider; modelId: string } | null {
  const rp = reasoningProviderForCatalogProvider(row.providerType);
  if (!rp) return null;
  return { provider: rp, modelId: row.modelId.trim() };
}

/**
 * Returns ordered unique { provider, modelId } for the stage, cheapest suitable first.
 */
export function buildIngestCatalogModelChainForStage(
  stage: IngestionLlmStageKey,
  rows: CatalogSurfaceRow[],
  surfaces: Awaited<ReturnType<typeof loadModelSurfacesConfig>>
): { provider: ReasoningProvider; modelId: string }[] {
  const pipelineKey = STAGE_TO_PIPELINE_KEY[stage];
  const candidates: CatalogSurfaceRow[] = [];

  for (const row of rows) {
    if (row.isEmbedding) continue;
    if (!row.eligibleForSurfaces) continue;
    const role = resolveSurfaceRole(row, surfaces);
    if (!surfaceRoleAllowsIngestion(role)) continue;

    const entry = catalogLikeFromRow(row);
    if (!entryMeetsPresetStageMinimum(INGESTION_PIPELINE_PRESET, pipelineKey, entry, { embed: false })) {
      continue;
    }

    const ref = rowToCanonicalRef(row);
    if (!ref || !ref.modelId) continue;

    candidates.push(row);
  }

  const scored = candidates.map((row) => {
    const entry = catalogLikeFromRow(row);
    const { costTier } = resolveCatalogQualityCost(entry);
    const co = COST_ORDER[costTier] ?? 1;
    const usd = estimatedUsdPer1Mtokens(row.modelId);
    const ref = rowToCanonicalRef(row)!;
    return { ref, co, usd, key: `${ref.provider}::${ref.modelId}` };
  });

  scored.sort((a, b) => {
    if (a.co !== b.co) return a.co - b.co;
    if (a.usd !== b.usd) return a.usd - b.usd;
    return a.key.localeCompare(b.key);
  });

  const out: { provider: ReasoningProvider; modelId: string }[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    out.push(s.ref);
  }
  return out;
}

export type IngestCatalogRoutingJson = Record<
  IngestionLlmStageKey,
  { provider: ReasoningProvider; modelId: string }[]
>;

/**
 * Full routing map for all LLM ingest stages (excludes embedding — handled separately).
 */
export async function buildIngestCatalogRoutingJson(): Promise<IngestCatalogRoutingJson> {
  const [catalogPayload, surfaces] = await Promise.all([
    restormelFetchCatalogPayloadUncached(),
    loadModelSurfacesConfig()
  ]);
  const rows = listCatalogSurfaceCandidatesWithEmbeddingSupplement(catalogPayload);

  const stages: IngestionLlmStageKey[] = [
    'extraction',
    'relations',
    'grouping',
    'validation',
    'remediation',
    'json_repair'
  ];
  const out = {} as IngestCatalogRoutingJson;
  for (const stage of stages) {
    out[stage] = buildIngestCatalogModelChainForStage(stage, rows, surfaces);
  }
  return out;
}

/**
 * Base64url JSON for `INGEST_CATALOG_ROUTING_JSON_B64` (spawn-safe).
 */
export async function encodeIngestCatalogRoutingJsonB64(): Promise<string | null> {
  const routing = await buildIngestCatalogRoutingJson();
  const keys: IngestionLlmStageKey[] = [
    'extraction',
    'relations',
    'grouping',
    'validation',
    'remediation',
    'json_repair'
  ];
  if (!keys.some((k) => routing[k]?.length)) return null;
  return Buffer.from(JSON.stringify(routing), 'utf8').toString('base64url');
}
