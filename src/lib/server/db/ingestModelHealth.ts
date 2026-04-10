import { sql } from 'drizzle-orm';
import { getDrizzleDb } from './neon';
import { ingestLlmModelHealth, ingestLlmStageModelHealth } from './schema';

function healthKey(provider: string, model: string): string {
  return `${provider.trim().toLowerCase()}::${model.trim()}`;
}

function stageHealthKey(stage: string, provider: string, model: string): string {
  return `${stage.trim().toLowerCase()}::${provider.trim().toLowerCase()}::${model.trim()}`;
}

export async function loadIngestLlmFailureCountsFromDb(): Promise<Map<string, number>> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return new Map();
  try {
    const db = getDrizzleDb();
    const rows = await db
      .select({
        provider: ingestLlmModelHealth.provider,
        modelId: ingestLlmModelHealth.modelId,
        failureCount: ingestLlmModelHealth.failureCount
      })
      .from(ingestLlmModelHealth);
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = healthKey(r.provider, r.modelId);
      m.set(k, r.failureCount);
    }
    return m;
  } catch {
    return new Map();
  }
}

/** Per-stage failure counts for routing (key: `stage::provider::model`). */
export async function loadIngestLlmStageFailureCountsFromDb(): Promise<Map<string, number>> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return new Map();
  try {
    const db = getDrizzleDb();
    const rows = await db
      .select({
        stage: ingestLlmStageModelHealth.stage,
        provider: ingestLlmStageModelHealth.provider,
        modelId: ingestLlmStageModelHealth.modelId,
        failureCount: ingestLlmStageModelHealth.failureCount
      })
      .from(ingestLlmStageModelHealth);
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = stageHealthKey(r.stage, r.provider, r.modelId);
      m.set(k, r.failureCount);
    }
    return m;
  } catch {
    return new Map();
  }
}

export async function bumpIngestModelFailureInDb(provider: string, model: string): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;
  const p = provider.trim().toLowerCase();
  const mid = model.trim();
  if (!p || !mid) return;
  try {
    const db = getDrizzleDb();
    const now = new Date();
    await db
      .insert(ingestLlmModelHealth)
      .values({
        provider: p,
        modelId: mid,
        failureCount: 1,
        successCount: 0,
        lastFailureAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [ingestLlmModelHealth.provider, ingestLlmModelHealth.modelId],
        set: {
          failureCount: sql`${ingestLlmModelHealth.failureCount} + 1`,
          lastFailureAt: now,
          updatedAt: now
        }
      });
  } catch {
    /* non-fatal */
  }
}

export async function bumpIngestStageModelFailureInDb(
  stage: string,
  provider: string,
  model: string
): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;
  const st = stage.trim().toLowerCase();
  const p = provider.trim().toLowerCase();
  const mid = model.trim();
  if (!st || !p || !mid) return;
  try {
    const db = getDrizzleDb();
    const now = new Date();
    await db
      .insert(ingestLlmStageModelHealth)
      .values({
        stage: st,
        provider: p,
        modelId: mid,
        failureCount: 1,
        successCount: 0,
        lastFailureAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [
          ingestLlmStageModelHealth.stage,
          ingestLlmStageModelHealth.provider,
          ingestLlmStageModelHealth.modelId
        ],
        set: {
          failureCount: sql`${ingestLlmStageModelHealth.failureCount} + 1`,
          lastFailureAt: now,
          updatedAt: now
        }
      });
  } catch {
    /* non-fatal */
  }
}

export async function noteIngestModelSuccessInDb(provider: string, model: string): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;
  const p = provider.trim().toLowerCase();
  const mid = model.trim();
  if (!p || !mid) return;
  try {
    const db = getDrizzleDb();
    const now = new Date();
    await db
      .insert(ingestLlmModelHealth)
      .values({
        provider: p,
        modelId: mid,
        failureCount: 0,
        successCount: 1,
        lastSuccessAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [ingestLlmModelHealth.provider, ingestLlmModelHealth.modelId],
        set: {
          successCount: sql`${ingestLlmModelHealth.successCount} + 1`,
          lastSuccessAt: now,
          updatedAt: now
        }
      });
  } catch {
    /* non-fatal */
  }
}

export async function noteIngestStageModelSuccessInDb(
  stage: string,
  provider: string,
  model: string
): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;
  const st = stage.trim().toLowerCase();
  const p = provider.trim().toLowerCase();
  const mid = model.trim();
  if (!st || !p || !mid) return;
  try {
    const db = getDrizzleDb();
    const now = new Date();
    await db
      .insert(ingestLlmStageModelHealth)
      .values({
        stage: st,
        provider: p,
        modelId: mid,
        failureCount: 0,
        successCount: 1,
        lastSuccessAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [
          ingestLlmStageModelHealth.stage,
          ingestLlmStageModelHealth.provider,
          ingestLlmStageModelHealth.modelId
        ],
        set: {
          successCount: sql`${ingestLlmStageModelHealth.successCount} + 1`,
          lastSuccessAt: now,
          updatedAt: now
        }
      });
  } catch {
    /* non-fatal */
  }
}
