import { json, type RequestHandler } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { applyClaimReviewDecision } from '$lib/server/review/workflow';
import { ReviewClaimDecisionSchema } from '$lib/server/review/adminReviewApi';

export const POST: RequestHandler = async ({ locals, request }) => {
	const actor = assertAdminAccess(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	try {
		const payload = ReviewClaimDecisionSchema.parse(body);
		const updated = await applyClaimReviewDecision({
			claimId: payload.claim_id,
			nextState: payload.next_state,
			actor,
			notes: payload.notes
		});

		return json({
			success: `Claim ${updated.id} moved to ${updated.review_state}.`,
			updated
		});
	} catch (error) {
		if (error instanceof ZodError) {
			return json(
				{
					error: 'Invalid claim review payload',
					issues: error.issues
				},
				{ status: 400 }
			);
		}
		return json(
			{
				error: error instanceof Error ? error.message : 'Failed to review claim.'
			},
			{ status: 400 }
		);
	}
};
