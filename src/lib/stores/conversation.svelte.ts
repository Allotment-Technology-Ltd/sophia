import type { PassType } from '$lib/types/passes';
import type { SSEEvent } from '$lib/types/api';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  passes?: { analysis: string; critique: string; synthesis: string };
  metadata?: { total_input_tokens: number; total_output_tokens: number; duration_ms: number };
  timestamp: Date;
}

function createConversationStore() {
  let messages = $state<Message[]>([]);
  let isLoading = $state(false);
  let currentPass = $state<PassType | null>(null);
  let currentPasses = $state({ analysis: '', critique: '', synthesis: '' });
  let error = $state<string | null>(null);

  return {
    get messages() { return messages; },
    get isLoading() { return isLoading; },
    get currentPass() { return currentPass; },
    get currentPasses() { return currentPasses; },
    get error() { return error; },

    async submitQuery(query: string, lens?: string): Promise<void> {
      error = null;
      isLoading = true;
      currentPass = null;
      currentPasses = { analysis: '', critique: '', synthesis: '' };

      // Add user message
      messages = [...messages, {
        id: crypto.randomUUID(),
        role: 'user',
        content: query,
        timestamp: new Date()
      }];

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

              case 'metadata':
                messages = [...messages, {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: currentPasses.synthesis,
                  passes: { ...currentPasses },
                  metadata: {
                    total_input_tokens: event.total_input_tokens,
                    total_output_tokens: event.total_output_tokens,
                    duration_ms: event.duration_ms
                  },
                  timestamp: new Date()
                }];
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

    clear(): void {
      messages = [];
      error = null;
      currentPass = null;
      currentPasses = { analysis: '', critique: '', synthesis: '' };
      isLoading = false;
    }
  };
}

export const conversation = createConversationStore();
