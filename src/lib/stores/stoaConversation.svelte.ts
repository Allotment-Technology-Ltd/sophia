import { getIdToken } from '$lib/authClient';
import type { ClaimReference, StanceType } from '$lib/server/stoa/types';

export interface StoaMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  stance?: StanceType;
}

function createStoaConversationStore() {
  let messages = $state<StoaMessage[]>([]);
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let sessionId = $state(`stoa-${crypto.randomUUID()}`);
  let currentStance = $state<StanceType>('hold');
  let sourceClaims = $state<ClaimReference[]>([]);
  let escalated = $state(false);

  function reset(): void {
    messages = [];
    error = null;
    isLoading = false;
    currentStance = 'hold';
    sourceClaims = [];
    escalated = false;
    sessionId = `stoa-${crypto.randomUUID()}`;
  }

  async function send(message: string): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed || isLoading) return;
    error = null;
    isLoading = true;

    const userMessage: StoaMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString()
    };
    messages = [...messages, userMessage];

    const token = await getIdToken();
    const response = await fetch('/api/stoa/dialogue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        message: trimmed,
        sessionId,
        history: messages.map((entry) => ({
          role: entry.role === 'agent' ? 'agent' : 'user',
          content: entry.content,
          timestamp: entry.timestamp,
          stance: entry.stance
        }))
      })
    });

    if (!response.ok || !response.body) {
      isLoading = false;
      error = `Request failed (${response.status})`;
      return;
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    let agentMessage: StoaMessage | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'metadata') {
              if (payload.stance) currentStance = payload.stance as StanceType;
              if (Array.isArray(payload.sourceClaims)) sourceClaims = payload.sourceClaims as ClaimReference[];
              escalated = Boolean(payload.escalated);
            } else if (payload.type === 'delta') {
              const text = typeof payload.text === 'string' ? payload.text : '';
              if (!agentMessage) {
                agentMessage = {
                  id: crypto.randomUUID(),
                  role: 'agent',
                  content: '',
                  timestamp: new Date().toISOString(),
                  stance: currentStance
                };
                messages = [...messages, agentMessage];
              }
              agentMessage.content += text;
              messages = [...messages.slice(0, -1), agentMessage];
            } else if (payload.type === 'complete') {
              if (agentMessage) {
                agentMessage.stance = (payload.stance as StanceType) ?? currentStance;
                messages = [...messages.slice(0, -1), agentMessage];
              }
            } else if (payload.type === 'error') {
              error = typeof payload.message === 'string' ? payload.message : 'Unknown streaming error';
            }
          }
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading = false;
    }
  }

  return {
    get messages() {
      return messages;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    get currentStance() {
      return currentStance;
    },
    get sourceClaims() {
      return sourceClaims;
    },
    get escalated() {
      return escalated;
    },
    get sessionId() {
      return sessionId;
    },
    reset,
    send
  };
}

export const stoaConversationStore = createStoaConversationStore();

