# Restormel Graph Kit v1: Compare Mode Note

## What Exists Now

The repo now contains a first compare-mode scaffold built on Graph Kit view models rather than raw SOPHIA graph payloads.

Implemented now:

- compare data model for two runs and two graph states
- claim-level compare entries for matched reasoning nodes
- evidence-set compare entries for matched claims
- graph-level deltas:
  - added nodes
  - removed nodes
  - added edges
  - removed edges
  - changed confidence values
  - contradiction-state changes
- a compare panel in the SOPHIA map tab
- baseline selection from cached SOPHIA runs

## What Is Partial

Partial now:

- run selection currently uses cached runs as baselines, not an arbitrary two-run picker
- diffing is based on stable Graph Kit signatures, not canonical persisted compare IDs
- compare results are summarized in a panel, but not yet overlaid directly on the graph canvas
- inspector integration is currently indirect:
  - compare entries can drive node selection
  - the inspector does not yet render side-by-side diffs

## Inspector And Selection Integration

Current integration:

- compare panel can focus a current node in the Graph Kit workspace
- focused node then uses the normal inspector flow

Recommended next step:

1. add compare-aware inspector sections
2. show baseline vs current confidence and evidence deltas inline
3. allow “jump to baseline equivalent” where a stable mapping exists

## What Remains

- compare overlays in the graph canvas
- explicit added/removed/change styling on nodes and edges
- dual-run selector with better identity than query text alone
- compare-linked trace diffs
- compare-aware provenance and evidence drawer
- side-by-side claim and evidence detail inspection

## Extraction Readiness

The compare logic is positioned to extract later because:

- the diff builder operates on `GraphKitWorkspaceData`
- SOPHIA-specific shaping happens before compare
- the compare panel consumes Graph Kit compare contracts rather than SOPHIA graph internals

To extract this into a standalone package later, the remaining work would be:

1. stabilize compare signatures or introduce canonical compare IDs
2. move compare state helpers into package-owned modules
3. separate baseline/run selection UI from SOPHIA cache access
4. define package-level graph overlay semantics for compare mode
