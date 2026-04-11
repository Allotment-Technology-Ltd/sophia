# Restormel Graph Kit v1 — Provenance And Evidence Gaps

## Current SOPHIA limitations affecting inspector depth

- Provenance is often exposed only as `provenance_id`, not as a full structured provenance record.
- Evidence is usually implicit:
  - source title
  - relation rationale text
  - derived-from IDs
  - evidence source references
  rather than emitted as first-class graph evidence nodes.
- Support and contradiction relations are available, but confidence and rationale coverage are inconsistent across all relation types.
- Query/question context is not currently represented as a graph node in the snapshot, so provenance cannot always be tied back to an explicit task node.
- Validation status is inferred from missing signals and graph-state heuristics rather than backed by a canonical validation subsystem.

## Implication for Graph Kit v1

The inspector can now answer "where did this come from?" more clearly than before, but full provenance fidelity will require richer SOPHIA snapshot payloads, especially:

1. embedded provenance records
2. first-class evidence nodes or evidence items
3. explicit conclusion/query nodes
4. normalized validation/check results per node and edge
