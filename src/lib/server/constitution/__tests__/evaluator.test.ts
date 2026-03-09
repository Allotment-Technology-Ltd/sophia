import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import {
  checkContradictionAwareness,
  checkEvidenceRequirement,
  checkNormativeBridge,
  checkSourceDiversity,
  evaluateConstitution
} from '../evaluator';
import { deterministicFixtures } from './fixtures/deterministic-fixtures';

vi.mock('ai', () => ({
  generateText: vi.fn()
}));

vi.mock('$lib/server/vertex', () => ({
  getReasoningModel: vi.fn(() => 'mock-reasoning-model'),
  trackTokens: vi.fn()
}));

const mockedGenerateText = vi.mocked(generateText);

describe('constitution deterministic checks', () => {
  it('Rule 1: empirical claim with no support is violated', () => {
    const fixture = deterministicFixtures.evidence_requirement_violation;
    const evaluation = checkEvidenceRequirement(fixture.claims, fixture.relations);

    expect(evaluation.rule_id).toBe('evidence_requirement');
    expect(evaluation.status).toBe('violated');
    expect(evaluation.severity).toBe('critical');
    expect(evaluation.affected_claim_ids).toContain('c_empirical_no_support');
  });

  it('Rule 3: contradiction with explicit qualification is satisfied', () => {
    const fixture = deterministicFixtures.contradiction_addressed;
    const evaluation = checkContradictionAwareness(fixture.claims, fixture.relations);

    expect(evaluation.rule_id).toBe('contradiction_awareness');
    expect(evaluation.status).toBe('satisfied');
  });

  it('Rule 9: normative claim depending only on empirical premise is violated', () => {
    const fixture = deterministicFixtures.normative_bridge_violation;
    const evaluation = checkNormativeBridge(fixture.claims, fixture.relations);

    expect(evaluation.rule_id).toBe('normative_bridge_requirement');
    expect(evaluation.status).toBe('violated');
    expect(evaluation.affected_claim_ids).toContain('c_normative');
  });

  it('Rule 10: broad claim from a single source is violated with info severity', () => {
    const fixture = deterministicFixtures.source_diversity_violation;
    const evaluation = checkSourceDiversity(fixture.claims, fixture.relations);

    expect(evaluation.rule_id).toBe('source_diversity');
    expect(evaluation.status).toBe('violated');
    expect(evaluation.severity).toBe('info');
    expect(evaluation.affected_claim_ids).toContain('c_broad');
  });
});

describe('evaluateConstitution', () => {
  beforeEach(() => {
    mockedGenerateText.mockReset();
  });

  it('uses one LLM batch call for non-deterministic rules and merges all 10 rule outputs', async () => {
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify([
        {
          rule_id: 'proportional_evidence',
          status: 'uncertain',
          affected_claim_ids: ['c_causal'],
          rationale: 'Scope is broad but evidence quality cannot be fully assessed from extraction data.'
        },
        {
          rule_id: 'alternative_hypotheses',
          status: 'satisfied',
          affected_claim_ids: [],
          rationale: 'Alternative explanatory paths are represented in the extracted structure.'
        },
        {
          rule_id: 'assumption_transparency',
          status: 'violated',
          affected_claim_ids: ['c_causal'],
          rationale: 'The argument relies on unstated assumptions about intervention context.',
          remediation: 'Surface key assumptions and state how conclusions depend on them.'
        },
        {
          rule_id: 'uncertainty_signalling',
          status: 'not_applicable',
          affected_claim_ids: [],
          rationale: 'No synthesis tone signal is available in this extraction-only payload.'
        }
      ]),
      usage: {
        inputTokens: 120,
        outputTokens: 210
      }
    } as never);

    const fixture = deterministicFixtures.hybrid_batch;
    const result = await evaluateConstitution(fixture.claims, fixture.relations, fixture.text);

    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
    expect(result.rules_evaluated).toBe(10);
    expect(result.violated.some((entry) => entry.rule_id === 'assumption_transparency')).toBe(true);
    expect(result.satisfied.some((entry) => entry.rule_id === 'alternative_hypotheses')).toBe(true);
    expect(result.uncertain.some((entry) => entry.rule_id === 'proportional_evidence')).toBe(true);
    expect(result.not_applicable.some((entry) => entry.rule_id === 'uncertainty_signalling')).toBe(true);
  });
});
