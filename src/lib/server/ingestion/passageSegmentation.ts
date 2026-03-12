import {
	PassageRecordSchema,
	type PassageRecord,
	type PassageRole
} from './contracts.js';

interface TextBlock {
	text: string;
	start: number;
	end: number;
	isHeading: boolean;
}

interface PassageSegmentationOptions {
	maxTokensPerPassage?: number;
}

const DEFAULT_MAX_TOKENS_PER_PASSAGE = 900;

function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

function looksLikeHeading(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	return (
		/^#{1,3}\s/.test(trimmed) ||
		/^\d+[.)]\s+[A-Z]/.test(trimmed) ||
		/^(?:chapter|section|part|book)\s+[ivxlcdm\d]+/i.test(trimmed) ||
		/^[A-Z][A-Z\s,:;'-]{8,}$/.test(trimmed)
	);
}

function splitIntoBlocks(text: string): TextBlock[] {
	const blocks: TextBlock[] = [];
	const regex = /\n\s*\n/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		const raw = text.slice(lastIndex, match.index);
		const trimmed = raw.trim();
		if (trimmed) {
			const startOffset = lastIndex + raw.indexOf(trimmed);
			const endOffset = startOffset + trimmed.length - 1;
			blocks.push({
				text: trimmed,
				start: startOffset,
				end: endOffset,
				isHeading: looksLikeHeading(trimmed)
			});
		}
		lastIndex = match.index + match[0].length;
	}

	const raw = text.slice(lastIndex);
	const trimmed = raw.trim();
	if (trimmed) {
		const startOffset = lastIndex + raw.indexOf(trimmed);
		const endOffset = startOffset + trimmed.length - 1;
		blocks.push({
			text: trimmed,
			start: startOffset,
			end: endOffset,
			isHeading: looksLikeHeading(trimmed)
		});
	}

	return blocks;
}

function splitOversizeBlock(block: TextBlock, maxTokensPerPassage: number): TextBlock[] {
	if (estimateTokens(block.text) <= maxTokensPerPassage) return [block];

	const maxChars = maxTokensPerPassage * 4;
	const chunks: TextBlock[] = [];
	let cursor = 0;

	while (cursor < block.text.length) {
		let end = Math.min(block.text.length, cursor + maxChars);
		if (end < block.text.length) {
			const boundary = block.text.lastIndexOf(' ', end);
			if (boundary > cursor + Math.floor(maxChars * 0.6)) {
				end = boundary;
			}
		}
		const chunkText = block.text.slice(cursor, end).trim();
		if (chunkText) {
			const relativeStart = block.text.indexOf(chunkText, cursor);
			const start = block.start + relativeStart;
			const finish = start + chunkText.length - 1;
			chunks.push({
				text: chunkText,
				start,
				end: finish,
				isHeading: false
			});
		}
		cursor = end;
	}

	return chunks;
}

function summarisePassage(text: string): string {
	const collapsed = text.replace(/\s+/g, ' ').trim();
	if (!collapsed) return '';
	const firstSentence = collapsed.split(/(?<=[.!?])\s+/)[0]?.trim() ?? collapsed;
	return firstSentence.length <= 180 ? firstSentence : `${firstSentence.slice(0, 177).trim()}...`;
}

function classifyPassageRole(text: string, sectionTitle?: string | null): {
	role: PassageRole;
	confidence: number;
} {
	const haystack = `${sectionTitle ?? ''} ${text}`.toLowerCase();

	const rules: Array<{ role: PassageRole; confidence: number; patterns: RegExp[] }> = [
		{
			role: 'reply',
			confidence: 0.88,
			patterns: [
				/\bin reply\b/,
				/\bi reply\b/,
				/\bmy reply\b/,
				/\bthe reply\b/,
				/\bresponse to this objection\b/,
				/\bdefen[cs]e of\b/
			]
		},
		{
			role: 'objection',
			confidence: 0.87,
			patterns: [
				/\bone might object\b/,
				/\bit might be objected\b/,
				/\ban objection\b/,
				/\bthe objection\b/,
				/\bcounterargument\b/,
				/\bhowever,? it may be said\b/
			]
		},
		{
			role: 'definition',
			confidence: 0.84,
			patterns: [
				/\bby [a-z\s-]+ i mean\b/,
				/\bis defined as\b/,
				/\bmeans that\b/,
				/\bdefinition of\b/
			]
		},
		{
			role: 'distinction',
			confidence: 0.82,
			patterns: [
				/\bdistinguish(?:es|ed|ing)?\b/,
				/\bdistinction\b/,
				/\bin one sense\b/,
				/\bin another sense\b/
			]
		},
		{
			role: 'example',
			confidence: 0.79,
			patterns: [/\bfor example\b/, /\bfor instance\b/, /\bconsider the case\b/, /\bimagine\b/]
		},
		{
			role: 'thesis',
			confidence: 0.78,
			patterns: [
				/\bi argue\b/,
				/\bi contend\b/,
				/\bmy thesis\b/,
				/\bi shall argue\b/,
				/\bi will argue\b/
			]
		},
		{
			role: 'premise',
			confidence: 0.66,
			patterns: [/\bbecause\b/, /\bsince\b/, /\btherefore\b/, /\bthus\b/, /\bhence\b/]
		}
	];

	for (const rule of rules) {
		if (rule.patterns.some((pattern) => pattern.test(haystack))) {
			return { role: rule.role, confidence: rule.confidence };
		}
	}

	return { role: 'interpretive_commentary', confidence: 0.55 };
}

export function segmentArgumentativePassages(
	text: string,
	options: PassageSegmentationOptions = {}
): PassageRecord[] {
	const maxTokensPerPassage = options.maxTokensPerPassage ?? DEFAULT_MAX_TOKENS_PER_PASSAGE;
	const blocks = splitIntoBlocks(text).flatMap((block) => splitOversizeBlock(block, maxTokensPerPassage));

	const passages: PassageRecord[] = [];
	let sectionTitle: string | null = null;

	for (const block of blocks) {
		if (block.isHeading) {
			sectionTitle = block.text;
			continue;
		}
		const { role, confidence } = classifyPassageRole(block.text, sectionTitle);
		passages.push(
			PassageRecordSchema.parse({
				id: `p${String(passages.length + 1).padStart(4, '0')}`,
				order_in_source: passages.length + 1,
				section_title: sectionTitle,
				text: block.text,
				summary: summarisePassage(block.text),
				role,
				role_confidence: confidence,
				span: {
					start: block.start,
					end: block.end
				}
			})
		);
	}

	if (passages.length === 0 && text.trim()) {
		const { role, confidence } = classifyPassageRole(text, null);
		passages.push(
			PassageRecordSchema.parse({
				id: 'p0001',
				order_in_source: 1,
				section_title: null,
				text: text.trim(),
				summary: summarisePassage(text),
				role,
				role_confidence: confidence,
				span: {
					start: 0,
					end: Math.max(0, text.trim().length - 1)
				}
			})
		);
	}

	return passages;
}

export function buildPassageBatches(
	passages: PassageRecord[],
	maxTokensPerBatch: number
): PassageRecord[][] {
	const batches: PassageRecord[][] = [];
	let current: PassageRecord[] = [];
	let currentTokens = 0;

	for (const passage of passages) {
		const passageTokens = estimateTokens(passage.text);
		if (current.length > 0 && currentTokens + passageTokens > maxTokensPerBatch) {
			batches.push(current);
			current = [];
			currentTokens = 0;
		}
		current.push(passage);
		currentTokens += passageTokens;
	}

	if (current.length > 0) {
		batches.push(current);
	}

	return batches;
}

export function renderPassageBatch(passages: PassageRecord[]): string {
	return passages
		.map(
			(passage) =>
				`<passage id="${passage.id}" order="${passage.order_in_source}" role="${passage.role}" section_title="${passage.section_title ?? ''}" span_start="${passage.span.start}" span_end="${passage.span.end}">\n${passage.text}\n</passage>`
		)
		.join('\n\n');
}
