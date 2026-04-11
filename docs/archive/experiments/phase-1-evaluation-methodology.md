---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SOPHIA — Evaluation Methodology

## Research Question

Can structured argument retrieval combined with dialectical prompting produce measurably more rigorous philosophical analyses than standard single-pass LLM responses?

## Phase 1 Evaluation

**Comparison:** SOPHIA three-pass dialectical engine vs. single-pass Claude Sonnet (same model, same query, no graph context)

**Test cases:** 10 philosophical questions spanning 4 domains

**Design:** Blinded — evaluator did not know which response was SOPHIA vs. single-pass

### Test Cases (Phase 1)

| # | Query | Domain |
|---|-------|--------|
| 1 | Is moral relativism defensible? | Ethics / Meta-ethics |
| 2 | Can free will be compatible with determinism? | Metaphysics |
| 3 | What justifies civil disobedience? | Political philosophy |
| 4 | Is the trolley problem morally relevant to AI ethics? | Applied ethics |
| 5 | Can consequentialism justify torture in ticking-bomb cases? | Applied ethics |
| 6 | Is there a meaningful distinction between acts and omissions? | Ethics |
| 7 | What is the relationship between knowledge and justified belief? | Epistemology |
| 8 | Can we have obligations to future generations? | Ethics / Political philosophy |
| 9 | Is personal identity a coherent concept? | Metaphysics / Philosophy of mind |
| 10 | Does the experience machine argument refute hedonism? | Ethics |

### Evaluation Rubric

Each response was scored 1–5 on four dimensions:

#### 1. Argument Structure (AS)
- **5**: Premises stated explicitly; inference form identified; conclusion follows
- **4**: Premises mostly explicit; some reasoning implicit
- **3**: Arguments present but informally stated
- **2**: Conclusions asserted without supporting reasoning
- **1**: No discernible argument structure

#### 2. Counterargument Coverage (CC)
- **5**: Strongest available objections engaged at full strength; no strawmanning
- **4**: Main objections covered; some weakening of objections
- **3**: Some counterarguments mentioned but not fully engaged
- **2**: Token mention of opposing views without engagement
- **1**: No counterarguments acknowledged

#### 3. Conclusion Justification (CJ)
- **5**: Conclusion proportionate to evidence; qualifications stated; uncertainty acknowledged
- **4**: Conclusion mostly justified; minor overreach
- **3**: Conclusion partially supported; some unjustified hedging or overconfidence
- **2**: Conclusion significantly stronger than evidence supports
- **1**: Conclusion unsupported or arbitrarily chosen

#### 4. Philosophical Grounding (PG)
- **5**: Claims anchored in named traditions and thinkers; technical terms used precisely
- **4**: Most claims grounded; some undefined terminology
- **3**: Some philosophical grounding; relies on informal language for complex concepts
- **2**: Minimal grounding; philosophical concepts used loosely
- **1**: No philosophical grounding; responses could be from any LLM

### Phase 1 Results

| Test Case | SOPHIA (AS/CC/CJ/PG) | Single-Pass (AS/CC/CJ/PG) | SOPHIA wins? |
|-----------|-----------------------|---------------------------|--------------|
| 1. Moral relativism | 5/5/4/5 = **19** | 3/3/3/3 = **12** | ✅ Yes |
| 2. Free will | 4/4/4/4 = **16** | 3/3/3/3 = **12** | ✅ Yes |
| 3. Civil disobedience | 5/4/4/5 = **18** | 4/3/4/4 = **15** | ✅ Yes |
| 4. Trolley + AI ethics | 4/5/4/4 = **17** | 3/3/3/3 = **12** | ✅ Yes |
| 5. Consequentialism + torture | 5/5/5/5 = **20** | 3/2/3/3 = **11** | ✅ Yes |
| 6. Acts vs. omissions | 4/4/4/4 = **16** | 4/4/3/4 = **15** | ✅ Yes |
| 7. Knowledge + belief | 4/3/4/4 = **15** | 3/3/3/4 = **13** | ✅ Yes |
| 8. Future generations | 4/4/4/4 = **16** | 4/4/4/4 = **16** | — Draw |
| 9. Personal identity | 4/4/3/4 = **15** | 4/4/4/4 = **16** | ❌ No |
| 10. Experience machine | 5/5/5/5 = **20** | 3/3/4/4 = **14** | ✅ Yes |

**Outcome: SOPHIA wins 8/10, draws 1/10, loses 1/10**

Most significant improvement: Counterargument Coverage (SOPHIA avg: 4.4 vs. single-pass avg: 3.2). Single-pass tends to acknowledge objections without engaging them at full strength; the Sceptic pass is specifically designed to prevent this.

Weakest area: SOPHIA's Pass 3 occasionally hedges too heavily when the Critique is very strong, leading to lower Conclusion Justification scores. This is a prompt engineering problem being addressed in Phase 3c.

## Planned Formal Evaluation (Phase 6)

The Phase 1 results are promising but the sample size (n=10) is too small to be statistically meaningful. Phase 6 plans a formal evaluation:

- **50+ test cases** across 10 philosophical domains
- **Three evaluators** (two philosophy graduates, one AI researcher) to establish inter-rater reliability
- **Blind comparative evaluation** with SOPHIA, single-pass Claude, single-pass GPT-4, and a human philosophy tutor baseline
- **Quantitative analysis**: Cohen's kappa for inter-rater agreement; effect sizes for each dimension

## Limitations

1. **Evaluator bias**: Phase 1 used a single evaluator (the author). Confirmed evaluator bias is a confound.
2. **Model selection**: Both SOPHIA and single-pass used Claude Sonnet. SOPHIA's three-pass advantage may be smaller with a weaker base model.
3. **Domain coverage**: Phase 1 test cases over-represent applied ethics. The graph has better coverage of normative ethics than meta-ethics at this stage.
4. **Latency**: SOPHIA takes 15–25 seconds vs. 3–5 seconds for single-pass. The quality improvement must be weighed against response time in a real user context.
5. **Graph dependency**: SOPHIA's advantage may partially reflect the argument-graph context rather than the dialectical structure. Phase 4 evaluation will test graph-only vs. three-pass-only vs. combined.
