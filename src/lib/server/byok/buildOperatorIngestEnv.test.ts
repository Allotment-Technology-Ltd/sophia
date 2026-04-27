import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetOperatorByokTargetUid = vi.fn();
const mockLoadByokProviderApiKeys = vi.fn();
const mockGetAppAiDefaults = vi.fn();

vi.mock('./operatorByokTarget', () => ({
  getOperatorByokTargetUid: mockGetOperatorByokTargetUid
}));

vi.mock('./store', () => ({
  loadByokProviderApiKeys: mockLoadByokProviderApiKeys
}));

vi.mock('../appAiDefaults.js', () => ({
  getAppAiDefaults: mockGetAppAiDefaults
}));

describe('buildOperatorByokProcessEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VOYAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.INGEST_PREFER_LOCAL_PROVIDER_KEYS;
    mockGetOperatorByokTargetUid.mockReturnValue('operator-uid');
    mockGetAppAiDefaults.mockResolvedValue({ defaultOpenaiApiKey: null });
  });

  it('maps operator Voyage BYOK into VOYAGE_API_KEY for ingestion workers', async () => {
    mockLoadByokProviderApiKeys.mockResolvedValue({
      voyage: 'pa-voyage-from-neon',
      aizolo: 'az-from-neon'
    });

    const { buildOperatorByokProcessEnv } = await import('./buildOperatorIngestEnv');
    const env = await buildOperatorByokProcessEnv();

    expect(mockLoadByokProviderApiKeys).toHaveBeenCalledWith('operator-uid', {
      allowPending: true,
      allowInvalid: true
    });
    expect(env.VOYAGE_API_KEY).toBe('pa-voyage-from-neon');
    expect(env.AIZOLO_API_KEY).toBe('az-from-neon');
  });

  it('uses local VOYAGE_API_KEY when operator bucket has no Voyage key', async () => {
    process.env.VOYAGE_API_KEY = 'pa-voyage-local';
    mockLoadByokProviderApiKeys.mockResolvedValue({});

    const { buildOperatorByokProcessEnv } = await import('./buildOperatorIngestEnv');
    const env = await buildOperatorByokProcessEnv();

    expect(env.VOYAGE_API_KEY).toBe('pa-voyage-local');
  });
});
