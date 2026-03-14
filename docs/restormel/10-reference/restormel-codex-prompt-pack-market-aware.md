# Restormel Codex Prompt Pack — Market-Aware Revision

## Purpose

This is the revised Codex prompt pack for moving from the current **SOPHIA** codebase toward the **Restormel** platform **without reinventing categories that are already mature or crowded**.

This revision incorporates the findings from the deep competitive research and updates the implementation path accordingly.

It assumes:
- **Prompt 0 through Prompt 4 from the original pack have already been implemented**
- the major **Restormel Graph Kit v1** implementation slices have already been implemented in SOPHIA
- the next phase is **not** to build more generic infrastructure from scratch
- the next phase is to **integrate with strong existing substrates** and build Restormel’s moat in the differentiated layer

---

## Status legend

- **DONE** = already implemented or intentionally completed enough for this phase
- **ACTIVE** = recommended next Codex prompts
- **LATER** = worthwhile, but not the next immediate move
- **DEFER / INTEGRATE** = do not build from scratch unless a deliberate strategic choice changes this

---

## 1. Market-aware rules Codex must follow

### Strategic rule
Restormel should not become:
- another generic tracing tool
- another generic RAG framework
- another vector DB wrapper
- another generic observability dashboard

Restormel **should** become:
- a **graph-native reasoning debugger and evaluator**
- a compiler from traces + retrieval events + intermediate reasoning artefacts into a unified reasoning object
- a platform for graph-aware evaluation, provenance inspection, contradiction inspection, run comparison, and audit-ready decision lineage

### Build-vs-integrate default

#### Integrate / adapt by default
- tracing / telemetry substrates
- instrumentation standards
- RAG frameworks and orchestration pipelines
- GraphRAG building blocks
- retrieval evaluation baselines
- embeddings / rerankers
- graph storage
- model providers

#### Build directly
- reasoning graph compilation layer
- canonical contracts for claims / evidence / provenance / trace / contradiction / synthesis
- graph-native debugger UX
- graph-aware retrieval diagnostics
- argument-graph evaluation primitives
- compare mode for reasoning states / runs
- governance-grade decision-lineage artefacts

### Preferred compatibility targets
Codex should preserve compatibility with:
- OpenTelemetry-style traces
- OpenInference-style AI semantics where practical
- existing agent / RAG frameworks as upstream producers
- existing retrieval evaluation libraries as baseline inputs
- graph database compatibility rather than graph DB reinvention
- provider-agnostic model, embedding, and reranker integration

---

## 2. Current project state

### DONE
- Prompt 0 through Prompt 4 from the original prompt pack have been implemented.
- A meaningful first Graph Kit implementation exists in SOPHIA.
- The graph workspace should now be treated as an established baseline, not a greenfield UI task.

### Implication
The next phase is:
1. harden boundaries
2. integrate external substrates where useful
3. define the reasoning-object layer clearly
4. make Restormel’s differentiated value more explicit in code

---

## 3. Delivery classification framework

For every feature or implementation suggestion, Codex must classify it as one of:

### COMMODITY
Already solved well elsewhere; integrate rather than build.

### DIFFERENTIATED
Core to Restormel’s wedge; build and own directly.

### ADJACENT
Useful but not moat-defining; scaffold lightly or defer.

Codex must explicitly state for each major recommendation:
- **Classification**
- **Reuse candidates**
- **Build scope**
- **Why it matters to Restormel**
- **Risk of overbuilding / incumbent collision**

---

## 4. Revised implementation stance by platform layer

## A. Trace ingestion and telemetry compatibility

**Classification:** COMMODITY  
**Reuse candidates:** OpenTelemetry conventions, OpenInference-style semantics, existing framework instrumentation outputs  
**Build scope:** adapters, normalisers, import pipeline into Restormel reasoning objects  
**Why it matters:** makes Restormel portable across frameworks and lets it sit on top of existing telemetry stacks  
**Risk:** building a proprietary trace system would collide with observability incumbents and dilute the product thesis

### Direction
Do not build a general-purpose tracing platform.
Build:
- a trace-ingestion adapter layer
- span/event normalisation into Restormel contracts
- mapping from temporal traces into structural reasoning graphs

---

## B. RAG orchestration and retrieval pipelines

**Classification:** COMMODITY  
**Reuse candidates:** LangChain, LlamaIndex, Haystack, Microsoft GraphRAG patterns, existing retrieval pipeline implementations  
**Build scope:** adapters, evaluation hooks, graph-compilation hooks, retrieval diagnostics overlays  
**Why it matters:** Restormel should benefit from mature ecosystems instead of rebuilding them  
**Risk:** building a new generic orchestration framework would collide with mature ecosystems and slow differentiation

### Direction
Do not build a fresh general RAG framework.
Build:
- hooks that ingest retrieval events and evidence selections
- graph-aware diagnostics on top of those events
- context-pack inspection views where they serve the reasoning debugger

---

## C. Vector / embedding / reranker infrastructure

**Classification:** COMMODITY  
**Reuse candidates:** existing vector DBs, embedding providers, rerankers, hybrid retrieval systems  
**Build scope:** provider-agnostic interfaces, comparative evaluation surfaces, debug metadata capture  
**Why it matters:** these are variables Restormel should inspect and compare, not reinvent  
**Risk:** major incumbent collision with little strategic upside

### Direction
Do not build vector infrastructure.
Do build:
- provider-agnostic adapters
- retrieval debug metadata contracts
- evaluation surfaces that show how retrieval choices affected reasoning structure

---

## D. Reasoning object / graph compilation layer

**Classification:** DIFFERENTIATED  
**Reuse candidates:** trace standards as inputs, argument-mining concepts as references, graph models as implementation aids  
**Build scope:** canonical contracts, transforms, compilers, graph assembly rules, reasoning-object lifecycle  
**Why it matters:** this is the heart of Restormel’s thesis and the least-crowded category  
**Risk:** under-specifying this layer would collapse Restormel into generic observability

### Direction
This should become a first-class package and concept.
Priority build areas:
- canonical node and edge taxonomy
- claim/evidence/provenance/contradiction/synthesis contracts
- compiler from traces + retrieval + tool outputs into reasoning graphs
- stable view models for UI and evaluation

---

## E. Graph-native debugger UX

**Classification:** DIFFERENTIATED  
**Reuse candidates:** existing graph rendering libraries only as substrate, existing design patterns where helpful  
**Build scope:** graph workspace behaviour, inspector semantics, provenance surfaces, compare mode UX, dense-graph workflows  
**Why it matters:** this is the wedge users can see and buy  
**Risk:** over-polishing visuals without strengthening reasoning semantics would make it feel ornamental

### Direction
Keep building here, but focus on:
- reasoning inspection depth
- graph state comparison
- provenance clarity
- graph-aware diagnostics
- audit / export surfaces

---

## F. Graph-aware evaluation

**Classification:** DIFFERENTIATED  
**Reuse candidates:** baseline RAG eval libraries, reasoning-eval literature, existing offline eval harnesses  
**Build scope:** graph-native evaluation primitives and regression tests  
**Why it matters:** this is where Restormel can move from “debug viewer” to “reasoning evaluator”  
**Risk:** if this remains shallow, incumbents may close the gap by adding graph views to traces

### Direction
Build:
- unsupported-claim detection
- missing-evidence checks
- contradiction-density checks
- source diversity / evidence quality checks
- traversal / justification sanity checks
- graph-state diff evaluators

---

## G. Governance-grade decision lineage

**Classification:** DIFFERENTIATED  
**Reuse candidates:** governance workflows as downstream integrations, existing reporting formats as references  
**Build scope:** exportable justification artefacts, lineage summaries, diff reports, evidence-backed audit bundles  
**Why it matters:** this gives Restormel a route into high-value compliance and high-stakes AI workflows  
**Risk:** trying to become a full governance suite too early would overextend the product

### Direction
Do not build a full governance platform.
Do build:
- structured reasoning artefacts
- decision lineage exports
- compare reports between runs / versions
- evidence bundles for review

---

## 5. Recommended next implementation sequence

1. **Harden the reasoning-object contracts**
2. **Add trace-ingestion / telemetry adapters**
3. **Separate graph compilation from graph rendering**
4. **Add graph-aware evaluators**
5. **Add compare-mode backed by reasoning-object diffs**
6. **Add audit / lineage export surfaces**
7. **Only then deepen adjacent integrations**

---

## 6. Revised Codex prompts

## Prompt 0 — Repo orientation and market-aware migration framing  **DONE**

Use the original implementation and migration audit already completed.
From this point on, treat the repo as already oriented.

---

## Prompt 1 — End-state reminder  **DONE**

Use the original end-state framing, but apply the market-aware constraints in this document.

---

## Prompt 2 — Monorepo foundation  **DONE**

Already completed for this phase.
Use only if hardening or repair work is needed.

---

## Prompt 3 — Contracts extraction  **DONE / PARTIAL HARDENING POSSIBLE**

Already started or completed enough for the current phase.
Future work should now focus on **reasoning-object hardening** rather than generic contract extraction alone.

---

## Prompt 4 — Graph baseline implementation  **DONE**

Do not re-run as a greenfield build prompt.
Only use graph-related prompts below for hardening, extraction, standards alignment, or differentiated capability expansion.

---

## Prompt 5 — Introduce a reasoning-object core and map existing contracts onto it  **ACTIVE**

```text
You are working on the Restormel platform inside the SOPHIA codebase.

Important constraint:
Do not build generic tracing, generic RAG orchestration, or vector infrastructure.
Instead, strengthen Restormel’s differentiated layer: the reasoning object.

Task:
Introduce or harden a canonical reasoning-object core that unifies:
- traces / events
- graph nodes and edges
- claims
- evidence
- provenance
- contradictions
- synthesis / conclusion outputs
- evaluation-ready metadata
- compare-ready versioning or run identity

Instructions:
1. inspect the existing contracts, graph workspace types, adapter layer, trace/timeline types, and any evaluation or provenance types already present
2. identify where the current model is fragmented across SOPHIA-specific structures
3. define a stable reasoning-object contract model that can be used by:
   - graph rendering
   - inspector UI
   - compare mode
   - evaluation primitives
   - audit / export surfaces
4. preserve working behaviour and add adapters rather than destructive rewrites
5. keep SOPHIA-specific assumptions behind adapter functions
6. write a markdown note explaining:
   - the reasoning-object model
   - how it maps from current SOPHIA structures
   - what remains app-specific
   - what is a future extraction candidate

Output requirements:
For this task, explicitly classify the work using:
- Classification
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision

Success condition:
The repo has a clearer canonical reasoning-object layer that sits between upstream traces/retrieval artefacts and downstream graph/evaluation UI.
```

---

## Prompt 6 — Add trace-ingestion compatibility instead of proprietary tracing  **ACTIVE**

```text
Continue the Restormel implementation.

Strategic constraint:
Restormel should not become a proprietary tracing product.
Instead, it should ingest and normalise trace/event data from existing ecosystems and compile them into reasoning objects.

Task:
Design and implement the first trace-ingestion compatibility layer.

Goals:
1. inspect what trace/run/event structures already exist in SOPHIA
2. add a normalisation layer that can map existing internal traces into a canonical Restormel event format
3. design the interfaces so future adapters for OpenTelemetry / OpenInference-style producers are possible
4. keep the implementation practical and incremental
5. document where current SOPHIA traces are richer or poorer than the target model

Implementation boundaries:
- do not build a new tracing backend
- do not build a general observability UI
- do build adapters, normalisers, and contracts that make external trace compatibility plausible

Deliverables:
- canonical event / span-like contract definitions where needed
- adapter layer for current SOPHIA trace sources
- docs explaining future compatibility targets
- minimal fixtures or examples showing how a foreign trace producer could map into the model later

Output requirements:
Include:
- Classification
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision

Success condition:
Restormel’s graph workspace and reasoning-object layer no longer assume only SOPHIA-native trace structures.
```

---

## Prompt 7 — Separate graph compilation from graph rendering  **ACTIVE**

```text
Continue the Restormel implementation.

Focus now on separating:
- upstream event / retrieval / reasoning artefacts
- graph compilation logic
- graph rendering and workspace UI

Task:
Refactor the current graph implementation so that graph assembly is a reusable package concern, while the visual workspace remains a reusable UI concern and SOPHIA-specific data assumptions stay in adapters.

Goals:
1. inspect the current graph workspace code and identify where graph assembly, view-model mapping, and rendering are still mixed together
2. extract or harden package boundaries for:
   - contracts
n   - graph-core
   - ui
   - observability or trace helpers
3. preserve working graph behaviour
4. avoid a destabilising rewrite
5. leave clear extraction notes

Important:
The graph workspace is already implemented.
Do not replace it with a fresh competing approach.
Strengthen boundaries around what already exists.

Output requirements:
Include:
- Classification
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision

Success condition:
The repo clearly separates reasoning-graph compilation from graph rendering, making Restormel Graph more extractable and more defensible.
```

---

## Prompt 8 — Add graph-aware evaluation primitives  **ACTIVE**

```text
Continue the Restormel implementation.

Strategic focus:
Build differentiated evaluation primitives rather than generic observability dashboards.

Task:
Implement the first graph-aware evaluation slice on top of the reasoning-object / graph model.

Candidate evaluator types to inspect and implement where the data allows:
- unsupported claim detection
- claim without evidence detection
- contradiction presence / contradiction density
- missing provenance flags
- weak source diversity flags
- unresolved inference chains
- conclusion confidence gaps
- graph path sanity / disconnected justification paths

Instructions:
1. inspect existing data availability before deciding what is real vs placeholder
2. implement the most credible first set of evaluators based on current data
3. keep evaluator logic separate from rendering logic
4. show results in a way that can surface in the graph workspace and inspector without tightly coupling everything
5. document what additional data would be required for stronger evaluators later

Do not:
- build generic eval infrastructure for every metric under the sun
- drift into baseline RAG benchmarking as the main product

Output requirements:
Include:
- Classification
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision

Success condition:
The repo contains the beginnings of a credible graph-native reasoning evaluation layer that is distinct from generic trace inspection.
```

---

## Prompt 9 — Wire existing retrieval / GraphRAG components in as upstream producers, not a replacement platform  **ACTIVE**

```text
Continue the Restormel implementation.

Strategic constraint:
Restormel should use retrieval and GraphRAG infrastructure as an upstream producer and integration surface, not try to replace mature frameworks.

Task:
Audit the current SOPHIA retrieval / GraphRAG-related code and reframe it through the market-aware architecture.

Goals:
1. identify which current retrieval capabilities are core to SOPHIA operation and should remain
2. identify which pieces look like reusable upstream producer modules for Restormel
3. identify which parts should stay thin wrappers around existing ecosystem patterns instead of becoming a bespoke Restormel framework
4. identify where retrieval events, evidence packaging, reranking choices, and graph extraction outputs can feed the reasoning-object layer and graph-aware evaluation layer
5. write a migration note recommending what to keep, what to extract, what to thin down, and what to integrate with external substrates later

Important:
Do not propose building a full new general GraphRAG framework unless there is a very explicit differentiated reason.
The goal is to make current retrieval flows legible, inspectable, and evaluable inside Restormel.

Output requirements:
Include:
- Classification for each major retrieval-related area
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision

Success condition:
The repo has a clearer plan for treating retrieval and GraphRAG capabilities as inputs to Restormel’s differentiated reasoning debugger and evaluator.
```

---

## Prompt 10 — Strengthen compare mode around reasoning-state diffs  **ACTIVE**

```text
Continue the Restormel implementation.

Focus now on making compare mode strategically meaningful.

Task:
Turn the existing compare scaffold into a first reasoning-state diff capability.

Compare targets can include:
- two runs
- two graph states
- two answer generations
- two evidence sets
- two reasoning traces compiled into reasoning objects

Minimum useful diff areas:
- added / removed claims
- added / removed evidence
- contradiction changes
- provenance changes
- changed confidence or support strength where available
- changed justification paths

Instructions:
1. inspect the current compare architecture and graph implementation
2. back it with the reasoning-object model where possible
3. keep UI and diff logic separate
4. document what remains placeholder vs real
5. make the output useful for regression analysis, not just visual novelty

Output requirements:
Include:
- Classification
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision

Success condition:
Compare mode becomes a credible part of Restormel’s moat in reasoning regression and decision-lineage analysis.
```

---

## Prompt 11 — Add audit-ready lineage and export surfaces  **ACTIVE**

```text
Continue the Restormel implementation.

Strategic focus:
Restormel should be able to generate decision-lineage artefacts without trying to become a full governance suite.

Task:
Implement the first audit-ready export or summary surfaces from the current reasoning-object / graph model.

Candidate outputs:
- reasoning summary
- evidence-backed justification summary
- contradiction summary
- run comparison summary
- provenance bundle
- decision-lineage report scaffold

Instructions:
1. inspect current graph, inspector, provenance, and compare data
2. design a lightweight exportable or renderable artefact format
3. keep it extraction-friendly
4. avoid building a full workflow/compliance product
5. document the relationship between these artefacts and future governance integrations

Output requirements:
Include:
- Classification
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision

Success condition:
The repo can generate a first structured justification artefact that demonstrates Restormel’s value beyond graph visualisation alone.
```

---

## Prompt 12 — Review existing provider / model / embedding integrations through the “evaluate, don’t reinvent” lens  **LATER**

```text
Audit current provider, model, embedding, and reranker integrations in SOPHIA.

Task:
Reframe these integrations so Restormel remains provider-agnostic and evaluation-oriented rather than becoming an infrastructure clone.

Goals:
- identify what should stay adapter-based
- identify where comparative metadata should be captured for reasoning/retrieval diagnostics
- identify what should not be platform-owned
- propose the cleanest package boundary for provider-facing code

Output requirements:
Include:
- Classification
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision
```

---

## Prompt 13 — Figma alignment pass for Restormel Graph without destabilising the architecture  **LATER**

```text
Use the implemented graph workspace as the baseline.

Task:
Align the current UI with the emerging Figma design system without destabilising the architecture.

Instructions:
- preserve boundary separation
- avoid replacing semantic behaviour with superficial styling work
- focus on token alignment, component consistency, layout polish, and information hierarchy
- leave reasoning semantics intact

Output requirements:
Include:
- Classification
- Reuse candidates
- Build scope
- Why it matters to Restormel
- Risk of overbuilding / incumbent collision
```

---

## 7. Practical next run order

### Best next sequence for Codex
1. **Prompt 5** — reasoning-object core
2. **Prompt 6** — trace-ingestion compatibility
3. **Prompt 7** — graph compilation vs rendering separation
4. **Prompt 8** — graph-aware evaluators
5. **Prompt 10** — compare mode backed by reasoning diffs
6. **Prompt 11** — audit-ready lineage outputs
7. **Prompt 9** — retrieval / GraphRAG integration reframing

### Why this sequence
This sequence:
- builds the moat first
- uses existing telemetry / retrieval ecosystems as substrates
- strengthens the graph workspace as a reasoning debugger rather than a decorative graph
- creates user-visible differentiation before further infrastructure work

---

## 8. Explicit “do not accidentally do this” list

Do not ask Codex to:
- build a fresh tracing backend
- build a generic observability product
- build a new general RAG framework
- build a vector DB abstraction layer as if that is the product
- rebuild the graph workspace from scratch
- over-optimise generic infrastructure before the reasoning-object and evaluation moat are stronger

---

## 9. One-line operating summary for Codex

**Use existing ecosystems for traces, retrieval, models, embeddings, and storage; build Restormel’s moat in reasoning-object compilation, graph-native debugging, graph-aware evaluation, compare mode, and audit-ready decision lineage.**
