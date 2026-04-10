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

export async function loadQuarantineClaimQueue(opts: {
	maxScore?: number;
	limit?: number;
	sourceUrlContains?: string;
}): Promise<QuarantineClaimRow[]> {
	const maxScore = opts.maxScore ?? 80;
	const limit = Math.min(100, Math.max(1, opts.limit ?? 40));
	const urlPart = opts.sourceUrlContains?.trim().toLowerCase();

	const sql = `
SELECT
	id,
	text,
	validation_score,
	verification_state,
	review_state,
	position_in_source,
	source.title AS source_title,
	source.url AS source_url
FROM claim
WHERE
	(
		validation_score IS NONE OR validation_score < $max_score
		OR verification_state IS NONE OR verification_state != 'validated'
		OR review_state = 'needs_review'
	)
	${urlPart ? 'AND string::contains(string::lowercase(source.url), $url_part)' : ''}
FETCH source
ORDER BY validation_score ASC
LIMIT $lim;
`;

	const vars: Record<string, unknown> = {
		max_score: maxScore,
		lim: limit,
		...(urlPart ? { url_part: urlPart } : {})
	};

	const rows = await query<Record<string, unknown>[]>(sql, vars);
	if (!Array.isArray(rows)) return [];

	return rows
		.map((r) => ({
			id: String(r.id ?? ''),
			text: typeof r.text === 'string' ? r.text : '',
			validation_score: typeof r.validation_score === 'number' ? r.validation_score : null,
			verification_state: typeof r.verification_state === 'string' ? r.verification_state : null,
			review_state: typeof r.review_state === 'string' ? r.review_state : null,
			position_in_source: typeof r.position_in_source === 'number' ? r.position_in_source : null,
			source_title: typeof r.source_title === 'string' ? r.source_title : null,
			source_url: typeof r.source_url === 'string' ? r.source_url : null
		}))
		.filter((r) => r.id.length > 0);
}
