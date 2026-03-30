import { retrieveContext } from '$lib/server/retrieval';
import { query } from '$lib/server/db';
import type {
  CitationQuality,
  ClaimReference,
  ConversationTurn,
  GroundingConfidenceLevel,
  GroundingResult
} from './types';

function buildConversationSummary(history: ConversationTurn[]): string {
  if (history.length === 0) return '';
  const recent = history.slice(-4);
  return recent
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join('\n');
}

export async function retrieveStoaGrounding(params: {
  message: string;
  history?: ConversationTurn[];
  topK?: number;
}): Promise<ClaimReference[]> {
  const history = params.history ?? [];
  const topK = Math.max(1, Math.min(params.topK ?? 5, 10));
  const queryText = [buildConversationSummary(history), params.message].filter(Boolean).join('\n\n');

  const retrieval = await retrieveContext(queryText, { topK });
  return retrieval.claims.slice(0, topK).map((claim) => ({
    claimId: claim.id,
    sourceText: claim.text,
    sourceAuthor: claim.source_author?.join(', ') || 'Unknown',
    sourceWork: claim.source_title || 'Unknown source',
    relevanceScore: claim.confidence ?? 0
  }));
}

function tokenizeQuery(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
    )
  ).slice(0, 20);
}

function lexicalScore(text: string, tokens: string[]): number {
  const low = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (low.includes(token)) score += 1;
  }
  return score;
}

async function retrieveLexicalFallback(params: {
  queryText: string;
  topK: number;
}): Promise<ClaimReference[]> {
  const tokens = tokenizeQuery(params.queryText);
  if (tokens.length === 0) return [];

  const candidateRows = await query<Array<{
    id: string;
    text: string;
    source?: string;
    confidence?: number;
  }>>(
    `SELECT id, text, source, confidence
     FROM claim
     WHERE review_state = 'accepted'
     LIMIT 1500`
  );

  const scored = candidateRows
    .map((row) => ({
      ...row,
      lexicalScore: lexicalScore(row.text ?? '', tokens)
    }))
    .filter((row) => row.lexicalScore > 0)
    .sort((a, b) => b.lexicalScore - a.lexicalScore || (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, params.topK);

  if (scored.length === 0) return [];

  const sourceIds = Array.from(
    new Set(
      scored
        .map((row) => (typeof row.source === 'string' ? row.source : ''))
        .filter(Boolean)
    )
  );
  const sourceRows = sourceIds.length
    ? await query<Array<{ id: string; title?: string; author?: string[] }>>(
        `SELECT id, title, author FROM source WHERE id INSIDE $sourceIds`,
        { sourceIds }
      )
    : [];
  const sourceMap = new Map(sourceRows.map((row) => [row.id, row]));

  return scored.map((row) => {
    const sourceInfo = typeof row.source === 'string' ? sourceMap.get(row.source) : undefined;
    return {
      claimId: row.id,
      sourceText: row.text ?? '',
      sourceAuthor: Array.isArray(sourceInfo?.author) && sourceInfo.author.length > 0
        ? sourceInfo.author.join(', ')
        : 'Unknown',
      sourceWork: sourceInfo?.title || 'Unknown source',
      relevanceScore: Math.min(1, (row.lexicalScore / Math.max(tokens.length, 1)) * 0.9 + 0.1)
    };
  });
}

function confidenceFromScore(score: number): GroundingConfidenceLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

function overlapScore(a: string, b: string): number {
  const as = tokenSet(a);
  const bs = tokenSet(b);
  if (as.size === 0 || bs.size === 0) return 0;
  let shared = 0;
  for (const token of as) {
    if (bs.has(token)) shared += 1;
  }
  return shared / Math.max(as.size, 1);
}

export function scoreCitationQuality(params: {
  responseText: string;
  sourceClaims: ClaimReference[];
}): { overall: GroundingConfidenceLevel; details: CitationQuality[] } {
  const details: CitationQuality[] = params.sourceClaims.map((claim) => {
    const quoteOverlap = overlapScore(params.responseText, claim.sourceText);
    const provenanceConfidence = Math.max(0, Math.min(1, claim.relevanceScore ?? 0));
    const combined = quoteOverlap * 0.65 + provenanceConfidence * 0.35;
    return {
      claimId: claim.claimId,
      quoteOverlap: Number(quoteOverlap.toFixed(3)),
      provenanceConfidence: Number(provenanceConfidence.toFixed(3)),
      confidence: confidenceFromScore(combined)
    };
  });
  if (details.length === 0) {
    return { overall: 'low', details: [] };
  }
  const avg =
    details.reduce((sum, detail) => {
      const score = detail.confidence === 'high' ? 1 : detail.confidence === 'medium' ? 0.6 : 0.2;
      return sum + score;
    }, 0) / details.length;
  return {
    overall: confidenceFromScore(avg),
    details
  };
}

export async function retrieveStoaGroundingWithMode(params: {
  message: string;
  history?: ConversationTurn[];
  topK?: number;
}): Promise<GroundingResult> {
  const history = params.history ?? [];
  const topK = Math.max(1, Math.min(params.topK ?? 5, 10));
  const queryText = [buildConversationSummary(history), params.message].filter(Boolean).join('\n\n');

  try {
    const primary = await retrieveStoaGrounding({ message: params.message, history, topK });
    if (primary.length > 0) {
      return { claims: primary, mode: 'graph_dense', confidence: 'high' };
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[STOA] Graph grounding failed; attempting lexical fallback:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  try {
    const fallback = await retrieveLexicalFallback({ queryText, topK });
    if (fallback.length > 0) {
      return {
        claims: fallback,
        mode: 'lexical_fallback',
        warning: 'Graph retrieval unavailable, using lexical fallback claims.',
        confidence: 'medium'
      };
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[STOA] Lexical fallback grounding failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return {
    claims: [],
    mode: 'degraded_none',
    warning: 'Grounding unavailable for this turn.',
    confidence: 'low'
  };
}

