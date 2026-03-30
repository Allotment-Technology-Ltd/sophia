import { Surreal } from 'surrealdb';
import {
	canonicalizeThinkerName,
	estimateThinkerNameConfidence,
	pickThinkerAutoLinkCandidate,
	type ThinkerIdentityCandidate
} from '../src/lib/server/thinkerIdentity.js';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const THINKER_AUTO_LINK_MIN_CONFIDENCE = Number(
	process.env.THINKER_AUTO_LINK_MIN_CONFIDENCE || '0.86'
);
const THINKER_AUTO_LINK_MIN_DELTA = Number(process.env.THINKER_AUTO_LINK_MIN_DELTA || '0.08');
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_USER_AGENT =
	'SOPHIA-thinker-reconcile/1.0 (https://usesophia.app; contact@allotment.tech)';

interface Flags {
	dryRun: boolean;
	limit: number;
	driftCheck: boolean;
}

interface QueueRow {
	id: unknown;
	raw_name?: string;
	canonical_name?: string;
	source_ids?: string[];
	status?: string;
	last_seen_at?: string;
}

interface ThinkerRow {
	id: unknown;
	name?: string;
}

interface WikidataThinkerCandidate {
	wikidata_id: string;
	name: string;
	confidence: number;
}

function parseFlags(argv: string[]): Flags {
	const limitArg = argv.find((arg) => arg.startsWith('--limit=')) ?? '';
	const parsed = Number.parseInt(limitArg.replace('--limit=', ''), 10);
	return {
		dryRun: argv.includes('--dry-run'),
		limit: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 200,
		driftCheck: argv.includes('--drift-check')
	};
}

function recordIdToString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string') {
		return (value as { id: string }).id;
	}
	return String(value ?? '');
}

function qidFromRecordId(value: unknown): string | null {
	const raw = recordIdToString(value);
	const match = raw.match(/Q\d+$/);
	return match?.[0] ?? null;
}

async function fetchWikidataJson(params: Record<string, string>): Promise<any> {
	const url = new URL(WIKIDATA_API);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	const response = await fetch(url.toString(), {
		headers: {
			Accept: 'application/json',
			'User-Agent': WIKIDATA_USER_AGENT
		}
	});
	if (!response.ok) {
		throw new Error(`Wikidata API ${response.status} ${response.statusText}`);
	}
	return response.json();
}

function extractClaimEntityIds(claims: any[] | undefined): string[] {
	if (!Array.isArray(claims)) return [];
	const result: string[] = [];
	for (const claim of claims) {
		const id = claim?.mainsnak?.datavalue?.value?.id;
		if (typeof id === 'string') result.push(id);
	}
	return result;
}

async function resolveWikidataThinker(name: string): Promise<WikidataThinkerCandidate | null> {
	const search = await fetchWikidataJson({
		action: 'wbsearchentities',
		search: name,
		language: 'en',
		format: 'json',
		limit: '6',
		type: 'item',
		origin: '*'
	});
	const candidates = Array.isArray(search?.search) ? search.search : [];
	if (candidates.length === 0) return null;
	const candidateIds = candidates
		.map((candidate: any) => (typeof candidate?.id === 'string' ? candidate.id : null))
		.filter((id: string | null): id is string => Boolean(id));
	if (candidateIds.length === 0) return null;

	const entitiesPayload = await fetchWikidataJson({
		action: 'wbgetentities',
		ids: candidateIds.join('|'),
		props: 'labels|claims',
		languages: 'en',
		format: 'json',
		origin: '*'
	});
	const entities = entitiesPayload?.entities ?? {};

	const broadThinkerKeywords = [
		'philosopher',
		'ethicist',
		'philosophy',
		'logician',
		'political theorist',
		'moral theologian',
		'bioethicist',
		'epistemologist',
		'metaphysician',
		'theorist'
	];
	const canonicalInput = canonicalizeThinkerName(name);
	let best: WikidataThinkerCandidate | null = null;
	for (const candidate of candidates) {
		const candidateId = candidate?.id;
		if (typeof candidateId !== 'string') continue;
		const entity = entities[candidateId];
		if (!entity) continue;

		const instanceOfIds = extractClaimEntityIds(entity?.claims?.P31);
		const occupationIds = extractClaimEntityIds(entity?.claims?.P106);
		const isHuman = instanceOfIds.includes('Q5');
		if (!isHuman) continue;

		const label = entity?.labels?.en?.value ?? candidate?.label ?? candidateId;
		const description = typeof candidate?.description === 'string' ? candidate.description.toLowerCase() : '';
		const canonicalLabel = canonicalizeThinkerName(label);
		const isExactLabel = canonicalLabel === canonicalInput;
		const isPhilosopher = occupationIds.includes('Q4964182');
		const descriptionMatches = broadThinkerKeywords.some((keyword) => description.includes(keyword));
		if (!isPhilosopher && !descriptionMatches) continue;

		let score = 0;
		if (isPhilosopher) score += 100;
		if (descriptionMatches) score += 40;
		if (isExactLabel) score += 30;
		if (canonicalLabel.includes(canonicalInput) || canonicalInput.includes(canonicalLabel)) score += 15;

		const confidence = Math.min(0.99, Math.max(0.7, score / 180));
		if (!best || confidence > best.confidence) {
			best = {
				wikidata_id: candidateId,
				name: label,
				confidence
			};
		}
	}
	return best;
}

async function connect(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	try {
		await db.signin({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE,
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
	} catch (scopedError) {
		try {
			await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
		} catch {
			throw scopedError;
		}
	}
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

async function main(): Promise<void> {
	const flags = parseFlags(process.argv.slice(2));
	console.log('[THINKER-RECONCILE] Starting reconcile run...');
	console.log(`[THINKER-RECONCILE] Flags: dryRun=${flags.dryRun} limit=${flags.limit} driftCheck=${flags.driftCheck}`);
	const db = await connect();
	try {
		const thinkerRows = await db.query<ThinkerRow[][]>(`SELECT id, name FROM thinker`);
		const thinkers = (thinkerRows?.[0] ?? [])
			.map((row) => {
				const wikidata_id = qidFromRecordId(row.id);
				const name = typeof row.name === 'string' ? row.name.trim() : '';
				if (!wikidata_id || !name) return null;
				return { wikidata_id, name };
			})
			.filter((row): row is { wikidata_id: string; name: string } => Boolean(row));

		const queueRows = await db.query<QueueRow[][]>(
			`SELECT id, raw_name, canonical_name, source_ids, status, last_seen_at
			 FROM unresolved_thinker_reference
			 WHERE status = 'queued'
			 ORDER BY last_seen_at DESC
			 LIMIT $limit`,
			{ limit: flags.limit }
		);
		const queue = queueRows?.[0] ?? [];
		let resolved = 0;
		let queued = 0;
		let driftWarnings = 0;
		let wikidataResolved = 0;

		for (const row of queue) {
			const rawName = typeof row.raw_name === 'string' ? row.raw_name.trim() : '';
			const canonical = typeof row.canonical_name === 'string' ? row.canonical_name : canonicalizeThinkerName(rawName);
			const queueRecordId = recordIdToString(row.id);
			if (!rawName || !queueRecordId) continue;
			const candidates: ThinkerIdentityCandidate[] = [];
			for (const thinker of thinkers) {
				const confidence = estimateThinkerNameConfidence(rawName, thinker.name);
				if (confidence > 0) {
					candidates.push({
						wikidata_id: thinker.wikidata_id,
						name: thinker.name,
						confidence
					});
				}
			}
			const decision = pickThinkerAutoLinkCandidate(
				candidates,
				THINKER_AUTO_LINK_MIN_CONFIDENCE,
				THINKER_AUTO_LINK_MIN_DELTA
			);
			let chosen = decision.best;
			let chosenBy: 'heuristic' | 'wikidata' = 'heuristic';
			if (!chosen) {
				try {
					const wikidata = await resolveWikidataThinker(rawName);
					if (wikidata && wikidata.confidence >= THINKER_AUTO_LINK_MIN_CONFIDENCE) {
						chosen = wikidata;
						chosenBy = 'wikidata';
					}
				} catch {
					// network/API issues should not fail reconcile pass
				}
			}

			if (!chosen) {
				queued += 1;
				if (!flags.dryRun) {
					await db.query(
						`CREATE thinker_resolution_audit_log CONTENT {
							raw_name: $raw_name,
							canonical_name: $canonical_name,
							action: 'reconcile_queue',
							queue_record_id: $queue_record_id,
							notes: $notes,
							created_at: time::now()
						}`,
						{
							raw_name: rawName,
							canonical_name: canonical,
							queue_record_id: queueRecordId,
							notes: `Still unresolved after reconcile (${decision.reason})`
						}
					);
				}
				continue;
			}

			const sourceIds = Array.isArray(row.source_ids) ? row.source_ids.filter((x): x is string => typeof x === 'string') : [];
			if (!flags.dryRun) {
				if (chosenBy === 'wikidata') {
					await db.query(
						`UPSERT type::record('thinker', $wikidata_id) CONTENT {
							wikidata_id: $wikidata_id,
							name: $name,
							traditions: [],
							domains: [],
							imported_at: time::now()
						}`,
						{
							wikidata_id: chosen.wikidata_id,
							name: chosen.name
						}
					);
				}
				await db.query(
					`UPSERT thinker_alias:$rid CONTENT {
						canonical_name: $canonical_name,
						raw_name: $raw_name,
						wikidata_id: $wikidata_id,
						label: $label,
						confidence: $confidence,
						resolved_by: 'heuristic',
						status: 'active',
						source_contexts: $source_contexts,
						updated_at: time::now(),
						created_at: time::now()
					}`,
					{
						rid: canonical.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, ''),
						canonical_name: canonical,
						raw_name: rawName,
						wikidata_id: chosen.wikidata_id,
						label: chosen.name,
						confidence: chosen.confidence,
						source_contexts: sourceIds.map((sid) => `source:${sid}`)
					}
				);
				for (const sourceId of sourceIds) {
					await db.query(
						`LET $from = type::record('thinker', $wikidata_id);
						 LET $to = type::record('source', $source_id);
						 LET $existing = (SELECT id FROM authored WHERE in = $from AND out = $to LIMIT 1);
						 IF array::len($existing) = 0 {
						 	RELATE $from->authored->$to
						 		SET match_type = 'reconcile_identity_resolver',
						 		    confidence = $confidence,
						 		    linked_at = time::now();
						 }`,
						{
							wikidata_id: chosen.wikidata_id,
							source_id: sourceId,
							confidence: chosen.confidence
						}
					);
				}
				await db.query(
					`UPDATE type::thing($queue_record_id) MERGE {
						status: 'resolved',
						resolver_notes: $notes,
						last_seen_at: time::now()
					}`,
					{
						queue_record_id: queueRecordId,
						notes: `Reconciled automatically to ${chosen.wikidata_id}`
					}
				);
				await db.query(
					`CREATE thinker_resolution_audit_log CONTENT {
						raw_name: $raw_name,
						canonical_name: $canonical_name,
						wikidata_id: $wikidata_id,
						label: $label,
						action: 'reconcile_resolve',
						confidence: $confidence,
						queue_record_id: $queue_record_id,
						created_at: time::now()
					}`,
					{
						raw_name: rawName,
						canonical_name: canonical,
						wikidata_id: chosen.wikidata_id,
						label: chosen.name,
						confidence: chosen.confidence,
						queue_record_id: queueRecordId
					}
				);
			}
			resolved += 1;
			if (chosenBy === 'wikidata') wikidataResolved += 1;
		}

		if (flags.driftCheck) {
			const driftRows = await db.query<Array<{ canonical_name?: string; wikidata_id?: string; label?: string }>[]>(
				`SELECT canonical_name, wikidata_id, label FROM thinker_alias WHERE status = 'active'`
			);
			for (const row of driftRows?.[0] ?? []) {
				if (typeof row.wikidata_id !== 'string') continue;
				const thinker = thinkers.find((x) => x.wikidata_id === row.wikidata_id);
				if (!thinker) continue;
				if (typeof row.label === 'string' && row.label && row.label !== thinker.name) {
					driftWarnings += 1;
				}
			}
		}

		console.log('[THINKER-RECONCILE] Summary');
		console.log(`  Queue rows scanned: ${queue.length}`);
		console.log(`  Resolved: ${resolved}`);
		console.log(`  Resolved via Wikidata fallback: ${wikidataResolved}`);
		console.log(`  Still queued: ${queued}`);
		console.log(`  Drift warnings: ${driftWarnings}`);
	} finally {
		await db.close();
	}
}

main().catch((error) => {
	console.error(
		'[THINKER-RECONCILE] Fatal error:',
		error instanceof Error ? error.message : String(error)
	);
	process.exit(1);
});
