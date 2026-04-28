import {
	DEFAULT_GUTENBERG_PHILOSOPHY_DOMAIN,
	GUTENBERG_PHILOSOPHY_DOMAINS,
	isGutenbergPhilosophyDomainId
} from '$lib/admin/gutenbergPhilosophyDomains';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { pickGutenbergPhilosophyUrlsForBatch } from '$lib/server/gutenbergPhilosophyBatchPick';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		assertAdminAccess(locals);
		const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('limit') ?? '10', 10) || 10));
		const excludeIngested = url.searchParams.get('excludeIngested') !== '0';
		const domainRaw = (url.searchParams.get('domain') ?? DEFAULT_GUTENBERG_PHILOSOPHY_DOMAIN).trim();
		if (!isGutenbergPhilosophyDomainId(domainRaw)) {
			const valid = GUTENBERG_PHILOSOPHY_DOMAINS.map((d) => d.id).join(', ');
			return json({ error: `Invalid domain "${domainRaw}". Use one of: ${valid}` }, { status: 400 });
		}
		const result = await pickGutenbergPhilosophyUrlsForBatch({ limit, excludeIngested, domain: domainRaw });
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to suggest Gutenberg URLs';
		return json({ error: message }, { status: 400 });
	}
};

