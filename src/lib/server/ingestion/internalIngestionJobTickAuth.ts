import { timingSafeEqual } from 'node:crypto';

/**
 * Strips Windows CR, trims whitespace, and normalizes a trailing newline (common when copy-pasting
 * secrets into Railway or GitHub) so a deliberately multi-line secret is unchanged except for
 * that single common mistake.
 */
export function normalizeIngestionJobTickSecret(value: string | null | undefined): string {
	if (value == null) return '';
	return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '').trim();
}

/**
 * Verifies `Authorization: Bearer` for `POST /api/internal/ingest/jobs/tick` when
 * `INGESTION_JOB_TICK_SECRET` is set. Uses constant-time comparison of UTF-8 bytes.
 */
export function verifyIngestionJobTickSecret(authorizationHeader: string | null): boolean {
	const secret = normalizeIngestionJobTickSecret(process.env.INGESTION_JOB_TICK_SECRET);
	if (!secret) return false;
	const h = (authorizationHeader ?? '').trim();
	const prefix = 'Bearer ';
	if (!h.startsWith(prefix)) return false;
	const token = normalizeIngestionJobTickSecret(h.slice(prefix.length));
	if (!token) return false;
	const a = Buffer.from(token, 'utf8');
	const b = Buffer.from(secret, 'utf8');
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export function isIngestionJobTickHttpEnabled(): boolean {
	return Boolean(normalizeIngestionJobTickSecret(process.env.INGESTION_JOB_TICK_SECRET));
}
