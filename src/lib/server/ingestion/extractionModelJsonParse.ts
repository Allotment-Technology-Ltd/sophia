/**
 * Parse model output for Stage 1 (extraction). Finetuned models often emit a stray leading `{...}`
 * before a valid `[{...}]` array; `JSON.parse` then fails with "non-whitespace after JSON".
 */

export function stripMarkdownCodeFencesFromModelJson(text: string): string {
	let cleaned = text.trim();
	if (cleaned.startsWith('```json')) {
		cleaned = cleaned.slice(7);
	} else if (cleaned.startsWith('```')) {
		cleaned = cleaned.slice(3);
	}
	if (cleaned.endsWith('```')) {
		cleaned = cleaned.slice(0, -3);
	}
	return cleaned.trim();
}

export function parseJsonFromModelResponse(text: string): unknown {
	return JSON.parse(stripMarkdownCodeFencesFromModelJson(text));
}

function tryParseInnerJsonArraySlice(text: string): unknown | undefined {
	const cleaned = stripMarkdownCodeFencesFromModelJson(text);
	const open = cleaned.indexOf('[');
	const close = cleaned.lastIndexOf(']');
	if (open < 0 || close <= open) return undefined;
	const slice = cleaned.slice(open, close + 1);
	try {
		return JSON.parse(slice);
	} catch {
		return undefined;
	}
}

/**
 * Like {@link parseJsonFromModelResponse}, but if the full string is not one JSON value, try the
 * substring from the first `[` through the last `]` (recovers `[...]` after leading junk).
 */
export function parseExtractionJsonFromModelResponse(text: string): unknown {
	try {
		return parseJsonFromModelResponse(text);
	} catch (firstError) {
		const recovered = tryParseInnerJsonArraySlice(text);
		if (recovered !== undefined) {
			console.log(
				'  [INFO] Extraction JSON: parsed `[…]` slice after stray prefix/suffix (inner-array recovery)'
			);
			return recovered;
		}
		throw firstError;
	}
}
