# Restormel Reasoning Compare Diff Note

## Classification

Reasoning-state diffing for regression analysis and decision-lineage inspection, built on canonical reasoning-object snapshots rather than Graph Kit view-model heuristics.

## Reuse candidates

- `@restormel/contracts/reasoning-compare`
- `@restormel/graph-core/compare`
- SOPHIA snapshot builders in `src/lib/graph-kit/adapters/sophiaWorkspaceBuilder.ts`
- Graph Kit mapping layer in `src/lib/graph-kit/state/compare.ts`

## Build scope

Implemented now:

- package-owned reasoning diff contracts
- package-owned diffing for:
  - added / removed claims
  - added / removed nodes and edges
  - changed confidence values
  - support-strength changes on support-like edges
  - contradiction-state and contradiction-pressure changes
  - evidence-set changes
  - provenance changes
  - local justification-path changes
  - synthesis / conclusion / final-output changes
- Graph Kit compare mapping on top of canonical reasoning diffs
- compare panel updates in the SOPHIA map tab

Still partial:

- baseline selection is still cached-run based
- compare overlays are not yet drawn directly in the graph canvas
- inspector is selection-linked but not yet side-by-side diff aware
- justification-path diffs are local path-set deltas, not full replay

## Why it matters to Restormel

This moves compare mode closer to Restormel's differentiated layer:

- regression analysis over reasoning state, not just graph churn
- decision-lineage inspection across evidence, provenance, and support structure
- a reusable compare core that can later serve Graph, evaluation, and export surfaces

## Risk of overbuilding / incumbent collision

Kept intentionally narrow:

- no generic experiment platform
- no full observability diff dashboard
- no new trace backend
- no speculative side-by-side graph engine

The implementation stays focused on reasoning-state deltas that are specific to Restormel's intended moat.