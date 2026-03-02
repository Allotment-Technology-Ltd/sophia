import type { PassType } from '$lib/types/passes';
import type { SSEEvent } from '$lib/types/api';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
import { handleSSEEvent } from '$lib/utils/sseHandler';
import { referencesStore } from '$lib/stores/references.svelte';
import { historyStore } from '$lib/stores/history.svelte';
import { graphStore } from '$lib/stores/graph.svelte';

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

function createConversationStore() {
  let messages = $state<Message[]>([]);
  let isLoading = $state(false);
  let currentPass = $state<PassType | null>(null);
  let currentPasses = $state({ analysis: '', critique: '', synthesis: '', verification: '' });
  let error = $state<string | null>(null);
  let confidenceSummary = $state<{ avgConfidence: number; lowConfidenceCount: number; totalClaims: number } | null>(null);

  return {
    get messages() { return messages; },
    get isLoading() { return isLoading; },
    get currentPass() { return currentPass; },
    get currentPasses() { return currentPasses; },
    get error() { return error; },
    get confidenceSummary() { return confidenceSummary; },

    async submitQuery(query: string, lens?: string): Promise<void> {
      error = null;
      isLoading = true;
      currentPass = null;
      currentPasses = { analysis: '', critique: '', synthesis: '', verification: '' };
      confidenceSummary = null;
      referencesStore.reset();
      graphStore.reset();

      messages = [...messages, {
        id: crypto.randomUUID(),
        role: 'user',
        content: query,
        timestamp: new Date()
      }];

      const cached = historyStore.getCachedResult(query);
      if (cached) {
        currentPass = null;
        currentPasses = { ...cached.passes, verification: cached.passes.verification ?? '' };
        referencesStore.setSources(cached.sources);

        for (const { pass, claims } of cached.claimsByPass as CachedPassClaims[]) {
          referencesStore.addClaims(pass, claims, []);
        }

        for (const { pass, relations } of cached.relationsByPass as CachedPassRelations[]) {
          referencesStore.addClaims(pass, [], relations);
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

        historyStore.addEntry(query);
        isLoading = false;
        return;
      }

      try {
        const response = await fetch('/api/analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, lens })
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
        let streamedSources: SourceReference[] = [];
        let streamedClaimsByPass: CachedPassClaims[] = [];
        let streamedRelationsByPass: CachedPassRelations[] = [];

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
                break;

              case 'confidence_summary':
                confidenceSummary = {
                  avgConfidence: event.avgConfidence,
                  lowConfidenceCount: event.lowConfidenceCount,
                  totalClaims: event.totalClaims
                };
                break;

              case 'metadata':
                messages = [...messages, {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: currentPasses.synthesis,
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

      try {
        const response = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      currentPasses = { analysis: '', critique: '', synthesis: '', verification: '' };
      confidenceSummary = null;
      isLoading = false;
    }
  };
}

export const conversation = createConversationStore();
