const CRISIS_MARKERS = [
  'suicidal',
  'kill myself',
  'end my life',
  'want to die',
  'self harm',
  'hurt myself',
  'no reason to live',
  'i might do something to myself'
];

function includesAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

export function detectCrisisRisk(message: string): boolean {
  return includesAny(message.toLowerCase(), CRISIS_MARKERS);
}

export function buildCrisisSupportMessage(): string {
  return [
    "I'm really glad you told me this. What you're carrying sounds serious, and you deserve immediate real support.",
    'I am not a substitute for professional crisis care.',
    'If you might act on these thoughts, please contact emergency support now:',
    '- US/Canada: call or text 988',
    '- UK/Ireland: Samaritans 116 123',
    "- If you're elsewhere, tell me your location and I'll help find the right crisis line.",
    'If possible, reach out to a trusted person near you right now and let them know you need support.',
    'If you want, I can stay with you while you take that next step.'
  ].join('\n');
}

export function detectSuppressionMisuse(message: string): boolean {
  const low = message.toLowerCase();
  const hasDenialFrame =
    low.includes('i should not feel') ||
    low.includes('i shouldnt feel') ||
    low.includes('feel nothing') ||
    low.includes('just suppress') ||
    low.includes('ignore my feelings');
  const hasStoicLabel = low.includes('stoic') || low.includes('stoicism');
  return hasStoicLabel && hasDenialFrame;
}

