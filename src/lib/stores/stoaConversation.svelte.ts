import { getIdToken } from '$lib/authClient';
import type {
  ActionSuggestion,
  CitationQuality,
  ClaimReference,
  CurriculumProgress,
  CurriculumWeek,
  GroundingConfidenceLevel,
  GroundingExplainer,
  JournalEntry,
  GroundingMode,
  StoaActionItem,
  StoaOnboardingProfile,
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
type OnboardingStatus = 'unknown' | 'required' | 'complete';

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
  let onboardingStatus = $state<OnboardingStatus>('unknown');
  let onboardingDraft = $state<StoaOnboardingProfile>({
    stoicLevel: 'new',
    primaryChallenge: '',
    goals: [],
    triggers: [],
    intakeVersion: 1
  });
  let actionSuggestions = $state<ActionSuggestion[]>([]);
  let pendingActions = $state<StoaActionItem[]>([]);
  let groundingExplainer = $state<GroundingExplainer | null>(null);
  let curriculumWeeks = $state<CurriculumWeek[]>([]);
  let curriculumProgress = $state<CurriculumProgress | null>(null);
  let currentCurriculumWeek = $state<CurriculumWeek | null>(null);
  let journalEntries = $state<JournalEntry[]>([]);
  let relevantJournal = $state<JournalEntry[]>([]);

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
    actionSuggestions = [];
    pendingActions = [];
    relevantJournal = [];
    groundingExplainer = null;
    sessionId = `stoa-${crypto.randomUUID()}`;
  }

  async function loadBootstrap(): Promise<void> {
    const token = await getIdToken();
    const headers: HeadersInit | undefined = token
      ? { Authorization: `Bearer ${token}` }
      : undefined;
    const [onboardingRes, curriculumRes, journalRes, incompleteRes] = await Promise.all([
      fetch('/api/stoa/onboarding/status', { headers }),
      fetch('/api/stoa/curriculum', { headers }),
      fetch('/api/stoa/journal?limit=20', { headers }),
      fetch('/api/stoa/action-loop/incomplete?lookbackDays=14', { headers })
    ]);
    if (onboardingRes.ok) {
      const payload = await onboardingRes.json();
      onboardingStatus = payload.onboardingStatus === 'complete' ? 'complete' : 'required';
      if (payload.profile && typeof payload.profile === 'object') {
        onboardingDraft = {
          ...onboardingDraft,
          stoicLevel: payload.profile.stoicLevel ?? 'new',
          primaryChallenge: payload.profile.primaryChallenge ?? '',
          goals: Array.isArray(payload.profile.goals) ? payload.profile.goals : [],
          triggers: Array.isArray(payload.profile.triggers) ? payload.profile.triggers : []
        };
      }
    }
    if (curriculumRes.ok) {
      const payload = await curriculumRes.json();
      curriculumWeeks = Array.isArray(payload.weeks) ? payload.weeks : [];
      curriculumProgress = payload.progress ?? null;
      currentCurriculumWeek = payload.currentWeek ?? null;
    }
    if (journalRes.ok) {
      const payload = await journalRes.json();
      journalEntries = Array.isArray(payload.items) ? payload.items : [];
    }
    if (incompleteRes.ok) {
      const payload = await incompleteRes.json();
      pendingActions = Array.isArray(payload.items) ? payload.items : [];
    }
  }

  async function completeOnboarding(payload: StoaOnboardingProfile): Promise<void> {
    const token = await getIdToken();
    const response = await fetch('/api/stoa/onboarding/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Failed onboarding (${response.status})`);
    onboardingStatus = 'complete';
    const body = await response.json();
    profile = body.profile ?? profile;
  }

  async function resetOnboarding(): Promise<void> {
    const token = await getIdToken();
    const response = await fetch('/api/stoa/onboarding/reset', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) throw new Error(`Failed onboarding reset (${response.status})`);
    onboardingStatus = 'required';
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
              pendingActions = Array.isArray(payload.pendingActions)
                ? (payload.pendingActions as StoaActionItem[])
                : pendingActions;
              relevantJournal = Array.isArray(payload.relevantJournal)
                ? (payload.relevantJournal as JournalEntry[])
                : relevantJournal;
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
              actionSuggestions = Array.isArray(payload.actionSuggestions)
                ? (payload.actionSuggestions as ActionSuggestion[])
                : [];
              profile =
                payload.profile && typeof payload.profile === 'object'
                  ? (payload.profile as { goals: string[]; triggers: string[]; practices: string[] })
                  : profile;
              pendingActions = Array.isArray(payload.pendingActions)
                ? (payload.pendingActions as StoaActionItem[])
                : pendingActions;
              relevantJournal = Array.isArray(payload.relevantJournal)
                ? (payload.relevantJournal as JournalEntry[])
                : relevantJournal;
              groundingExplainer =
                (Array.isArray(payload.groundingReasons) || typeof payload.groundingExplainer === 'string')
                  ? {
                      reasons: Array.isArray(payload.groundingReasons)
                        ? payload.groundingReasons.filter((reason: unknown): reason is string => typeof reason === 'string')
                        : [],
                      explanation:
                        typeof payload.groundingExplainer === 'string'
                          ? payload.groundingExplainer
                          : 'Grounding explanation unavailable.'
                    }
                  : groundingExplainer;
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

  async function confirmActionSuggestions(selectedIds: string[]): Promise<void> {
    if (selectedIds.length === 0) return;
    const selected = actionSuggestions.filter((item) => selectedIds.includes(item.id));
    if (selected.length === 0) return;
    const token = await getIdToken();
    const response = await fetch('/api/stoa/action-loop/suggestions/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        sessionId,
        suggestions: selected
      })
    });
    if (!response.ok) throw new Error(`Failed to confirm suggestions (${response.status})`);
    await loadBootstrap();
    actionSuggestions = actionSuggestions.filter((item) => !selectedIds.includes(item.id));
  }

  async function updateActionStatus(itemId: string, status: 'pending' | 'done' | 'archived' | 'carried_forward') {
    const token = await getIdToken();
    const response = await fetch(`/api/stoa/action-loop/item/${itemId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ status })
    });
    if (!response.ok) throw new Error(`Failed action update (${response.status})`);
    await loadBootstrap();
  }

  async function saveJournalReflection(entryText: string, themes: string[] = []): Promise<void> {
    const text = entryText.trim();
    if (!text) return;
    const token = await getIdToken();
    const response = await fetch('/api/stoa/journal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        sessionId,
        entryText: text,
        themes
      })
    });
    if (!response.ok) throw new Error(`Failed journal save (${response.status})`);
    await loadBootstrap();
  }

  async function runRitual(params: {
    ritualType: 'morning' | 'evening';
    answers: Record<string, string>;
    durationSeconds: number;
  }): Promise<{ actionText: string | null }> {
    const token = await getIdToken();
    const response = await fetch('/api/stoa/ritual', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        sessionId,
        ...params
      })
    });
    if (!response.ok) throw new Error(`Failed ritual run (${response.status})`);
    const payload = await response.json();
    await loadBootstrap();
    return { actionText: typeof payload.actionText === 'string' ? payload.actionText : null };
  }

  async function updateCurriculum(params: { currentWeek: number; completedWeeks: number[] }): Promise<void> {
    const token = await getIdToken();
    const response = await fetch('/api/stoa/curriculum', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error(`Failed curriculum update (${response.status})`);
    const payload = await response.json();
    curriculumProgress = payload.progress ?? curriculumProgress;
    const week = curriculumWeeks.find((item) => item.weekNumber === curriculumProgress?.currentWeek);
    if (week) currentCurriculumWeek = week;
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
    get onboardingStatus() {
      return onboardingStatus;
    },
    get onboardingDraft() {
      return onboardingDraft;
    },
    get actionSuggestions() {
      return actionSuggestions;
    },
    get pendingActions() {
      return pendingActions;
    },
    get groundingExplainer() {
      return groundingExplainer;
    },
    get curriculumWeeks() {
      return curriculumWeeks;
    },
    get curriculumProgress() {
      return curriculumProgress;
    },
    get currentCurriculumWeek() {
      return currentCurriculumWeek;
    },
    get journalEntries() {
      return journalEntries;
    },
    get relevantJournal() {
      return relevantJournal;
    },
    addProfileItem,
    confirmActionSuggestions,
    completeOnboarding,
    loadBootstrap,
    resetOnboarding,
    reset,
    runRitual,
    saveJournalReflection,
    send,
    updateActionStatus,
    updateCurriculum
  };
}

export const stoaConversationStore = createStoaConversationStore();

