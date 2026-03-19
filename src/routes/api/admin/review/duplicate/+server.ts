import { json, type RequestHandler } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { resolveClaimPairReview } from '$lib/server/review/workflow';
import { ResolveDuplicateSchema } from '$lib/server/review/adminReviewApi';

export const POST: RequestHandler = async ({ locals, request }) => {
	const actor = assertAdminAccess(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	try {
		const payload = ResolveDuplicateSchema.parse(body);
		const result = await resolveClaimPairReview({
			leftClaimId: payload.left_claim_id,
			rightClaimId: payload.right_claim_id,
			canonicalClaimId: payload.canonical_claim_id,
			classification: payload.classification,
			actor,
			notes: payload.notes
		});

		return json({
			success: `Recorded ${result.classification} for ${result.pairKey}.`,
			result
		});
	} catch (error) {
		if (error instanceof ZodError) {
			return json(
				{
					error: 'Invalid duplicate review payload',
					issues: error.issues
				},
				{ status: 400 }
			);
		}
		return json(
			{
				error: error instanceof Error ? error.message : 'Failed to resolve duplicate pair.'
			},
			{ status: 400 }
		);
	}
};
