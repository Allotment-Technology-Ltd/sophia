export const DEFAULT_MAX_TOKENS_PER_SECTION = 5_000;
export const BOOK_MAX_TOKENS_PER_SECTION = Number(process.env.BOOK_MAX_TOKENS_PER_SECTION || '3000');

export function estimateTokens(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	return Math.ceil(words * 1.3);
}

export function getSectionTokenLimit(sourceType: string): number {
	return sourceType === 'book' ? BOOK_MAX_TOKENS_PER_SECTION : DEFAULT_MAX_TOKENS_PER_SECTION;
}

function splitChunkByParagraphs(chunk: string, maxTokensPerSection: number): string[] {
	if (estimateTokens(chunk) <= maxTokensPerSection) return [chunk];

	const paragraphs = chunk
		.split(/\n\s*\n/g)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);

	if (paragraphs.length <= 1) {
		const charChunkSize = maxTokensPerSection * 4;
		const direct: string[] = [];
		for (let i = 0; i < chunk.length; i += charChunkSize) {
			const sub = chunk.substring(i, i + charChunkSize).trim();
			if (sub.length > 100) direct.push(sub);
		}
		return direct;
	}

	const grouped: string[] = [];
	let buffer = '';

	for (const paragraph of paragraphs) {
		const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
		if (estimateTokens(candidate) > maxTokensPerSection && buffer.length > 0) {
			grouped.push(buffer.trim());
			buffer = paragraph;
		} else {
			buffer = candidate;
		}
	}

	if (buffer.length > 0) grouped.push(buffer.trim());
	return grouped;
}

export function splitIntoSections(text: string, maxTokensPerSection: number): string[] {
	const sections: string[] = [];
	const lines = text.split('\n');
	let currentSection: string[] = [];

	for (const line of lines) {
		const isHeading =
			/^\d+\.\s+[A-Z]/.test(line) ||
			/^[IVXLCDM]+\.\s+[A-Z]/.test(line) ||
			/^#{1,3}\s/.test(line) ||
			/^[A-Z][A-Z\s]{10,}$/.test(line.trim()) ||
			/^(?:Chapter|Section|Part|Book)\s+(?:\d+|[IVXLCDM]+)/i.test(line);

		if (isHeading && currentSection.length > 0) {
			const sectionText = currentSection.join('\n').trim();
			if (sectionText.length > 100) sections.push(sectionText);
			currentSection = [line];
		} else {
			currentSection.push(line);
		}
	}

	if (currentSection.length > 0) {
		const sectionText = currentSection.join('\n').trim();
		if (sectionText.length > 100) sections.push(sectionText);
	}

	if (sections.length <= 1) {
		const chunkSize = maxTokensPerSection * 4;
		const chunks: string[] = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			chunks.push(text.substring(i, i + chunkSize));
		}
		return chunks;
	}

	const merged: string[] = [];
	let buffer = '';
	for (const section of sections) {
		if (estimateTokens(buffer + '\n\n' + section) > maxTokensPerSection && buffer.length > 0) {
			merged.push(buffer.trim());
			buffer = section;
		} else {
			buffer = buffer ? `${buffer}\n\n${section}` : section;
		}
	}
	if (buffer.length > 0) merged.push(buffer.trim());

	const final: string[] = [];
	for (const chunk of merged) {
		if (estimateTokens(chunk) > maxTokensPerSection) {
			final.push(...splitChunkByParagraphs(chunk, maxTokensPerSection));
		} else {
			final.push(chunk);
		}
	}

	return final;
}
