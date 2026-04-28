/**
 * Philosophical domains for Project Gutenberg discovery (operator UI + Gutendex-backed suggest).
 * Each domain maps to a Gutendex full-text search plus optional keyword refinement on titles/subjects.
 */

export const GUTENBERG_PHILOSOPHY_DOMAINS = [
	{
		id: 'general',
		label: 'General philosophy',
		description: 'Broad “philosophy” search with classic Philosophy / ethics / logic shelf signals.',
		gutendexSearch: 'philosophy',
		domainKeywords: [] as string[]
	},
	{
		id: 'ethics',
		label: 'Ethics & moral philosophy',
		description: 'Moral philosophy, normative theory, virtue, duty, and related tags.',
		gutendexSearch: 'ethics',
		domainKeywords: [
			'ethic',
			'moral',
			'virtue',
			'duty',
			'utilitar',
			'deontolog',
			'consequential',
			'normative'
		]
	},
	{
		id: 'metaphysics',
		label: 'Metaphysics',
		description: 'Being, substance, ontology, and classical metaphysical topics.',
		gutendexSearch: 'metaphysics',
		domainKeywords: ['metaphys', 'ontology', 'substance', 'cosmolog', 'being']
	},
	{
		id: 'epistemology',
		label: 'Epistemology',
		description: 'Knowledge, justification, skepticism, and theory of belief.',
		gutendexSearch: 'epistemology',
		domainKeywords: ['epistem', 'knowledge', 'skeptic', 'justified', 'belief']
	},
	{
		id: 'logic',
		label: 'Logic',
		description: 'Formal and philosophical logic, reasoning, and related works.',
		gutendexSearch: 'logic',
		domainKeywords: ['logic', 'deduct', 'syllog', 'inference', 'reasoning']
	},
	{
		id: 'political',
		label: 'Political philosophy',
		description: 'Justice, the state, social contract, liberty, and citizenship.',
		gutendexSearch: 'political philosophy',
		domainKeywords: [
			'political',
			'contract',
			'sovereign',
			'liberty',
			'citizen',
			'justice',
			'commonwealth'
		]
	},
	{
		id: 'aesthetics',
		label: 'Aesthetics',
		description: 'Beauty, art, taste, and the philosophy of the arts.',
		gutendexSearch: 'aesthetics',
		domainKeywords: ['aesthet', 'beauty', 'sublime', 'taste']
	},
	{
		id: 'ancient',
		label: 'Ancient philosophy',
		description: 'Greek, Hellenistic, and Roman philosophical traditions.',
		gutendexSearch: 'ancient philosophy',
		domainKeywords: [
			'plato',
			'aristotle',
			'socrates',
			'stoic',
			'epicure',
			'presocratic',
			'hellenist',
			'greek'
		]
	},
	{
		id: 'medieval',
		label: 'Medieval philosophy',
		description: 'Scholastic, patristic, and medieval thinkers.',
		gutendexSearch: 'medieval philosophy',
		domainKeywords: ['augustine', 'aquinas', 'scholastic', 'medieval', 'patristic']
	},
	{
		id: 'early_modern',
		label: 'Early modern philosophy',
		description: 'Rationalism, empiricism, and 17th–18th century figures.',
		gutendexSearch: 'early modern philosophy',
		domainKeywords: [
			'descart',
			'spinoza',
			'leibniz',
			'hobbes',
			'locke',
			'hume',
			'rationalism',
			'empiricism',
			'enlightenment'
		]
	},
	{
		id: 'philosophy_of_religion',
		label: 'Philosophy of religion',
		description: 'Theism, natural religion, theology, and arguments concerning God.',
		gutendexSearch: 'philosophy religion',
		domainKeywords: ['theolog', 'theism', 'atheism', 'theodicy', 'revelation', 'natural religion']
	}
] as const;

export type GutenbergPhilosophyDomainId = (typeof GUTENBERG_PHILOSOPHY_DOMAINS)[number]['id'];

export const DEFAULT_GUTENBERG_PHILOSOPHY_DOMAIN: GutenbergPhilosophyDomainId = 'general';

const DOMAIN_IDS = new Set<string>(GUTENBERG_PHILOSOPHY_DOMAINS.map((d) => d.id));

export function isGutenbergPhilosophyDomainId(v: string): v is GutenbergPhilosophyDomainId {
	return DOMAIN_IDS.has(v);
}

export function getGutenbergPhilosophyDomainSpec(id: GutenbergPhilosophyDomainId) {
	return GUTENBERG_PHILOSOPHY_DOMAINS.find((d) => d.id === id) ?? GUTENBERG_PHILOSOPHY_DOMAINS[0];
}
