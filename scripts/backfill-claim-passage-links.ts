import { Buffer } from 'node:buffer';

type PassageRow = {
	id: string;
	order_in_source: number;
	role?: string;
};

type ClaimRow = {
	id: string;
	position_in_source?: number | null;
};

function sourceRecordId(source: unknown): string {
	if (typeof source === 'string') return source;
	if (source && typeof source === 'object') {
		const tb = (source as { tb?: unknown }).tb;
		const id = (source as { id?: unknown }).id;
		if (typeof tb === 'string' && id !== undefined) return `${tb}:${String(id)}`;
	}
	return String(source ?? '');
}

function sourceIdPart(source: unknown): string {
	const full = sourceRecordId(source);
	return full.includes(':') ? full.split(':').slice(1).join(':') : full;
}

function baseUrl(): string {
	const raw = process.env.SURREAL_URL || 'http://localhost:8800';
	return raw
		.replace(/^ws:\/\//i, 'http://')
		.replace(/^wss:\/\//i, 'https://')
		.replace(/\/rpc\/?$/, '')
		.replace(/\/sql\/?$/, '')
		.replace(/\/$/, '');
}

function authHeader(): string {
	const user = process.env.SURREAL_USER || 'root';
	const pass = process.env.SURREAL_PASS || 'root';
	return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function ns(): string {
	return process.env.SURREAL_NAMESPACE || 'sophia';
}

function dbName(): string {
	return process.env.SURREAL_DATABASE || 'sophia';
}

async function queryRows<T = Record<string, unknown>>(
	sql: string,
	vars: Record<string, unknown> = {}
): Promise<T[]> {
	const sets = Object.entries(vars)
		.map(([k, v]) => `LET $${k} = ${JSON.stringify(v)};`)
		.join(' ');
	const res = await fetch(`${baseUrl()}/sql`, {
		method: 'POST',
		headers: {
			'Content-Type': 'text/plain',
			Accept: 'application/json',
			Authorization: authHeader(),
			'surreal-ns': ns(),
			'surreal-db': dbName()
		},
		body: `${sets} ${sql}`
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`HTTP ${res.status}: ${text}`);
	}
	const payload = (await res.json()) as Array<{ status: string; result?: unknown; detail?: string }>;
	const meaningful = payload.filter((row) => !(row.status === 'OK' && row.result === null));
	const last = meaningful[meaningful.length - 1] ?? payload[payload.length - 1];
	if (!last) return [];
	if (last.status !== 'OK') {
		throw new Error(last.detail || `Query failed: ${last.status}`);
	}
	return Array.isArray(last.result) ? (last.result as T[]) : [];
}

async function scalar(sql: string, vars: Record<string, unknown> = {}): Promise<number> {
	const rows = await queryRows<{ c?: number; count?: number }>(sql, vars);
	return Number(rows[0]?.c ?? rows[0]?.count ?? 0);
}

function choosePassage(position: number | null | undefined, passages: PassageRow[]): PassageRow | null {
	if (passages.length === 0) return null;
	if (!Number.isFinite(position as number)) return passages[0]!;
	const target = Number(position);
	let best = passages[0]!;
	let bestDist = Math.abs(best.order_in_source - target);
	for (let i = 1; i < passages.length; i += 1) {
		const candidate = passages[i]!;
		const dist = Math.abs(candidate.order_in_source - target);
		if (dist < bestDist) {
			best = candidate;
			bestDist = dist;
		}
	}
	return best;
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	const batchSizeArg = process.argv.indexOf('--batch-size');
	const batchSize = batchSizeArg >= 0 && process.argv[batchSizeArg + 1] ? Number(process.argv[batchSizeArg + 1]) : 500;
	const concurrencyArg = process.argv.indexOf('--concurrency');
	const concurrency =
		concurrencyArg >= 0 && process.argv[concurrencyArg + 1] ? Number(process.argv[concurrencyArg + 1]) : 24;
	if (!Number.isFinite(batchSize) || batchSize <= 0) {
		throw new Error('Invalid --batch-size');
	}
	if (!Number.isFinite(concurrency) || concurrency <= 0) {
		throw new Error('Invalid --concurrency');
	}

	const beforeMissing = await scalar(`SELECT count() AS c FROM claim WHERE passage = NONE GROUP ALL`);
	console.log(`[CLAIM-PASSAGE-BACKFILL] missing passage before=${beforeMissing}`);

	const sourceRows = await queryRows<{ source: unknown; c: number }>(
		`SELECT source, count() AS c FROM claim WHERE passage = NONE GROUP BY source`
	);
	console.log(`[CLAIM-PASSAGE-BACKFILL] sources with missing claims=${sourceRows.length}`);

	let updated = 0;
	let skipped = 0;

	for (const sourceRow of sourceRows) {
		const sourceId = sourceRecordId(sourceRow.source);
		const sourcePart = sourceIdPart(sourceRow.source);
		const passages = await queryRows<PassageRow>(
			`SELECT id, order_in_source, role
			 FROM passage
			 WHERE source = type::thing('source', $source_part)
			 ORDER BY order_in_source ASC`,
			{ source_part: sourcePart }
		);
		if (passages.length === 0) {
			skipped += sourceRow.c;
			console.log(`[SKIP] ${sourceId} no passages; claims=${sourceRow.c}`);
			continue;
		}

		const claims = await queryRows<ClaimRow>(
			`SELECT id, position_in_source
			 FROM claim
			 WHERE source = type::thing('source', $source_part) AND passage = NONE
			 ORDER BY position_in_source ASC, id ASC`,
			{ source_part: sourcePart }
		);

		let cursor = 0;
		const workers = Array.from({ length: Math.min(concurrency, claims.length) }, async () => {
			while (cursor < claims.length) {
				const i = cursor;
				cursor += 1;
				const claim = claims[i]!;
				const chosen = choosePassage(claim.position_in_source, passages);
				if (!chosen) {
					skipped += 1;
					continue;
				}
				if (!dryRun) {
					try {
						await queryRows(
							`UPDATE type::thing($id) MERGE {
								passage: type::thing($passage_id),
								passage_order: $passage_order,
								passage_role: $passage_role
							} RETURN NONE`,
							{
								id: claim.id,
								passage_id: chosen.id,
								passage_order: chosen.order_in_source,
								passage_role: chosen.role ?? 'premise'
							}
						);
					} catch (error) {
						skipped += 1;
						console.error(
							`[CLAIM-PASSAGE-BACKFILL] update_failed claim=${claim.id} source=${sourceId}: ${
								error instanceof Error ? error.message : String(error)
							}`
						);
						continue;
					}
				}
				updated += 1;
				if (updated % batchSize === 0) {
					console.log(`[CLAIM-PASSAGE-BACKFILL] progress updated=${updated}`);
				}
			}
		});
		await Promise.all(workers);
	}

	const afterMissing = dryRun
		? beforeMissing - updated
		: await scalar(`SELECT count() AS c FROM claim WHERE passage = NONE GROUP ALL`);

	console.log(`[CLAIM-PASSAGE-BACKFILL] updated=${updated} skipped=${skipped} missing_after=${afterMissing} dryRun=${dryRun}`);

	if (!dryRun) {
		await queryRows(
			`CREATE review_audit_log CONTENT {
				entity_kind: 'claim',
				entity_id: $entity_id,
				entity_table: 'claim',
				action: 'classify_pair',
				previous_state: NONE,
				next_state: NONE,
				reviewer_uid: 'system:phase1-closeout',
				reviewer_email: 'system@sophia.local',
				source_id: NONE,
				source_title: 'Phase 1 Closeout',
				merge_target_id: NONE,
				merge_classification: NONE,
				notes: 'Backfilled claim->passage links for legacy claims missing passage.',
				metadata: {
					updated: $updated,
					skipped: $skipped,
					missing_before: $before,
					missing_after: $after
				},
				created_at: time::now()
			}`,
			{
				entity_id: `bulk:claim-passage-backfill:${Date.now()}`,
				updated,
				skipped,
				before: beforeMissing,
				after: afterMissing
			}
		);
	}
}

main().catch((error) => {
	console.error('[CLAIM-PASSAGE-BACKFILL] Fatal:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});
