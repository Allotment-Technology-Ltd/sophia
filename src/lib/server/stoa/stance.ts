import type { ConversationTurn, StanceType } from './types';
import type { StoicFrameworkId } from './frameworks';

export interface StanceDecision {
  stance: StanceType;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  askClarifyingQuestion: boolean;
  scores: Record<StanceType, number>;
  recommendedFrameworks: StoicFrameworkId[];
  frameworkRationale: string;
}

const HOLD_MARKERS = [
  "can't",
  'cannot',
  'overwhelmed',
  'falling apart',
  'panicking',
  'anxious',
  'ashamed',
  'i do not know what to do',
  'i dont know what to do'
];

const CHALLENGE_MARKERS = [
  'obviously',
  'clearly',
  'always',
  'never',
  'they never',
  'everyone knows',
  'prove me wrong',
  'challenge me'
];

const GUIDE_MARKERS = [
  'what should i do',
  'help me decide',
  'step by step',
  'how do i prepare',
  'what now',
  'tomorrow',
  'conversation with'
];

const TEACH_MARKERS = [
  'what did stoics think',
  'what is',
  'explain',
  'framework',
  'difference between',
  'teach me'
];

const SIT_WITH_MARKERS = [
  'grief',
  'died',
  'dying',
  'death',
  'terminal',
  'chronic illness',
  'loss',
  'mourning',
  'funeral'
];

function includesAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

function topStance(scores: Record<StanceType, number>): StanceType {
  const entries = Object.entries(scores) as Array<[StanceType, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function recommendFrameworks(message: string, stance: StanceType): {
  frameworks: StoicFrameworkId[];
  rationale: string;
} {
  const low = message.toLowerCase();
  if (low.includes('control') || low.includes('cannot') || low.includes("can't")) {
    return {
      frameworks: ['dichotomy_of_control', 'discipline_of_impression'],
      rationale: 'Distinguishing what is and is not up to the user is the clearest stabilizer.'
    };
  }
  if (low.includes('fear') || low.includes('anxiety') || low.includes('worry')) {
    return {
      frameworks: ['premeditatio_malorum', 'reserve_clause'],
      rationale: 'Anxiety-heavy prompts benefit from obstacle rehearsal and conditional commitment.'
    };
  }
  if (stance === 'sit_with' || low.includes('grief') || low.includes('loss')) {
    return {
      frameworks: ['amor_fati', 'sympatheia'],
      rationale: 'Acceptance plus shared-humanity framing keeps difficult emotional work grounded.'
    };
  }
  if (stance === 'guide') {
    return {
      frameworks: ['discipline_of_impression', 'three_disciplines'],
      rationale: 'Action-oriented turns need impression checks plus practical discipline sequencing.'
    };
  }
  if (stance === 'teach') {
    return {
      frameworks: ['three_disciplines', 'dichotomy_of_control'],
      rationale: 'Conceptual requests benefit from a canonical Stoic structure with control framing.'
    };
  }
  return {
    frameworks: ['dichotomy_of_control'],
    rationale: 'Defaulting to control framing keeps early guidance clear and actionable.'
  };
}

export function detectStance(params: {
  message: string;
  history?: ConversationTurn[];
}): StanceDecision {
  const message = params.message.toLowerCase().trim();
  const history = params.history ?? [];
  const scores: Record<StanceType, number> = {
    hold: 0,
    challenge: 0,
    guide: 0,
    teach: 0,
    sit_with: 0
  };
  if (includesAny(message, SIT_WITH_MARKERS)) scores.sit_with += 4;
  if (includesAny(message, HOLD_MARKERS)) scores.hold += 3;
  if (includesAny(message, GUIDE_MARKERS)) scores.guide += 2;
  if (includesAny(message, CHALLENGE_MARKERS)) scores.challenge += 2;
  if (includesAny(message, TEACH_MARKERS)) scores.teach += 2;

  if (includesAny(message, SIT_WITH_MARKERS)) {
    const recommendation = recommendFrameworks(message, 'sit_with');
    return {
      stance: 'sit_with',
      confidence: 'high',
      reason: 'Detected severe hardship/grief language.',
      askClarifyingQuestion: false,
      scores,
      recommendedFrameworks: recommendation.frameworks,
      frameworkRationale: recommendation.rationale
    };
  }

  if (includesAny(message, HOLD_MARKERS)) {
    const recommendation = recommendFrameworks(message, 'hold');
    return {
      stance: 'hold',
      confidence: 'high',
      reason: 'Detected distress/overwhelm markers.',
      askClarifyingQuestion: false,
      scores,
      recommendedFrameworks: recommendation.frameworks,
      frameworkRationale: recommendation.rationale
    };
  }

  if (includesAny(message, GUIDE_MARKERS)) {
    const recommendation = recommendFrameworks(message, 'guide');
    return {
      stance: 'guide',
      confidence: 'medium',
      reason: 'Detected practical next-step language.',
      askClarifyingQuestion: false,
      scores,
      recommendedFrameworks: recommendation.frameworks,
      frameworkRationale: recommendation.rationale
    };
  }

  if (includesAny(message, CHALLENGE_MARKERS)) {
    const recommendation = recommendFrameworks(message, 'challenge');
    return {
      stance: 'challenge',
      confidence: 'medium',
      reason: 'Detected overconfident or pushback-seeking language.',
      askClarifyingQuestion: false,
      scores,
      recommendedFrameworks: recommendation.frameworks,
      frameworkRationale: recommendation.rationale
    };
  }

  if (includesAny(message, TEACH_MARKERS)) {
    const recommendation = recommendFrameworks(message, 'teach');
    return {
      stance: 'teach',
      confidence: 'medium',
      reason: 'Detected conceptual inquiry language.',
      askClarifyingQuestion: false,
      scores,
      recommendedFrameworks: recommendation.frameworks,
      frameworkRationale: recommendation.rationale
    };
  }

  const lastAgentStance = history
    .slice()
    .reverse()
    .find((turn) => turn.role === 'agent' && turn.stance)?.stance;

  if (lastAgentStance) {
    const recommendation = recommendFrameworks(message, lastAgentStance);
    return {
      stance: lastAgentStance,
      confidence: 'low',
      reason: 'No strong marker found; reusing prior stance as default.',
      askClarifyingQuestion: true,
      scores,
      recommendedFrameworks: recommendation.frameworks,
      frameworkRationale: recommendation.rationale
    };
  }

  const fallbackStance = topStance(scores);
  const recommendation = recommendFrameworks(message, fallbackStance);
  return {
    stance: fallbackStance,
    confidence: 'low',
    reason: 'No strong marker found; defaulting to hold.',
    askClarifyingQuestion: true,
    scores,
    recommendedFrameworks: recommendation.frameworks,
    frameworkRationale: recommendation.rationale
  };
}

