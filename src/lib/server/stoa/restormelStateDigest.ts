import type { MemoryPolicy } from '@restormel/state';

/** Default caps for `projectWorkingMemory` in Stoa-adjacent flows. */
export const STOA_DEFAULT_MEMORY_POLICY: MemoryPolicy = {
	maxCellsPerScope: 32,
	maxApproxTokensPerScope: 8000
};

/**
 * Redact user text before storing in Restormel State digests (no secrets in memory cells).
 */
export function redactStoaUserTurnDigest(raw: string): string {
	let s = raw.trim().slice(0, 500);
	s = s.replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[redacted]');
	s = s.replace(/\bsk-[a-zA-Z0-9]{10,}\b/g, '[redacted-token]');
	s = s.replace(/\bBearer\s+[a-zA-Z0-9._-]+\b/gi, 'Bearer [redacted]');
	return s.length > 0 ? s : '[empty]';
}
