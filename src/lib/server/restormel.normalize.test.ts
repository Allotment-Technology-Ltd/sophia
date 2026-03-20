import { describe, expect, it } from 'vitest';
import { normalizeRestormelBaseUrl } from './restormel';

describe('normalizeRestormelBaseUrl', () => {
  it('defaults empty to keys dashboard', () => {
    expect(normalizeRestormelBaseUrl('')).toBe('https://restormel.dev/keys/dashboard');
  });

  it('keeps full keys dashboard path', () => {
    expect(normalizeRestormelBaseUrl('https://restormel.dev/keys/dashboard')).toBe(
      'https://restormel.dev/keys/dashboard'
    );
  });

  it('strips trailing /api from keys dashboard', () => {
    expect(normalizeRestormelBaseUrl('https://restormel.dev/keys/dashboard/api')).toBe(
      'https://restormel.dev/keys/dashboard'
    );
  });

  it('rewrites bare restormel.dev origin to keys dashboard', () => {
    expect(normalizeRestormelBaseUrl('https://restormel.dev')).toBe(
      'https://restormel.dev/keys/dashboard'
    );
    expect(normalizeRestormelBaseUrl('https://restormel.dev/')).toBe(
      'https://restormel.dev/keys/dashboard'
    );
  });

  it('rewrites restormel.dev/api mistake to keys dashboard', () => {
    expect(normalizeRestormelBaseUrl('https://restormel.dev/api')).toBe(
      'https://restormel.dev/keys/dashboard'
    );
  });

  it('rewrites subdomain bare origin', () => {
    expect(normalizeRestormelBaseUrl('https://app.restormel.dev')).toBe(
      'https://app.restormel.dev/keys/dashboard'
    );
  });

  it('does not rewrite non-bare paths on restormel.dev', () => {
    expect(normalizeRestormelBaseUrl('https://restormel.dev/other')).toBe(
      'https://restormel.dev/other'
    );
  });
});
