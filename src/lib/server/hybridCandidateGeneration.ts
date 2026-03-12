export interface HybridCandidate {
  id: string;
  text: string;
  confidence: number;
  source_title: string;
  section_context?: string | null;
}

export interface HybridFusionResult<T extends HybridCandidate> {
  ranked: T[];
  denseCount: number;
  lexicalCount: number;
  fusedCount: number;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'which',
  'why',
  'with'
]);

const CORPUS_LEVEL_SIGNALS = [
  'across philosophy',
  'across traditions',
  'across thinkers',
  'historical development',
  'main positions',
  'overview',
  'survey',
  'big picture',
  'in general'
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniq<T>(input: T[]): T[] {
  return [...new Set(input)];
}

export function detectCorpusLevelQuery(query: string): boolean {
  const q = normalize(query);
  return CORPUS_LEVEL_SIGNALS.some((signal) => q.includes(signal));
}

export function extractLexicalTerms(query: string): string[] {
  const normalized = normalize(query);
  if (!normalized) return [];

  const terms: string[] = [];
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map((m) => normalize(m[1])).filter(Boolean);
  terms.push(...quoted);

  const hyphenated = normalized.match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) ?? [];
  terms.push(...hyphenated);

  const tokens = normalized.split(' ').filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    if (
      !STOPWORDS.has(tokens[i]) &&
      !STOPWORDS.has(tokens[i + 1]) &&
      bigram.length >= 10
    ) {
      terms.push(bigram);
    }
  }

  for (const token of tokens) {
    if (token.length >= 8 && !STOPWORDS.has(token)) {
      terms.push(token);
    }
  }

  const knownPhrases = ['public reason', 'epistemic injustice', 'non-identity problem'];
  for (const phrase of knownPhrases) {
    if (normalized.includes(phrase)) terms.push(phrase);
  }

  return uniq(terms).slice(0, 8);
}

function rrf(rank: number, k = 60): number {
  return 1 / (k + rank);
}

function termCoverage(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const normalized = normalize(text);
  let hits = 0;
  for (const term of terms) {
    if (normalized.includes(term)) hits += 1;
  }
  return hits / terms.length;
}

function diversifyBySource<T extends HybridCandidate>(ranked: T[], size: number): T[] {
  const selected: T[] = [];
  const seenSources = new Set<string>();

  for (const row of ranked) {
    if (selected.length >= size) break;
    if (!seenSources.has(row.source_title)) {
      selected.push(row);
      seenSources.add(row.source_title);
    }
  }

  for (const row of ranked) {
    if (selected.length >= size) break;
    if (!selected.includes(row)) selected.push(row);
  }

  return selected;
}

export function fuseHybridCandidates<T extends HybridCandidate>(params: {
  dense: T[];
  lexical: T[];
  lexicalTerms: string[];
  poolSize: number;
  corpusLevelQuery: boolean;
}): HybridFusionResult<T> {
  const { dense, lexical, lexicalTerms, poolSize, corpusLevelQuery } = params;
  const denseRanks = new Map<string, number>();
  const lexicalRanks = new Map<string, number>();
  const byId = new Map<string, T>();

  dense.forEach((row, idx) => {
    denseRanks.set(row.id, idx + 1);
    byId.set(row.id, row);
  });
  lexical.forEach((row, idx) => {
    lexicalRanks.set(row.id, idx + 1);
    if (!byId.has(row.id)) byId.set(row.id, row);
  });

  const scored = Array.from(byId.values()).map((row) => {
    const denseRank = denseRanks.get(row.id);
    const lexicalRank = lexicalRanks.get(row.id);
    const fusionScore = (denseRank ? rrf(denseRank) : 0) + (lexicalRank ? rrf(lexicalRank) : 0);
    const coverage = termCoverage(`${row.text} ${row.section_context ?? ''}`, lexicalTerms);
    const rerankScore = fusionScore + coverage * 0.025 + Math.max(0, row.confidence) * 0.01;
    return { row, rerankScore };
  });

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  const ordered = scored.map((s) => s.row);
  const ranked = corpusLevelQuery
    ? diversifyBySource(ordered, poolSize)
    : ordered.slice(0, poolSize);

  return {
    ranked,
    denseCount: dense.length,
    lexicalCount: lexical.length,
    fusedCount: ranked.length
  };
}
