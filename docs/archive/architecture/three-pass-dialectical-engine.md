---
status: superseded
owner: adam
source_of_truth: false
replaced_by: docs/sophia/architecture.md
last_reviewed: 2026-03-13
---

> Superseded during the 2026-03-13 documentation rationalisation. Use docs/sophia/architecture.md for the live SOPHIA architecture.

# SOPHIA — The Three-Pass Dialectical Engine

## Motivation

Standard single-pass LLM responses to philosophical questions tend to hedge. Asked "Is moral relativism defensible?", a single-pass response will typically list arguments for and against, then conclude with "it depends on one's perspective" — which is epistemically correct but philosophically unsatisfying. It doesn't do the hard work of identifying *which* objections are decisive, *where* genuine disagreement lies, or *what* the most defensible position actually is.

The three-pass engine separates the epistemic labour across three roles, mirroring the structure of actual philosophical debate:

1. **The Proponent** builds the strongest case, without immediately hedging.
2. **The Sceptic** attacks that case, without being required to offer alternatives.
3. **The Synthesiser** must now reckon with a real objection — not a strawman — before reaching a conclusion.

This forces the model to engage with genuine philosophical tension rather than performing balance.

## Pass Architecture

### Pass 1: Analysis (The Proponent)

**System prompt role:** Construct the strongest possible argument(s) addressing the question.

**What it does:**
- Decomposes the question into constituent sub-questions
- Identifies 2–4 philosophical domains engaged
- Presents 2–3 distinct positions, each grounded in named traditions and thinkers
- States premises explicitly as empirical, normative, or conceptual
- Does NOT resolve tensions or reach a verdict

**Input:** Query + argument-graph context (claims, relations, arguments from the knowledge base)
**Proposed extension:** Optional lightweight runtime context from user-provided links (`/api/analyse`) to direct the pass without running full ingestion inline.

**Characteristic output features:**
- Named traditions (Kantian deontology, utilitarian calculus, virtue ethics)
- Explicit premises ("P1: ..., P2: ..., therefore C: ...")
- Section headers: `**The Question(s)**`, `**Position 1: [Tradition]**`, `**Key Tensions**`

### Pass 2: Critique (The Sceptic)

**System prompt role:** Challenge the strongest objections to the positions presented in Pass 1.

**What it does:**
- Identifies hidden assumptions in each position from Pass 1
- Raises the strongest available counterarguments
- Tests whether cited evidence actually supports the claimed conclusions
- Asks whether the framing of the question itself is philosophically loaded
- Does NOT synthesise or reach conclusions

**Input:** Query + argument-graph context + Pass 1 output
**Proposed extension:** Critique can use the same lightweight user-link context when present.

**Characteristic output features:**
- Exposes internal tensions within a position (not just between positions)
- Questions premises directly ("Does P1 actually hold? Consider...")
- Identifies cases where the Proponent conflated distinct claims
- Section headers: `**Objection to [Position]**`, `**Hidden Assumptions**`, `**Strongest Challenge**`

### Pass 3: Synthesis (The Synthesiser)

**System prompt role:** Integrate the Analysis and Critique to reach a justified conclusion.

**What it does:**
- Reviews which objections from Pass 2 were adequately answered by Pass 1
- Distinguishes genuine philosophical impasses from merely rhetorical ones
- Identifies what *would* be required to resolve remaining tensions
- Reaches a proportionate conclusion with stated confidence level
- Cites specific claims from the argument graph where relevant

**Input:** Query + argument-graph context + Pass 1 output + Pass 2 output
**Proposed extension:** Synthesis incorporates user-link runtime context, while heavy source ingestion is deferred to nightly processing.

**Characteristic output features:**
- Explicitly tracks which objections are decisive vs. which can be answered
- States conclusion with epistemic qualification ("On balance, X appears defensible because...")
- Distinguishes "this is hard" from "this is genuinely undecidable"
- Section headers: `**What the Critique Established**`, `**Remaining Tensions**`, `**Synthesis**`

## Example: "Is moral relativism defensible?"

### Pass 1 — Analysis (excerpt)

> **The Question(s)**
> Core question: Can moral claims be genuinely *true* or *false* across cultures, or are they true only relative to a cultural framework? Sub-questions: Does descriptive moral diversity entail normative relativism? Can relativism avoid self-refutation?
>
> **Position 1: Moral Universalism (Kantian)**
> P1: Rational agency is a necessary condition of morality. P2: Any being with rational agency is subject to the categorical imperative regardless of cultural membership. C: Moral norms binding on rational agents are not culturally relative...
>
> **Position 2: Cultural Relativism (Descriptive → Normative)**
> P1: Moral practices vary substantially across cultures (empirical). P2: There is no culture-independent standpoint from which to adjudicate these practices. C: Moral judgements are valid only relative to the cultural framework within which they are made...
>
> **Key Tensions**
> The Kantian position requires that rational agency generates determinate obligations — disputed. The relativist position faces the self-refutation challenge: if all moral claims are culture-relative, so is the claim that moral relativism is true...

### Pass 2 — Critique (excerpt)

> **Hidden Assumptions in Position 1**
> The Kantian argument assumes rational agency is both necessary and sufficient for moral standing, but this is contested. Parfit argues the categorical imperative underdetermines specific obligations even if accepted...
>
> **Strongest Challenge to Position 2**
> The self-refutation problem is more serious than the Proponent acknowledged. If "moral norms are culturally relative" is itself a moral norm, it refutes itself. If it is a meta-ethical claim, it is not subject to cultural variation — which concedes the universalist's point that some moral claims are culture-independent...

### Pass 3 — Synthesis (excerpt)

> **What the Critique Established**
> The Critique correctly identified that strong cultural relativism faces a decisive self-refutation objection. This cannot be deflected easily. However, the Kantian position was not given a clean pass: the underdetermination problem is real...
>
> **Synthesis**
> Moral relativism in its strong descriptive-to-normative form is not defensible: the self-refutation objection is decisive. A more defensible position is *moral pluralism* — the view that there are genuine moral universals (prohibitions on gratuitous cruelty, requirements of basic reciprocity) alongside significant legitimate cultural variation in how those universals are specified and weighted. This position acknowledges descriptive diversity without inferring normative relativism...

## Argument Graph Integration

Each pass receives a **context block** assembled by the retrieval pipeline:

```
[PHILOSOPHICAL KNOWLEDGE BASE CONTEXT]

CLAIMS:
[C1] "Maximising aggregate utility can justify harming innocent individuals"
     Type: normative | Domain: ethics | Source: SEP Utilitarianism | Confidence: 0.94
[C2] "Each person's rights function as a side-constraint on utility maximisation"
     Type: normative | Domain: ethics | Source: Nozick, Anarchy State Utopia | Confidence: 0.91

RELATIONS:
[C2] contradicts [C1] — "Rights as constraints vs. rights as one good among many"

ARGUMENTS:
[A1] The Rights Objection to Utilitarianism
     Tradition: Deontological | Conclusion: Utility maximisation cannot override individual rights
     Key premises: C2, C3, C4
```

The Proponent uses this to ground positions in specific thinkers. The Sceptic looks for contradictions between retrieved claims and the Proponent's characterisation. The Synthesiser uses the argument structures to identify which objections have established philosophical replies.

## Performance Characteristics

- **Latency**: ~15–25 seconds end-to-end (three sequential API calls, streaming)
- **Token cost**: ~3,000–5,000 input tokens + ~2,000–3,000 output tokens per query
- **Streaming**: All three passes stream progressively; the user sees Pass 1 completing before Pass 2 starts
- **Graceful degradation**: If SurrealDB is unavailable, the engine runs without graph context — reasoning quality degrades but the system remains functional
- **Proposed two-speed source handling**: runtime uses lightweight link intake only; full ingestion for opted-in links runs nightly (02:00 UTC) via deferred batch processing.
