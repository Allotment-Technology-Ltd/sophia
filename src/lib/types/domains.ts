export type PhilosophicalDomain =
  | 'epistemology'
  | 'metaphysics'
  | 'ethics'
  | 'philosophy_of_mind'
  | 'political_philosophy'
  | 'logic'
  | 'aesthetics'
  | 'philosophy_of_science'
  | 'philosophy_of_language'
  | 'applied_ethics'
  | 'philosophy_of_ai';

export const DOMAIN_LABELS: Record<PhilosophicalDomain, string> = {
  epistemology: 'Epistemology',
  metaphysics: 'Metaphysics',
  ethics: 'Ethics',
  philosophy_of_mind: 'Philosophy of Mind',
  political_philosophy: 'Political Philosophy',
  logic: 'Logic',
  aesthetics: 'Aesthetics',
  philosophy_of_science: 'Philosophy of Science',
  philosophy_of_language: 'Philosophy of Language',
  applied_ethics: 'Applied Ethics',
  philosophy_of_ai: 'Philosophy of AI'
};
