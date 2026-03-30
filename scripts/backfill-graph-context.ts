import { Surreal } from 'surrealdb';
import { startSpinner, startStageTimer } from './progress.js';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

type GraphNodeTable = 'tradition' | 'subject' | 'period' | 'work';

type SourceRow = {
	id?: unknown;
	title?: unknown;
	url?: unknown;
	canonical_url_hash?: unknown;
};

type ThinkerRow = {
	id?: unknown;
	traditions?: unknown;
	domains?: unknown;
	birth_year?: unknown;
	death_year?: unknown;
};

type ClaimRow = {
	id?: unknown;
	source?: unknown;
	domain?: unknown;
	concept_tags?: unknown;
	era?: unknown;
};

type AuthoredRow = {
	in?: unknown;
	out?: unknown;
};

type Stats = {
	traditionsCreated: number;
	subjectsCreated: number;
	periodsCreated: number;
	worksCreated: number;
	belongsToTraditionInserted: number;
	worksInDomainInserted: number;
	activeInPeriodInserted: number;
	aboutSubjectInserted: number;
	inPeriodInserted: number;
	authoredWorkInserted: number;
	citesWorkInserted: number;
	relatedToSubjectInserted: number;
};

function parseArgs(argv: string[]) {
	return { dryRun: argv.includes('--dry-run') };
}

function normalizeRecordId(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') {
		const row = value as { tb?: unknown; id?: unknown };
		if (typeof row.tb === 'string' && row.id !== undefined) {
			return `${row.tb}:${String(row.id)}`;
		}
		if (typeof row.id === 'string') return row.id;
	}
	return null;
}

function withTablePrefix(recordId: string | null, table: string): string | null {
	if (!recordId) return null;
	return recordId.includes(':') ? recordId : `${table}:${recordId}`;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter(Boolean);
}

function cleanLabel(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 96);
}

function periodFromYear(year: number): string {
	if (year === 0) return '1st century CE';
	const absYear = Math.abs(year);
	const century = Math.floor((absYear - 1) / 100) + 1;
	const suffix = century % 10 === 1 && century % 100 !== 11
		? 'st'
		: century % 10 === 2 && century % 100 !== 12
			? 'nd'
			: century % 10 === 3 && century % 100 !== 13
				? 'rd'
				: 'th';
	if (year < 0) return `${century}${suffix} century BCE`;
	return `${century}${suffix} century CE`;
}

function deriveThinkerActivePeriod(row: ThinkerRow): string | null {
	const birth = typeof row.birth_year === 'number' ? row.birth_year : null;
	const death = typeof row.death_year === 'number' ? row.death_year : null;
	if (birth == null && death == null) return null;
	const pivot = birth != null && death != null ? Math.floor((birth + death) / 2) : (birth ?? death)!;
	return periodFromYear(pivot);
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
	} catch {
		await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	}
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

async function upsertNamedNode(
	db: Surreal,
	table: Exclude<GraphNodeTable, 'work'>,
	name: string,
	nodeCache: Set<string>,
	dryRun: boolean
): Promise<{ id: string; created: boolean } | null> {
	const clean = cleanLabel(name);
	if (!clean) return null;
	const slug = slugify(clean);
	if (!slug) return null;
	const id = `${table}:${slug}`;
	const created = !nodeCache.has(id);
	if (!dryRun) {
		await queryWithRetry(
			db,
			`UPSERT type::record('${table}', $rid) CONTENT {
				name: $name,
				slug: $rid,
				imported_at: time::now()
			}`,
			{ rid: slug, name: clean }
		);
	}
	nodeCache.add(id);
	return { id, created };
}

async function upsertWorkNode(
	db: Surreal,
	source: SourceRow,
	workCache: Set<string>,
	dryRun: boolean
): Promise<{ id: string; created: boolean } | null> {
	const sourceId = normalizeRecordId(source.id);
	const normalizedSourceId = withTablePrefix(sourceId, 'source');
	if (!normalizedSourceId) return null;
	const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : sourceId;
	const url = typeof source.url === 'string' ? source.url : '';
	const hash = typeof source.canonical_url_hash === 'string' ? source.canonical_url_hash : '';
	const rid = slugify(hash || url || title || sourceId);
	if (!rid) return null;
	const id = `work:${rid}`;
	const created = !workCache.has(id);
	if (!dryRun) {
		await queryWithRetry(
			db,
			`UPSERT type::record('work', $rid) CONTENT {
				title: $title,
				source_id: $source_id,
				source_url: $source_url,
				imported_at: time::now()
			}`,
			{ rid, title, source_id: normalizedSourceId, source_url: url || undefined }
		);
	}
	workCache.add(id);
	return { id, created };
}

function edgeKey(fromId: string, toId: string): string {
	return `${fromId}|${toId}`;
}

async function runInBatches<T>(
	items: T[],
	batchSize: number,
	handler: (item: T) => Promise<void>
): Promise<void> {
	for (let i = 0; i < items.length; i += batchSize) {
		const chunk = items.slice(i, i + batchSize);
		await Promise.all(chunk.map((item) => handler(item)));
	}
}

function isRetriableDbError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Transaction conflict') || message.includes('Resource busy');
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryWithRetry(
	db: Surreal,
	sql: string,
	vars: Record<string, unknown>,
	maxRetries = 5
): Promise<void> {
	let attempt = 0;
	for (;;) {
		try {
			await db.query(sql, vars);
			return;
		} catch (error) {
			if (!isRetriableDbError(error) || attempt >= maxRetries) throw error;
			attempt += 1;
			await sleep(40 * attempt);
		}
	}
}

async function relateIfAbsent(
	db: Surreal,
	table: string,
	fromId: string,
	toId: string,
	setClause: string,
	edgeCache: Set<string>,
	vars: Record<string, unknown>,
	dryRun: boolean
): Promise<boolean> {
	const key = edgeKey(fromId, toId);
	if (edgeCache.has(key)) return false;
	if (!dryRun) {
		await queryWithRetry(db, `RELATE ${fromId}->${table}->${toId} ${setClause}`, vars);
	}
	edgeCache.add(key);
	return true;
}

async function main(): Promise<void> {
	const { dryRun } = parseArgs(process.argv.slice(2));
	const db = await connect();
	const stats: Stats = {
		traditionsCreated: 0,
		subjectsCreated: 0,
		periodsCreated: 0,
		worksCreated: 0,
		belongsToTraditionInserted: 0,
		worksInDomainInserted: 0,
		activeInPeriodInserted: 0,
		aboutSubjectInserted: 0,
		inPeriodInserted: 0,
		authoredWorkInserted: 0,
		citesWorkInserted: 0,
		relatedToSubjectInserted: 0
	};
	const timer = startStageTimer();
	console.log(`[GRAPH-BACKFILL] Starting (${dryRun ? 'dry-run' : 'write'})`);

	try {
		const loadSpinner = startSpinner('Loading source/thinker/claim/authored rows');
		const [
			sourceRowsRes,
			thinkerRowsRes,
			claimRowsRes,
			authoredRowsRes,
			traditionRowsRes,
			subjectRowsRes,
			periodRowsRes,
			workRowsRes,
			belongsRowsRes,
			domainRowsRes,
			activeRowsRes,
			aboutRowsRes,
			inPeriodRowsRes,
			authoredWorkRowsRes,
			citesRowsRes,
			relatedRowsRes
		] = await Promise.all([
			db.query<SourceRow[][]>('SELECT id, title, url, canonical_url_hash FROM source'),
			db.query<ThinkerRow[][]>('SELECT id, traditions, domains, birth_year, death_year FROM thinker'),
			db.query<ClaimRow[][]>('SELECT id, source, domain, concept_tags, era FROM claim'),
			db.query<AuthoredRow[][]>('SELECT in, out FROM authored'),
			db.query<{ id?: unknown }[][]>('SELECT id FROM tradition'),
			db.query<{ id?: unknown }[][]>('SELECT id FROM subject'),
			db.query<{ id?: unknown }[][]>('SELECT id FROM period'),
			db.query<{ id?: unknown; source_id?: unknown }[][]>('SELECT id, source_id FROM work'),
			db.query<{ in?: unknown; out?: unknown }[][]>('SELECT in, out FROM belongs_to_tradition'),
			db.query<{ in?: unknown; out?: unknown }[][]>('SELECT in, out FROM works_in_domain'),
			db.query<{ in?: unknown; out?: unknown }[][]>('SELECT in, out FROM active_in_period'),
			db.query<{ in?: unknown; out?: unknown }[][]>('SELECT in, out FROM about_subject'),
			db.query<{ in?: unknown; out?: unknown }[][]>('SELECT in, out FROM in_period'),
			db.query<{ in?: unknown; out?: unknown }[][]>('SELECT in, out FROM authored_work'),
			db.query<{ in?: unknown; out?: unknown }[][]>('SELECT in, out FROM cites_work'),
			db.query<{ in?: unknown; out?: unknown }[][]>('SELECT in, out FROM related_to_subject')
		]);
		const sourceRows = sourceRowsRes?.[0] ?? [];
		const thinkerRows = thinkerRowsRes?.[0] ?? [];
		const claimRows = claimRowsRes?.[0] ?? [];
		const authoredRows = authoredRowsRes?.[0] ?? [];
		const traditionCache = new Set((traditionRowsRes?.[0] ?? []).map((row) => normalizeRecordId(row.id)).filter((v): v is string => Boolean(v)));
		const subjectCache = new Set((subjectRowsRes?.[0] ?? []).map((row) => normalizeRecordId(row.id)).filter((v): v is string => Boolean(v)));
		const periodCache = new Set((periodRowsRes?.[0] ?? []).map((row) => normalizeRecordId(row.id)).filter((v): v is string => Boolean(v)));
		const workCache = new Set((workRowsRes?.[0] ?? []).map((row) => normalizeRecordId(row.id)).filter((v): v is string => Boolean(v)));
		const belongsCache = new Set(
			(belongsRowsRes?.[0] ?? [])
				.map((row) => {
					const inId = normalizeRecordId(row.in);
					const outId = normalizeRecordId(row.out);
					return inId && outId ? edgeKey(inId, outId) : null;
				})
				.filter((v): v is string => Boolean(v))
		);
		const domainCache = new Set(
			(domainRowsRes?.[0] ?? [])
				.map((row) => {
					const inId = normalizeRecordId(row.in);
					const outId = normalizeRecordId(row.out);
					return inId && outId ? edgeKey(inId, outId) : null;
				})
				.filter((v): v is string => Boolean(v))
		);
		const activeCache = new Set(
			(activeRowsRes?.[0] ?? [])
				.map((row) => {
					const inId = normalizeRecordId(row.in);
					const outId = normalizeRecordId(row.out);
					return inId && outId ? edgeKey(inId, outId) : null;
				})
				.filter((v): v is string => Boolean(v))
		);
		const aboutCache = new Set(
			(aboutRowsRes?.[0] ?? [])
				.map((row) => {
					const inId = normalizeRecordId(row.in);
					const outId = normalizeRecordId(row.out);
					return inId && outId ? edgeKey(inId, outId) : null;
				})
				.filter((v): v is string => Boolean(v))
		);
		const inPeriodCache = new Set(
			(inPeriodRowsRes?.[0] ?? [])
				.map((row) => {
					const inId = normalizeRecordId(row.in);
					const outId = normalizeRecordId(row.out);
					return inId && outId ? edgeKey(inId, outId) : null;
				})
				.filter((v): v is string => Boolean(v))
		);
		const authoredWorkCache = new Set(
			(authoredWorkRowsRes?.[0] ?? [])
				.map((row) => {
					const inId = normalizeRecordId(row.in);
					const outId = normalizeRecordId(row.out);
					return inId && outId ? edgeKey(inId, outId) : null;
				})
				.filter((v): v is string => Boolean(v))
		);
		const citesWorkCache = new Set(
			(citesRowsRes?.[0] ?? [])
				.map((row) => {
					const inId = normalizeRecordId(row.in);
					const outId = normalizeRecordId(row.out);
					return inId && outId ? edgeKey(inId, outId) : null;
				})
				.filter((v): v is string => Boolean(v))
		);
		const relatedCache = new Set(
			(relatedRowsRes?.[0] ?? [])
				.map((row) => {
					const inId = normalizeRecordId(row.in);
					const outId = normalizeRecordId(row.out);
					return inId && outId ? edgeKey(inId, outId) : null;
				})
				.filter((v): v is string => Boolean(v))
		);
		loadSpinner.stop(
			`✓ Loaded source=${sourceRows.length} thinker=${thinkerRows.length} claim=${claimRows.length} authored=${authoredRows.length}`
		);

		const workBySourceId = new Map<string, string>();
		const subjectByName = new Map<string, string>();
		const traditionByName = new Map<string, string>();
		const periodByName = new Map<string, string>();

		const workSpinner = startSpinner('Backfilling work nodes');
		for (const row of workRowsRes?.[0] ?? []) {
			const sourceId = withTablePrefix(normalizeRecordId(row.source_id), 'source');
			const workId = normalizeRecordId(row.id);
			if (sourceId && workId) workBySourceId.set(sourceId, workId);
		}
		for (const source of sourceRows) {
			const sourceId = withTablePrefix(normalizeRecordId(source.id), 'source');
			if (!sourceId) continue;
			const work = await upsertWorkNode(db, source, workCache, dryRun);
			if (!work) continue;
			workBySourceId.set(sourceId, work.id);
			if (work.created) stats.worksCreated += 1;
		}
		workSpinner.stop(`✓ Work nodes processed (${stats.worksCreated} created)`);

		const thinkerGraphSpinner = startSpinner('Backfilling thinker graph context');
		const thinkerTraditionNames = new Set<string>();
		const thinkerSubjectNames = new Set<string>();
		const thinkerPeriodNames = new Set<string>();
		const belongsEdgeKeys = new Set<string>();
		const domainEdgeKeys = new Set<string>();
		const activeEdgeKeys = new Set<string>();

		for (const thinker of thinkerRows) {
			const thinkerId = withTablePrefix(normalizeRecordId(thinker.id), 'thinker');
			if (!thinkerId) continue;
			for (const name of toStringArray(thinker.traditions)) {
				const clean = cleanLabel(name);
				if (!clean) continue;
				thinkerTraditionNames.add(clean);
				const traditionId = `tradition:${slugify(clean)}`;
				if (!traditionId.endsWith(':')) {
					traditionByName.set(clean.toLowerCase(), traditionId);
					belongsEdgeKeys.add(edgeKey(thinkerId, traditionId));
				}
			}
			for (const name of toStringArray(thinker.domains)) {
				const clean = cleanLabel(name);
				if (!clean) continue;
				thinkerSubjectNames.add(clean);
				const subjectId = `subject:${slugify(clean)}`;
				if (!subjectId.endsWith(':')) {
					subjectByName.set(clean.toLowerCase(), subjectId);
					domainEdgeKeys.add(edgeKey(thinkerId, subjectId));
				}
			}
			const activePeriod = deriveThinkerActivePeriod(thinker);
			if (activePeriod) {
				const clean = cleanLabel(activePeriod);
				if (clean) {
					thinkerPeriodNames.add(clean);
					const periodId = `period:${slugify(clean)}`;
					if (!periodId.endsWith(':')) {
						periodByName.set(clean.toLowerCase(), periodId);
						activeEdgeKeys.add(edgeKey(thinkerId, periodId));
					}
				}
			}
		}

		for (const traditionName of thinkerTraditionNames) {
			const node = await upsertNamedNode(db, 'tradition', traditionName, traditionCache, dryRun);
			if (!node) continue;
			if (node.created) stats.traditionsCreated += 1;
			traditionByName.set(cleanLabel(traditionName).toLowerCase(), node.id);
		}
		for (const subjectName of thinkerSubjectNames) {
			const node = await upsertNamedNode(db, 'subject', subjectName, subjectCache, dryRun);
			if (!node) continue;
			if (node.created) stats.subjectsCreated += 1;
			subjectByName.set(cleanLabel(subjectName).toLowerCase(), node.id);
		}
		for (const periodName of thinkerPeriodNames) {
			const node = await upsertNamedNode(db, 'period', periodName, periodCache, dryRun);
			if (!node) continue;
			if (node.created) stats.periodsCreated += 1;
			periodByName.set(cleanLabel(periodName).toLowerCase(), node.id);
		}

		await runInBatches(Array.from(belongsEdgeKeys), 40, async (pair) => {
			const [fromId, toId] = pair.split('|');
			const inserted = await relateIfAbsent(
				db,
				'belongs_to_tradition',
				fromId,
				toId,
				`SET confidence = 0.9, imported_at = time::now()`,
				belongsCache,
				{},
				dryRun
			);
			if (inserted) stats.belongsToTraditionInserted += 1;
		});
		await runInBatches(Array.from(domainEdgeKeys), 40, async (pair) => {
			const [fromId, toId] = pair.split('|');
			const inserted = await relateIfAbsent(
				db,
				'works_in_domain',
				fromId,
				toId,
				`SET confidence = 0.9, imported_at = time::now()`,
				domainCache,
				{},
				dryRun
			);
			if (inserted) stats.worksInDomainInserted += 1;
		});
		await runInBatches(Array.from(activeEdgeKeys), 40, async (pair) => {
			const [fromId, toId] = pair.split('|');
			const inserted = await relateIfAbsent(
				db,
				'active_in_period',
				fromId,
				toId,
				`SET confidence = 0.8, imported_at = time::now()`,
				activeCache,
				{},
				dryRun
			);
			if (inserted) stats.activeInPeriodInserted += 1;
		});

		thinkerGraphSpinner.stop(
			`✓ Thinker graph context done (traditions=${stats.traditionsCreated}, subjects=${stats.subjectsCreated}, periods=${stats.periodsCreated})`
		);

		const subjectCooccurrence = new Map<string, number>();
		const claimGraphSpinner = startSpinner('Backfilling claim graph context');
		const subjectNames = new Set<string>();
		const periodNames = new Set<string>();
		const aboutEdgeKeys = new Set<string>();
		const inPeriodEdgeKeys = new Set<string>();
		const citesEdgeKeys = new Set<string>();

		for (const claim of claimRows) {
			const claimId = withTablePrefix(normalizeRecordId(claim.id), 'claim');
			if (!claimId) continue;
			const subjects = new Set<string>();
			if (typeof claim.domain === 'string' && claim.domain.trim()) {
				subjects.add(claim.domain.trim());
			}
			for (const tag of toStringArray(claim.concept_tags)) {
				subjects.add(tag);
			}
			const subjectIds: string[] = [];
			for (const subjectName of subjects) {
				const clean = cleanLabel(subjectName);
				if (!clean) continue;
				subjectNames.add(clean);
				const subjectId = `subject:${slugify(clean)}`;
				if (!subjectId.endsWith(':')) {
					subjectIds.push(subjectId);
					aboutEdgeKeys.add(edgeKey(claimId, subjectId));
				}
			}

			const era = typeof claim.era === 'string' ? claim.era.trim() : '';
			if (era) {
				const clean = cleanLabel(era);
				if (clean) {
					periodNames.add(clean);
					const periodId = `period:${slugify(clean)}`;
					if (!periodId.endsWith(':')) inPeriodEdgeKeys.add(edgeKey(claimId, periodId));
				}
			}

			const sourceId = withTablePrefix(normalizeRecordId(claim.source), 'source');
			if (sourceId) {
				const workId = workBySourceId.get(sourceId);
				if (workId) {
					citesEdgeKeys.add(edgeKey(claimId, workId));
				}
			}

			const dedupedSubjectIds = Array.from(new Set(subjectIds)).sort();
			for (let i = 0; i < dedupedSubjectIds.length; i++) {
				for (let j = i + 1; j < dedupedSubjectIds.length; j++) {
					const key = `${dedupedSubjectIds[i]}::${dedupedSubjectIds[j]}`;
					subjectCooccurrence.set(key, (subjectCooccurrence.get(key) ?? 0) + 1);
				}
			}
		}

		for (const subjectName of subjectNames) {
			const node = await upsertNamedNode(db, 'subject', subjectName, subjectCache, dryRun);
			if (!node) continue;
			if (node.created) stats.subjectsCreated += 1;
			subjectByName.set(cleanLabel(subjectName).toLowerCase(), node.id);
		}
		for (const periodName of periodNames) {
			const node = await upsertNamedNode(db, 'period', periodName, periodCache, dryRun);
			if (!node) continue;
			if (node.created) stats.periodsCreated += 1;
			periodByName.set(cleanLabel(periodName).toLowerCase(), node.id);
		}

		await runInBatches(Array.from(aboutEdgeKeys), 40, async (pair) => {
			const [fromId, toId] = pair.split('|');
			const inserted = await relateIfAbsent(
				db,
				'about_subject',
				fromId,
				toId,
				`SET confidence = 0.9, imported_at = time::now()`,
				aboutCache,
				{},
				dryRun
			);
			if (inserted) stats.aboutSubjectInserted += 1;
		});
		await runInBatches(Array.from(inPeriodEdgeKeys), 40, async (pair) => {
			const [fromId, toId] = pair.split('|');
			const inserted = await relateIfAbsent(
				db,
				'in_period',
				fromId,
				toId,
				`SET confidence = 0.85, imported_at = time::now()`,
				inPeriodCache,
				{},
				dryRun
			);
			if (inserted) stats.inPeriodInserted += 1;
		});
		await runInBatches(Array.from(citesEdgeKeys), 40, async (pair) => {
			const [fromId, toId] = pair.split('|');
			const inserted = await relateIfAbsent(
				db,
				'cites_work',
				fromId,
				toId,
				`SET confidence = 0.8, imported_at = time::now()`,
				citesWorkCache,
				{},
				dryRun
			);
			if (inserted) stats.citesWorkInserted += 1;
		});
		claimGraphSpinner.stop('✓ Claim graph context done');

		const authoredWorkSpinner = startSpinner('Backfilling authored_work edges');
		const authoredWorkEdgeKeys: string[] = [];
		for (const edge of authoredRows) {
			const thinkerId = withTablePrefix(normalizeRecordId(edge.in), 'thinker');
			const sourceId = withTablePrefix(normalizeRecordId(edge.out), 'source');
			if (!thinkerId || !sourceId) continue;
			const workId = workBySourceId.get(sourceId);
			if (!workId) continue;
			authoredWorkEdgeKeys.push(edgeKey(thinkerId, workId));
		}
		await runInBatches(authoredWorkEdgeKeys, 40, async (pair) => {
			const [thinkerId, workId] = pair.split('|');
			const inserted = await relateIfAbsent(
				db,
				'authored_work',
				thinkerId,
				workId,
				`SET confidence = 0.85, imported_at = time::now()`,
				authoredWorkCache,
				{},
				dryRun
			);
			if (inserted) stats.authoredWorkInserted += 1;
		});
		authoredWorkSpinner.stop(`✓ Authored_work done (${stats.authoredWorkInserted} inserted)`);

		const relatedSpinner = startSpinner('Backfilling related_to_subject edges');
		for (const [pair, count] of subjectCooccurrence) {
			if (count < 2) continue;
			const [fromId, toId] = pair.split('::');
			const inserted = await relateIfAbsent(
				db,
				'related_to_subject',
				fromId,
				toId,
				`SET weight = $weight, reason = 'claim_cooccurrence', imported_at = time::now()`,
				relatedCache,
				{ weight: Number((Math.min(1, count / 10)).toFixed(3)) },
				dryRun
			);
			if (inserted) stats.relatedToSubjectInserted += 1;
		}
		relatedSpinner.stop(`✓ Related subjects done (${stats.relatedToSubjectInserted} inserted)`);

		console.log('\n[GRAPH-BACKFILL] Summary');
		console.log(`  traditions created: ${stats.traditionsCreated}`);
		console.log(`  subjects created: ${stats.subjectsCreated}`);
		console.log(`  periods created: ${stats.periodsCreated}`);
		console.log(`  works created: ${stats.worksCreated}`);
		console.log(`  belongs_to_tradition inserted: ${stats.belongsToTraditionInserted}`);
		console.log(`  works_in_domain inserted: ${stats.worksInDomainInserted}`);
		console.log(`  active_in_period inserted: ${stats.activeInPeriodInserted}`);
		console.log(`  about_subject inserted: ${stats.aboutSubjectInserted}`);
		console.log(`  in_period inserted: ${stats.inPeriodInserted}`);
		console.log(`  authored_work inserted: ${stats.authoredWorkInserted}`);
		console.log(`  cites_work inserted: ${stats.citesWorkInserted}`);
		console.log(`  related_to_subject inserted: ${stats.relatedToSubjectInserted}`);
		console.log(`  Duration: ${timer.end()}`);
	} finally {
		await db.close();
	}
}

main().catch((error) => {
	console.error('[GRAPH-BACKFILL] Fatal:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});

