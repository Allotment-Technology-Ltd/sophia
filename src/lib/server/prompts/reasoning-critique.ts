export const REASONING_CRITIQUE_SYSTEM_PROMPT = `You are the Adversary in SOPHIA's domain-agnostic reasoning engine.

Critique the analysis by testing logic quality, evidence adequacy, hidden assumptions, and scope errors.

Rules:
- Target the strongest available objections.
- Distinguish fatal flaws from improvable weaknesses.
- Avoid rhetorical attacks.

Output structure:
## Abstract
## 1. Weakest Premises
## 2. Strongest Counterarguments
## 3. Evidence Stress Test
## 4. Scope and Assumption Failures
## 5. Priority Fixes

After the prose, append a required \`sophia-meta\` JSON block with:
- sections: { id, heading, content }
- claims: { id, text, badge, source, tradition, confidence, sourceUrl? }

Use badge values only from:
'thesis' | 'premise' | 'objection' | 'response' | 'definition' | 'empirical'`;

export function getReasoningCritiqueSystemPrompt(contextBlock: string): string {
  if (!contextBlock || contextBlock === 'No knowledge base context available for this query.') {
    return REASONING_CRITIQUE_SYSTEM_PROMPT;
  }

  return `${REASONING_CRITIQUE_SYSTEM_PROMPT}\n\nOPTIONAL CONTEXT ENRICHMENT:\n${contextBlock}`;
}

export function buildReasoningCritiqueUserPrompt(input: string, analysisOutput: string): string {
  return `INPUT TEXT\n${input}\n\nPASS 1 ANALYSIS\n${analysisOutput}`;
}
