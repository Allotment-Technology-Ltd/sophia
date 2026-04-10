/**
 * Optional cross-process limits for heavy ingest.ts phases (Neon row locks).
 * Enable with INGEST_PHASE_EMBED_MAX_CONCURRENT > 0 (requires DATABASE_URL).
 */

import { eq, sql } from 'drizzle-orm';
import { ingestPhaseGate } from '$lib/server/db/schema';
import { getDrizzleDb } from '$lib/server/db/neon';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export type IngestPhaseGateKey = 'embed' | 'store';

export async function tryAcquirePhaseSlot(phase: IngestPhaseGateKey, maxSlots: number): Promise<boolean> {
	if (!isNeonIngestPersistenceEnabled()) return true;
	const cap = Math.max(1, Math.min(32, maxSlots));
	const db = getDrizzleDb();
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT 1 FROM ingest_phase_gate WHERE phase = ${phase} FOR UPDATE`
		);
		const [row] = await tx.select().from(ingestPhaseGate).where(eq(ingestPhaseGate.phase, phase));
		if (!row || row.slotsInUse >= cap) return false;
		await tx
			.update(ingestPhaseGate)
			.set({ slotsInUse: row.slotsInUse + 1 })
			.where(eq(ingestPhaseGate.phase, phase));
		return true;
	});
}

export async function releasePhaseSlot(phase: IngestPhaseGateKey): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	const db = getDrizzleDb();
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT 1 FROM ingest_phase_gate WHERE phase = ${phase} FOR UPDATE`
		);
		const [row] = await tx.select().from(ingestPhaseGate).where(eq(ingestPhaseGate.phase, phase));
		if (!row) return;
		await tx
			.update(ingestPhaseGate)
			.set({ slotsInUse: Math.max(0, row.slotsInUse - 1) })
			.where(eq(ingestPhaseGate.phase, phase));
	});
}

/** Wrap Stage 4 embedding API calls when INGEST_PHASE_EMBED_MAX_CONCURRENT is set. */
export async function withEmbedPhaseSlot<T>(fn: () => Promise<T>): Promise<T> {
	const raw = (process.env.INGEST_PHASE_EMBED_MAX_CONCURRENT ?? '').trim();
	const max = parseInt(raw || '0', 10);
	if (!Number.isFinite(max) || max <= 0) return fn();
	if (!isNeonIngestPersistenceEnabled()) {
		console.warn(
			'[ingest] INGEST_PHASE_EMBED_MAX_CONCURRENT is set but Neon ingest persistence is not enabled — phase gate skipped'
		);
		return fn();
	}
	const ok = await tryAcquirePhaseSlot('embed', max);
	if (!ok) {
		throw new Error(
			`[INGEST] Embedding phase: max concurrent runs (${max}) reached (INGEST_PHASE_EMBED_MAX_CONCURRENT). Retry shortly.`
		);
	}
	try {
		return await fn();
	} finally {
		await releasePhaseSlot('embed');
	}
}
