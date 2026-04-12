# Restormel Graph Kit v1: Compare Mode Note

## What Exists Now

The repo now contains a first reasoning-state diff capability built on canonical reasoning-object snapshots rather than raw SOPHIA graph payloads or Graph Kit-only view-model signatures.

Implemented now:

- compare data model for two runs and two graph states
- package-owned reasoning diff logic in `@restormel/graph-core`
- claim-level compare entries for matched reasoning nodes
- evidence-set compare entries for matched claims
- provenance diffs for matched claims
- justification-path diffs for matched claims
- output diffs for synthesis / conclusion / final-output objects
- graph-level deltas:
  - added nodes
  - removed nodes
  - added claims
  - removed claims
  - added edges
  - removed edges
  - changed confidence values
  - changed support strength on support-like edges
  - contradiction-state changes
- a compare panel in the SOPHIA map tab
- baseline selection from cached SOPHIA runs
- compare built from reasoning-object compare keys and version metadata where available

## What Is Partial

Partial now:

- run selection currently uses cached runs as baselines, not an arbitrary two-run picker
- compare identity still relies on adapter-generated compare keys rather than persisted platform-level compare IDs
- compare results are summarized in a panel, but not yet overlaid directly on the graph canvas
- inspector integration is currently indirect:
  - compare entries can drive node selection
  - the inspector does not yet render a baseline-vs-current side-by-side diff view
- justification-path diffs are currently local path-set deltas, not full path-sequence replay
- trace diffs are not yet first-class in compare mode

## Inspector And Selection Integration

Current integration:

- compare panel can focus a current node in the Graph Kit workspace
- focused node then uses the normal inspector flow
- claim diffs, evidence diffs, provenance diffs, and path diffs all resolve around the same selected current node

Recommended next step:

1. add compare-aware inspector sections
2. show baseline vs current confidence, provenance, and justification deltas inline
3. allow “jump to baseline equivalent” where a stable mapping exists

## What Remains

- compare overlays in the graph canvas
- explicit added/removed/change styling on nodes and edges
- dual-run selector with better identity than query text alone
- compare-linked trace diffs
- compare-aware provenance and evidence drawer
- side-by-side claim and evidence detail inspection
- compare-aware export or audit output for regression review

## Extraction Readiness

The compare logic is positioned to extract later because:

- the diff builder now operates on canonical reasoning-object snapshots
- SOPHIA-specific shaping happens before compare in adapter functions
- the compare panel consumes Graph Kit compare contracts rather than SOPHIA graph internals

To extract this into a standalone package later, the remaining work would be:

1. stabilize compare signatures or introduce canonical compare IDs
2. move Graph Kit compare contract mapping into package-owned UI helpers if a second consumer appears
3. separate baseline/run selection UI from SOPHIA cache access
4. define package-level graph overlay semantics for compare mode
5. add trace-aware compare overlays or inspector sections once normalized run traces are consistently available
