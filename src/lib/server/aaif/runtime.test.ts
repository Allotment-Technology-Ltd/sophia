import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateText, mockEmbedQuery, mockResolveReasoningModelRoute, mockTrackTokens } =
  vi.hoisted(() => ({
    mockGenerateText: vi.fn(),
    mockEmbedQuery: vi.fn(),
    mockResolveReasoningModelRoute: vi.fn(),
    mockTrackTokens: vi.fn()
  }));

vi.mock('ai', () => ({
  generateText: mockGenerateText
}));

vi.mock('$lib/server/embeddings', () => ({
  EMBEDDING_MODEL: 'text-embedding-005',
  embedQuery: mockEmbedQuery,
  getEmbeddingProvider: () => ({ name: 'vertex' })
}));

vi.mock('$lib/server/vertex', () => ({
  resolveReasoningModelRoute: mockResolveReasoningModelRoute,
  trackTokens: mockTrackTokens
}));

describe('executeAAIFRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes chat/completion requests through the routed reasoning model', async () => {
    mockResolveReasoningModelRoute.mockResolvedValue({
      model: 'fake-model-instance',
      provider: 'vertex',
      modelId: 'gemini-3-flash-preview',
      routingSource: 'restormel',
      resolvedExplanation: 'Restormel selected the default interactive route.'
    });
    mockGenerateText.mockResolvedValue({
      text: 'Hello from Sophia',
      usage: {
        inputTokens: 50,
        outputTokens: 100
      }
    });

    const { executeAAIFRequest } = await import('./runtime');
    const result = await executeAAIFRequest({
      input: 'Say hello',
      task: 'chat',
      constraints: {
        latency: 'low'
      }
    });

    expect(mockResolveReasoningModelRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        pass: 'analysis',
        depthMode: 'quick',
        failureMode: 'error'
      })
    );
    expect(result).toMatchObject({
      output: 'Hello from Sophia',
      provider: 'vertex',
      model: 'gemini-3-flash-preview',
      routing: {
        reason: 'Restormel selected the default interactive route.'
      }
    });
    expect(mockTrackTokens).toHaveBeenCalledWith(50, 100);
  });

  it('serialises embedding responses into the AAIF string output contract', async () => {
    mockEmbedQuery.mockResolvedValue([0.1, 0.2, 0.3]);

    const { executeAAIFRequest } = await import('./runtime');
    const result = await executeAAIFRequest({
      input: 'future harms',
      task: 'embedding'
    });

    expect(result).toEqual({
      output: JSON.stringify([0.1, 0.2, 0.3]),
      provider: 'vertex',
      model: 'text-embedding-005',
      cost: expect.any(Number),
      routing: {
        reason:
          'Sophia currently executes AAIF embedding requests on the configured vertex embedding pipeline because Restormel AAIF runtime routing is not yet published.'
      }
    });
  });
});
