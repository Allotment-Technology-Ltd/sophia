import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockStreamText,
  mockResolveReasoningModelRoute,
  mockLoadSession,
  mockLoadProfile,
  mockAppendTurns,
  mockUpdateProfile,
  mockListIncompleteActionItems,
  mockListRelevantJournalEntries,
  mockListJournalEntries,
  mockUpsertActionItems,
  mockRetrieveGrounding,
  mockScoreCitationQuality,
  mockBuildGroundingExplainer,
  mockClassifyStanceV2,
  mockShouldEscalate,
  mockRunDeepEscalation,
  mockRecordTelemetry,
  mockGetProgress
} = vi.hoisted(() => ({
  mockStreamText: vi.fn(),
  mockResolveReasoningModelRoute: vi.fn(),
  mockLoadSession: vi.fn(),
  mockLoadProfile: vi.fn(),
  mockAppendTurns: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockListIncompleteActionItems: vi.fn(),
  mockListRelevantJournalEntries: vi.fn(),
  mockListJournalEntries: vi.fn(),
  mockUpsertActionItems: vi.fn(),
  mockRetrieveGrounding: vi.fn(),
  mockScoreCitationQuality: vi.fn(),
  mockBuildGroundingExplainer: vi.fn(),
  mockClassifyStanceV2: vi.fn(),
  mockShouldEscalate: vi.fn(),
  mockRunDeepEscalation: vi.fn(),
  mockRecordTelemetry: vi.fn(),
  mockGetProgress: vi.fn()
}));

vi.mock('ai', () => ({
  streamText: mockStreamText
}));

vi.mock('$lib/server/byok/effectiveKeys', () => ({
  loadInquiryEffectiveProviderApiKeys: vi.fn(async () => ({}))
}));

vi.mock('$lib/server/vertex', () => ({
  resolveReasoningModelRoute: mockResolveReasoningModelRoute
}));

vi.mock('$lib/server/stoa/sessionStore', () => ({
  loadStoaSession: mockLoadSession,
  loadStoaProfile: mockLoadProfile,
  appendStoaTurns: mockAppendTurns,
  updateStoaProfileFromTurns: mockUpdateProfile,
  listIncompleteActionItems: mockListIncompleteActionItems,
  listRelevantJournalEntries: mockListRelevantJournalEntries,
  listJournalEntries: mockListJournalEntries,
  upsertActionItems: mockUpsertActionItems
}));

vi.mock('$lib/server/stoa/game/progress-store', () => ({
  getProgress: mockGetProgress
}));

vi.mock('$lib/server/stoa/game/quest-engine', () => ({
  QuestEngine: class {
    async evaluateCompletions(): Promise<never[]> {
      return [];
    }
    async evaluateTriggers(): Promise<never[]> {
      return [];
    }
    async awardCompletion(): Promise<void> {
      return;
    }
  }
}));

vi.mock('$lib/server/stoa/grounding', () => ({
  retrieveStoaGroundingWithMode: mockRetrieveGrounding,
  scoreCitationQuality: mockScoreCitationQuality,
  buildGroundingExplainer: mockBuildGroundingExplainer
}));

vi.mock('$lib/server/stoa/safety', () => ({
  detectCrisisRisk: vi.fn(() => false),
  detectSuppressionMisuse: vi.fn(() => false),
  buildCrisisSupportMessage: vi.fn(() => 'crisis')
}));

vi.mock('$lib/server/stoa/stanceClassifier', () => ({
  classifyStanceV2: mockClassifyStanceV2
}));

vi.mock('$lib/server/stoa/prompt', () => ({
  buildStoaSystemPrompt: vi.fn(() => 'system'),
  buildStoaUserPrompt: vi.fn(() => 'user prompt')
}));

vi.mock('$lib/server/stoa/escalation', () => ({
  decideEscalation: vi.fn(() => ({ escalate: mockShouldEscalate(), reasons: [] })),
  runDeepEscalationAnalysis: mockRunDeepEscalation
}));

vi.mock('$lib/server/stoa/observability', () => ({
  recordStoaTelemetry: mockRecordTelemetry
}));

const DEFAULT_STANCE = {
  decision: {
    stance: 'hold',
    confidence: 'medium',
    reason: 'test',
    askClarifyingQuestion: false,
    scores: { hold: 2, challenge: 0, guide: 0, teach: 0, sit_with: 0 },
    recommendedFrameworks: ['dichotomy_of_control'],
    frameworkRationale: 'test rationale'
  },
  source: 'heuristic'
} as const;

import { POST } from './+server';

async function readSseEvents(response: Response): Promise<any[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  const events: any[] = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith('data: ')) continue;
      events.push(JSON.parse(line.slice(6)));
    }
  }

  return events;
}

describe('/api/stoa/dialogue SSE contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProgress.mockResolvedValue({
      xp: 0,
      level: 1,
      levelTitle: 'Novice',
      xpToNextLevel: 100,
      levelProgress: 0,
      unlockedThinkers: ['marcus'],
      masteredFrameworks: [],
      activeQuestIds: [],
      completedQuestIds: []
    });
    mockListJournalEntries.mockResolvedValue([]);
    mockLoadSession.mockResolvedValue({ turns: [] });
    mockLoadProfile.mockResolvedValue({ userId: 'u1', goals: [], triggers: [], practices: [], updatedAt: null });
    mockClassifyStanceV2.mockResolvedValue(DEFAULT_STANCE);
    mockListIncompleteActionItems.mockResolvedValue([]);
    mockListRelevantJournalEntries.mockResolvedValue([]);
    mockUpsertActionItems.mockResolvedValue(undefined);
    mockRetrieveGrounding.mockResolvedValue({
      claims: [
        {
          claimId: 'claim-1',
          sourceText: 'What upsets people is not things but judgments.',
          sourceAuthor: 'Epictetus',
          sourceWork: 'Enchiridion',
          relevanceScore: 0.9
        }
      ],
      mode: 'graph_dense',
      warning: undefined,
      confidence: 'high'
    });
    mockScoreCitationQuality.mockReturnValue({
      overall: 'high',
      details: []
    });
    mockBuildGroundingExplainer.mockReturnValue({
      reasons: [],
      explanation: 'Grounding is strong.'
    });
    mockResolveReasoningModelRoute.mockResolvedValue({
      model: { id: 'fake-model' },
      provider: 'vertex',
      modelId: 'gemini-2.5-flash',
      resolvedRouteId: 'route:test',
      resolvedExplanation: 'test route'
    });
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        yield 'Hello';
        yield ' world';
      })(),
      totalUsage: Promise.resolve({ inputTokens: 11, outputTokens: 7, totalTokens: 18 }),
      finishReason: Promise.resolve('stop')
    });
    mockAppendTurns.mockResolvedValue(undefined);
    mockUpdateProfile.mockResolvedValue(undefined);
    mockRecordTelemetry.mockResolvedValue(undefined);
    mockRunDeepEscalation.mockResolvedValue({
      analysis: 'Deep synthesis text.',
      usage: { inputTokens: 9, outputTokens: 6, totalTokens: 15 },
      route: { provider: 'vertex', modelId: 'gemini-2.5-pro', routeId: 'deep:test', reason: 'deep' }
    });
  });

  it('emits base SSE sequence without escalation', async () => {
    mockShouldEscalate.mockReturnValue(false);
    const request = new Request('http://localhost/api/stoa/dialogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Help me think clearly about this decision.',
        sessionId: 'session-1'
      })
    });

    const response = await POST({ request, locals: { user: { uid: 'u1' } } } as never);
    const events = await readSseEvents(response);

    expect(response.status).toBe(200);
    expect(events.map((event) => event.type)).toContain('metadata');
    expect(events.map((event) => event.type)).toContain('start');
    expect(events.filter((event) => event.type === 'delta')).toHaveLength(2);
    expect(events.at(-1)?.type).toBe('complete');
    expect(events.some((event) => event.type === 'escalation_started')).toBe(false);
    expect(events.some((event) => event.type === 'escalation_result')).toBe(false);
    expect(mockRunDeepEscalation).not.toHaveBeenCalled();
  });

  it('emits escalation events and includes deep analysis in completion payload', async () => {
    mockShouldEscalate.mockReturnValue(true);
    const request = new Request('http://localhost/api/stoa/dialogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'I am conflicted between long term duty and short term relief.',
        sessionId: 'session-2'
      })
    });

    const response = await POST({ request, locals: { user: { uid: 'u2' } } } as never);
    const events = await readSseEvents(response);
    const types = events.map((event) => event.type);

    expect(response.status).toBe(200);
    expect(types).toContain('escalation_started');
    expect(types).toContain('escalation_result');
    expect(types.at(-1)).toBe('complete');

    const escalationResultEvent = events.find((event) => event.type === 'escalation_result');
    expect(escalationResultEvent.analysis).toContain('Deep synthesis text.');

    const completeEvent = events.find((event) => event.type === 'complete');
    expect(completeEvent.escalated).toBe(true);
    expect(completeEvent.escalationResult?.analysis).toContain('Deep synthesis text.');
    expect(completeEvent.response).toContain('Deep analysis:');
    expect(mockRunDeepEscalation).toHaveBeenCalledTimes(1);
  });
});

