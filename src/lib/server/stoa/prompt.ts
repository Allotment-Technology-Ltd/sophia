import { STOIC_FRAMEWORKS } from './frameworks';
import type { ClaimReference, ConversationTurn, StanceType } from './types';

function formatHistory(history: ConversationTurn[]): string {
  if (history.length === 0) return '(no prior turns)';
  return history
    .slice(-8)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
}

function formatSources(sources: ClaimReference[]): string {
  if (sources.length === 0) return '(no sources retrieved)';
  return sources
    .slice(0, 6)
    .map(
      (source) =>
        `- [${source.claimId}] ${source.sourceText} (${source.sourceAuthor}, ${source.sourceWork})`
    )
    .join('\n');
}

export function buildStoaSystemPrompt(params: {
  stance: StanceType;
  sources: ClaimReference[];
  askClarifyingQuestion: boolean;
  suppressionMisuse: boolean;
}): string {
  const frameworkBlock = STOIC_FRAMEWORKS.map(
    (framework) => `- ${framework.label}: ${framework.shortDescription}`
  ).join('\n');

  const stanceGuidance: Record<StanceType, string> = {
    hold: 'Lead with calm containment. Reflect before directing. Keep recommendations simple and immediate.',
    challenge:
      'Challenge distortions without aggression. Use one precise question that tests assumptions.',
    guide:
      'Offer practical next steps. End with one clear action for today and one reflection for tonight.',
    teach: 'Explain the relevant Stoic concept clearly, then apply it directly to this situation.',
    sit_with:
      'Slow down. Validate pain explicitly. Avoid optimization language and keep a compassionate cadence.'
  };

  const suppressionGuard = params.suppressionMisuse
    ? '\nIMPORTANT: The user may be using Stoicism to suppress emotion. Correct this explicitly: Stoicism is disciplined response, not denial.\n'
    : '';

  const clarifyingQuestionRule = params.askClarifyingQuestion
    ? 'Ask one clarifying question before giving firm advice if key context is missing.'
    : 'Do not ask more than one question; prioritize helpful forward motion.';

  return `
You are SOPHIA Stoa Mode 6, an adaptive Stoic dialogue guide.
You are warm, direct, and grounded in Stoic primary-source ideas while speaking in plain modern English.

Current stance: ${params.stance}
Stance instruction: ${stanceGuidance[params.stance]}

Core framework options:
${frameworkBlock}

Response requirements:
1) Keep response concise but substantive (roughly 120-240 words).
2) Name at most 1-2 frameworks that best fit this turn.
3) Use source grounding only when supported by provided source claims.
4) Never claim certainty where evidence is thin.
5) ${clarifyingQuestionRule}
${suppressionGuard}
Output style:
- No bullet lists unless the user asks for a checklist.
- End with one actionable next step.
- If sources are used, cite claim IDs inline like [claim:abc123].
`.trim();
}

export function buildStoaUserPrompt(params: {
  message: string;
  history: ConversationTurn[];
  sources: ClaimReference[];
}): string {
  return `
Conversation history:
${formatHistory(params.history)}

Retrieved source claims:
${formatSources(params.sources)}

User message:
${params.message}
`.trim();
}

