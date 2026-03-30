import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockStreamText,
  mockResolveReasoningModelRoute,
  mockLoadSession,
  mockAppendTurns,
  mockRetrieveGrounding,
  mockShouldEscalate,
  mockRunDeepEscalation
} = vi.hoisted(() => ({
  mockStreamText: vi.fn(),
  mockResolveReasoningModelRoute: vi.fn(),
  mockLoadSession: vi.fn(),
  mockAppendTurns: vi.fn(),
  mockRetrieveGrounding: vi.fn(),
  mockShouldEscalate: vi.fn(),
  mockRunDeepEscalation: vi.fn()
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
  appendStoaTurns: mockAppendTurns
}));

vi.mock('$lib/server/stoa/grounding', () => ({
  retrieveStoaGrounding: mockRetrieveGrounding
}));

vi.mock('$lib/server/stoa/safety', () => ({
  detectCrisisRisk: vi.fn(() => false),
  detectSuppressionMisuse: vi.fn(() => false),
  buildCrisisSupportMessage: vi.fn(() => 'crisis')
}));

vi.mock('$lib/server/stoa/stance', () => ({
  detectStance: vi.fn(() => ({
    stance: 'hold',
    confidence: 'medium',
    reason: 'test',
    askClarifyingQuestion: false
  }))
}));

vi.mock('$lib/server/stoa/prompt', () => ({
  buildStoaSystemPrompt: vi.fn(() => 'system'),
  buildStoaUserPrompt: vi.fn(() => 'user prompt')
}));

vi.mock('$lib/server/stoa/escalation', () => ({
  shouldEscalateToDeepAnalysis: mockShouldEscalate,
  runDeepEscalationAnalysis: mockRunDeepEscalation
}));

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
    mockLoadSession.mockResolvedValue({ turns: [] });
    mockRetrieveGrounding.mockResolvedValue([
      {
        claimId: 'claim-1',
        sourceText: 'What upsets people is not things but judgments.',
        sourceAuthor: 'Epictetus',
        sourceWork: 'Enchiridion',
        relevanceScore: 0.9
      }
    ]);
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

