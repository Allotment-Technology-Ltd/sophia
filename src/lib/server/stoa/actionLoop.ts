import type { StanceType } from './types';
import type { ActionLoopTimeframe, ActionSuggestion } from './types';

export interface ActionLoopPlan {
  today: string;
  tonight: string;
  thisWeek: string;
  followUpPrompt: string;
}

const ACTION_PATTERNS: Array<{ regex: RegExp; timeframe?: ActionLoopTimeframe }> = [
  { regex: /\b(today|this afternoon)\b/i, timeframe: 'today' },
  { regex: /\b(tonight|this evening)\b/i, timeframe: 'tonight' },
  { regex: /\b(this week|over the week)\b/i, timeframe: 'this_week' },
  { regex: /\b(write|call|schedule|practice|prepare|review|journal|ask|draft|plan)\b/i }
];

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

function inferTimeframe(sentence: string): ActionLoopTimeframe {
  const low = sentence.toLowerCase();
  if (low.includes('tonight') || low.includes('evening')) return 'tonight';
  if (low.includes('today') || low.includes('now')) return 'today';
  if (low.includes('this week') || low.includes('week')) return 'this_week';
  return 'this_week';
}

function confidenceForSentence(sentence: string): number {
  const strongVerb = /\b(write|call|schedule|practice|review|journal|draft|prepare)\b/i.test(sentence);
  const explicitTime = /\b(today|tonight|this week|now|tomorrow)\b/i.test(sentence);
  if (strongVerb && explicitTime) return 0.86;
  if (strongVerb) return 0.72;
  return 0.58;
}

export function detectActionSuggestions(responseText: string): ActionSuggestion[] {
  const sentences = responseText
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 16 && line.length <= 180);
  const matches: ActionSuggestion[] = [];
  for (const sentence of sentences) {
    const matched = ACTION_PATTERNS.some((rule) => rule.regex.test(sentence));
    if (!matched) continue;
    const normalized = sentence.replace(/\s+/g, ' ');
    matches.push({
      id: crypto.randomUUID(),
      text: normalized,
      timeframe: inferTimeframe(normalized),
      confidenceScore: confidenceForSentence(normalized),
      rationale: 'Detected practical commitment language in assistant response.'
    });
  }
  return dedupeSuggestions(matches).slice(0, 3);
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function dedupeSuggestions(items: ActionSuggestion[]): ActionSuggestion[] {
  const seen = new Set<string>();
  const deduped: ActionSuggestion[] = [];
  const sorted = [...items].sort((a, b) => b.confidenceScore - a.confidenceScore);
  for (const item of sorted) {
    const key = normalizeKey(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

