import { describe, expect, it } from 'vitest';
import {
  detectCorpusLevelQuery,
  extractLexicalTerms,
  fuseHybridCandidates,
  type HybridCandidate
} from './hybridCandidateGeneration';

const claim = (id: string, text: string, source: string, confidence = 0.8): HybridCandidate => ({
  id,
  text,
  source_title: source,
  confidence
});

describe('extractLexicalTerms', () => {
  it('captures key multi-word philosophical terms', () => {
    const terms = extractLexicalTerms(
      'Explain public reason and epistemic injustice in the non-identity problem.'
    );
    expect(terms).toEqual(expect.arrayContaining(['public reason', 'epistemic injustice', 'non-identity problem']));
  });
});

describe('detectCorpusLevelQuery', () => {
  it('flags corpus-level overview prompts', () => {
    expect(detectCorpusLevelQuery('Give a big picture overview across traditions of free will.')).toBe(true);
    expect(detectCorpusLevelQuery('Is lying wrong?')).toBe(false);
  });
});

describe('fuseHybridCandidates', () => {
  it('keeps lexical-only candidates when term match is strong', () => {
    const dense = [claim('d1', 'General utilitarian summary', 'A')];
    const lexical = [claim('l1', 'Public reason in Rawlsian political liberalism', 'B')];
    const fused = fuseHybridCandidates({
      dense,
      lexical,
      lexicalTerms: ['public reason'],
      poolSize: 3,
      corpusLevelQuery: false
    });
    expect(fused.ranked.map((c) => c.id)).toEqual(expect.arrayContaining(['d1', 'l1']));
  });

  it('diversifies by source when corpus-level query is detected', () => {
    const dense = [
      claim('d1', 'Overview 1', 'Source A'),
      claim('d2', 'Overview 2', 'Source A')
    ];
    const lexical = [
      claim('l1', 'Overview 3', 'Source B'),
      claim('l2', 'Overview 4', 'Source C')
    ];
    const fused = fuseHybridCandidates({
      dense,
      lexical,
      lexicalTerms: ['overview'],
      poolSize: 3,
      corpusLevelQuery: true
    });
    const sourceTitles = new Set(fused.ranked.map((c) => c.source_title));
    expect(sourceTitles.size).toBeGreaterThan(1);
  });
});
