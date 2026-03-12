import { Buffer } from 'node:buffer';

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
	if (last.status !== 'OK') throw new Error(last.detail || `Query failed: ${last.status}`);
	return Array.isArray(last.result) ? (last.result as T[]) : [];
}

async function scalar(sql: string): Promise<number> {
	const rows = await queryRows<{ c?: number; count?: number }>(sql);
	return Number(rows[0]?.c ?? rows[0]?.count ?? 0);
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');

	const before = await scalar(
		`SELECT count() AS c FROM claim WHERE review_state = 'accepted' AND verification_state = 'unverified' GROUP ALL`
	);
	console.log(`[ACCEPTED-CLAIM-VALIDATION] accepted_unverified_before=${before}`);

	const eligible = await scalar(
		`SELECT count() AS c
		 FROM claim
		 WHERE review_state = 'accepted'
		   AND verification_state = 'unverified'
		   AND passage != NONE
		   AND source_span_start != NONE
		   AND source_span_end != NONE
		   AND source_span_end >= source_span_start
		 GROUP ALL`
	);
	console.log(`[ACCEPTED-CLAIM-VALIDATION] eligible_for_validated=${eligible}`);

	if (!dryRun && eligible > 0) {
		await queryRows(
			`UPDATE claim
			 SET verification_state = 'validated'
			 WHERE review_state = 'accepted'
			   AND verification_state = 'unverified'
			   AND passage != NONE
			   AND source_span_start != NONE
			   AND source_span_end != NONE
			   AND source_span_end >= source_span_start
			 RETURN NONE`
		);
	}

	const after = dryRun
		? before - eligible
		: await scalar(
				`SELECT count() AS c FROM claim WHERE review_state = 'accepted' AND verification_state = 'unverified' GROUP ALL`
		  );

	console.log(`[ACCEPTED-CLAIM-VALIDATION] accepted_unverified_after=${after} dryRun=${dryRun}`);

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
				notes: 'Validated accepted claims that met provenance/linkage gates.',
				metadata: {
					accepted_unverified_before: $before,
					eligible_for_validated: $eligible,
					accepted_unverified_after: $after
				},
				created_at: time::now()
			}`,
			{ entity_id: `bulk:accepted-claim-validation:${Date.now()}`, before, eligible, after }
		);
	}
}

main().catch((error) => {
	console.error('[ACCEPTED-CLAIM-VALIDATION] Fatal:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});
