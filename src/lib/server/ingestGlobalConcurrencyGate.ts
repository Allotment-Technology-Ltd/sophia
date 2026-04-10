/**
 * Optional Neon-backed counter for concurrent ingest worker processes across app instances.
 * Enable with INGEST_GLOBAL_CONCURRENCY_GATE=1 (requires DATABASE_URL / Neon ingest persistence).
 */

import { eq, sql } from 'drizzle-orm';
import { ingestConcurrencyGate } from '$lib/server/db/schema';
import { getDrizzleDb } from '$lib/server/db/neon';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export function isIngestGlobalConcurrencyGateEnabled(): boolean {
	return (process.env.INGEST_GLOBAL_CONCURRENCY_GATE ?? '').trim() === '1';
}

export async function tryAcquireGlobalIngestSlot(maxSlots: number): Promise<boolean> {
	if (!isNeonIngestPersistenceEnabled()) return true;
	const cap = Math.max(1, Math.min(64, maxSlots));
	const db = getDrizzleDb();
	return db.transaction(async (tx) => {
		await tx.execute(sql`SELECT 1 FROM ingest_concurrency_gate WHERE id = 1 FOR UPDATE`);
		const [row] = await tx.select().from(ingestConcurrencyGate).where(eq(ingestConcurrencyGate.id, 1));
		if (!row || row.slotsInUse >= cap) return false;
		await tx
			.update(ingestConcurrencyGate)
			.set({ slotsInUse: row.slotsInUse + 1 })
			.where(eq(ingestConcurrencyGate.id, 1));
		return true;
	});
}

export async function releaseGlobalIngestSlot(): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	const db = getDrizzleDb();
	await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT 1 FROM ingest_concurrency_gate WHERE id = 1 FOR UPDATE`);
		const [row] = await tx.select().from(ingestConcurrencyGate).where(eq(ingestConcurrencyGate.id, 1));
		if (!row) return;
		await tx
			.update(ingestConcurrencyGate)
			.set({ slotsInUse: Math.max(0, row.slotsInUse - 1) })
			.where(eq(ingestConcurrencyGate.id, 1));
	});
}
