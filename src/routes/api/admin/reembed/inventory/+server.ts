import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getEmbeddingDimensions } from '$lib/server/embeddings';
import {
	getReembedCorpusInventory,
	getReembedCorpusInventoryWithDiagnostics
} from '$lib/server/ingestion/reembedCorpusInventory';
import { resolveRequestId } from '$lib/server/problem';

export const GET: RequestHandler = async ({ locals, request }) => {
	const startedAt = Date.now();
	const requestId = resolveRequestId(request);
	try {
		assertAdminAccess(locals);
		const targetDim = getEmbeddingDimensions();
		const timeoutMs = Math.max(
			1000,
			Math.min(30_000, Math.trunc(Number(process.env.ADMIN_REEMBED_INVENTORY_TIMEOUT_MS ?? '6500')) || 6500)
		);
		const perSourceLimit = Math.max(
			0,
			Math.min(500, Math.trunc(Number(process.env.ADMIN_REEMBED_INVENTORY_PER_SOURCE_LIMIT ?? '60')) || 60)
		);
		const cacheTtlMs = Math.max(
			0,
			Math.min(300_000, Math.trunc(Number(process.env.ADMIN_REEMBED_INVENTORY_CACHE_TTL_MS ?? '30000')) || 30_000)
		);
		const includeQueryTimings = process.env.ADMIN_REEMBED_INVENTORY_DIAGNOSTICS === '1';

		const inventory = await Promise.race([
			(includeQueryTimings
				? getReembedCorpusInventoryWithDiagnostics(targetDim, { perSourceLimit, cacheTtlMs })
				: getReembedCorpusInventory(targetDim, { perSourceLimit, cacheTtlMs })),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`Inventory timed out after ${timeoutMs}ms`)), timeoutMs)
			)
		]);
		const payload =
			includeQueryTimings && typeof inventory === 'object' && inventory && 'inventory' in inventory
				? (inventory as { inventory: unknown; queryMs?: unknown })
				: null;

		return json({
			ok: true,
			runtimeExpectedDim: targetDim,
			inventory: payload ? payload.inventory : inventory,
			diagnostics: {
				requestId,
				wallMs: Date.now() - startedAt,
				timeoutMs,
				cacheTtlMs,
				perSourceLimit,
				queryMs: payload?.queryMs
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Inventory failed';
		console.warn('[admin] reembed inventory failed', {
			requestId,
			wallMs: Date.now() - startedAt,
			error: message
		});
		// Typically Surreal query failures/timeouts: present as degraded, not a hard 500.
		return json({ ok: false, error: message, requestId }, { status: 503 });
	}
};
