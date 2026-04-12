# Restormel Retrieval / GraphRAG Producer Note

## Purpose

Clarify how SOPHIA's existing retrieval and GraphRAG-related code should feed Restormel as upstream producers, rather than expanding Restormel into a general-purpose retrieval or tracing platform.

## Strategic framing

Restormel's differentiated layer is the reasoning object, graph workspace, compare surfaces, and graph-aware evaluation. Retrieval, reranking, graph traversal, extraction, and enrichment should be treated as producer inputs into that layer.

This means:

- keep mature retrieval patterns where they already work
- extract reusable producer seams where SOPHIA has differentiated logic
- avoid building a bespoke general GraphRAG framework unless there is a clear product wedge
- make retrieval outputs more legible, inspectable, and evaluable inside Restormel Graph

## Classification by area

| Area | Current files | Classification | Reuse candidates | Build scope | Why it matters to Restormel | Risk of overbuilding / incumbent collision |
| --- | --- | --- | --- | --- | --- | --- |
| Retrieval orchestration | [src/lib/server/retrieval.ts](/Users/adamboon/projects/sophia/src/lib/server/retrieval.ts) | `upstream producer core` | `RetrievalResult`, retrieval trace packaging, graph projection input seam | Harden contracts and trace output shape first; defer DB/query extraction | This is the main producer of claims, relations, arguments, seed sets, and traversal evidence that feed the reasoning object | High if turned into a general retrieval framework; keep infra details local |
| Hybrid candidate generation | [src/lib/server/hybridCandidateGeneration.ts](/Users/adamboon/projects/sophia/src/lib/server/hybridCandidateGeneration.ts) | `thin reusable helper` | lexical term extraction, corpus-level query detection, hybrid fusion policy | Extract only if needed by multiple producers | Useful for explaining why a retrieval run surfaced certain candidates | Medium if expanded into a full retrieval subsystem |
| Seed-set construction | [src/lib/server/seedSetConstructor.ts](/Users/adamboon/projects/sophia/src/lib/server/seedSetConstructor.ts) | `differentiated reusable producer logic` | role quotas, MMR balancing, seed balance stats | Good near-term extraction candidate into `@restormel/graphrag-core` or similar producer package | This affects viewpoint diversity, contradiction coverage, and graph inspectability | Medium; keep it as a policy module, not a framework |
| Context-pack assembly | [src/lib/server/contextPacks.ts](/Users/adamboon/projects/sophia/src/lib/server/contextPacks.ts) | `SOPHIA app/reasoning orchestration` | stats only, maybe pack diagnostics | Keep mostly app-local for now | These packs shape prompts and pass behavior, but are tightly coupled to SOPHIA's three-pass engine | High if abstracted too early; likely app-specific until more consumers exist |
| Engine orchestration | [src/lib/server/engine.ts](/Users/adamboon/projects/sophia/src/lib/server/engine.ts), [src/lib/server/reasoningEngine.ts](/Users/adamboon/projects/sophia/src/lib/server/reasoningEngine.ts) | `SOPHIA operational core` | callback/event seams only | Preserve behavior; expose producer outputs, not engine internals | This is where retrieval, context packs, projection, and reasoning runs are composed into working product behavior | Very high; this should not become a speculative platform runtime yet |
| Graph projection | [packages/graph-core/src/projection.ts](/Users/adamboon/projects/sophia/packages/graph-core/src/projection.ts), [src/lib/server/graphProjection.ts](/Users/adamboon/projects/sophia/src/lib/server/graphProjection.ts) | `already-extracted reusable producer boundary` | `projectGraph()`, `GraphSnapshot`, projection summaries | Keep hardening as the canonical bridge from retrieval outputs to graph state | This is the cleanest existing seam between retrieval artefacts and Restormel Graph | Low; already aligned with current platform direction |
| Verification extraction | [src/lib/server/extraction.ts](/Users/adamboon/projects/sophia/src/lib/server/extraction.ts), [src/lib/server/verification/pipeline.ts](/Users/adamboon/projects/sophia/src/lib/server/verification/pipeline.ts) | `upstream structured reasoning producer` | extracted claims, relations, extraction metadata, verification outputs | Stabilize contracts and provenance mapping before deeper extraction | This produces structured claim/relation artefacts that can feed reasoning objects and evaluation | Medium; avoid turning it into a general extraction platform |
| Enrichment pipeline | [src/lib/server/enrichment/pipeline.ts](/Users/adamboon/projects/sophia/src/lib/server/enrichment/pipeline.ts) | `producer with app-specific assumptions` | provenance packaging, candidate node/edge output, promotion diagnostics | Extract contracts and candidate shapes first; keep storage/promotion local | This is a useful bridge from pass outputs into richer graph/provenance state | Medium to high; current logic is still tightly bound to SOPHIA graph types and storage |
| Embeddings / provider routing / DB access | [src/lib/server/embeddings.ts](/Users/adamboon/projects/sophia/src/lib/server/vertex.ts), DB calls inside [src/lib/server/retrieval.ts](/Users/adamboon/projects/sophia/src/lib/server/retrieval.ts) | `thin wrappers around ecosystem substrates` | interfaces only | Keep thin, swappable, and boring | Restormel should consume mature model/vector substrates, not replace them | Very high if product effort drifts into infra replication |
| Source extraction and intake | [src/lib/server/enrichment/sourceExtractor.ts](/Users/adamboon/projects/sophia/src/lib/server/enrichment/sourceExtractor.ts) | `integration utility` | source metadata and extracted text envelopes | Keep as adapter/util until there is a cross-app need | Helpful for provenance completion and evidence packaging | Medium if broadened into a content ingestion platform too early |

## What should remain

Keep these as SOPHIA operational strengths unless a second consumer appears:

- engine orchestration
- pass-specific context packing
- provider/model routing
- DB-specific retrieval implementation details
- storage and promotion mechanics for enrichment

These are core to SOPHIA's current working behavior and are not yet proven as stable platform APIs.

## What should extract next

The strongest producer-oriented extraction candidates are:

1. retrieval result contracts and retrieval trace schema
2. seed-set construction and balance diagnostics
3. hybrid candidate fusion helpers
4. extraction output contracts for claims, relations, and metadata
5. enrichment candidate and provenance packaging contracts

These are the places where SOPHIA produces structured reasoning artefacts that multiple Restormel surfaces can consume.

## What should stay thin

These areas should stay as thin wrappers around existing ecosystem patterns:

- embeddings and model-provider integrations
- vector search / database query plumbing
- transport/event streaming infrastructure
- raw source fetching and parsing

Restormel should integrate with those layers, not compete with them.

## How current retrieval flows should feed the reasoning-object layer

The current pipeline already supports the right direction:

1. `retrieveContext()` produces claims, relations, arguments, seed IDs, degradation signals, and rich retrieval trace.
2. `projectRetrievalToGraph()` turns those artefacts into a graph snapshot.
3. the reasoning-object adapter can compile graph state, trace context, provenance, and evaluation signals into a canonical reasoning snapshot.
4. Graph Kit and graph-aware evaluators consume that reasoning-object layer.

The most important inputs from retrieval and GraphRAG into Restormel are:

- retrieval events and stage metadata
- evidence packaging and source references
- reranking and seed-balance decisions
- traversal choices and pruning summaries
- graph extraction outputs
- degradation and confidence signals

## Gaps to address

Current gaps that limit full fidelity:

- retrieval contracts still live mainly in SOPHIA server code instead of a package-owned producer contract
- context-pack logic is useful but too app-specific to expose as a platform API yet
- explicit evidence objects are still thinner than the eventual reasoning-object model wants
- provenance is richer in enrichment than in baseline retrieval outputs
- graph extraction from verification and enrichment flows is still partially separate from baseline retrieval projection

## Recommended next moves

1. Stabilize a package-owned retrieval producer contract that wraps current `RetrievalResult` and trace fields without changing behavior.
2. Extract seed-set balancing as a reusable producer policy module with tests and fixtures.
3. Add a small retrieval-to-reasoning-object adapter seam so Graph Kit and evaluators can consume retrieval outputs more directly.
4. Normalize evidence and provenance envelopes across baseline retrieval, verification extraction, and enrichment.
5. Leave context packing and engine composition inside SOPHIA until at least one additional consumer exists.

## Future external integrations

When Restormel integrates with external GraphRAG or retrieval substrates later, the compatibility points should be:

- normalized retrieval events
- evidence/source envelopes
- claim/relation extraction outputs
- graph projection inputs
- reasoning-object ingestion

That keeps Restormel focused on reasoning inspection and evaluation rather than replacing mature upstream tooling.
