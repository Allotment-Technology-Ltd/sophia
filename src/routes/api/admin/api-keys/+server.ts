import { json, type RequestHandler } from '@sveltejs/kit';
import { ZodError, z } from 'zod';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { createAdminApiKey } from '$lib/server/adminDashboard';

const CreateAdminApiKeySchema = z.object({
	name: z.string().max(200).optional(),
	owner_uid: z.string().max(200).optional(),
	daily_quota: z.number().int().min(1).max(100000).optional()
});

export const POST: RequestHandler = async ({ locals, request }) => {
	const actor = assertAdminAccess(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	try {
		const payload = CreateAdminApiKeySchema.parse(body);
		const result = await createAdminApiKey(actor, payload);
		return json(result, { status: 201 });
	} catch (error) {
		if (error instanceof ZodError) {
			return json(
				{
					error: 'Invalid API key payload',
					issues: error.issues
				},
				{ status: 400 }
			);
		}
		throw error;
	}
};
