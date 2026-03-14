import { z } from 'zod';

export const PHILOSOPHICAL_DOMAIN_VALUES = [
  'epistemology',
  'metaphysics',
  'ethics',
  'philosophy_of_mind',
  'political_philosophy',
  'logic',
  'aesthetics',
  'philosophy_of_science',
  'philosophy_of_language',
  'applied_ethics',
  'philosophy_of_ai'
] as const;

export const PhilosophicalDomainSchema = z.enum(PHILOSOPHICAL_DOMAIN_VALUES);

export type PhilosophicalDomain = z.infer<typeof PhilosophicalDomainSchema>;

export const SUPPORTED_DOMAIN_VALUES = ['ethics', 'philosophy_of_mind'] as const;

export const SupportedDomainSchema = z.enum(SUPPORTED_DOMAIN_VALUES);

export type SupportedDomain = z.infer<typeof SupportedDomainSchema>;

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
