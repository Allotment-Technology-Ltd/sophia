import { describe, expect, it } from 'vitest';
import {
  encodeIngestPinsJsonCliArg,
  modelChainLabelsToEnv,
  type IngestRunPayload
} from './ingestRuns';

describe('modelChainLabelsToEnv', () => {
  it('maps Expand labels to INGEST_PIN env keys and normalizes google to vertex', () => {
    const chain: IngestRunPayload['model_chain'] = {
      extract: 'anthropic · claude-sonnet-4-20250514',
      relate: 'google · gemini-2.5-flash',
      group: 'anthropic · claude-sonnet-4-20250514',
      validate: 'openai · gpt-4o'
    };
    const env = modelChainLabelsToEnv(chain);
    expect(env.INGEST_PIN_PROVIDER_EXTRACTION).toBe('anthropic');
    expect(env.INGEST_PIN_MODEL_EXTRACTION).toBe('claude-sonnet-4-20250514');
    expect(env.INGEST_PIN_PROVIDER_RELATIONS).toBe('vertex');
    expect(env.INGEST_PIN_MODEL_RELATIONS).toBe('gemini-2.5-flash');
    expect(env.INGEST_PIN_PROVIDER_VALIDATION).toBe('openai');
    expect(env.INGEST_PIN_MODEL_VALIDATION).toBe('gpt-4o');
  });

  it('skips unparsable or unknown provider slugs', () => {
    const env = modelChainLabelsToEnv({
      extract: 'not-a-label',
      relate: '',
      group: 'weirdco · model-x',
      validate: 'anthropic · claude-haiku-4-5-20251001'
    });
    expect(env.INGEST_PIN_PROVIDER_EXTRACTION).toBeUndefined();
    expect(env.INGEST_PIN_PROVIDER_GROUPING).toBeUndefined();
    expect(env.INGEST_PIN_PROVIDER_VALIDATION).toBe('anthropic');
  });

  it('does not emit pins for auto (Restormel + canonical defaults apply)', () => {
    const env = modelChainLabelsToEnv({
      extract: 'auto',
      relate: 'auto',
      group: 'auto',
      validate: 'auto'
    });
    expect(Object.keys(env).length).toBe(0);
  });

  it('maps admin stable ids (provider__modelId) like the ingest wizard sends in JSON', () => {
    const env = modelChainLabelsToEnv({
      extract: 'anthropic__claude-sonnet-4-20250514',
      relate: 'anthropic__claude-sonnet-4-20250514',
      group: 'anthropic__claude-sonnet-4',
      validate: 'mistral__mistral-large-latest'
    });
    expect(env.INGEST_PIN_PROVIDER_EXTRACTION).toBe('anthropic');
    expect(env.INGEST_PIN_MODEL_EXTRACTION).toBe('claude-sonnet-4-20250514');
    expect(env.INGEST_PIN_PROVIDER_RELATIONS).toBe('anthropic');
    expect(env.INGEST_PIN_MODEL_GROUPING).toBe('claude-sonnet-4');
    expect(env.INGEST_PIN_PROVIDER_VALIDATION).toBe('mistral');
    expect(env.INGEST_PIN_MODEL_VALIDATION).toBe('mistral-large-latest');
  });

  it('encodeIngestPinsJsonCliArg round-trips stable ids for CLI', () => {
    const env = modelChainLabelsToEnv({
      extract: 'anthropic__claude-sonnet-4-20250514',
      relate: 'anthropic__claude-sonnet-4-20250514',
      group: 'anthropic__claude-sonnet-4',
      validate: 'mistral__mistral-large-latest'
    });
    const b64 = encodeIngestPinsJsonCliArg(env);
    expect(b64).toBeTruthy();
    const parsed = JSON.parse(Buffer.from(b64!, 'base64url').toString('utf8')) as Record<
      string,
      { provider: string; model: string }
    >;
    expect(parsed.EXTRACTION).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    expect(parsed.VALIDATION).toEqual({ provider: 'mistral', model: 'mistral-large-latest' });
  });
});
