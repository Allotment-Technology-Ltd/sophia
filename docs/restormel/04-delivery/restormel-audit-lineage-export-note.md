# Restormel Audit Lineage Export Note

## Classification

Audit-ready lineage and justification artefacts built from the canonical reasoning-object model, not a governance workflow suite.

## Reuse candidates

- `@restormel/contracts/reasoning-lineage`
- `@restormel/graph-core/lineage`
- `ReasoningLineagePanel.svelte`
- SOPHIA workspace bundle builders that already expose canonical reasoning snapshots

## Build scope

Implemented now:

- package-owned reasoning-lineage report contract
- package-owned report generator from `ReasoningObjectSnapshot`
- optional compare-summary attachment from reasoning-state diffs
- Markdown export renderer for the generated artefact
- SOPHIA UI surface in the Map tab and full Graph workspace page
- clipboard copy for Markdown and JSON

The current report includes:

- reasoning summary
- evidence-backed justification summary
- contradiction summary
- provenance bundle
- run comparison summary when a baseline is present
- notes describing current fidelity limits

## Why it matters to Restormel

This is the first proof that Restormel can emit a structured decision-lineage artefact from the same canonical model that drives graph inspection and compare mode. It demonstrates value beyond graph visualisation alone:

- exportable reasoning summaries
- justification-focused review surfaces
- provenance packaging
- future-ready inputs for policy, audit, or governance integrations

## Risk of overbuilding / incumbent collision

Kept intentionally narrow:

- no workflow routing
- no policy engine
- no attestation or approval process
- no attempt to replace full governance/compliance systems

The artefact is positioned as an integration surface for future governance tooling rather than a competing governance suite.

## Relationship to future governance integrations

The intended future boundary is:

1. Restormel compiles reasoning objects, diffs, provenance, and justification summaries.
2. Restormel emits structured lineage artefacts.
3. External governance, review, policy, or records systems ingest those artefacts as needed.

That keeps Restormel focused on reasoning clarity and audit-ready structure without drifting into broad governance workflow ownership.
