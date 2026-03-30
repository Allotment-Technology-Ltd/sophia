import type { StanceType } from './types';

export interface ActionLoopPlan {
  today: string;
  tonight: string;
  thisWeek: string;
  followUpPrompt: string;
}

function fallbackForStance(stance: StanceType): ActionLoopPlan {
  switch (stance) {
    case 'sit_with':
      return {
        today: 'Take one 10-minute decompression walk and name what you feel without judging it.',
        tonight: 'Write three sentences: what hurt, what mattered, and what you can carry forward.',
        thisWeek: 'Practice one short morning check-in and one evening reflection daily.',
        followUpPrompt: 'Would you like help turning this into a gentler version if today is heavy?'
      };
    case 'challenge':
      return {
        today: 'Identify one assumption and test it with one concrete counterexample.',
        tonight: 'Journal one belief that shifted and what evidence changed it.',
        thisWeek: 'Run a daily 5-minute thought audit on recurring distortions.',
        followUpPrompt: 'Which recurring thought should we challenge next?'
      };
    default:
      return {
        today: 'Pick one controllable action and complete it before the end of the day.',
        tonight: 'Review what was in your control and what was not.',
        thisWeek: 'Repeat one small Stoic practice each day and track completion.',
        followUpPrompt: 'Should I set up tomorrow’s next single step now?'
      };
  }
}

export function buildActionLoop(params: { responseText: string; stance: StanceType }): ActionLoopPlan {
  const compact = params.responseText.replace(/\s+/g, ' ').trim();
  const defaultPlan = fallbackForStance(params.stance);
  if (!compact) return defaultPlan;
  return {
    ...defaultPlan,
    today: defaultPlan.today,
    tonight: defaultPlan.tonight,
    thisWeek: defaultPlan.thisWeek
  };
}

