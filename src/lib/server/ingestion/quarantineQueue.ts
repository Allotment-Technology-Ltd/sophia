/**
 * Operator quarantine queue — claims that may need review or agent remediation
 * (low validation score, non-validated verification, or review flags).
 *
 * Post-store: `scripts/ingest.ts` may set `review_state: needs_review` for low faithfulness
 * when `INGEST_POST_STORE_LOW_VALIDATION_REVIEW_THRESHOLD` is set (see ingestion-sep-preset-discipline.md).
 */

import { query } from '$lib/server/db';

export interface QuarantineClaimRow {
	id: string;
	text: string;
	validation_score: number | null;
	verification_state: string | null;
	review_state: string | null;
	position_in_source: number | null;
	source_title: string | null;
	source_url: string | null;
}

function thingIdToString(id: unknown): string {
	if (typeof id === 'string') return id;
	if (id != null && typeof (id as { toString?: () => string }).toString === 'function') {
		return String(id);
	}
	return '';
}

export async function loadQuarantineClaimQueue(opts: {
	maxScore?: number;
	limit?: number;
	sourceUrlContains?: string;
}): Promise<QuarantineClaimRow[]> {
	const maxScore = opts.maxScore ?? 80;
	const limit = Math.min(100, Math.max(1, opts.limit ?? 40));
	const urlPart = opts.sourceUrlContains?.trim().toLowerCase();

	/* SurrealQL: WHERE → ORDER BY → LIMIT → FETCH (FETCH must be last; do not reference source.* in WHERE).
	 * Filter URL in JS if needed. Tight OR avoids selecting “all claims”. */
	const sql = `
SELECT
	id,
	text,
	validation_score,
	verification_state,
	review_state,
	position_in_source
FROM claim
WHERE
	(
		(validation_score IS NOT NONE AND validation_score < $max_score)
		OR review_state = 'needs_review'
		OR (
			verification_state IS NOT NONE
			AND verification_state != 'validated'
			AND verification_state != 'skipped'
		)
	)
ORDER BY validation_score ASC
LIMIT $lim
FETCH source;
`;

	const vars: Record<string, unknown> = {
		max_score: maxScore,
		lim: limit
	};

	const rows = await query<Record<string, unknown>[]>(sql, vars);
	if (!Array.isArray(rows)) return [];

	const mapped: QuarantineClaimRow[] = [];
	for (const r of rows) {
		const raw = r.source as Record<string, unknown> | Record<string, unknown>[] | undefined;
		const source = Array.isArray(raw) ? raw[0] : raw;
		const source_title =
			source && typeof source.title === 'string' ? source.title : null;
		const source_url =
			source && typeof source.url === 'string' ? source.url : null;

		if (urlPart) {
			const u = (source_url ?? '').toLowerCase();
			if (!u.includes(urlPart)) continue;
		}

		const id = thingIdToString(r.id);
		if (!id) continue;

		mapped.push({
			id,
			text: typeof r.text === 'string' ? r.text : '',
			validation_score: typeof r.validation_score === 'number' ? r.validation_score : null,
			verification_state: typeof r.verification_state === 'string' ? r.verification_state : null,
			review_state: typeof r.review_state === 'string' ? r.review_state : null,
			position_in_source: typeof r.position_in_source === 'number' ? r.position_in_source : null,
			source_title,
			source_url
		});
	}

	return mapped;
}
