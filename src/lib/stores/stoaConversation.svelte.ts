import { getIdToken } from '$lib/authClient';
import type {
  CitationQuality,
  ClaimReference,
  GroundingConfidenceLevel,
  GroundingMode,
  StanceType
} from '$lib/server/stoa/types';

export interface StoaMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  stance?: StanceType;
}

export interface ActionLoopState {
  today: string;
  tonight: string;
  thisWeek: string;
  followUpPrompt: string;
}

type ProfileKind = 'goals' | 'triggers' | 'practices';
type StoaProfileState = { goals: string[]; triggers: string[]; practices: string[] };

function createStoaConversationStore() {
  let messages = $state<StoaMessage[]>([]);
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let sessionId = $state(`stoa-${crypto.randomUUID()}`);
  let currentStance = $state<StanceType>('hold');
  let sourceClaims = $state<ClaimReference[]>([]);
  let groundingMode = $state<GroundingMode>('degraded_none');
  let groundingConfidence = $state<GroundingConfidenceLevel>('low');
  let citationQuality = $state<CitationQuality[]>([]);
  let groundingWarning = $state<string | null>(null);
  let escalated = $state(false);
  let escalationReasons = $state<string[]>([]);
  let actionLoop = $state<ActionLoopState | null>(null);
  let profile = $state<StoaProfileState | null>(null);

  function reset(): void {
    messages = [];
    error = null;
    isLoading = false;
    currentStance = 'hold';
    sourceClaims = [];
    groundingMode = 'degraded_none';
    groundingConfidence = 'low';
    citationQuality = [];
    groundingWarning = null;
    escalated = false;
    escalationReasons = [];
    actionLoop = null;
    profile = null;
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
              if (payload.groundingMode) groundingMode = payload.groundingMode as GroundingMode;
              if (payload.groundingConfidence) {
                groundingConfidence = payload.groundingConfidence as GroundingConfidenceLevel;
              }
              citationQuality = Array.isArray(payload.citationQuality)
                ? (payload.citationQuality as CitationQuality[])
                : citationQuality;
              groundingWarning =
                typeof payload.groundingWarning === 'string' && payload.groundingWarning.trim()
                  ? payload.groundingWarning
                  : null;
              escalated = Boolean(payload.escalated);
              escalationReasons = Array.isArray(payload.escalationReasons)
                ? payload.escalationReasons.filter((r: unknown): r is string => typeof r === 'string')
                : [];
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
              if (payload.groundingMode) groundingMode = payload.groundingMode as GroundingMode;
              if (payload.groundingConfidence) {
                groundingConfidence = payload.groundingConfidence as GroundingConfidenceLevel;
              }
              citationQuality = Array.isArray(payload.citationQuality)
                ? (payload.citationQuality as CitationQuality[])
                : citationQuality;
              actionLoop =
                payload.actionLoop && typeof payload.actionLoop === 'object'
                  ? (payload.actionLoop as ActionLoopState)
                  : actionLoop;
              profile =
                payload.profile && typeof payload.profile === 'object'
                  ? (payload.profile as { goals: string[]; triggers: string[]; practices: string[] })
                  : profile;
              groundingWarning =
                typeof payload.groundingWarning === 'string' && payload.groundingWarning.trim()
                  ? payload.groundingWarning
                  : null;
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

  async function saveProfile(nextProfile: StoaProfileState): Promise<void> {
    const token = await getIdToken();
    const response = await fetch('/api/stoa/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(nextProfile)
    });
    if (!response.ok) {
      throw new Error(`Failed to save profile (${response.status})`);
    }
    profile = nextProfile;
  }

  async function addProfileItem(kind: ProfileKind, value: string): Promise<void> {
    const text = value.trim();
    if (!text) return;
    const current: StoaProfileState = profile ?? { goals: [], triggers: [], practices: [] };
    const next: StoaProfileState = {
      goals: kind === 'goals' ? Array.from(new Set([...current.goals, text])).slice(0, 12) : current.goals,
      triggers:
        kind === 'triggers'
          ? Array.from(new Set([...current.triggers, text])).slice(0, 12)
          : current.triggers,
      practices:
        kind === 'practices'
          ? Array.from(new Set([...current.practices, text])).slice(0, 12)
          : current.practices
    };
    try {
      await saveProfile(next);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
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
    get groundingMode() {
      return groundingMode;
    },
    get groundingWarning() {
      return groundingWarning;
    },
    get groundingConfidence() {
      return groundingConfidence;
    },
    get citationQuality() {
      return citationQuality;
    },
    get escalated() {
      return escalated;
    },
    get escalationReasons() {
      return escalationReasons;
    },
    get sessionId() {
      return sessionId;
    },
    get actionLoop() {
      return actionLoop;
    },
    get profile() {
      return profile;
    },
    addProfileItem,
    reset,
    send
  };
}

export const stoaConversationStore = createStoaConversationStore();

