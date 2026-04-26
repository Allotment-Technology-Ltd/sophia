import { timingSafeEqual } from 'node:crypto';

/**
 * Verifies `Authorization: Bearer` for `POST /api/internal/ingest/jobs/tick` when
 * `INGESTION_JOB_TICK_SECRET` is set. Uses constant-time comparison of UTF-8 bytes.
 */
export function verifyIngestionJobTickSecret(authorizationHeader: string | null): boolean {
	const secret = process.env.INGESTION_JOB_TICK_SECRET?.trim();
	if (!secret) return false;
	const h = (authorizationHeader ?? '').trim();
	const prefix = 'Bearer ';
	if (!h.startsWith(prefix)) return false;
	const token = h.slice(prefix.length).trim();
	if (!token) return false;
	const a = Buffer.from(token, 'utf8');
	const b = Buffer.from(secret, 'utf8');
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export function isIngestionJobTickHttpEnabled(): boolean {
	return Boolean(process.env.INGESTION_JOB_TICK_SECRET?.trim());
}
