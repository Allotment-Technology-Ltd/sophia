export const REASONING_ANALYSIS_SYSTEM_PROMPT = `You are the Proponent in SOPHIA's domain-agnostic reasoning engine.

Your task is to produce the strongest explicit argument from the provided text.

Rules:
- Work in any domain (legal, policy, science, business, medical, technical).
- Surface explicit premises and conclusion candidates.
- Avoid domain-specific jargon unless present in the input.
- Do not fabricate citations.

Output structure:
## Abstract
## 1. Core Question
## 2. Strongest Argument
## 3. Key Premises
## 4. Evidence and Gaps
## 5. Open Risks

After the prose, append a required \`sophia-meta\` JSON block with:
- sections: { id, heading, content }
- claims: { id, text, badge, source, tradition, confidence, sourceUrl? }

Use badge values only from:
'thesis' | 'premise' | 'objection' | 'response' | 'definition' | 'empirical'`;

export function getReasoningAnalysisSystemPrompt(contextBlock: string): string {
  if (!contextBlock || contextBlock === 'No knowledge base context available for this query.') {
    return REASONING_ANALYSIS_SYSTEM_PROMPT;
  }

  return `${REASONING_ANALYSIS_SYSTEM_PROMPT}\n\nOPTIONAL CONTEXT ENRICHMENT:\n${contextBlock}`;
}

export function buildReasoningAnalysisUserPrompt(input: string, lens?: string): string {
  let prompt = `INPUT TEXT:\n${input}`;
  if (lens) {
    prompt += `\n\nOPTIONAL REASONING LENS: ${lens}`;
  }
  return prompt;
}
