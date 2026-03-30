import type { ConversationTurn, StanceType } from './types';

interface StanceDecision {
  stance: StanceType;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  askClarifyingQuestion: boolean;
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

export function detectStance(params: {
  message: string;
  history?: ConversationTurn[];
}): StanceDecision {
  const message = params.message.toLowerCase().trim();
  const history = params.history ?? [];

  if (includesAny(message, SIT_WITH_MARKERS)) {
    return {
      stance: 'sit_with',
      confidence: 'high',
      reason: 'Detected severe hardship/grief language.',
      askClarifyingQuestion: false
    };
  }

  if (includesAny(message, HOLD_MARKERS)) {
    return {
      stance: 'hold',
      confidence: 'high',
      reason: 'Detected distress/overwhelm markers.',
      askClarifyingQuestion: false
    };
  }

  if (includesAny(message, GUIDE_MARKERS)) {
    return {
      stance: 'guide',
      confidence: 'medium',
      reason: 'Detected practical next-step language.',
      askClarifyingQuestion: false
    };
  }

  if (includesAny(message, CHALLENGE_MARKERS)) {
    return {
      stance: 'challenge',
      confidence: 'medium',
      reason: 'Detected overconfident or pushback-seeking language.',
      askClarifyingQuestion: false
    };
  }

  if (includesAny(message, TEACH_MARKERS)) {
    return {
      stance: 'teach',
      confidence: 'medium',
      reason: 'Detected conceptual inquiry language.',
      askClarifyingQuestion: false
    };
  }

  const lastAgentStance = history
    .slice()
    .reverse()
    .find((turn) => turn.role === 'agent' && turn.stance)?.stance;

  if (lastAgentStance) {
    return {
      stance: lastAgentStance,
      confidence: 'low',
      reason: 'No strong marker found; reusing prior stance as default.',
      askClarifyingQuestion: true
    };
  }

  return {
    stance: 'hold',
    confidence: 'low',
    reason: 'No strong marker found; defaulting to hold.',
    askClarifyingQuestion: true
  };
}

