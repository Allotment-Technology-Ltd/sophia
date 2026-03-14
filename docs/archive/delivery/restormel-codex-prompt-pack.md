# Restormel Codex Prompt Pack

## Purpose

This document is a working prompt pack for using Codex to move from the current **SOPHIA** repository state to the target **Restormel platform** state.

It is designed to help you run Codex in controlled waves rather than asking for one large, risky refactor.

---

## 1. What Codex should understand before it starts

Use this as the first orientation prompt in a fresh Codex session.

### Prompt 0 — Repo orientation and migration framing

```text
You are working inside the SOPHIA codebase.

Your job is not to do a blind rewrite. Your job is to help migrate SOPHIA into the first version of the Restormel platform.

Target framing:
- SOPHIA becomes the reference application / showcase app.
- Restormel becomes the platform and product family.
- The first reusable platform outputs are shared packages inside a monorepo.
- The first public wedge product is Restormel Graph.
- GraphRAG follows after Graph.
- We should extract before rewriting.
- We should stabilise contracts early.
- We should keep one monorepo first.
- We should preserve working SOPHIA behaviour wherever possible.

Current repo reality to assume:
- SOPHIA already has meaningful production-grade strengths in retrieval architecture, runtime orchestration, ingestion discipline, BYOK/billing scaffolding, and observability.
- The main weakness is not concept but proof, evaluation, and platform boundary clarity.
- The migration should therefore focus on extracting reusable platform modules from existing working code, not replacing everything with speculative abstractions.

Working rules:
1. Extract before rewrite.
2. Prefer small safe commits over sweeping moves.
3. Preserve behaviour unless explicitly told otherwise.
4. Add tests or fixtures when extracting shared logic.
5. Keep app-specific UX logic in SOPHIA unless there is a clear platform reason to move it.
6. Create or update docs as part of each milestone.
7. Keep a migration ledger of what was moved, what still depends on app-local code, and what risks remain.

Before making changes:
- inspect the repo structure
- identify the modules most likely to map to:
  - @restormel/contracts
  - @restormel/graph-core
  - @restormel/observability
  - @restormel/graphrag-core
  - @restormel/reasoning-core
  - @restormel/providers
- identify build/tooling constraints already present
- propose the safest first extraction sequence based on the actual code

Output required before coding:
- a concise migration audit
- a proposed first-wave plan
- the exact files/modules you think should move first
- key risks and dependencies

Then begin with the smallest viable first step.
```

---

## 2. Target end state Codex should optimise toward

Give Codex this context when it starts drifting or becoming too app-centric.

### Prompt 1 — Restormel end-state reminder

```text
Optimise toward this end state:

Apps:
- apps/sophia
- apps/restormel-site
- apps/restormel-console
- apps/restormel-api

Packages:
- @restormel/contracts
- @restormel/graph-core
- @restormel/graphrag-core
- @restormel/reasoning-core
- @restormel/providers
- @restormel/observability
- @restormel/sdk
- @restormel/ui

Migration intent:
- SOPHIA should consume shared platform packages.
- Restormel Graph should be buildable independently of SOPHIA.
- Shared graph, trace, reasoning, provider, and retrieval contracts should not live only inside the SOPHIA app.
- Hosted products and exported packages should align wherever practical.

Do not optimise for elegant theory alone.
Optimise for a real migration path from the code that already exists.
```

---

## 3. The recommended order to run Codex in

Use Codex in waves.

### Wave order

1. Monorepo foundation
2. Contracts extraction
3. Graph core + observability extraction
4. Restormel Graph MVP scaffold
5. GraphRAG extraction
6. Reasoning extraction
7. Providers / BYOK extraction
8. SOPHIA migration cleanup

That keeps the work aligned with the delivery pack and avoids prematurely pulling apart the highest-risk runtime pieces.

---

## 4. Prompts for the first activities in the delivery plan

These are the strongest starting prompts for actual repo work now.

### Prompt 2 — Monorepo foundation without breaking SOPHIA

```text
Set up the minimum viable monorepo foundation for the migration from SOPHIA to Restormel.

Goals:
- preserve the current SOPHIA app as the main working app
- introduce workspace structure that can support future apps and packages
- avoid unnecessary behavioural changes
- make local build/test/dev ergonomics clearer, not worse

What I want you to do:
1. inspect the current repo and infer the existing framework/build setup
2. propose the least disruptive monorepo shape
3. implement the minimum required workspace/tooling changes
4. create placeholder package locations where appropriate
5. keep SOPHIA building and running
6. add a short migration README explaining the new structure

Target structure direction:
- apps/sophia
- packages/contracts
- packages/graph-core
- packages/observability
- packages/graphrag-core
- packages/reasoning-core
- packages/providers

Constraints:
- do not attempt the full migration in one pass
- do not move risky runtime logic yet unless necessary
- do not invent a large release pipeline unless the repo already needs it
- prefer incremental moves that can be validated immediately

Deliverables:
- updated workspace config
- minimal package scaffolds
- SOPHIA still builds
- clear notes on what remains before contracts extraction starts
```

### Prompt 3 — Extract `@restormel/contracts`

```text
Extract the first shared platform package: @restormel/contracts.

Intent:
- move shared contracts and schemas out of SOPHIA app-local ownership
- stabilise graph, trace, reasoning, retrieval, provider, and ingestion contract shapes early
- minimise behaviour change

Priority candidate sources to inspect first:
- src/lib/types/api.ts
- src/lib/types/constitution.ts
- src/lib/types/domains.ts
- src/lib/types/enrichment.ts
- src/lib/types/learn.ts
- src/lib/types/passes.ts
- src/lib/types/providers.ts
- src/lib/types/references.ts
- src/lib/types/verification.ts
- src/lib/server/ingestion/contracts.ts
- selected shared server types from src/lib/server/types.ts

Tasks:
1. identify which types are genuinely shared versus app-specific
2. create a contracts package with clean index exports
3. add zod validators where missing and useful
4. define an initial schema versioning approach if appropriate
5. refactor SOPHIA imports to consume the new package
6. remove obvious duplicate schema ownership
7. add fixtures or tests for the highest-value shared schemas

Guardrails:
- keep server-only implementation logic out of the contracts package
- do not over-abstract naming before the extraction is stable
- preserve current runtime behaviour

Definition of done:
- @restormel/contracts exists and compiles
- SOPHIA consumes it
- duplicate app-local contracts are reduced
- shared graph/trace/reasoning contracts can be imported from one place
- docs explain what belongs in contracts vs what does not
```

### Prompt 4 — Extract `@restormel/graph-core` and `@restormel/observability`

```text
Extract the next two shared packages:
- @restormel/graph-core
- @restormel/observability

Intent:
These packages should make it possible to build Restormel Graph independently of the SOPHIA app.

Likely graph-core candidates:
- src/lib/server/graphProjection.ts
- src/lib/utils/graphLayout.ts
- src/lib/utils/graphTrace.ts
- graph stats helpers
- path-finding helpers
- graph diff helpers
- graph filters/query helpers

Likely observability candidates:
- src/lib/utils/sseHandler.ts
- event-shaping logic from analyse/verify routes
- trace/replay helpers in stores or route handlers

Tasks:
1. identify pure graph logic vs renderer/UI coupling
2. extract package-owned graph projection and graph utility functions
3. extract package-owned event and trace shaping functions
4. define explicit contracts for GraphSnapshot, ReasoningEvent, and RunTrace if not already present
5. refactor SOPHIA to consume the new packages
6. create sample traces or fixtures so replay can be tested

Desired exports include:
- projectGraph()
- diffGraphs()
- summarizeGraph()
- traceToEvents()
- eventsToTrace()

Guardrails:
- avoid coupling graph-core to a specific frontend renderer
- keep UI state and panel logic in the app unless truly generic
- prefer package APIs that match real current behaviour, not speculative future APIs

Definition of done:
- graph projection logic is package-owned
- trace/event shaping is package-owned
- at least one saved SOPHIA trace can replay through shared contracts
- SOPHIA still works with the extracted code
- package docs include example inputs/outputs
```

### Prompt 5 — Scaffold the first Restormel Graph MVP surface

```text
Using the extracted contracts, graph-core, and observability packages, scaffold the first Restormel Graph MVP surface.

Intent:
This is the first standalone product wedge. It should let a user inspect graph JSON and trace JSON quickly.

Primary capabilities:
- graph import
- trace import
- graph canvas scaffold
- trace timeline scaffold
- inspector scaffold
- answer path highlighting scaffold
- sample demo loading
- invalid payload handling

Tasks:
1. inspect the current UI stack and reuse what is sensible
2. create the minimum independent surface needed for Restormel Graph
3. use shared package outputs rather than app-local internal types
4. keep the MVP narrow and demo-friendly
5. add sample files and a quickstart

Success bar:
- a user can import graph JSON and inspect it in under a minute
- a user can import trace JSON and inspect answer paths
- at least five SOPHIA traces can be used as fixtures or sample demos
- at least one non-SOPHIA sample also works

Do not try to build the entire final product. Build the smallest coherent private-beta MVP.
```

---

## 5. Prompts for the next extraction waves

These are ready once the first wave is stable.

### Prompt 6 — Extract `@restormel/graphrag-core`

```text
Extract @restormel/graphrag-core from the current SOPHIA retrieval stack.

Intent:
The retrieval layer is already one of the strongest and most differentiated parts of the system. The goal is to package it cleanly without losing the current sophistication.

Likely source modules to inspect first:
- src/lib/server/retrieval.ts
- src/lib/server/hybridCandidateGeneration.ts
- src/lib/server/seedSetConstructor.ts
- src/lib/server/domainClassifier.ts
- adjacent modules such as source identity, embeddings, db access, and enrichment gates

Tasks:
1. separate domain classification from retrieval where possible
2. introduce clear storage/provider interfaces instead of hard-wiring app DB assumptions into the public core
3. make retrieval trace a first-class output
4. expose package APIs such as:
   - retrieve()
   - retrieveWithTrace()
   - buildSeedSet()
   - expandGraph()
   - buildContextPack()
5. add representative tests and fixtures
6. preserve the differentiated retrieval behaviour already present

Guardrails:
- do not flatten the retrieval system into a generic vector search wrapper
- preserve traceability and auditability
- do not couple the package to SOPHIA-only product framing
```

### Prompt 7 — Extract `@restormel/reasoning-core`

```text
Extract @restormel/reasoning-core from the current SOPHIA reasoning runtime.

Intent:
Separate the reasoning engine from SOPHIA-specific framing so it can later power hosted reasoning APIs and other product surfaces.

Likely source modules:
- src/lib/server/engine.ts
- src/lib/server/reasoningEngine.ts
- src/lib/server/contextPacks.ts
- src/lib/server/reasoningEval.ts
- prompt modules for analysis, critique, synthesis, and reasoning evaluation

Tasks:
1. separate runtime orchestration from product-specific copy and UX assumptions
2. standardise pass outputs under shared contracts
3. expose package APIs such as:
   - runReasoning()
   - runReasoningBatch()
   - buildContextPacks()
   - parsePassOutput()
4. preserve continuation handling, structured parsing, pass reuse, and streaming-aware design where already present
5. add fixtures/examples for analysis, critique, synthesis runs

Guardrails:
- keep the first extraction conservative
- do not try to solve the constitution/rules system fully in the same pass unless needed
- preserve current behaviour over elegance
```

### Prompt 8 — Extract `@restormel/providers`

```text
Extract @restormel/providers for provider routing and BYOK.

Intent:
Centralise provider capability handling, credential validation, and provider execution interfaces while leaving billing/entitlement logic in the app until later.

Likely source modules:
- src/lib/server/byok/config.ts
- src/lib/server/byok/crypto.ts
- src/lib/server/byok/store.ts
- src/lib/server/byok/tenantIdentity.ts
- src/lib/server/byok/validation.ts
- provider adapters such as anthropic, claude, gemini, vertex

Tasks:
1. define a shared provider adapter interface
2. extract provider capability metadata and model catalog logic
3. expose APIs such as:
   - resolveProvider()
   - validateCredential()
   - getAvailableModels()
   - runModel()
4. refactor SOPHIA to consume the package
5. keep billing and entitlement wiring app-local for now unless obviously reusable

Guardrails:
- do not bury product plan logic in the providers package
- keep secrets handling disciplined
- do not over-complicate multi-provider abstraction before the basics are stable
```

---

## 6. Prompts for control, review, and cleanup

These are useful between major waves.

### Prompt 9 — Migration ledger update

```text
Pause implementation and produce a migration ledger.

I want:
- what has been extracted so far
- what still remains app-local in SOPHIA
- what dependencies are still too tangled
- what technical debt was introduced temporarily
- what should happen next in priority order
- what risks might break future hosted products or Restormel Graph independence

Be concrete and reference actual files/modules.
```

### Prompt 10 — Refactor review before merge

```text
Review the current migration changes as if you were the technical lead approving a risky platform refactor.

Check for:
- hidden behaviour changes
- circular dependencies
- leaky app-specific assumptions inside shared packages
- package APIs that are too speculative
- missing tests/fixtures/docs
- naming inconsistencies between SOPHIA and Restormel framing
- gaps that would make Restormel Graph or hosted GraphRAG harder to build

Output:
- critical issues
- medium issues
- nice-to-have improvements
- exact recommended next edits before merge
```

### Prompt 11 — SOPHIA-to-reference-app cleanup

```text
Refactor the current codebase so SOPHIA more clearly behaves as a reference app consuming platform modules rather than acting as the source of truth for all platform logic.

Tasks:
- identify duplicated platform logic still owned by SOPHIA
- move or wrap it where appropriate behind Restormel package boundaries
- keep SOPHIA-specific UX, branding, learn flows, admin, billing, legal, and other app-specific surfaces in the app
- reduce bespoke internal coupling
- improve naming and import clarity

Deliverable:
A cleaner separation between platform-owned logic and SOPHIA-owned app logic, without destabilising the product.
```

---

## 7. How to run this practically with Codex

A good working pattern is:

1. Start with Prompt 0.
2. Let Codex inspect the repo and propose the first safe wave.
3. Use Prompt 2 for monorepo groundwork.
4. Then Prompt 3 for contracts.
5. Then Prompt 4 for graph + observability.
6. After each wave, run Prompt 9 and Prompt 10.
7. Only then move on to GraphRAG and reasoning extraction.

---

## 8. Recommended instruction to append to any Codex task

You can paste this at the end of almost any of the prompts above.

### Reusable appendix — implementation discipline

```text
Implementation discipline:
- Make the smallest coherent set of changes needed.
- Prefer real code movement over placeholder architecture theatre.
- Preserve behaviour unless explicitly changing it.
- Update docs as you go.
- Add or update tests/fixtures where extraction risk is non-trivial.
- Show me the exact files changed.
- Explain any compromises or temporary bridges.
- If the repo reality differs from my assumptions, adapt to the repo rather than forcing the plan.
```

---

## 9. Suggested immediate starting point

If you want the best next move right now, start Codex with:

1. Prompt 0
2. Prompt 2
3. Prompt 3

That should get you into the first real engineering movement of the delivery plan without jumping too early into the higher-risk runtime extractions.
