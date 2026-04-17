import { eq } from 'drizzle-orm';
import { adminIngestionRestormelRouteBindings } from './db/schema.js';
import { getDrizzleDb } from './db/neon.js';

/** Matches {@link IngestionStage} in `ingestion-plan.ts` (avoid circular import). */
type PlanIngestionStage =
  | 'extraction'
  | 'relations'
  | 'grouping'
  | 'validation'
  | 'remediation'
  | 'embedding'
  | 'json_repair';

const ROW_ID = 'default';

const CACHE_TTL_MS = 60_000;
let cache: { at: number; bindings: Record<string, string> } | null = null;

/** Admin UI / JSON keys (aligned with `INGESTION_PHASE_COLUMN_ORDER` Restormel stages). */
export const INGESTION_BINDING_ADMIN_KEYS = [
  'ingestion_extraction',
  'ingestion_relations',
  'ingestion_grouping',
  'ingestion_validation',
  'ingestion_remediation',
  'ingestion_embedding',
  'ingestion_json_repair'
] as const;

export type IngestionBindingAdminKey = (typeof INGESTION_BINDING_ADMIN_KEYS)[number];

/** Maps `planIngestionStage` stage → admin binding key (for DB / API). */
export const INGESTION_STAGE_TO_BINDING_ADMIN_KEY: Record<PlanIngestionStage, IngestionBindingAdminKey> = {
  extraction: 'ingestion_extraction',
  relations: 'ingestion_relations',
  grouping: 'ingestion_grouping',
  validation: 'ingestion_validation',
  remediation: 'ingestion_remediation',
  embedding: 'ingestion_embedding',
  json_repair: 'ingestion_json_repair'
};

function normalizeBindings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const key of INGESTION_BINDING_ADMIN_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      out[key] = v.trim();
    }
  }
  return out;
}

export function invalidateIngestionRouteBindingsCache(): void {
  cache = null;
}

async function loadBindingsFromDb(): Promise<Record<string, string>> {
  if (!process.env.DATABASE_URL?.trim()) {
    return {};
  }
  try {
    const db = getDrizzleDb();
    const [row] = await db
      .select()
      .from(adminIngestionRestormelRouteBindings)
      .where(eq(adminIngestionRestormelRouteBindings.id, ROW_ID))
      .limit(1);
    return normalizeBindings(row?.bindings ?? {});
  } catch {
    return {};
  }
}

/** Cached full map (admin keys → route UUID). */
export async function getStoredIngestionRouteBindings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.bindings };
  }
  const bindings = await loadBindingsFromDb();
  cache = { at: now, bindings };
  return { ...bindings };
}

/** Route UUID for an admin stage key, if the operator set one in Neon. */
export async function getStoredRouteIdForBindingKey(adminKey: IngestionBindingAdminKey): Promise<string | undefined> {
  const all = await getStoredIngestionRouteBindings();
  const id = all[adminKey];
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

/**
 * Effective Restormel route id for AAIF planning: Neon binding for this stage wins over env pins.
 */
export async function getStoredRouteIdForIngestionStage(stage: PlanIngestionStage): Promise<string | undefined> {
  const adminKey = INGESTION_STAGE_TO_BINDING_ADMIN_KEY[stage];
  return getStoredRouteIdForBindingKey(adminKey);
}

export type IngestionRouteBindingsPayload = Partial<
  Record<IngestionBindingAdminKey, string | null | undefined>
>;

export function sanitizeBindingsPayload(
  input: unknown
): Partial<Record<IngestionBindingAdminKey, string | undefined>> {
  if (!input || typeof input !== 'object') return {};
  const rec = input as Record<string, unknown>;
  const raw = rec.bindings;
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<IngestionBindingAdminKey, string | undefined>> = {};
  for (const key of INGESTION_BINDING_ADMIN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const v = (raw as Record<string, unknown>)[key];
    if (v === null || v === undefined || v === '') {
      out[key] = undefined;
    } else if (typeof v === 'string' && v.trim()) {
      out[key] = v.trim();
    }
  }
  return out;
}

export async function upsertIngestionRouteBindings(
  patch: Partial<Record<IngestionBindingAdminKey, string | undefined>>,
  updatedByUid: string
): Promise<Record<string, string>> {
  const db = getDrizzleDb();
  const current = await loadBindingsFromDb();
  const next: Record<string, string> = { ...current };
  for (const key of INGESTION_BINDING_ADMIN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      const v = patch[key];
      if (v === undefined || v === '') {
        delete next[key];
      } else if (typeof v === 'string' && v.trim()) {
        next[key] = v.trim();
      }
    }
  }

  await db
    .insert(adminIngestionRestormelRouteBindings)
    .values({
      id: ROW_ID,
      bindings: next as unknown as Record<string, string>,
      updatedByUid: updatedByUid
    })
    .onConflictDoUpdate({
      target: adminIngestionRestormelRouteBindings.id,
      set: {
        bindings: next as unknown as Record<string, string>,
        updatedAt: new Date(),
        updatedByUid: updatedByUid
      }
    });

  invalidateIngestionRouteBindingsCache();
  return { ...next };
}
