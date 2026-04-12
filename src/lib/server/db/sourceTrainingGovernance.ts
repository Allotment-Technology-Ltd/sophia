import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from './neon';
import { sourceTrainingGovernance } from './schema';

/** When true, new Surreal rows and Neon governance rows mark the source as excluded from model training. */
export function resolveExcludeSourceFromModelTrainingForIngest(): boolean {
  const v = process.env.INGEST_EXCLUDE_SOURCE_FROM_MODEL_TRAINING?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** True when Neon already marks this canonical source as excluded (re-store must not clear Surreal). */
export async function getSourceTrainingGovernanceExcluded(
  canonicalUrlHash: string | null | undefined
): Promise<boolean> {
  const h = canonicalUrlHash?.trim();
  if (!h || !process.env.DATABASE_URL?.trim()) return false;
  try {
    const db = getDrizzleDb();
    const row = await db
      .select({ ex: sourceTrainingGovernance.excludeFromModelTraining })
      .from(sourceTrainingGovernance)
      .where(eq(sourceTrainingGovernance.canonicalUrlHash, h))
      .limit(1);
    return Boolean(row[0]?.ex);
  } catch {
    return false;
  }
}

/**
 * Upsert Neon governance row on ingest completion. Conflict merge uses OR so exclusion is sticky:
 * once true, later completes with false do not clear it without a manual DB update.
 */
export async function upsertSourceTrainingGovernanceOnIngestComplete(params: {
  canonicalUrlHash: string | null | undefined;
  sourceUrl: string;
  excludeFromModelTraining: boolean;
}): Promise<void> {
  const hash = params.canonicalUrlHash?.trim();
  if (!hash) {
    console.warn('[ingest] training governance: skipping Neon upsert (missing canonical_url_hash)');
    return;
  }
  const url = (params.sourceUrl || '').trim() || '(unknown)';
  const incoming = params.excludeFromModelTraining;
  const db = getDrizzleDb();
  await db
    .insert(sourceTrainingGovernance)
    .values({
      canonicalUrlHash: hash,
      sourceUrl: url,
      excludeFromModelTraining: incoming,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: sourceTrainingGovernance.canonicalUrlHash,
      set: {
        sourceUrl: url,
        excludeFromModelTraining: sql`${sourceTrainingGovernance.excludeFromModelTraining} OR excluded.exclude_from_model_training`,
        updatedAt: new Date()
      }
    });
}
