import type { PassType } from '$lib/types/passes';
import type { SSEEvent } from '$lib/types/api';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
import { handleSSEEvent } from '$lib/utils/sseHandler';
import { referencesStore } from '$lib/stores/references.svelte';
import { historyStore } from '$lib/stores/history.svelte';
import { graphStore } from '$lib/stores/graph.svelte';
import { getIdToken } from '$lib/firebase';
import { trackEvent } from '$lib/utils/analytics';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  passes?: { analysis: string; critique: string; synthesis: string; verification?: string };
  metadata?: {
    total_input_tokens: number;
    total_output_tokens: number;
    duration_ms: number;
    claims_retrieved?: number;
    arguments_retrieved?: number;
    retrieval_degraded?: boolean;
    retrieval_degraded_reason?: string;
  };
  structuredPasses?: Partial<Record<PassType, { sections: Array<{ id: string; heading: string; content: string }>; wordCount: number }>>;
  timestamp: Date;
}

interface CachedPassClaims {
  pass: AnalysisPhase;
  claims: Claim[];
}

interface CachedPassRelations {
  pass: AnalysisPhase;
  relations: RelationBundle[];
}

function buildPassFallbackGraph(
  passes: { analysis: string; critique: string; synthesis: string }
): {
  nodes: Array<{ id: string; type: 'claim'; label: string; phase: AnalysisPhase }>;
  edges: Array<{ from: string; to: string; type: 'responds-to' | 'supports'; phaseOrigin: AnalysisPhase }>;
} {
  const snip = (text: string, fallback: string) => {
    const clean = text.trim();
    if (!clean) return fallback;
    return clean.length > 96 ? `${clean.slice(0, 96)}...` : clean;
  };

  return {
    nodes: [
      { id: 'claim:pass-analysis', type: 'claim', phase: 'analysis', label: snip(passes.analysis, 'Analysis output') },
      { id: 'claim:pass-critique', type: 'claim', phase: 'critique', label: snip(passes.critique, 'Critique output') },
      { id: 'claim:pass-synthesis', type: 'claim', phase: 'synthesis', label: snip(passes.synthesis, 'Synthesis output') }
    ],
    edges: [
      { from: 'claim:pass-analysis', to: 'claim:pass-critique', type: 'responds-to', phaseOrigin: 'critique' },
      { from: 'claim:pass-critique', to: 'claim:pass-synthesis', type: 'responds-to', phaseOrigin: 'synthesis' },
      { from: 'claim:pass-analysis', to: 'claim:pass-synthesis', type: 'supports', phaseOrigin: 'synthesis' }
    ]
  };
}

function createConversationStore() {
  let messages = $state<Message[]>([]);
  let isLoading = $state(false);
  let currentPass = $state<PassType | null>(null);
  let completedPasses = $state<Set<PassType>>(new Set());
  let currentPasses = $state({ analysis: '', critique: '', synthesis: '', verification: '' });
  let currentStructuredPasses = $state<Partial<Record<PassType, { sections: Array<{ id: string; heading: string; content: string }>; wordCount: number }>>>({});
  let error = $state<string | null>(null);
  let confidenceSummary = $state<{ avgConfidence: number; lowConfidenceCount: number; totalClaims: number } | null>(null);
  let questionCount = $state(0);

  const QUESTION_LIMIT = 3;

  return {
    get messages() { return messages; },
    get isLoading() { return isLoading; },
    get currentPass() { return currentPass; },
    get completedPasses() { return [...completedPasses]; },
    get currentPasses() { return currentPasses; },
    get currentStructuredPasses() { return currentStructuredPasses; },
    get error() { return error; },
    get confidenceSummary() { return confidenceSummary; },
    get questionCount() { return questionCount; },
    get questionLimit() { return QUESTION_LIMIT; },
    get isAtQuestionLimit() { return questionCount >= QUESTION_LIMIT; },

    async submitQuery(
      query: string,
      lens?: string,
      options?: { domainMode?: 'auto' | 'manual'; domain?: 'ethics' | 'philosophy_of_mind' }
    ): Promise<void> {
      // Enforce question limit (only for live queries, not cache hits)
      if (questionCount >= QUESTION_LIMIT) return;

      error = null;
      isLoading = true;
      currentPass = null;
      completedPasses = new Set();
      currentPasses = { analysis: '', critique: '', synthesis: '', verification: '' };
      currentStructuredPasses = {};
      confidenceSummary = null;
      referencesStore.reset();
      graphStore.reset();

      messages = [...messages, {
        id: crypto.randomUUID(),
        role: 'user',
        content: query,
        timestamp: new Date()
      }];

      const domainMode = options?.domainMode ?? 'auto';
      const domain = options?.domain;
      trackEvent('query_submitted', {
        query_length: query.length,
        has_lens: !!lens
      });

      const cached = historyStore.getCachedResult(query);
      if (cached) {
        trackEvent('cache_hit');
        // Loading from history restarts the depth counter — fresh exploration
        questionCount = 0;
        currentPass = null;
        const cachedCompleted = new Set<PassType>();
        if (cached.passes.analysis) cachedCompleted.add('analysis');
        if (cached.passes.critique) cachedCompleted.add('critique');
        if (cached.passes.synthesis) cachedCompleted.add('synthesis');
        if (cached.passes.verification) cachedCompleted.add('verification');
        completedPasses = cachedCompleted;
        currentPasses = { ...cached.passes, verification: cached.passes.verification ?? '' };
        currentStructuredPasses = {};
        referencesStore.setSources(cached.sources);

        for (const { pass, claims } of cached.claimsByPass as CachedPassClaims[]) {
          referencesStore.addClaims(pass, claims, []);
          graphStore.addFromClaims(pass, claims, []);
        }

        for (const { pass, relations } of cached.relationsByPass as CachedPassRelations[]) {
          referencesStore.addClaims(pass, [], relations);
          graphStore.addFromClaims(pass, [], relations);
        }

        if (graphStore.rawNodes.length === 0 && (cached.passes.analysis || cached.passes.critique || cached.passes.synthesis)) {
          const fallback = buildPassFallbackGraph({
            analysis: cached.passes.analysis ?? '',
            critique: cached.passes.critique ?? '',
            synthesis: cached.passes.synthesis ?? ''
          });
          graphStore.setGraph(
            fallback.nodes,
            fallback.edges,
            {
              seedNodeIds: ['claim:pass-analysis'],
              traversedNodeIds: ['claim:pass-critique', 'claim:pass-synthesis'],
              relationTypeCounts: { 'responds-to': 2, supports: 1 },
              maxHops: 2,
              contextSufficiency: 'sparse',
              retrievalDegraded: true,
              retrievalDegradedReason: 'fallback_pass_graph',
              retrievalTimestamp: new Date().toISOString()
            },
            1
          );
        }

        referencesStore.setLive(false);
        referencesStore.setPhase(null);

        messages = [...messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: cached.passes.synthesis,
          passes: { ...cached.passes },
          metadata: { ...cached.metadata },
          timestamp: new Date()
        }];

        isLoading = false;
        return;
      }

      // Only count depth for live API queries (not cache/history hits)
      questionCount += 1;

      try {
        const idToken = await getIdToken();
        if (!idToken) {
          throw new Error('Not authenticated');
        }

        const response = await fetch('/api/analyse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            query,
            lens,
            domain_mode: domainMode,
            ...(domainMode === 'manual' && domain ? { domain } : {})
          })
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errorBody.detail || errorBody.error || `API error: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamedSources: SourceReference[] = [];
        let streamedClaimsByPass: CachedPassClaims[] = [];
        let streamedRelationsByPass: CachedPassRelations[] = [];
        let gotMetadata = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;

            const json = line.slice(6);
            let event: SSEEvent;
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }

            if (event.type === 'sources') {
              streamedSources = event.sources;
            }

            if (event.type === 'claims') {
              streamedClaimsByPass = [...streamedClaimsByPass, { pass: event.pass, claims: event.claims }];
            }

            if (event.type === 'relations') {
              streamedRelationsByPass = [...streamedRelationsByPass, { pass: event.pass, relations: event.relations }];
            }

            if (handleSSEEvent(event)) continue;

            switch (event.type) {
              case 'pass_start':
                currentPass = event.pass;
                break;

              case 'pass_chunk':
                currentPasses = {
                  ...currentPasses,
                  [event.pass]: currentPasses[event.pass] + event.content
                };
                break;

              case 'pass_complete':
                completedPasses = new Set([...completedPasses, event.pass]);
                break;

              case 'pass_structured':
                // Store sections for the structured/summary view.
                // Do NOT overwrite currentPasses[pass] — the full streaming essay is canonical.
                currentStructuredPasses = {
                  ...currentStructuredPasses,
                  [event.pass]: { sections: event.sections, wordCount: event.wordCount }
                };
                break;

              case 'confidence_summary':
                confidenceSummary = {
                  avgConfidence: event.avgConfidence,
                  lowConfidenceCount: event.lowConfidenceCount,
                  totalClaims: event.totalClaims
                };
                break;

              case 'metadata':
                gotMetadata = true;
                trackEvent('analysis_complete', {
                  duration_ms: event.duration_ms,
                  claims_retrieved: event.claims_retrieved ?? 0,
                  detected_domain: event.detected_domain ?? 'unknown'
                });
                messages = [...messages, {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: currentPasses.synthesis || currentPasses.critique || currentPasses.analysis,
                  passes: { ...currentPasses },
                  structuredPasses: { ...currentStructuredPasses },
                  metadata: {
                    total_input_tokens: event.total_input_tokens,
                    total_output_tokens: event.total_output_tokens,
                    duration_ms: event.duration_ms,
                    claims_retrieved: event.claims_retrieved,
                    arguments_retrieved: event.arguments_retrieved,
                    retrieval_degraded: event.retrieval_degraded,
                    retrieval_degraded_reason: event.retrieval_degraded_reason
                  },
                  timestamp: new Date()
                }];

                historyStore.saveCachedResult(query, {
                  passes: { ...currentPasses },
                  metadata: {
                    total_input_tokens: event.total_input_tokens,
                    total_output_tokens: event.total_output_tokens,
                    duration_ms: event.duration_ms,
                    claims_retrieved: event.claims_retrieved,
                    arguments_retrieved: event.arguments_retrieved,
                    retrieval_degraded: event.retrieval_degraded,
                    retrieval_degraded_reason: event.retrieval_degraded_reason
                  },
                  sources: streamedSources,
                  claimsByPass: streamedClaimsByPass,
                  relationsByPass: streamedRelationsByPass
                });

                historyStore.addEntry(query);

                if (graphStore.rawNodes.length === 0 && (currentPasses.analysis || currentPasses.critique || currentPasses.synthesis)) {
                  const fallback = buildPassFallbackGraph({
                    analysis: currentPasses.analysis,
                    critique: currentPasses.critique,
                    synthesis: currentPasses.synthesis
                  });
                  graphStore.setGraph(
                    fallback.nodes,
                    fallback.edges,
                    {
                      seedNodeIds: ['claim:pass-analysis'],
                      traversedNodeIds: ['claim:pass-critique', 'claim:pass-synthesis'],
                      relationTypeCounts: { 'responds-to': 2, supports: 1 },
                      maxHops: 2,
                      contextSufficiency: 'sparse',
                      retrievalDegraded: true,
                      retrievalDegradedReason: 'fallback_pass_graph',
                      retrievalTimestamp: new Date().toISOString()
                    },
                    1
                  );
                }
                break;

              case 'error':
                error = event.message;
                break;
            }
          }
        }

        if (!gotMetadata && (currentPasses.analysis || currentPasses.critique || currentPasses.synthesis)) {
          const fallbackMetadata = {
            total_input_tokens: 0,
            total_output_tokens: 0,
            duration_ms: 0,
            claims_retrieved: 0,
            arguments_retrieved: 0,
            retrieval_degraded: true,
            retrieval_degraded_reason: 'stream_disconnected_before_metadata'
          };

          messages = [...messages, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: currentPasses.synthesis || currentPasses.critique || currentPasses.analysis,
            passes: { ...currentPasses },
            structuredPasses: { ...currentStructuredPasses },
            metadata: fallbackMetadata,
            timestamp: new Date()
          }];

          historyStore.saveCachedResult(query, {
            passes: { ...currentPasses },
            metadata: fallbackMetadata,
            sources: streamedSources,
            claimsByPass: streamedClaimsByPass,
            relationsByPass: streamedRelationsByPass
          });

          historyStore.addEntry(query);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        isLoading = false;
      }
    },

    async runVerification(): Promise<void> {
      if (!currentPasses.synthesis) {
        error = 'No synthesis available to verify';
        return;
      }

      error = null;
      isLoading = true;
      currentPass = 'verification';
      currentPasses = { ...currentPasses, verification: '' };
      trackEvent('verification_triggered');

      try {
        const idToken = await getIdToken();
        if (!idToken) {
          throw new Error('Not authenticated');
        }
        const response = await fetch('/api/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            claims: referencesStore.activeClaims,
            synthesisText: currentPasses.synthesis
          })
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errorBody.error || `API error: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;

            const json = line.slice(6);
            let event: any;
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }

            switch (event.type) {
              case 'verification_start':
                break;

              case 'verification_chunk':
                currentPasses = {
                  ...currentPasses,
                  verification: currentPasses.verification + event.content
                };
                break;

              case 'verification_complete':
                currentPass = null;
                completedPasses = new Set([...completedPasses, 'verification']);
                // Patch the last assistant message so verification text persists
                {
                  const lastIdx = messages.findLastIndex(m => m.role === 'assistant');
                  if (lastIdx >= 0) {
                    const prev = messages[lastIdx];
                    const updatedPasses = prev.passes
                      ? { ...prev.passes, verification: currentPasses.verification }
                      : { analysis: '', critique: '', synthesis: '', verification: currentPasses.verification };
                    messages = messages.map((m, i) =>
                      i === lastIdx ? { ...m, passes: updatedPasses } : m
                    );
                  }
                }
                break;

              case 'error':
                error = event.message;
                break;
            }
          }
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        isLoading = false;
        currentPass = null;
      }
    },

    clear(): void {
      messages = [];
      error = null;
      currentPass = null;
      completedPasses = new Set();
      currentPasses = { analysis: '', critique: '', synthesis: '', verification: '' };
      currentStructuredPasses = {};
      confidenceSummary = null;
      isLoading = false;
      questionCount = 0;
    }
  };
}

export const conversation = createConversationStore();
