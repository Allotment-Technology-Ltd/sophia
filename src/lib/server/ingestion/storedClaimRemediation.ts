/**
 * Apply passage-bounded remediation to a stored Surreal claim (admin / quarantine job).
 * Reuses the same prompt contract as scripts/ingest.ts Stage 5b.
 */

import { generateText } from 'ai';
import { planIngestionStage } from '$lib/server/aaif/ingestion-plan';
import { embedTexts } from '$lib/server/embeddings';
import { query, update } from '$lib/server/db';
import {
	normalizeRemediationRepairOutput,
	REMEDIATION_REPAIR_SYSTEM,
	REMEDIATION_REPAIR_USER
} from '$lib/server/prompts/remediation';
import { sliceSourceAroundClaim } from '$lib/server/ingestion/remediationLogic';

function parseJsonResponse(text: string): unknown {
	let cleaned = text.trim();
	if (cleaned.startsWith('```json')) {
		cleaned = cleaned.slice(7);
	} else if (cleaned.startsWith('```')) {
		cleaned = cleaned.slice(3);
	}
	if (cleaned.endsWith('```')) {
		cleaned = cleaned.slice(0, -3);
	}
	return JSON.parse(cleaned.trim());
}

export async function applyRemediationToStoredClaim(claimId: string): Promise<{ id: string }> {
	const rows = await query<
		Array<{
			id: string;
			text: string;
			position_in_source?: number;
			source_span_start?: number;
			source_span_end?: number;
			claim_type?: string;
			domain?: string;
			source?: { title?: string };
			passage?: { text?: string };
		}>
	>(
		`SELECT * FROM type::thing($cid) FETCH source, passage;`,
		{ cid: claimId }
	);
	const row = Array.isArray(rows) ? rows[0] : undefined;
	if (!row || typeof row.text !== 'string') {
		throw new Error(`Claim not found: ${claimId}`);
	}

	let sourceBody = '';
	if (row.passage?.text && typeof row.passage.text === 'string') {
		sourceBody = row.passage.text;
	}
	if (!sourceBody) {
		sourceBody = row.text;
	}

	const excerpt = sliceSourceAroundClaim(
		sourceBody,
		row.source_span_start,
		row.source_span_end,
		{ maxChars: 14_000, pad: 500 }
	);

	const plan = await planIngestionStage('remediation', {
		sourceTitle: row.source?.title ?? 'source',
		sourceType: 'unknown',
		estimatedTokens: Math.ceil(sourceBody.length / 4),
		sourceLengthChars: sourceBody.length,
		claimCount: 1,
		preferredProvider: 'auto'
	});

	if (!plan.route?.model) {
		throw new Error('No executable route for remediation stage');
	}

	const pos = typeof row.position_in_source === 'number' ? row.position_in_source : 1;
	const userMsg = REMEDIATION_REPAIR_USER({
		position_in_source: pos,
		passage_excerpt: excerpt,
		claim_json: JSON.stringify(
			{
				position_in_source: pos,
				text: row.text,
				claim_type: row.claim_type ?? 'premise',
				domain: row.domain ?? 'philosophy'
			},
			null,
			2
		),
		validation_issues: ['operator-triggered quarantine remediation']
	});

	const result = await generateText({
		model: plan.route.model,
		system: REMEDIATION_REPAIR_SYSTEM,
		messages: [{ role: 'user', content: userMsg }],
		temperature: 0.1,
		maxOutputTokens: 8192
	});

	const parsed = parseJsonResponse(result.text);
	const out = normalizeRemediationRepairOutput(parsed, pos);

	const [emb] = await embedTexts([out.revised_claim_text], {});

	await update(claimId, {
		text: out.revised_claim_text,
		embedding: emb,
		verification_state: 'unverified',
		review_state: 'needs_review'
	});

	return { id: claimId };
}
