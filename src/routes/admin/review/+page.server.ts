import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import {
	DUPLICATE_CLASSIFICATIONS,
	REVIEWABLE_RELATION_TABLES,
	applyClaimReviewDecision,
	applyRelationReviewDecision,
	loadReviewDashboard,
	resolveClaimPairReview,
	type DuplicateClassification,
	type ReviewableRelationTable
} from '$lib/server/review/workflow';
import type { ReviewState } from '@restormel/contracts/ingestion';

const REVIEW_STATE_OPTIONS: Exclude<ReviewState, 'merged'>[] = [
	'accepted',
	'rejected',
	'needs_review',
	'candidate'
];

function assertAdmin(locals: App.Locals): { uid: string; email?: string | null } {
	if (!locals.user) {
		throw redirect(302, '/auth');
	}

	const adminUids = process.env.ADMIN_UIDS?.split(',').map((uid) => uid.trim()) ?? [];
	if (!adminUids.includes(locals.user.uid)) {
		throw error(403, 'Forbidden: Admin access required');
	}

	return {
		uid: locals.user.uid,
		email: locals.user.email ?? null
	};
}

function parseReviewState(value: FormDataEntryValue | null): Exclude<ReviewState, 'merged'> | null {
	const next = String(value ?? '').trim() as Exclude<ReviewState, 'merged'>;
	return REVIEW_STATE_OPTIONS.includes(next) ? next : null;
}

function parseRelationTable(value: FormDataEntryValue | null): ReviewableRelationTable | null {
	const table = String(value ?? '').trim() as ReviewableRelationTable;
	return REVIEWABLE_RELATION_TABLES.includes(table) ? table : null;
}

function parseDuplicateClassification(
	value: FormDataEntryValue | null
): DuplicateClassification | null {
	const classification = String(value ?? '').trim() as DuplicateClassification;
	return DUPLICATE_CLASSIFICATIONS.includes(classification) ? classification : null;
}

export const load: PageServerLoad = async ({ locals }) => {
	assertAdmin(locals);

	return {
		dashboard: await loadReviewDashboard(24),
		reviewStates: REVIEW_STATE_OPTIONS,
		duplicateClassifications: DUPLICATE_CLASSIFICATIONS
	};
};

export const actions: Actions = {
	reviewClaim: async ({ locals, request }) => {
		const actor = assertAdmin(locals);
		const formData = await request.formData();
		const claimId = String(formData.get('claim_id') ?? '').trim();
		const nextState = parseReviewState(formData.get('next_state'));
		const notes = String(formData.get('notes') ?? '').trim();

		if (!claimId || !nextState) {
			return fail(400, {
				error: 'Claim review request missing claim ID or next state.',
				section: 'claims'
			});
		}

		try {
			const updated = await applyClaimReviewDecision({
				claimId,
				nextState,
				actor,
				notes
			});

			return {
				success: `Claim ${updated.id} moved to ${updated.review_state}.`,
				section: 'claims'
			};
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : 'Failed to review claim.',
				section: 'claims'
			});
		}
	},

	reviewRelation: async ({ locals, request }) => {
		const actor = assertAdmin(locals);
		const formData = await request.formData();
		const relationId = String(formData.get('relation_id') ?? '').trim();
		const table = parseRelationTable(formData.get('relation_table'));
		const nextState = parseReviewState(formData.get('next_state'));
		const notes = String(formData.get('notes') ?? '').trim();

		if (!relationId || !table || !nextState) {
			return fail(400, {
				error: 'Relation review request missing table, relation ID, or next state.',
				section: 'relations'
			});
		}

		try {
			const updated = await applyRelationReviewDecision({
				table,
				relationId,
				nextState,
				actor,
				notes
			});

			return {
				success: `Relation ${updated.id} in ${updated.table} moved to ${updated.review_state}.`,
				section: 'relations'
			};
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : 'Failed to review relation.',
				section: 'relations'
			});
		}
	},

	resolveDuplicate: async ({ locals, request }) => {
		const actor = assertAdmin(locals);
		const formData = await request.formData();
		const leftClaimId = String(formData.get('left_claim_id') ?? '').trim();
		const rightClaimId = String(formData.get('right_claim_id') ?? '').trim();
		const canonicalClaimId = String(formData.get('canonical_claim_id') ?? '').trim();
		const classification = parseDuplicateClassification(formData.get('classification'));
		const notes = String(formData.get('notes') ?? '').trim();

		if (!leftClaimId || !rightClaimId || !classification) {
			return fail(400, {
				error: 'Duplicate resolution requires both claim IDs and a classification.',
				section: 'duplicates'
			});
		}

		try {
			const result = await resolveClaimPairReview({
				leftClaimId,
				rightClaimId,
				canonicalClaimId: canonicalClaimId || undefined,
				classification,
				actor,
				notes
			});

			return {
				success: `Recorded ${result.classification} for ${result.pairKey}.`,
				section: 'duplicates'
			};
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : 'Failed to resolve duplicate pair.',
				section: 'duplicates'
			});
		}
	}
};
