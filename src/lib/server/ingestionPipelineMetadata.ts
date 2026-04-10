/**
 * Durable run metadata for extraction-ready hygiene (SEP ingestion plan).
 */

import { getEmbeddingProvider } from './embeddings';

export function resolvePipelineVersion(): string {
	const v =
		process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
		process.env.GITHUB_SHA?.trim() ||
		process.env.COMMIT_SHA?.trim() ||
		process.env.npm_package_version?.trim();
	return v && v.length > 0 ? v : 'unknown';
}

export function resolveEmbeddingFingerprint(): string {
	try {
		const p = getEmbeddingProvider();
		return `${p.name}:${p.documentModel}:${p.dimensions}d`;
	} catch {
		return 'unknown';
	}
}
