import { json, type RequestHandler } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { applyRelationReviewDecision } from '$lib/server/review/workflow';
import { ReviewRelationDecisionSchema } from '$lib/server/review/adminReviewApi';

export const POST: RequestHandler = async ({ locals, request }) => {
	const actor = assertAdminAccess(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	try {
		const payload = ReviewRelationDecisionSchema.parse(body);
		const updated = await applyRelationReviewDecision({
			table: payload.relation_table,
			relationId: payload.relation_id,
			nextState: payload.next_state,
			actor,
			notes: payload.notes
		});

		return json({
			success: `Relation ${updated.id} in ${updated.table} moved to ${updated.review_state}.`,
			updated
		});
	} catch (error) {
		if (error instanceof ZodError) {
			return json(
				{
					error: 'Invalid relation review payload',
					issues: error.issues
				},
				{ status: 400 }
			);
		}
		return json(
			{
				error: error instanceof Error ? error.message : 'Failed to review relation.'
			},
			{ status: 400 }
		);
	}
};
