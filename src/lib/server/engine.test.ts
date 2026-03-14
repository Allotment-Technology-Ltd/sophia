import { describe, it, expect } from 'vitest';
import {
  extractSophiaMetaBlock,
  aggregateConfidenceMetrics,
  SophiaMetaBlockSchema,
  SophiaMetaClaimSchema
} from './engine';
import type { Claim } from '$lib/types/references';

// ─── extractSophiaMetaBlock ────────────────────────────────────────────────

describe('extractSophiaMetaBlock', () => {
  const validMeta = JSON.stringify({
    sections: [{ id: 'abstract', heading: 'Abstract', content: 'Summary of argument.' }],
    claims: [
      {
        id: 'c1',
        text: 'Moral realism holds that moral facts exist independently of minds.',
        badge: 'premise',
        source: 'Parfit, Reasons and Persons · 1984',
        tradition: 'Analytic Ethics',
        confidence: 0.9,
      },
    ],
  });

  it('returns null metaBlock when no sophia-meta fence is present', () => {
    const text = '## Abstract\n\nSome philosophical argument.\n\n## 1. Analysis\n\nContent here.';
    const { cleanedText, metaBlock } = extractSophiaMetaBlock(text);
    expect(metaBlock).toBeNull();
    expect(cleanedText).toBe(text);
  });

  it('extracts and validates a well-formed sophia-meta block', () => {
    const text = `## Abstract\n\nContent.\n\n\`\`\`sophia-meta\n${validMeta}\n\`\`\``;
    const { cleanedText, metaBlock } = extractSophiaMetaBlock(text);

    expect(metaBlock).not.toBeNull();
    expect(metaBlock!.sections).toHaveLength(1);
    expect(metaBlock!.sections[0].id).toBe('abstract');
    expect(metaBlock!.claims).toHaveLength(1);
    expect(metaBlock!.claims[0].confidence).toBe(0.9);
  });

  it('removes the sophia-meta block from cleanedText', () => {
    const text = `## Abstract\n\nContent.\n\n\`\`\`sophia-meta\n${validMeta}\n\`\`\``;
    const { cleanedText } = extractSophiaMetaBlock(text);
    expect(cleanedText).not.toContain('sophia-meta');
    expect(cleanedText).toContain('Content.');
  });

  it('returns null metaBlock when JSON is malformed', () => {
    const text = '## Abstract\n\nContent.\n\n```sophia-meta\n{invalid json\n```';
    const { cleanedText, metaBlock } = extractSophiaMetaBlock(text);
    expect(metaBlock).toBeNull();
    expect(cleanedText).toBe(text); // original text preserved
  });

  it('returns null metaBlock when schema validation fails', () => {
    const badMeta = JSON.stringify({
      sections: [],
      claims: [{ id: 'c1', badge: 'not-a-valid-badge' }], // missing required fields
    });
    const text = `Content.\n\`\`\`sophia-meta\n${badMeta}\n\`\`\``;
    const { metaBlock } = extractSophiaMetaBlock(text);
    expect(metaBlock).toBeNull();
  });

  it('accepts an optional sourceUrl on claims', () => {
    const metaWithUrl = JSON.stringify({
      sections: [],
      claims: [
        {
          id: 'c1',
          text: 'Claim text.',
          badge: 'premise',
          source: 'SEP',
          tradition: 'Analytic',
          confidence: 0.85,
          sourceUrl: 'https://plato.stanford.edu/entries/moral-realism/',
        },
      ],
    });
    const text = `Content.\n\`\`\`sophia-meta\n${metaWithUrl}\n\`\`\``;
    const { metaBlock } = extractSophiaMetaBlock(text);
    expect(metaBlock).not.toBeNull();
    expect(metaBlock!.claims[0].sourceUrl).toBe('https://plato.stanford.edu/entries/moral-realism/');
  });

  it('rejects a claim with an invalid sourceUrl', () => {
    const metaWithBadUrl = JSON.stringify({
      sections: [],
      claims: [
        {
          id: 'c1',
          text: 'Claim text.',
          badge: 'premise',
          source: 'SEP',
          tradition: 'Analytic',
          confidence: 0.85,
          sourceUrl: 'not-a-url',
        },
      ],
    });
    const text = `Content.\n\`\`\`sophia-meta\n${metaWithBadUrl}\n\`\`\``;
    const { metaBlock } = extractSophiaMetaBlock(text);
    expect(metaBlock).toBeNull();
  });

  it('uses default empty arrays when sections/claims are omitted', () => {
    const minimal = JSON.stringify({});
    const text = `Content.\n\`\`\`sophia-meta\n${minimal}\n\`\`\``;
    const { metaBlock } = extractSophiaMetaBlock(text);
    expect(metaBlock).not.toBeNull();
    expect(metaBlock!.sections).toEqual([]);
    expect(metaBlock!.claims).toEqual([]);
    expect(metaBlock!.relations).toEqual([]);
  });

  it('accepts claim back references and relation bundles', () => {
    const metaWithRelations = JSON.stringify({
      sections: [{ id: 'summary', heading: 'Summary', content: 'Summary content.' }],
      claims: [
        {
          id: 'c1',
          text: 'A foundational claim.',
          badge: 'premise',
          source: 'SEP',
          tradition: 'Analytic',
          confidence: 0.8,
          backRefIds: ['claim:seed-1']
        },
        {
          id: 'c2',
          text: 'A conclusion.',
          badge: 'thesis',
          source: 'SEP',
          tradition: 'Analytic',
          confidence: 0.75
        }
      ],
      relations: [
        {
          claimId: 'c1',
          relations: [{ type: 'supports', target: 'c2', label: 'grounds the conclusion' }]
        }
      ]
    });
    const text = `Content.\n\`\`\`sophia-meta\n${metaWithRelations}\n\`\`\``;
    const { metaBlock } = extractSophiaMetaBlock(text);
    expect(metaBlock).not.toBeNull();
    expect(metaBlock!.claims[0].backRefIds).toEqual(['claim:seed-1']);
    expect(metaBlock!.relations).toHaveLength(1);
    expect(metaBlock!.relations[0].relations[0].type).toBe('supports');
  });
});

// ─── SophiaMetaBlockSchema ────────────────────────────────────────────────

describe('SophiaMetaBlockSchema', () => {
  it('defaults missing relations and claim backRefIds', () => {
    const result = SophiaMetaBlockSchema.safeParse({
      claims: [
        {
          id: 'c1',
          text: 'Claim text.',
          badge: 'premise',
          source: 'SEP',
          tradition: 'Analytic',
          confidence: 0.8
        }
      ]
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.relations).toEqual([]);
    expect(result.data.claims[0].backRefIds).toEqual([]);
  });
});

// ─── SophiaMetaClaimSchema ─────────────────────────────────────────────────

describe('SophiaMetaClaimSchema', () => {
  const validClaim = {
    id: 'c1',
    text: 'Moral facts are mind-independent.',
    badge: 'premise' as const,
    source: 'Parfit · 1984',
    tradition: 'Analytic Ethics',
    confidence: 0.85,
  };

  it('accepts all valid badge variants', () => {
    const badges = ['thesis', 'premise', 'objection', 'response', 'definition', 'empirical'] as const;
    for (const badge of badges) {
      const result = SophiaMetaClaimSchema.safeParse({ ...validClaim, badge });
      expect(result.success, `badge="${badge}" should be valid`).toBe(true);
    }
  });

  it('rejects an unknown badge', () => {
    const result = SophiaMetaClaimSchema.safeParse({ ...validClaim, badge: 'speculation' });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0–1', () => {
    expect(SophiaMetaClaimSchema.safeParse({ ...validClaim, confidence: -0.1 }).success).toBe(false);
    expect(SophiaMetaClaimSchema.safeParse({ ...validClaim, confidence: 1.1 }).success).toBe(false);
  });

  it('accepts confidence at boundary values 0 and 1', () => {
    expect(SophiaMetaClaimSchema.safeParse({ ...validClaim, confidence: 0 }).success).toBe(true);
    expect(SophiaMetaClaimSchema.safeParse({ ...validClaim, confidence: 1 }).success).toBe(true);
  });

  it('makes sourceUrl optional', () => {
    const withoutUrl = SophiaMetaClaimSchema.safeParse(validClaim);
    expect(withoutUrl.success).toBe(true);
    expect((withoutUrl as any).data.sourceUrl).toBeUndefined();
  });
});

// ─── aggregateConfidenceMetrics ────────────────────────────────────────────

describe('aggregateConfidenceMetrics', () => {
  const makeClaimsWithConfidence = (confidences: (number | undefined)[]): Claim[] =>
    confidences.map((confidence, i) => ({
      id: `c${i}`,
      text: `Claim ${i}`,
      badge: 'premise' as const,
      source: 'Test',
      tradition: 'Test',
      confidence,
      phase: 'analysis' as const,
      detail: `Detail ${i}`,
    }));

  it('returns zeros when given an empty array', () => {
    const result = aggregateConfidenceMetrics([]);
    expect(result).toEqual({ avgConfidence: 0, lowConfidenceCount: 0, totalClaims: 0 });
  });

  it('ignores claims with undefined confidence', () => {
    const claims = makeClaimsWithConfidence([undefined, undefined]);
    const result = aggregateConfidenceMetrics(claims);
    expect(result.totalClaims).toBe(0);
    expect(result.avgConfidence).toBe(0);
  });

  it('computes correct average confidence', () => {
    const claims = makeClaimsWithConfidence([0.8, 0.6, 1.0]);
    const result = aggregateConfidenceMetrics(claims);
    expect(result.totalClaims).toBe(3);
    expect(result.avgConfidence).toBeCloseTo(0.8);
  });

  it('counts low-confidence claims (< 0.7) correctly', () => {
    const claims = makeClaimsWithConfidence([0.9, 0.65, 0.5, 0.3]);
    const result = aggregateConfidenceMetrics(claims);
    expect(result.lowConfidenceCount).toBe(3); // 0.65, 0.5, 0.3 are all < 0.7
  });

  it('does not count claims at exactly 0.7 as low confidence', () => {
    const claims = makeClaimsWithConfidence([0.7]);
    const result = aggregateConfidenceMetrics(claims);
    expect(result.lowConfidenceCount).toBe(0);
  });

  it('mixes defined and undefined confidence, only counting defined', () => {
    const claims = makeClaimsWithConfidence([0.9, undefined, 0.5]);
    const result = aggregateConfidenceMetrics(claims);
    expect(result.totalClaims).toBe(2);
    expect(result.avgConfidence).toBeCloseTo(0.7);
    expect(result.lowConfidenceCount).toBe(1); // 0.5 < 0.7
  });
});
