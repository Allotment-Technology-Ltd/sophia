/**
 * Durable ingestion checkpoints in Neon (replaces *-partial.json when
 * INGEST_ORCHESTRATION_RUN_ID + DATABASE_URL are set on the worker).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDrizzleDb } from './neon';
import {
  ingestRuns,
  ingestStagingArguments,
  ingestStagingClaims,
  ingestStagingMeta,
  ingestStagingRelations,
  ingestStagingValidation
} from './schema';
import { isNeonIngestPersistenceEnabled } from '../neon/datastore';
import { canonicalizeSourceUrl } from '../sourceIdentity';

function sourceTextSnapshotFromPartial(partial: Record<string, unknown>): string | null {
  const raw = partial.source_text_snapshot;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function orchestrationRunId(): string | null {
  const id = process.env.INGEST_ORCHESTRATION_RUN_ID?.trim();
  return id || null;
}

export function isIngestNeonStagingActive(): boolean {
  return isNeonIngestPersistenceEnabled() && Boolean(orchestrationRunId());
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function claimTextFromUnknown(c: Record<string, unknown>): string {
  const t = c.text ?? c.claim_text ?? c.statement;
  return typeof t === 'string' ? t : '';
}

function isVector768(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === 768 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Staging claim row or JSON may hold 768-d (pgvector) or other dims (e.g. 1024 in `embeddings_json` only). */
function isFiniteEmbeddingVector(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length >= 64 &&
    v.length <= 4096 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export async function saveIngestPartialToNeon(opts: {
  runId: string;
  slug: string;
  partial: Record<string, unknown>;
}): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const { runId, slug, partial } = opts;
  const db = getDrizzleDb();

  await db.transaction(async (tx) => {
    await tx.delete(ingestStagingClaims).where(eq(ingestStagingClaims.runId, runId));
    await tx.delete(ingestStagingRelations).where(eq(ingestStagingRelations.runId, runId));
    await tx.delete(ingestStagingArguments).where(eq(ingestStagingArguments.runId, runId));
    await tx.delete(ingestStagingValidation).where(eq(ingestStagingValidation.runId, runId));

    const claims = Array.isArray(partial.claims) ? partial.claims : [];
    for (let i = 0; i < claims.length; i++) {
      const raw = claims[i];
      const c = asRecord(raw);
      if (!c) continue;
      const pos =
        typeof c.position_in_source === 'number' && Number.isFinite(c.position_in_source)
          ? Math.trunc(c.position_in_source)
          : i + 1;
      const text = claimTextFromUnknown(c);
      const embedding = c.embedding;
      const claimData = { ...c };
      delete claimData.embedding;
      const values: typeof ingestStagingClaims.$inferInsert = {
        runId,
        positionInSource: pos,
        claimText: text || `claim-${pos}`,
        claimData: claimData as Record<string, unknown>
      };
      if (isVector768(embedding)) {
        values.embedding = embedding;
      }
      await tx.insert(ingestStagingClaims).values(values);
    }

    const relations = Array.isArray(partial.relations) ? partial.relations : [];
    for (const raw of relations) {
      const r = asRecord(raw);
      if (!r) continue;
      const from = typeof r.from_position === 'number' ? Math.trunc(r.from_position) : null;
      const to = typeof r.to_position === 'number' ? Math.trunc(r.to_position) : null;
      const relType = typeof r.relation_type === 'string' ? r.relation_type : 'related';
      if (from == null || to == null) continue;
      await tx.insert(ingestStagingRelations).values({
        runId,
        fromPosition: from,
        toPosition: to,
        relationType: relType,
        relationData: r as Record<string, unknown>
      });
    }

    const args = partial.arguments;
    if (Array.isArray(args)) {
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        await tx.insert(ingestStagingArguments).values({
          runId,
          argumentIndex: i,
          argumentData: (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
        });
      }
    }

    const validation = partial.validation;
    const vrec = asRecord(validation);
    const claimIssues = vrec && Array.isArray(vrec.claims) ? vrec.claims : [];
    for (const raw of claimIssues) {
      const c = asRecord(raw);
      if (!c) continue;
      const pos =
        typeof c.position_in_source === 'number' ? Math.trunc(c.position_in_source) : null;
      if (pos == null) continue;
      const score =
        typeof c.faithfulness_score === 'number' && Number.isFinite(c.faithfulness_score)
          ? c.faithfulness_score
          : null;
      await tx.insert(ingestStagingValidation).values({
        runId,
        positionInSource: pos,
        faithfulnessScore: score,
        validationData: c as Record<string, unknown>
      });
    }

    const sourceJson =
      partial.source && typeof partial.source === 'object' && !Array.isArray(partial.source)
        ? (partial.source as Record<string, unknown>)
        : null;

    const textSnap = sourceTextSnapshotFromPartial(partial);

    await tx
      .insert(ingestStagingMeta)
      .values({
        runId,
        slug,
        sourceTextSnapshot: textSnap,
        sourceJson,
        stageCompleted: typeof partial.stage_completed === 'string' ? partial.stage_completed : '',
        costUsdSnapshot:
          typeof partial.cost_usd_snapshot === 'number' && Number.isFinite(partial.cost_usd_snapshot)
            ? partial.cost_usd_snapshot
            : null,
        extractionProgress: asRecord(partial.extraction_progress) ?? null,
        groupingProgress: asRecord(partial.grouping_progress) ?? null,
        validationProgress: asRecord(partial.validation_progress) ?? null,
        relationsProgress: asRecord(partial.relations_progress) ?? null,
        embeddingProgress: asRecord(partial.embedding_progress) ?? null,
        remediationProgress: asRecord(partial.remediation_progress) ?? null,
        validationFull: asRecord(partial.validation) ?? null,
        embeddingsJson: Array.isArray(partial.embeddings)
          ? (partial.embeddings as number[][])
          : null,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: ingestStagingMeta.runId,
        set: {
          slug,
          ...(textSnap != null ? { sourceTextSnapshot: textSnap } : {}),
          sourceJson,
          stageCompleted: typeof partial.stage_completed === 'string' ? partial.stage_completed : '',
          costUsdSnapshot:
            typeof partial.cost_usd_snapshot === 'number' && Number.isFinite(partial.cost_usd_snapshot)
              ? partial.cost_usd_snapshot
              : null,
          extractionProgress: asRecord(partial.extraction_progress) ?? null,
          groupingProgress: asRecord(partial.grouping_progress) ?? null,
          validationProgress: asRecord(partial.validation_progress) ?? null,
          relationsProgress: asRecord(partial.relations_progress) ?? null,
          embeddingProgress: asRecord(partial.embedding_progress) ?? null,
          remediationProgress: asRecord(partial.remediation_progress) ?? null,
          validationFull: asRecord(partial.validation) ?? null,
          embeddingsJson: Array.isArray(partial.embeddings)
            ? (partial.embeddings as number[][])
            : null,
          updatedAt: new Date()
        }
      });
  });
}

const STAGING_TAIL_SQL = sql`
  m.stage_completed IN ('embedding', 'validating', 'remediating', 'storing')
  AND (
    jsonb_array_length(COALESCE(m.embeddings_json, '[]'::jsonb)) > 0
    OR EXISTS (SELECT 1 FROM ingest_staging_claims c WHERE c.run_id = m.run_id LIMIT 1)
  )
`;

/**
 * All staging rows for a source identity hash with a validation-tail–compatible checkpoint.
 * Does **not** join `ingest_runs` — survives URL string drift on `ingest_runs.source_url` vs `source_json`.
 */
export async function findNeonStagingRunIdsForValidationTailByCanonicalUrlHash(
  canonicalUrlHash: string,
  maxResults = 20
): Promise<string[]> {
  if (!isNeonIngestPersistenceEnabled()) return [];
  const h = canonicalUrlHash.trim();
  if (!h) return [];
  const db = getDrizzleDb();
  const cap = Math.min(50, Math.max(1, maxResults));
  const rows = await db.execute(sql`
    SELECT m.run_id AS "runId"
    FROM ingest_staging_meta m
    WHERE ${STAGING_TAIL_SQL}
      AND (m.source_json->>'canonical_url_hash') = ${h}
    ORDER BY m.updated_at DESC
    LIMIT ${cap}
  `);
  const out: string[] = [];
  for (const row of rows.rows as { runId?: unknown }[]) {
    const id = row.runId != null && String(row.runId).trim() ? String(row.runId).trim() : null;
    if (id) out.push(id);
  }
  return out;
}

/**
 * Match by slug and/or `source_json.url` / `source_json.canonical_url` (several newest rows for resume).
 */
export async function findNeonStagingRunIdsForValidationTailBySlugOrUrl(
  opts: { slug: string; canonicalSourceUrl?: string },
  maxResults = 20
): Promise<string[]> {
  if (!isNeonIngestPersistenceEnabled()) return [];
  const slug = opts.slug.trim();
  if (!slug) return [];
  const canon = opts.canonicalSourceUrl ? canonicalizeSourceUrl(opts.canonicalSourceUrl) : null;
  const db = getDrizzleDb();
  const cap = Math.min(50, Math.max(1, maxResults));
  const tailPredicate = STAGING_TAIL_SQL;

  const rowsToIds = (rows: { rows: unknown[] }): string[] => {
    const out: string[] = [];
    for (const row of rows.rows as { runId?: unknown }[]) {
      const id = row.runId != null && String(row.runId).trim() ? String(row.runId).trim() : null;
      if (id) out.push(id);
    }
    return out;
  };

  if (canon) {
    const rows = await db.execute(sql`
      SELECT m.run_id AS "runId"
      FROM ingest_staging_meta m
      WHERE ${tailPredicate}
        AND (
          m.slug = ${slug}
          OR (m.source_json->>'url') = ${canon}
          OR (m.source_json->>'canonical_url') = ${canon}
        )
      ORDER BY m.updated_at DESC
      LIMIT ${cap}
    `);
    return rowsToIds(rows);
  }

  const rows = await db.execute(sql`
    SELECT m.run_id AS "runId"
    FROM ingest_staging_meta m
    WHERE ${tailPredicate}
      AND m.slug = ${slug}
    ORDER BY m.updated_at DESC
    LIMIT ${cap}
  `);
  return rowsToIds(rows);
}

/**
 * When a **new** `INGEST_ORCHESTRATION_RUN_ID` has no `ingest_staging_*` rows yet, an earlier run for the
 * same source may already have staging through embedding. Find the newest compatible row by slug and/or
 * canonical `source_json.url`.
 */
export async function findNeonStagingRunIdForValidationTailBySlug(opts: {
  slug: string;
  canonicalSourceUrl?: string;
  /** Matches `source_json->>'canonical_url_hash'` when slug/URL text drifted between runs. */
  canonicalUrlHash?: string;
}): Promise<string | null> {
  if (!isNeonIngestPersistenceEnabled()) return null;
  const slug = opts.slug.trim();
  if (!slug) return null;
  const urlHash = opts.canonicalUrlHash?.trim() || null;
  const db = getDrizzleDb();

  const tailPredicate = STAGING_TAIL_SQL;

  const pick = (rows: { rows: unknown[] }): string | null => {
    const head = rows.rows[0] as { runId?: unknown } | undefined;
    return head?.runId != null && String(head.runId).trim() ? String(head.runId).trim() : null;
  };

  if (urlHash) {
    const rows = await db.execute(sql`
      SELECT m.run_id AS "runId"
      FROM ingest_staging_meta m
      WHERE ${tailPredicate}
        AND (m.source_json->>'canonical_url_hash') = ${urlHash}
      ORDER BY m.updated_at DESC
      LIMIT 1
    `);
    const byHash = pick(rows);
    if (byHash) return byHash;
  }

  const tailIds = await findNeonStagingRunIdsForValidationTailBySlugOrUrl(
    { slug, canonicalSourceUrl: opts.canonicalSourceUrl },
    1
  );
  return tailIds[0] ?? null;
}

const STAGING_TAIL_STAGE_COMPLETED = new Set([
  'embedding',
  'validating',
  'remediating',
  'storing'
]);

/** Done ingest runs for the same canonical URL that still have Neon staging (slug in meta may differ). */
export async function findDoneIngestRunIdsWithStagingMetaForCanonicalUrl(
  canonicalSourceUrl: string,
  maxScan: number
): Promise<string[]> {
  if (!isNeonIngestPersistenceEnabled()) return [];
  const canon = canonicalizeSourceUrl(canonicalSourceUrl);
  if (!canon) return [];
  const db = getDrizzleDb();
  const cap = Math.min(800, Math.max(1, maxScan));
  const runs = await db
    .select({ id: ingestRuns.id, sourceUrl: ingestRuns.sourceUrl })
    .from(ingestRuns)
    .where(and(eq(ingestRuns.status, 'done'), isNotNull(ingestRuns.completedAt)))
    .orderBy(desc(ingestRuns.completedAt))
    .limit(cap);

  const out: string[] = [];
  for (const r of runs) {
    if (canonicalizeSourceUrl(r.sourceUrl) !== canon) continue;
    const meta = await db.query.ingestStagingMeta.findFirst({
      where: eq(ingestStagingMeta.runId, r.id),
      columns: { runId: true, stageCompleted: true }
    });
    if (!meta) continue;
    const st = (meta.stageCompleted ?? '').trim();
    if (!STAGING_TAIL_STAGE_COMPLETED.has(st)) continue;
    out.push(r.id);
  }
  return out;
}

export async function loadIngestPartialFromNeon(
  runId: string,
  slug: string
): Promise<Record<string, unknown> | null> {
  if (!isNeonIngestPersistenceEnabled()) return null;
  const db = getDrizzleDb();

  const meta = await db.query.ingestStagingMeta.findFirst({
    where: eq(ingestStagingMeta.runId, runId)
  });
  if (!meta) return null;

  const claimRows = await db
    .select()
    .from(ingestStagingClaims)
    .where(eq(ingestStagingClaims.runId, runId))
    .orderBy(ingestStagingClaims.positionInSource);

  const claims: unknown[] = [];
  for (const row of claimRows) {
    const data = { ...row.claimData };
    if (row.embedding) {
      const raw = row.embedding as unknown;
      if (isVector768(raw)) {
        (data as Record<string, unknown>).embedding = raw;
      }
    }
    claims.push(data);
  }

  const relationRows = await db
    .select()
    .from(ingestStagingRelations)
    .where(eq(ingestStagingRelations.runId, runId));

  const relations = relationRows.map((r) => r.relationData as unknown);

  const argRows = await db
    .select()
    .from(ingestStagingArguments)
    .where(eq(ingestStagingArguments.runId, runId))
    .orderBy(ingestStagingArguments.argumentIndex);

  const arguments_ = argRows.length > 0 ? argRows.map((r) => r.argumentData as unknown) : undefined;

  const valRows = await db
    .select()
    .from(ingestStagingValidation)
    .where(eq(ingestStagingValidation.runId, runId));

  let validation: Record<string, unknown> | undefined;
  if (meta.validationFull && typeof meta.validationFull === 'object' && !Array.isArray(meta.validationFull)) {
    validation = meta.validationFull as Record<string, unknown>;
  } else if (valRows.length > 0) {
    validation = {
      claims: valRows.map((r) => ({
        ...(r.validationData as Record<string, unknown>),
        position_in_source: r.positionInSource,
        faithfulness_score: r.faithfulnessScore ?? undefined
      })),
      summary: 'restored from neon staging'
    };
  }

  const source =
    meta.sourceJson && typeof meta.sourceJson === 'object' && !Array.isArray(meta.sourceJson)
      ? (meta.sourceJson as Record<string, unknown>)
      : { title: slug, url: '', author: [], source_type: 'unknown', word_count: 0 };

  let embeddings: number[][] | undefined =
    meta.embeddingsJson && Array.isArray(meta.embeddingsJson) && meta.embeddingsJson.length > 0
      ? (meta.embeddingsJson as number[][])
      : undefined;
  if (!embeddings && claims.length > 0) {
    const fromClaims: number[][] = [];
    for (const c of claims) {
      const rec = c as Record<string, unknown>;
      const e = rec.embedding;
      if (isFiniteEmbeddingVector(e)) {
        fromClaims.push(e);
      }
    }
    if (fromClaims.length === claims.length) {
      embeddings = fromClaims;
    }
  }

  const partial: Record<string, unknown> = {
    source,
    ...(meta.sourceTextSnapshot && meta.sourceTextSnapshot.length > 0
      ? { source_text_snapshot: meta.sourceTextSnapshot }
      : {}),
    stage_completed: meta.stageCompleted,
    cost_usd_snapshot: meta.costUsdSnapshot ?? undefined,
    claims: claims.length > 0 ? claims : undefined,
    relations: relations.length > 0 ? relations : undefined,
    arguments: arguments_,
    embeddings,
    validation,
    extraction_progress: meta.extractionProgress ?? undefined,
    grouping_progress: meta.groupingProgress ?? undefined,
    validation_progress: meta.validationProgress ?? undefined,
    relations_progress: meta.relationsProgress ?? undefined,
    embedding_progress: meta.embeddingProgress ?? undefined,
    remediation_progress: meta.remediationProgress ?? undefined
  };

  if (slug && meta.slug && meta.slug !== slug) {
    console.warn(`  [WARN] Neon staging slug mismatch (db=${meta.slug} file=${slug})`);
  }

  return partial;
}

/** True when staging has full source text (resume without local data/sources on the worker). */
export async function neonHasIngestSourceTextSnapshot(runId: string): Promise<boolean> {
  if (!isNeonIngestPersistenceEnabled()) return false;
  const db = getDrizzleDb();
  const meta = await db.query.ingestStagingMeta.findFirst({
    where: eq(ingestStagingMeta.runId, runId),
    columns: { sourceTextSnapshot: true }
  });
  const t = meta?.sourceTextSnapshot;
  return typeof t === 'string' && t.length > 0;
}

/**
 * Writes `slug.txt` + `slug.meta.json` under `data/sources` from Neon so `ingest.ts` can run
 * when the container filesystem no longer has the fetch output (e.g. Cloud Run).
 */
export async function neonRestoreSourceTextToDataSources(
  runId: string,
  slugHint?: string
): Promise<{ txtPath: string; restored: boolean; slug: string }> {
  const hint = slugHint?.trim();
  const fallbackSlug = hint
    ? path.basename(hint, path.extname(hint) === '.txt' ? '.txt' : '')
    : 'source';
  const fallbackTxt = path.resolve(process.cwd(), 'data/sources', `${fallbackSlug}.txt`);
  if (!isNeonIngestPersistenceEnabled()) {
    return { txtPath: fallbackTxt, restored: false, slug: fallbackSlug };
  }
  const db = getDrizzleDb();
  const metaRow = await db.query.ingestStagingMeta.findFirst({
    where: eq(ingestStagingMeta.runId, runId)
  });
  const text = metaRow?.sourceTextSnapshot;
  if (!metaRow || typeof text !== 'string' || text.length === 0) {
    return { txtPath: fallbackTxt, restored: false, slug: fallbackSlug };
  }

  const slug =
    metaRow.slug && metaRow.slug.trim().length > 0 ? metaRow.slug.trim() : fallbackSlug;

  const sourcesDir = path.resolve(process.cwd(), 'data/sources');
  fs.mkdirSync(sourcesDir, { recursive: true });
  const txtPath = path.join(sourcesDir, `${slug}.txt`);
  const metaPath = path.join(sourcesDir, `${slug}.meta.json`);

  const sourceObj =
    metaRow.sourceJson && typeof metaRow.sourceJson === 'object' && !Array.isArray(metaRow.sourceJson)
      ? (metaRow.sourceJson as Record<string, unknown>)
      : { title: slug, url: '', author: [], source_type: 'unknown', word_count: 0 };

  fs.writeFileSync(txtPath, text, 'utf-8');
  fs.writeFileSync(metaPath, JSON.stringify(sourceObj, null, 2), 'utf-8');
  return { txtPath, restored: true, slug };
}
