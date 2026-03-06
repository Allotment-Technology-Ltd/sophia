# SOPHIA Ingestion Prompt Tuning Log

Track changes to extraction prompts and their impact on quality metrics.

---

## Baseline (Phase 3a original prompts)

- **Date:** [date of Wave 1 ingestion]
- **Wave 1 spot-check accuracy:** [X]%
- **Spot-check file:** `data/reports/spot-check-*.json`
- **Quality report:** `data/reports/quality-report-*.md`
- **Common errors observed:**
  - [ ] Compound claims (two ideas in one)
  - [ ] Missing objections / relation imbalance
  - [ ] Section headers extracted as claims
  - [ ] Over-extracted trivial claims
  - [ ] Wrong domain assignment

---

## Iteration 1

- **Date:**
- **Change made:**
- **Reason:**
- **Spot-check accuracy after:** %
- **Files modified:**
  - `src/lib/server/prompts/extraction.ts`
  - `src/lib/server/prompts/relations.ts`
  - `src/lib/server/prompts/grouping.ts`
- **Notes:**

---

## Iteration 2

- **Date:**
- **Change made:**
- **Reason:**
- **Spot-check accuracy after:** %
- **Files modified:**
- **Notes:**

---

## Iteration 3

- **Date:**
- **Change made:**
- **Reason:**
- **Spot-check accuracy after:** %
- **Files modified:**
- **Notes:**

---

## Common Error Patterns & Fixes

### Pattern: Compound claims (two ideas merged into one)

**Symptom:** Claims contain "and" or "but" joining two distinct assertions, e.g.:
> "Utility is the foundation of morality and happiness is its goal"

**Diagnosis:** Check spot-check results for claims with conjunctions separating independent ideas.

**Fix:** Add to `EXTRACTION_SYSTEM` in [extraction.ts](../src/lib/server/prompts/extraction.ts):
> "If a statement contains two independent assertions joined by 'and', 'but', or 'however', extract them as separate claims."

---

### Pattern: Missing objections

**Symptom:** `quality-report` flags >80% of relations as `supports` with <10% `contradicts`. Claim type breakdown shows very few `objection` or `response` types.

**Diagnosis:** SEP/IEP entries almost always present objections to the main view. If none appear, the prompt is under-sampling the critical sections of the text.

**Fix:** Add to `EXTRACTION_SYSTEM`:
> "SEP and IEP entries typically present and respond to objections in dedicated sections. Ensure you extract objections as `objection` type claims and responses as `response` type claims — not as additional premises."

---

### Pattern: Section headers extracted as claims

**Symptom:** Spot-check reveals claims like `"3.2 The Utility Monster"` or `"See also: Consequentialism"`.

**Diagnosis:** The extraction prompt's exclusion rule ("do not extract purely expository claims") is not catching all structural text.

**Fix:** Strengthen the exclusion rule in `EXTRACTION_SYSTEM`:
> "Do not extract section headings, bibliographic references, 'see also' links, or transitional sentences as claims. A valid claim makes a substantive philosophical assertion that could stand alone."

---

### Pattern: Over-extraction of trivial claims

**Symptom:** Claims like `"This topic has been extensively discussed by many philosophers"` or `"There are several competing views on this question"`. Claim count is high but quality report shows low confidence scores across the board.

**Diagnosis:** The prompt is extracting framing/meta-commentary rather than substantive assertions.

**Fix:** Add a minimum substantiveness threshold to `EXTRACTION_SYSTEM`:
> "Only extract claims that make a substantive philosophical assertion — a claim that could be debated, argued for, or argued against. Do not extract claims that merely describe the existence of a debate, attribute views to philosophers without stating the view, or summarise what will be discussed."

---

### Pattern: Wrong domain assignment

**Symptom:** Ethics claims tagged as `philosophy_of_language` or `epistemology`. `quality-report` domain distribution looks implausible for the source type.

**Diagnosis:** Domain assignment is ambiguous for claims that span multiple areas (e.g., metaethical claims about moral language get tagged as `philosophy_of_language`).

**Fix:** Add disambiguating examples to `EXTRACTION_SYSTEM`:
> "Domain guidance: claims about what is good/right/obligatory → `ethics`; claims about what moral words mean or how moral language functions → `philosophy_of_language`; claims about whether moral knowledge is possible → `epistemology`. When a claim spans multiple domains, choose the most salient philosophical context."

---

### Pattern: Arguments too thin (1–2 claims each)

**Symptom:** `quality-report` flags many thin arguments. The grouping stage is creating many small argument groups rather than fewer well-populated ones.

**Diagnosis:** The `GROUPING_USER` prompt may be over-splitting arguments. Check whether related arguments could be merged.

**Fix:** Adjust `GROUPING_SYSTEM` in [grouping.ts](../src/lib/server/prompts/grouping.ts):
> "Prefer fewer, richer arguments over many thin ones. An argument should have at least 3 claims — a conclusion, at least one key premise, and either a supporting premise, assumption, objection, or response. Only create a separate argument if the logical structure genuinely differs."

---

### Pattern: Orphan claims

**Symptom:** `quality-report` shows a high percentage of orphan claims (no relations, not in any argument). May indicate the relations extraction pass missed connections, or claims were extracted from footnotes/bibliography.

**Diagnosis:**
1. Check if orphaned claims are bibliographic/footnote text (fix: exclude these in extraction)
2. Check if they're legitimate philosophical claims that should be connected (fix: tune relations prompt)

**Fix (if bibliographic):** Add to `EXTRACTION_SYSTEM`:
> "Do not extract claims from footnotes, endnotes, or bibliography sections."

**Fix (if under-connected):** Add to `RELATIONS_SYSTEM` in [relations.ts](../src/lib/server/prompts/relations.ts):
> "Every significant claim should have at least one relation to another claim. If a claim appears isolated, consider whether it supports, depends on, or responds to another claim in the source."

---

## Prompt Files Reference

| File | Purpose |
|------|---------|
| [src/lib/server/prompts/extraction.ts](../src/lib/server/prompts/extraction.ts) | Main extraction: claim types, domains, confidence |
| [src/lib/server/prompts/relations.ts](../src/lib/server/prompts/relations.ts) | Relation extraction: supports, contradicts, depends_on, etc. |
| [src/lib/server/prompts/grouping.ts](../src/lib/server/prompts/grouping.ts) | Argument grouping: clusters claims into named arguments |
| [src/lib/server/prompts/validation.ts](../src/lib/server/prompts/validation.ts) | Gemini cross-validation scoring |

## Quality Thresholds

| Metric | Target | Warning |
|--------|--------|---------|
| Spot-check accuracy | ≥ 80% | < 80% |
| Orphan claims | ≤ 10% | > 20% |
| Relation imbalance (supports %) | ≤ 70% | > 80% |
| Low-confidence claims (< 0.7) | ≤ 5% | > 15% |
| Min claims per argument | ≥ 3 | ≤ 2 |
