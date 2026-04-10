import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { applyRemediationToStoredClaim } from '$lib/server/ingestion/storedClaimRemediation';

const BodySchema = z.object({
	claim_ids: z.array(z.string().min(1)).min(1).max(20)
});

export const POST: RequestHandler = async ({ locals, request }) => {
	assertAdminAccess(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const parsed = BodySchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
	}

	const results: { id: string; ok: boolean; error?: string }[] = [];
	for (const id of parsed.data.claim_ids) {
		try {
			await applyRemediationToStoredClaim(id);
			results.push({ id, ok: true });
		} catch (e) {
			results.push({
				id,
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			});
		}
	}

	return json({ results });
};
