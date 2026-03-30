import { retrieveContext } from '$lib/server/retrieval';
import type { ClaimReference, ConversationTurn } from './types';

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

