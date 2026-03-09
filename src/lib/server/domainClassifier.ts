/**
 * SOPHIA — Domain Classifier
 *
 * Lightweight keyword-based query classifier. Detects which philosophical domain
 * a query most likely belongs to, for two purposes:
 *   1. Retrieval routing — pass a domain filter to retrieveContext() when confident,
 *      so that PoM queries don't bleed into ethics results and vice versa.
 *   2. Analytics — log detected domain per query for coverage analysis.
 *
 * This is intentionally heuristic-based (no LLM call) to add zero latency.
 * Accuracy matters most for the two live domains (ethics, philosophy_of_mind).
 * For domains with no graph data, classification is analytics-only.
 */

import type { PhilosophicalDomain } from '$lib/types/domains';

export interface DomainClassification {
	domain: PhilosophicalDomain | null;
	confidence: 'high' | 'medium' | 'low';
	scores: Partial<Record<PhilosophicalDomain, number>>;
}

// Domains that have knowledge graph data and can be used as retrieval filters.
// Update this set as new domains are ingested.
export const DOMAINS_WITH_DATA = new Set<PhilosophicalDomain>([
	'ethics',
	'philosophy_of_mind'
]);

// Domain keyword sets — ordered roughly by discriminating power.
// Use lowercase substrings; partial matches are intentional (e.g. 'utilitari' matches
// 'utilitarian', 'utilitarianism', 'act utilitarian').
const DOMAIN_KEYWORDS: Record<PhilosophicalDomain, string[]> = {
	ethics: [
		'moral relativism',
		'moral realism',
		'categorical imperative',
		'greatest happiness principle',
		'act utilitarian',
		'rule utilitarian',
		'trolley problem',
		'virtue ethics',
		'deontolog',
		'consequentialism',
		'utilitarianism',
		'utilitari',
		'metaethics',
		'normative ethics',
		'moral',
		'morality',
		'ethical',
		'ethics',
		'beneficence',
		'non-maleficence',
		'harm principle',
		'obligation',
		'ought',
		'permissible',
		'impermissible',
		'wrong to',
		'right to',
		'duty',
		'kantian',
		'bentham',
		'mill',
		'singer',
		'rawls',
		'scanlon',
		'parfit'
	],

	philosophy_of_mind: [
		'hard problem of consciousness',
		'chinese room',
		'turing test',
		'philosophical zombie',
		'qualia',
		'phenomenal consciousness',
		'phenomenal experience',
		'what it is like',
		'consciousness',
		'mind-body problem',
		'mind body problem',
		'mental causation',
		'functionalism',
		'physicalism',
		'dualism',
		'epiphenomenalism',
		'intentionality',
		'mental state',
		'subjective experience',
		'chalmers',
		'searle',
		'nagel',
		'dennett',
		'block',
		'levine',
		'explanatory gap',
		'cognitive science',
		'perception'
	],

	epistemology: [
		'justified true belief',
		'gettier',
		'epistemolog',
		'a priori',
		'a posteriori',
		'foundationalism',
		'coherentism',
		'reliabilism',
		'epistemic',
		'knowledge',
		'justification',
		'skepticism',
		'scepticism',
		'certainty',
		'testimony',
		'empiricism',
		'rationalism',
		'can we know'
	],

	metaphysics: [
		'personal identity',
		'identity over time',
		'ontolog',
		'mereolog',
		'abstract object',
		'universals',
		'particulars',
		'essence',
		'metaphysics',
		'substance',
		'persistence',
		'modality',
		'possibility and necessity',
		'possible world'
	],

	political_philosophy: [
		'social contract',
		'political philosophy',
		'distributive justice',
		'civil disobedience',
		'libertarian',
		'communitarianism',
		'republicanism',
		'legitimacy of the state',
		'state authority',
		'democracy',
		'sovereignty',
		'liberalism',
		'nozick',
		'hobbes',
		'locke',
		'rousseau'
	],

	logic: [
		'modus ponens',
		'modus tollens',
		'syllogism',
		'predicate logic',
		'propositional logic',
		'modal logic',
		'logical fallacy',
		'validity',
		'soundness',
		'deduction',
		'tautology',
		'contradiction in logic'
	],

	aesthetics: [
		'aesthetic judgment',
		'aesthetic experience',
		'theory of art',
		'expression in art',
		'beauty',
		'sublime',
		'artistic',
		'aesthetics'
	],

	philosophy_of_science: [
		'falsification',
		'scientific paradigm',
		'kuhn',
		'popper',
		'lakatos',
		'scientific realism',
		'underdetermination',
		'theory-ladenness',
		'laws of nature',
		'scientific explanation',
		'reductionism in science',
		'emergence'
	],

	philosophy_of_language: [
		'theory of meaning',
		'speech act',
		'use theory of meaning',
		'truth conditions',
		'compositionality',
		'reference',
		'indexicals',
		'pragmatics',
		'semantics',
		'frege',
		'wittgenstein',
		'meaning'
	],

	applied_ethics: [
		'bioethics',
		'medical ethics',
		'euthanasia',
		'abortion',
		'stem cell',
		'environmental ethics',
		'animal rights',
		'business ethics',
		'gene editing',
		'informed consent',
		'end of life',
		'torture',
		'capital punishment'
	],

	philosophy_of_ai: [
		'artificial intelligence',
		'machine learning',
		'alignment problem',
		'ai safety',
		'superintelligence',
		'language model',
		'deep learning',
		'neural network',
		'robot rights',
		'algorithmic bias',
		'automation'
	]
};

/**
 * Classify a query into the most likely philosophical domain.
 *
 * Returns:
 *   - domain: best-matching domain, or null if no keywords matched
 *   - confidence: 'high' if top score is >= 2 AND at least 1.5× second place;
 *                 'medium' if top score > second place;
 *                 'low' otherwise
 *   - scores: raw keyword hit counts per domain (for debugging/analytics)
 */
export function classifyQueryDomain(query: string): DomainClassification {
	const normalised = query.toLowerCase();
	const scores: Partial<Record<PhilosophicalDomain, number>> = {};

	for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [
		PhilosophicalDomain,
		string[]
	][]) {
		let score = 0;
		for (const kw of keywords) {
			if (normalised.includes(kw)) score += 1;
		}
		if (score > 0) scores[domain] = score;
	}

	const entries = (Object.entries(scores) as [PhilosophicalDomain, number][]).sort(
		(a, b) => b[1] - a[1]
	);

	if (entries.length === 0) {
		return { domain: null, confidence: 'low', scores };
	}

	const [topDomain, topScore] = entries[0];
	const secondScore = entries[1]?.[1] ?? 0;

	let confidence: 'high' | 'medium' | 'low';
	if (topScore >= 2 && topScore >= secondScore * 1.5) {
		confidence = 'high';
	} else if (topScore > secondScore) {
		confidence = 'medium';
	} else {
		confidence = 'low';
	}

	return { domain: topDomain, confidence, scores };
}

/**
 * Resolve the domain to pass as a retrieval filter.
 * Returns a domain only when:
 *   - Confidence is 'high'
 *   - The domain has ingested knowledge graph data
 *
 * For medium/low confidence or uningested domains, returns undefined
 * so retrieval remains cross-domain (best current behaviour).
 */
export function getRetrievalDomain(
	classification: DomainClassification
): PhilosophicalDomain | undefined {
	if (
		classification.confidence === 'high' &&
		classification.domain !== null &&
		DOMAINS_WITH_DATA.has(classification.domain)
	) {
		return classification.domain;
	}
	return undefined;
}
