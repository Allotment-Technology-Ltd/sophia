export type PassId = 'analysis' | 'critique' | 'synthesis' | 'verification';

export interface PassComparisonInput {
  gemini: string;
  claude: string;
}

export interface PassComparison {
  overlapRatio: number;
  tokenCountGemini: number;
  tokenCountClaude: number;
  sentenceCountGemini: number;
  sentenceCountClaude: number;
  uniqueToGemini: string[];
  uniqueToClaude: string[];
}

export interface ModelDiffResult {
  byPass: Partial<Record<PassId, PassComparison>>;
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`>#~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(input: string): string[] {
  return input
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 24);
}

function countTokens(input: string): number {
  return normalizeText(input)
    .split(' ')
    .filter((token) => token.length > 0).length;
}

function dedupeByNormalized(sentences: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const sentence of sentences) {
    const key = normalizeText(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(sentence);
  }
  return deduped;
}

function topUniqueSentences(source: string[], targetKeys: Set<string>, limit = 4): string[] {
  return source
    .filter((sentence) => !targetKeys.has(normalizeText(sentence)))
    .sort((a, b) => b.length - a.length)
    .slice(0, limit);
}

export function comparePasses(input: PassComparisonInput): PassComparison {
  const geminiSentences = dedupeByNormalized(splitSentences(input.gemini));
  const claudeSentences = dedupeByNormalized(splitSentences(input.claude));
  const geminiKeys = new Set(geminiSentences.map((sentence) => normalizeText(sentence)));
  const claudeKeys = new Set(claudeSentences.map((sentence) => normalizeText(sentence)));
  const shared = [...geminiKeys].filter((key) => claudeKeys.has(key)).length;
  const union = new Set([...geminiKeys, ...claudeKeys]).size;

  return {
    overlapRatio: union > 0 ? shared / union : 0,
    tokenCountGemini: countTokens(input.gemini),
    tokenCountClaude: countTokens(input.claude),
    sentenceCountGemini: geminiSentences.length,
    sentenceCountClaude: claudeSentences.length,
    uniqueToGemini: topUniqueSentences(geminiSentences, claudeKeys),
    uniqueToClaude: topUniqueSentences(claudeSentences, geminiKeys)
  };
}

export function buildModelDiffResult(
  passes: Partial<Record<PassId, PassComparisonInput>>
): ModelDiffResult {
  const byPass: Partial<Record<PassId, PassComparison>> = {};
  for (const pass of ['analysis', 'critique', 'synthesis', 'verification'] as const) {
    const pair = passes[pass];
    if (!pair) continue;
    if (!pair.gemini.trim() && !pair.claude.trim()) continue;
    byPass[pass] = comparePasses(pair);
  }
  return { byPass };
}
