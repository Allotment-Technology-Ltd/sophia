import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	restormelAddProjectModelBindings,
	restormelListProjectModels,
	restormelReplaceProjectModelAllowlist,
	type RestormelProjectModelBindingInput
} from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseBatchModels(
	body: unknown
): Array<Pick<RestormelProjectModelBindingInput, 'providerType' | 'modelId'>> | null {
	if (!isRecord(body)) return null;
	const models = body.models;
	if (!Array.isArray(models)) return null;
	const out: Array<Pick<RestormelProjectModelBindingInput, 'providerType' | 'modelId'>> = [];
	for (const m of models) {
		if (!isRecord(m)) return null;
		const providerType = typeof m.providerType === 'string' ? m.providerType.trim() : '';
		const modelId = typeof m.modelId === 'string' ? m.modelId.trim() : '';
		if (!providerType || !modelId) return null;
		out.push({ providerType, modelId });
	}
	return out;
}

function parseAllowlist(body: unknown): RestormelProjectModelBindingInput[] | null {
	if (!isRecord(body)) return null;
	const models = body.models;
	if (!Array.isArray(models)) return null;
	const out: RestormelProjectModelBindingInput[] = [];
	for (const m of models) {
		if (!isRecord(m)) return null;
		const providerType = typeof m.providerType === 'string' ? m.providerType.trim() : '';
		const modelId = typeof m.modelId === 'string' ? m.modelId.trim() : '';
		if (!providerType || !modelId) return null;
		if (typeof m.enabled === 'boolean') {
			out.push({ providerType, modelId, enabled: m.enabled });
		} else {
			out.push({ providerType, modelId });
		}
	}
	return out;
}

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);
	try {
		const payload = await restormelListProjectModels();
		return json({ payload });
	} catch (error) {
		return restormelJsonError(error);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	assertAdminAccess(locals);
	let body: unknown;
	try {
		body = await parseJsonBody(request);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
	}
	const models = parseBatchModels(body);
	if (!models) {
		return json(
			{ error: 'Expected JSON body { models: [{ providerType, modelId }, ...] } with non-empty strings.' },
			{ status: 400 }
		);
	}
	try {
		const payload = await restormelAddProjectModelBindings(models);
		return json({ payload });
	} catch (error) {
		return restormelJsonError(error);
	}
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	assertAdminAccess(locals);
	let body: unknown;
	try {
		body = await parseJsonBody(request);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
	}
	const models = parseAllowlist(body);
	if (!models) {
		return json(
			{
				error:
					'Expected JSON body { models: [{ providerType, modelId, enabled? }, ...] } with non-empty providerType and modelId.'
			},
			{ status: 400 }
		);
	}
	try {
		const payload = await restormelReplaceProjectModelAllowlist(models);
		return json({ payload });
	} catch (error) {
		return restormelJsonError(error);
	}
};
