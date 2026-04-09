import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIngestProviderTpmGuard } from './ingestProviderTpm.js';

describe('createIngestProviderTpmGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.INGEST_PROVIDER_TPM_BUDGET;
    delete process.env.INGEST_PROVIDER_TPM_WINDOW_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not throttle when INGEST_PROVIDER_TPM_BUDGET is unset', async () => {
    const g = createIngestProviderTpmGuard();
    await expect(g.waitForBudget('openai', 1_000_000)).resolves.toBeUndefined();
  });

  it('waits until the rolling window frees capacity', async () => {
    process.env.INGEST_PROVIDER_TPM_BUDGET = 'acme:1000';
    process.env.INGEST_PROVIDER_TPM_WINDOW_MS = '10000';
    const g = createIngestProviderTpmGuard();
    g.recordUsage('acme', 900);
    const p = g.waitForBudget('acme', 200);
    vi.advanceTimersByTime(10_001);
    await p;
    await expect(g.waitForBudget('acme', 200)).resolves.toBeUndefined();
  });
});
