import { json, type RequestHandler } from '@sveltejs/kit';
import { projectWorkingMemory, workingMemoryToDebugJson } from '@restormel/state';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { listStoaStateEvents } from '$lib/server/stoa/sessionStore';
import { STOA_DEFAULT_MEMORY_POLICY } from '$lib/server/stoa/restormelStateDigest';

/** Operator-only: working memory projection + debug JSON for a Stoa session (Restormel State). */
export const GET: RequestHandler = async ({ locals, url }) => {
	assertAdminAccess(locals);
	const sessionId = url.searchParams.get('sessionId')?.trim();
	const userId = url.searchParams.get('userId')?.trim();
	if (!sessionId || !userId) {
		return json({ error: 'sessionId and userId query params are required' }, { status: 400 });
	}
	const events = await listStoaStateEvents({ sessionId, userId });
	const view = projectWorkingMemory(events, STOA_DEFAULT_MEMORY_POLICY);
	return json(workingMemoryToDebugJson(view));
};
