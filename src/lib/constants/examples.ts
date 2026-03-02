/**
 * Curated pool of example philosophical questions for the empty state.
 * Ethics-scoped for MVP, randomized on component mount to avoid repetition.
 */

export interface ExamplePrompt {
  text: string;
  domain: 'ethics' | 'epistemology' | 'metaphysics' | 'political';
}

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  // Normative ethics
  { text: 'Is morality relative or universal?', domain: 'ethics' },
  { text: 'Can lying ever be justified?', domain: 'ethics' },
  { text: 'What obligations do we have to future generations?', domain: 'ethics' },
  { text: 'Is it ethical to eat animals?', domain: 'ethics' },
  { text: 'Does intent matter more than consequences?', domain: 'ethics' },
  
  // Applied ethics
  { text: 'Should we prioritize saving identifiable lives over statistical lives?', domain: 'ethics' },
  { text: 'Is wealth inequality inherently unjust?', domain: 'ethics' },
  { text: 'What makes a punishment just?', domain: 'ethics' },
  { text: 'Do we have a moral duty to donate to effective charities?', domain: 'ethics' },
  { text: 'Is it wrong to have children in a world with suffering?', domain: 'ethics' },
  
  // Virtue ethics & character
  { text: 'What makes a life meaningful?', domain: 'ethics' },
  { text: 'Can virtue be taught?', domain: 'ethics' },
  { text: 'Is integrity more important than compassion?', domain: 'ethics' },
  { text: 'What role should emotion play in moral judgment?', domain: 'ethics' },
  
  // Meta-ethics
  { text: 'Are there objective moral truths?', domain: 'ethics' },
  { text: 'Can moral disagreement ever be resolved?', domain: 'ethics' },
  { text: 'Do moral facts exist independently of human minds?', domain: 'ethics' },
  
  // Practical reasoning
  { text: 'How should we reason under moral uncertainty?', domain: 'ethics' },
  { text: 'What do we owe to people in distant countries?', domain: 'ethics' },
  { text: 'Is there a duty to rescue strangers?', domain: 'ethics' },
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
export function getRandomExamples(count: number = 4, domain?: ExamplePrompt['domain']): ExamplePrompt[] {
  const pool = domain ? EXAMPLE_PROMPTS.filter(p => p.domain === domain) : EXAMPLE_PROMPTS;
  const shuffled = shuffle(pool);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
