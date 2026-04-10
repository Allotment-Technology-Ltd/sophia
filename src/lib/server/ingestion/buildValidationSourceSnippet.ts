/**
 * Builds the source excerpt passed to the validation LLM for a batch of claims.
 * Uses claim span union + context; when over the max length, truncates with a
 * center-weighted window on the span midpoint (avoids dropping only the tail).
 */

export type ClaimSpanLike = Readonly<{
	source_span_start?: number;
	source_span_end?: number;
}>;

export type BuildValidationSourceSnippetOptions = Readonly<{
	maxChars: number;
	contextChars: number;
}>;

function truncateHead(sourceText: string, maxChars: number): string {
	if (sourceText.length <= maxChars) return sourceText;
	return sourceText.slice(0, maxChars);
}

/**
 * @param claims - Batch claims with optional source_span_* (absolute indices in sourceText)
 * @param sourceText - Full fetched document
 */
export function buildValidationSourceSnippet(
	claims: ReadonlyArray<ClaimSpanLike>,
	sourceText: string,
	opts: BuildValidationSourceSnippetOptions
): string {
	const { maxChars, contextChars } = opts;
	if (!sourceText || sourceText.length === 0) return '';
	if (claims.length === 0) {
		return truncateHead(sourceText, maxChars);
	}

	const starts = claims
		.map((claim) => claim.source_span_start)
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
	const ends = claims
		.map((claim) => claim.source_span_end)
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
	if (starts.length === 0 || ends.length === 0) {
		return truncateHead(sourceText, maxChars);
	}

	const minStart = Math.min(...starts);
	const maxEnd = Math.max(...ends);
	// span.end is inclusive (see passage segmentation); String.slice end index is exclusive.
	const winStart = Math.max(0, minStart - contextChars);
	const winEnd = Math.min(sourceText.length, maxEnd + 1 + contextChars);
	const snippet = sourceText.slice(winStart, winEnd);
	if (snippet.length <= maxChars) return snippet;

	// Center on the span-union midpoint, but stay inside [winStart, winEnd) (not full document).
	const unionMid = (minStart + maxEnd) / 2;
	const midInSnippet = unionMid - winStart;
	const half = Math.floor(maxChars / 2);
	let offset = Math.floor(midInSnippet - half);
	offset = Math.max(0, Math.min(offset, snippet.length - maxChars));
	return snippet.slice(offset, offset + maxChars);
}
