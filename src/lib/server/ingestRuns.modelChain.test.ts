import { describe, expect, it } from 'vitest';
import { modelChainLabelsToEnv, type IngestRunPayload } from './ingestRuns';

describe('modelChainLabelsToEnv', () => {
  it('maps Expand labels to INGEST_PIN env keys and normalizes google to vertex', () => {
    const chain: IngestRunPayload['model_chain'] = {
      extract: 'anthropic · claude-3-5-sonnet-20241022',
      relate: 'google · gemini-2.5-flash',
      group: 'anthropic · claude-3-5-sonnet-20241022',
      validate: 'openai · gpt-4o'
    };
    const env = modelChainLabelsToEnv(chain);
    expect(env.INGEST_PIN_PROVIDER_EXTRACTION).toBe('anthropic');
    expect(env.INGEST_PIN_MODEL_EXTRACTION).toBe('claude-3-5-sonnet-20241022');
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
      validate: 'anthropic · claude-3-5-haiku-20241022'
    });
    expect(env.INGEST_PIN_PROVIDER_EXTRACTION).toBeUndefined();
    expect(env.INGEST_PIN_PROVIDER_GROUPING).toBeUndefined();
    expect(env.INGEST_PIN_PROVIDER_VALIDATION).toBe('anthropic');
  });

  it('maps admin stable ids (provider__modelId) like the ingest wizard sends in JSON', () => {
    const env = modelChainLabelsToEnv({
      extract: 'anthropic__claude-3-5-sonnet-20241022',
      relate: 'anthropic__claude-3-5-sonnet-20241022',
      group: 'anthropic__claude-sonnet-4',
      validate: 'mistral__mistral-large-latest'
    });
    expect(env.INGEST_PIN_PROVIDER_EXTRACTION).toBe('anthropic');
    expect(env.INGEST_PIN_MODEL_EXTRACTION).toBe('claude-3-5-sonnet-20241022');
    expect(env.INGEST_PIN_PROVIDER_RELATIONS).toBe('anthropic');
    expect(env.INGEST_PIN_MODEL_GROUPING).toBe('claude-sonnet-4');
    expect(env.INGEST_PIN_PROVIDER_VALIDATION).toBe('mistral');
    expect(env.INGEST_PIN_MODEL_VALIDATION).toBe('mistral-large-latest');
  });
});
