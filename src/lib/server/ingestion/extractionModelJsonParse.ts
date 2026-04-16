/**
 * Parse model output for Stage 1 (extraction). Finetuned models often emit a stray leading `{...}`
 * before a valid `[{...}]` array; `JSON.parse` then fails with "non-whitespace after JSON".
 */

import { jsonrepair } from 'jsonrepair';
import { isExtractionClaimRow } from './stages/extraction-helpers.js';

/**
 * LLMs often emit literal newlines/tabs inside JSON string values. `JSON.parse` rejects those
 * ("Bad control character in string literal"). Escape U+0000–U+001F only **inside** double-quoted
 * string literals so the result is valid JSON (respects `\"` and `\\` while in a string).
 */
export function escapeUnescapedControlCharsInJsonStrings(input: string): string {
	let out = '';
	let inString = false;
	let escaped = false;
	for (let i = 0; i < input.length; i++) {
		const c = input[i]!;
		const code = c.charCodeAt(0);

		if (escaped) {
			out += c;
			escaped = false;
			continue;
		}

		if (inString) {
			if (c === '\\') {
				out += c;
				escaped = true;
				continue;
			}
			if (c === '"') {
				out += c;
				inString = false;
				continue;
			}
			if (code < 0x20) {
				if (code === 0x09) {
					out += '\\t';
					continue;
				}
				if (code === 0x0a) {
					out += '\\n';
					continue;
				}
				if (code === 0x0d) {
					out += '\\r';
					continue;
				}
				if (code === 0x08) {
					out += '\\b';
					continue;
				}
				if (code === 0x0c) {
					out += '\\f';
					continue;
				}
				out += `\\u${code.toString(16).padStart(4, '0')}`;
				continue;
			}
			out += c;
			continue;
		}

		if (c === '"') {
			inString = true;
		}
		out += c;
	}
	return out;
}

function stripLeadingBom(text: string): string {
	if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
		return text.slice(1);
	}
	return text;
}

/** Avoid wrapping arbitrary prose as a JSON string (jsonrepair does that for non-JSON text). */
function looksLikeJsonDocument(s: string): boolean {
	const t = s.trimStart();
	return t.startsWith('[') || t.startsWith('{');
}

function parseJsonLenient(cleaned: string): unknown {
	const bomStripped = stripLeadingBom(cleaned);
	const controlEscaped = escapeUnescapedControlCharsInJsonStrings(bomStripped);
	try {
		return JSON.parse(controlEscaped);
	} catch (e1) {
		if (!(e1 instanceof SyntaxError)) throw e1;
		if (!looksLikeJsonDocument(bomStripped)) throw e1;
		try {
			return JSON.parse(jsonrepair(bomStripped));
		} catch (e2) {
			try {
				return JSON.parse(jsonrepair(controlEscaped));
			} catch (e3) {
				const msg = [e1, e2, e3]
					.map((e) => (e instanceof Error ? e.message : String(e)))
					.filter(Boolean)
					.join(' | ');
				const err = new SyntaxError(`JSON.parse failed after control-char escape + jsonrepair: ${msg}`);
				if (e1 instanceof Error) (err as Error & { cause?: unknown }).cause = e1;
				throw err;
			}
		}
	}
}

export function stripMarkdownCodeFencesFromModelJson(text: string): string {
	let cleaned = stripLeadingBom(text.trim());
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
	return parseJsonLenient(stripMarkdownCodeFencesFromModelJson(text));
}

/**
 * Models sometimes emit a spurious `]` between two claim objects, e.g.
 * `{"text":"…quote…"]{"text":"…` (missing `}` and comma). Less common than `}][{` but breaks JSON.parse.
 * Conservative global replaces — only run after primary parse fails.
 */
export function tryNormalizeVendorBracketGlueBetweenObjects(cleaned: string): string {
	let s = cleaned;
	s = s.replace(/\}\s*\]\s*\{/g, '},{');
	s = s.replace(/"\]\s*\{/g, '"},{');
	return s;
}

/** First `[` … matching `]` at depth 0 (outside ASCII-quoted strings), ignoring `]` inside strings. */
function extractFirstTopLevelJsonArraySlice(text: string): string | undefined {
	const start = text.indexOf('[');
	if (start < 0) return undefined;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i]!;
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (c === '\\') {
				escaped = true;
				continue;
			}
			if (c === '"') {
				inString = false;
				continue;
			}
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === '[') {
			depth++;
			continue;
		}
		if (c === ']') {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return undefined;
}

function tryParseInnerJsonArraySlice(text: string): unknown | undefined {
	const cleaned = stripMarkdownCodeFencesFromModelJson(text);
	const slice = extractFirstTopLevelJsonArraySlice(cleaned);
	if (!slice) return undefined;
	try {
		return parseJsonLenient(slice);
	} catch {
		return undefined;
	}
}

/** `{"text"\s*:` — start of one extraction claim object (schema uses `text`). */
const EXTRACTION_CLAIM_OBJECT_START = /\{"text"\s*:/g;

/**
 * Vendor models sometimes glue incomplete objects: `{"text":"…cite Wilson 1][{"text":"…` (missing
 * `"}` before the next claim). Split on each `{"text":`, close the previous fragment, then
 * `jsonrepair` + `JSON.parse` per claim.
 */
function trySalvageConcatenatedExtractionObjects(cleaned: string): unknown[] | undefined {
	EXTRACTION_CLAIM_OBJECT_START.lastIndex = 0;
	const starts: number[] = [];
	let m: RegExpExecArray | null;
	while ((m = EXTRACTION_CLAIM_OBJECT_START.exec(cleaned)) !== null) {
		starts.push(m.index);
	}
	if (starts.length === 0) return undefined;

	const objects: unknown[] = [];
	for (let k = 0; k < starts.length; k++) {
		const start = starts[k]!;
		const end = k + 1 < starts.length ? starts[k + 1]! : cleaned.length;
		let chunk = cleaned.slice(start, end).trim();
		const isLast = k === starts.length - 1;
		// Glued next object: ...1][{"text" → close string + object before next `{"text"` (split already removed the next part).
		if (!isLast) {
			chunk = chunk.replace(/\]\[\s*$/, '"}').replace(/\]\s*$/, '"}');
		} else {
			// Trailing `}]` with `]` inside string value instead of closing `"`.
			chunk = chunk.replace(/\]\s*\}\s*$/, '"}').replace(/\]\s*$/, '"}');
		}
		try {
			const parsed = JSON.parse(jsonrepair(chunk));
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				objects.push(parsed);
			}
		} catch {
			// skip bad chunk
		}
	}
	return objects.length > 0 ? objects : undefined;
}

function trySalvageExtractionFromText(text: string): unknown | undefined {
	const cleaned = stripMarkdownCodeFencesFromModelJson(text);
	const glued = tryNormalizeVendorBracketGlueBetweenObjects(cleaned);
	const salvaged = trySalvageConcatenatedExtractionObjects(glued !== cleaned ? glued : cleaned);
	if (salvaged === undefined) return undefined;
	console.log(
		`  [INFO] Extraction JSON: salvaged ${salvaged.length} claim object(s) from concatenated / truncated vendor output`
	);
	return salvaged;
}

/**
 * Like {@link parseJsonFromModelResponse}, but if the full string is not one JSON value, try the
 * substring from the first `[` through the last `]` (recovers `[...]` after leading junk).
 */
export function parseExtractionJsonFromModelResponse(text: string): unknown {
	try {
		return parseJsonFromModelResponse(text);
	} catch (firstError) {
		const cleaned0 = stripMarkdownCodeFencesFromModelJson(text);
		const glued0 = tryNormalizeVendorBracketGlueBetweenObjects(cleaned0);
		if (glued0 !== cleaned0) {
			try {
				const trimmed = glued0.trim();
				const toParse = trimmed.startsWith('[') ? trimmed : `[${trimmed}]`;
				const recovered = parseJsonLenient(toParse);
				if (Array.isArray(recovered) && recovered.some(isExtractionClaimRow)) {
					console.log(
						'  [INFO] Extraction JSON: recovered after normalizing spurious `]` between claim objects'
					);
					return recovered;
				}
				if (recovered && typeof recovered === 'object' && !Array.isArray(recovered) && isExtractionClaimRow(recovered)) {
					console.log(
						'  [INFO] Extraction JSON: recovered single claim after normalizing spurious `]` between objects'
					);
					return [recovered];
				}
			} catch {
				// fall through
			}
		}
		const recovered = tryParseInnerJsonArraySlice(text);
		if (
			recovered !== undefined &&
			Array.isArray(recovered) &&
			recovered.some(isExtractionClaimRow)
		) {
			console.log(
				'  [INFO] Extraction JSON: parsed `[…]` slice after stray prefix/suffix (inner-array recovery)'
			);
			return recovered;
		}
		const salvaged = trySalvageExtractionFromText(text);
		if (salvaged !== undefined) {
			return salvaged;
		}
		throw firstError;
	}
}
