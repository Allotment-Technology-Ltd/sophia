import { describe, expect, it } from 'vitest';
import {
  canonicalizeSophiaProviderId,
  createSophiaKeyManagerProviders,
  toSophiaKeyRecord,
  toSophiaStorageByokProviderId
} from './key-manager';

describe('key-manager helpers', () => {
  it('uses defaultProviders while preserving Sophia storage compatibility for google/vertex', () => {
    const providers = createSophiaKeyManagerProviders(['vertex', 'openai']);

    expect(providers.map((provider) => provider.id)).toEqual(['google', 'openai']);
    expect(canonicalizeSophiaProviderId('vertex', providers)).toBe('google');
    expect(toSophiaStorageByokProviderId('google', providers)).toBe('vertex');
    expect(toSophiaStorageByokProviderId('vertex', providers)).toBe('vertex');
  });

  it('maps stored provider status into a KeyRecord for the richer KeyManager detail view', () => {
    const providers = createSophiaKeyManagerProviders(['vertex', 'anthropic']);
    const record = toSophiaKeyRecord({
      provider: 'anthropic',
      configured: true,
      status: 'invalid',
      fingerprint_last8: 'abcd1234',
      validated_at: '2026-03-19T09:00:00.000Z',
      updated_at: '2026-03-19T10:00:00.000Z',
      last_error: 'anthropic_validation_failed_401'
    }, providers);

    expect(record).toEqual({
      id: 'anthropic',
      provider: 'anthropic',
      label: 'abcd1234',
      status: 'invalid',
      validatedAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T10:00:00.000Z',
      lastError: 'anthropic_validation_failed_401',
      fingerprint: 'abcd1234'
    });
  });

  it('omits non-configured entries from the KeyManager list', () => {
    const providers = createSophiaKeyManagerProviders(['openai']);
    expect(
      toSophiaKeyRecord({
        provider: 'openai',
        configured: false,
        status: 'not_configured',
        fingerprint_last8: null,
        validated_at: null,
        updated_at: null,
        last_error: null
      }, providers)
    ).toBeNull();
  });
});
