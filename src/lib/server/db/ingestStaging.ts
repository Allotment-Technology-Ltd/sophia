/**
 * Durable ingestion checkpoints in Neon (replaces *-partial.json when
 * INGEST_ORCHESTRATION_RUN_ID + DATABASE_URL are set on the worker).
 */

import { eq } from 'drizzle-orm';
import { getDrizzleDb } from './neon';
import {
  ingestStagingArguments,
  ingestStagingClaims,
  ingestStagingMeta,
  ingestStagingRelations,
  ingestStagingValidation
} from './schema';
import { isNeonIngestPersistenceEnabled } from '../neon/datastore';

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

    await tx
      .insert(ingestStagingMeta)
      .values({
        runId,
        slug,
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
          validationFull: asRecord(partial.validation) ?? null,
          embeddingsJson: Array.isArray(partial.embeddings)
            ? (partial.embeddings as number[][])
            : null,
          updatedAt: new Date()
        }
      });
  });
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
  const partial: Record<string, unknown> = {
    source,
    stage_completed: meta.stageCompleted,
    cost_usd_snapshot: meta.costUsdSnapshot ?? undefined,
    claims: claims.length > 0 ? claims : undefined,
    relations: relations.length > 0 ? relations : undefined,
    arguments: arguments_,
    embeddings:
      meta.embeddingsJson && Array.isArray(meta.embeddingsJson) ? meta.embeddingsJson : undefined,
    validation,
    extraction_progress: meta.extractionProgress ?? undefined,
    grouping_progress: meta.groupingProgress ?? undefined,
    validation_progress: meta.validationProgress ?? undefined,
    relations_progress: meta.relationsProgress ?? undefined,
    embedding_progress: meta.embeddingProgress ?? undefined
  };

  if (slug && meta.slug && meta.slug !== slug) {
    console.warn(`  [WARN] Neon staging slug mismatch (db=${meta.slug} file=${slug})`);
  }

  return partial;
}
