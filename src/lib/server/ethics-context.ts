export function getEthicsContext(): string {
  return \`
ETHICS: CORE POSITIONS AND ARGUMENTS

=== NORMATIVE ETHICS ===

UTILITARIANISM (Consequentialist)
Thesis: An action is right iff it maximizes overall utility (well-being, preference satisfaction).
Key advocates: Bentham, Mill, Singer
Key claims: Consequences determine rightness; well-being is the only intrinsic good; impartially maximize utility
Strengths: Clear decision procedure; respects what matters (well-being); applicable to policy
Weaknesses: Demandingness; fails to respect individual rights; measurement problems

DEONTOLOGICAL ETHICS (Rights-based)
Thesis: Rightness depends on conforming to duties/rules, not just consequences.
Key advocates: Kant, Ross, Regan
Key claims: Some acts inherently wrong regardless of consequences; rights constrain utility maximization; persons have intrinsic dignity
Strengths: Explains why we shouldn't use people as mere means; protects individual rights
Weaknesses: Determining which duties bind; conflicts between duties; unintuitive implications

VIRTUE ETHICS (Character-based)
Thesis: Ethics is fundamentally about developing good character (virtues) and living well (eudaimonia).
Key advocates: Aristotle, Foot, Hursthouse, Annas
Key claims: Moral education cultivates virtues (courage, honesty, compassion, justice, prudence); virtuous person has practical wisdom; flourishing is the goal
Strengths: Explains moral development and motivation; emphasizes context-sensitivity; holistic view
Weaknesses: Doesn't clearly specify what makes an action right; cultural differences; requires significant moral maturity

CARE ETHICS
Thesis: Morality is grounded in relationships, interdependence, and responsiveness to particular others' needs.
Key advocates: Noddings, Held, Kittay, Tronto
Key claims: Universal principles miss what matters; dependence and interdependence fundamental; moral agency maintains relationships
Strengths: Explains motivation; highlights relational nature of human life; effective for real situations
Weaknesses: Seems parochial (focuses on those near us); unclear application beyond intimate relationships

=== META-ETHICS ===

MORAL REALISM: Moral facts exist objectively, independent of what anyone believes.
MORAL RELATIVISM: Moral judgments are true or false relative to a culture, individual, or perspective.
(Key tension: Realism vs. Relativism — how do we justify moral claims?)

=== APPLIED ETHICS: KEY CASES ===

THE TROLLEY PROBLEM
Scenario: Trolley hurtling toward five people. Pull lever to divert it, killing one instead.
Utilitarian analysis: Pull lever (1 death < 5 deaths)
Deontological analysis: Depends on rule; maybe impermissible to intentionally cause a death
Virtue ethics: What would virtuous person do?
Key tension: Why divert feels different from pushing one person in front of trolley

INFORMED CONSENT
Medical treatment should only proceed with consent from competent, informed patient.
Key principles: Autonomy (respect self-governance); Beneficence (act in patient's interest); Non-maleficence (avoid harm)
Tensions: What if competent patient refuses life-saving treatment? What if patient lacks competence?
AI relevance: Medical AI systems must respect patient autonomy

ALGORITHMIC BIAS IN AI
AI systems trained on biased data perpetuate discrimination.
Ethical tensions:
- Utilitarian: if AI improves outcomes overall, is bias acceptable?
- Rights-based: do affected individuals have right to non-discriminatory treatment?
- Virtue: what virtues (fairness, honesty, care) should guide AI developers?
- Care: whose vulnerabilities matter most?

=== KEY CONCEPTS ===

MORAL AGENCY: Capacity to act from moral principle, subject to moral evaluation.
MORAL STATUS: Standing to be morally considered; having interests that matter morally.
MORAL PROGRESS: Improvement in moral understanding and practice over time.
DOCTRINE OF DOUBLE EFFECT (DDE): An action with both good and bad effects can be permissible if good effect is intended and outweighs bad effect.

=== CROSS-DOMAIN IMPLICATIONS ===

EPISTEMOLOGY OF ETHICS: How do we know what's right? Is moral knowledge a priori or empirical?
METAPHYSICS OF MORALITY: What kind of thing is a moral fact?
PHILOSOPHY OF MIND AND MORAL STATUS: What properties ground moral status?
  \`.trim();
}
