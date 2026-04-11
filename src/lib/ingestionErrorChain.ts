/**
 * Flatten Error.cause chains (AI SDK often wraps provider text in "Failed after N attempts. Last error: …").
 * Used for TPM / rate-limit detection and recovery-agent eligibility.
 */
export function collectErrorMessageChain(error: unknown, maxDepth = 8): string {
	const parts: string[] = [];
	let current: unknown = error;
	let depth = 0;
	while (current != null && depth < maxDepth) {
		if (current instanceof Error) {
			const m = current.message?.trim();
			if (m) parts.push(m);
			current = current.cause;
		} else if (typeof current === 'string') {
			const m = current.trim();
			if (m) parts.push(m);
			break;
		} else {
			parts.push(String(current));
			break;
		}
		depth += 1;
	}
	return parts.join(' | ');
}

export function isTpmOrRateLimitModelErrorMessage(msg: string): boolean {
	return (
		/\btpm\b|tokens per min|token.?per.?min/i.test(msg) ||
		/rate limit|too many requests|429/i.test(msg)
	);
}

export function isTpmOrRateLimitInError(error: unknown): boolean {
	return isTpmOrRateLimitModelErrorMessage(collectErrorMessageChain(error));
}
