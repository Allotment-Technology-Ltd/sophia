/**
 * Curated pool of example philosophical questions for the empty state.
 * Ethics-scoped for MVP, randomized on component mount to avoid repetition.
 */

export interface ExamplePrompt {
  text: string;
  domain: 'ethics' | 'philosophy_of_mind';
  lenses?: LensId[];
}

export type LensId =
  | ''
  | 'utilitarian'
  | 'deontological'
  | 'virtue_ethics'
  | 'rawlsian'
  | 'care_ethics'
  | 'physicalist'
  | 'dualist'
  | 'functionalist'
  | 'enactivist'
  | 'phenomenological';

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  // Normative ethics
  { text: 'Is morality relative or universal?', domain: 'ethics' },
  { text: 'Can lying ever be justified?', domain: 'ethics', lenses: ['deontological', 'utilitarian'] },
  { text: 'What obligations do we have to future generations?', domain: 'ethics', lenses: ['utilitarian', 'rawlsian'] },
  { text: 'Is it ethical to eat animals?', domain: 'ethics', lenses: ['utilitarian', 'care_ethics'] },
  { text: 'Does intent matter more than consequences?', domain: 'ethics', lenses: ['deontological', 'utilitarian'] },
  
  // Applied ethics
  { text: 'Should we prioritize saving identifiable lives over statistical lives?', domain: 'ethics', lenses: ['utilitarian'] },
  { text: 'Is wealth inequality inherently unjust?', domain: 'ethics', lenses: ['rawlsian'] },
  { text: 'What makes a punishment just?', domain: 'ethics' },
  { text: 'Do we have a moral duty to donate to effective charities?', domain: 'ethics', lenses: ['utilitarian', 'care_ethics'] },
  { text: 'Is it wrong to have children in a world with suffering?', domain: 'ethics' },
  
  // Virtue ethics & character
  { text: 'What makes a life meaningful?', domain: 'ethics', lenses: ['virtue_ethics'] },
  { text: 'Can virtue be taught?', domain: 'ethics', lenses: ['virtue_ethics'] },
  { text: 'Is integrity more important than compassion?', domain: 'ethics', lenses: ['virtue_ethics', 'care_ethics'] },
  { text: 'What role should emotion play in moral judgment?', domain: 'ethics', lenses: ['care_ethics', 'virtue_ethics'] },
  
  // Meta-ethics
  { text: 'Are there objective moral truths?', domain: 'ethics' },
  { text: 'Can moral disagreement ever be resolved?', domain: 'ethics' },
  { text: 'Do moral facts exist independently of human minds?', domain: 'ethics' },
  
  // Practical reasoning
  { text: 'How should we reason under moral uncertainty?', domain: 'ethics' },
  { text: 'What do we owe to people in distant countries?', domain: 'ethics', lenses: ['rawlsian', 'care_ethics'] },
  { text: 'Is there a duty to rescue strangers?', domain: 'ethics' },

  // Philosophy of Mind
  { text: 'Can consciousness be fully explained by physical processes?', domain: 'philosophy_of_mind', lenses: ['physicalist'] },
  { text: 'Is subjective experience reducible to brain states?', domain: 'philosophy_of_mind', lenses: ['physicalist', 'dualist'] },
  { text: 'Could a machine genuinely have phenomenal consciousness?', domain: 'philosophy_of_mind', lenses: ['functionalist', 'phenomenological'] },
  { text: 'Does functionalism capture what matters about the mind?', domain: 'philosophy_of_mind', lenses: ['functionalist'] },
  { text: 'What is the strongest argument against eliminative materialism?', domain: 'philosophy_of_mind', lenses: ['phenomenological', 'dualist'] },
  { text: 'Can personal identity persist through radical cognitive change?', domain: 'philosophy_of_mind', lenses: ['phenomenological', 'enactivist'] },
  { text: 'Is the self an illusion or a necessary structure of cognition?', domain: 'philosophy_of_mind', lenses: ['enactivist', 'phenomenological'] },
  { text: 'Do thought experiments about zombies reveal limits of physicalism?', domain: 'philosophy_of_mind', lenses: ['dualist', 'physicalist'] },
  { text: 'How should we evaluate panpsychism against higher-order theories?', domain: 'philosophy_of_mind', lenses: ['dualist', 'physicalist'] },
  { text: 'Can free will survive a fully naturalistic account of mind?', domain: 'philosophy_of_mind', lenses: ['physicalist', 'enactivist'] },
];

/**
 * Shuffle array using Fisher-Yates algorithm.
 * Returns a new array; does not mutate input.
 */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Get N randomized example prompts without repetition within a session.
 * Filters by domain if provided.
 */
export function getRandomExamples(
  count: number = 4,
  options?: {
    domain?: ExamplePrompt['domain'] | 'auto';
    lens?: LensId;
  }
): ExamplePrompt[] {
  const domain = options?.domain;
  const lens = options?.lens;

  const byDomain = domain && domain !== 'auto'
    ? EXAMPLE_PROMPTS.filter((p) => p.domain === domain)
    : EXAMPLE_PROMPTS;

  if (!lens) {
    const shuffled = shuffle(byDomain);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  const lensMatched = byDomain.filter((p) => p.lenses?.includes(lens));
  const lensUnmatched = byDomain.filter((p) => !p.lenses?.includes(lens));
  const merged = [...shuffle(lensMatched), ...shuffle(lensUnmatched)];
  return merged.slice(0, Math.min(count, merged.length));
}
