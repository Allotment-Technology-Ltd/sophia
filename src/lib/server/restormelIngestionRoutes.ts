/**
 * Resolve Restormel **ingestion** route IDs at runtime via the Dashboard API (`list routes`),
 * so deploys do not need per-route ID secrets. Operators create/publish routes in Restormel Keys
 * (CLI or UI) with stable workload/stage metadata; Sophia matches them here.
 *
 * Convention (Restormel route records):
 * - **Dedicated** per pipeline stage: `workload: "ingestion"`, `stage: "ingestion_<stage>"`
 *   where `<stage>` is `extraction` | `relations` | `grouping` | `validation` | `json_repair`
 *   (`ingestion_embedding` is separate if you route embeddings through Restormel).
 * - **Shared** fallback: `workload: "ingestion"`, `stage` empty / null — resolve POST omits `stage`.
 *
 * List routes (discovery): `GET .../routes?environmentId=&workload=ingestion`. Prefer `isPublished`
 * and routes whose `version` equals `publishedVersion`.
 *
 * Runtime resolve (Keys ≥0.2.11) does not require these UUIDs: `planIngestionStage` calls POST /resolve
 * without routeId when env is unset, using workload=ingestion + stage=ingestion_<substage>.
 * Discovery here remains useful for admin list UX, logging, and optional preflight
 * (`restormelValidateRouteBinding`). Env overrides still pin routeId when set.
 */

import {
  RESTORMEL_ENVIRONMENT_ID,
  restormelListRoutes,
  type RestormelRouteRecord
} from './restormel.js';

/** Stages that use Restormel resolve (not embedding). */
export type DiscoverableIngestionStage =
  | 'extraction'
  | 'relations'
  | 'grouping'
  | 'validation'
  | 'json_repair';

export type StageRouteBindingMode = 'dedicated' | 'shared' | 'none';

const LIST_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedRoutes: { at: number; routes: RestormelRouteRecord[] } | null = null;

function normalizeMeta(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function ingestionStageKey(stage: DiscoverableIngestionStage): string {
  return `ingestion_${stage}`;
}

function isUsableRoute(route: RestormelRouteRecord): boolean {
  if (route.enabled === false) return false;
  const id = typeof route.id === 'string' ? route.id.trim() : '';
  if (!id) return false;
  if (route.isPublished === false) return false;
  if (typeof route.publishedVersion === 'number' && route.publishedVersion <= 0) return false;
  if (
    typeof route.version === 'number' &&
    typeof route.publishedVersion === 'number' &&
    route.version !== route.publishedVersion
  ) {
    return false;
  }
  return true;
}

async function loadProjectRoutes(): Promise<RestormelRouteRecord[]> {
  const now = Date.now();
  if (cachedRoutes && now - cachedRoutes.at < LIST_CACHE_TTL_MS) {
    return cachedRoutes.routes;
  }
  const { data } = await restormelListRoutes({
    environmentId: RESTORMEL_ENVIRONMENT_ID,
    workload: 'ingestion'
  });
  const routes = Array.isArray(data) ? data : [];
  cachedRoutes = { at: now, routes };
  return routes;
}

/** For tests only */
export function __resetIngestionRouteListCacheForTests(): void {
  cachedRoutes = null;
}

/**
 * Discover route id + binding mode for an ingestion stage. Returns `none` when no match and
 * no usable list (caller falls back to env or degraded defaults).
 */
export async function discoverIngestionRouteBinding(
  stage: DiscoverableIngestionStage
): Promise<{ routeId?: string; mode: StageRouteBindingMode }> {
  try {
    const routes = await loadProjectRoutes();
    const candidates = routes.filter(isUsableRoute);
    const wantStage = ingestionStageKey(stage);

    const dedicated = candidates.find(
      (r) =>
        normalizeMeta(r.workload) === 'ingestion' && normalizeMeta(r.stage) === wantStage
    );
    if (dedicated?.id) {
      return { routeId: dedicated.id.trim(), mode: 'dedicated' };
    }

    const shared = candidates.find(
      (r) => normalizeMeta(r.workload) === 'ingestion' && !normalizeMeta(r.stage)
    );
    if (shared?.id) {
      return { routeId: shared.id.trim(), mode: 'shared' };
    }

    return { mode: 'none' };
  } catch (err) {
    console.warn(
      '[restormel] list routes failed; ingestion route discovery skipped:',
      err instanceof Error ? err.message : String(err)
    );
    return { mode: 'none' };
  }
}
