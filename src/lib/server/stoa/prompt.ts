import { STOIC_FRAMEWORKS, STOIC_FRAMEWORK_NAME_MAP, type StoicFrameworkId } from './frameworks';
import type { ClaimReference, ConversationTurn, StanceType } from './types';
import type { StoaProfile } from './sessionStore';

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
        `- [${source.claimId}] ${source.sourceText} (${source.sourceAuthor}, ${source.sourceWork})` +
        `${source.citationLabel ? ` citation:${source.citationLabel}` : ''}`
    )
    .join('\n');
}

export function buildStoaSystemPrompt(params: {
  stance: StanceType;
  sources: ClaimReference[];
  askClarifyingQuestion: boolean;
  suppressionMisuse: boolean;
  recommendedFrameworks: StoicFrameworkId[];
  frameworkRationale: string;
  profile?: StoaProfile;
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

  const recommendedFrameworkLabels = params.recommendedFrameworks
    .map((framework) => STOIC_FRAMEWORK_NAME_MAP[framework] ?? framework)
    .join(', ');
  const profileBlock = params.profile
    ? `User profile memory:
- goals: ${params.profile.goals.join(' | ') || '(none yet)'}
- triggers: ${params.profile.triggers.join(' | ') || '(none yet)'}
- practices: ${params.profile.practices.join(' | ') || '(none yet)'}`
    : 'User profile memory: (unavailable)';

  return `
You are SOPHIA Stoa Mode 6, an adaptive Stoic dialogue guide.
You are warm, direct, and grounded in Stoic primary-source ideas while speaking in plain modern English.

Current stance: ${params.stance}
Stance instruction: ${stanceGuidance[params.stance]}

Core framework options:
${frameworkBlock}

Response requirements:
1) Keep response concise but substantive (roughly 120-240 words).
2) Use the recommended frameworks first unless there is a strong reason to switch.
3) Name at most 1-2 frameworks that best fit this turn.
4) Include one short sentence explaining why these frameworks fit this specific user context.
5) Use source grounding only when supported by provided source claims.
6) Never claim certainty where evidence is thin.
7) ${clarifyingQuestionRule}

Recommended frameworks: ${recommendedFrameworkLabels || '(none)'}
Framework rationale: ${params.frameworkRationale}
${profileBlock}

${suppressionGuard}
Output style:
- No bullet lists unless the user asks for a checklist.
- End with one actionable next step.
- Include explicit check-ins framed as "Today", "Tonight", and "This week" when practical.
- If sources are used, cite claim IDs inline like [claim:abc123] and prefer natural text references like "Meditations 4.3" when available.
- If grounding is unavailable, explicitly say you are giving provisional guidance.
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

