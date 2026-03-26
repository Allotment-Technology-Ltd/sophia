import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	restormelDeleteProjectModelBinding,
	restormelPatchProjectModelBinding
} from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	assertAdminAccess(locals);
	const bindingId = params.bindingId?.trim() ?? '';
	if (!bindingId) {
		return json({ error: 'bindingId is required' }, { status: 400 });
	}
	let body: unknown;
	try {
		body = await parseJsonBody(request);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
	}
	if (!isRecord(body) || typeof body.enabled !== 'boolean') {
		return json({ error: 'Expected JSON body { enabled: boolean }' }, { status: 400 });
	}
	try {
		const payload = await restormelPatchProjectModelBinding(bindingId, { enabled: body.enabled });
		return json({ payload });
	} catch (error) {
		return restormelJsonError(error);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	assertAdminAccess(locals);
	const bindingId = params.bindingId?.trim() ?? '';
	if (!bindingId) {
		return json({ error: 'bindingId is required' }, { status: 400 });
	}
	try {
		const payload = await restormelDeleteProjectModelBinding(bindingId);
		return json({ payload: payload ?? { ok: true } });
	} catch (error) {
		return restormelJsonError(error);
	}
};
