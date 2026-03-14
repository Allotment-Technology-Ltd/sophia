# Restormel Build Pack 03: Restormel Graph UX Spec

## Purpose
Define the UX for Restormel Graph as a reasoning workspace, not a decorative graph viewer.

## Product promise
Paste or import a run and quickly understand:
- what the system claimed
- what evidence supported it
- where support was weak or contradictory
- what changed between runs

## Primary users
1. AI engineers
2. evaluation and quality teams
3. internal SOPHIA users
4. technical buyers reviewing explainability and governance value

## Core UX principles
- reasoning first, graph second
- provenance always legible
- contradiction easy to spot
- compare mode built in
- semantic clarity over flourish
- typed view models between raw data and UI

## Primary surfaces

### Workspace view
Graph layout with semantic emphasis on claims, evidence, support, contradiction, and lineage.

### Claim inspector
Shows claim text, support status, linked evidence, provenance, evaluations, and neighbours.

### Evidence inspector
Shows source excerpt, locator, quality signals, linked claims, and contradiction relationships.

### Provenance trail
Trace from summary or claim back to relevant trace events and source fragments.

### Compare view
Highlight changes in claims, evidence support, contradictions, and evaluation results between two runs.

### Export surface
Generate a lineage summary, comparison summary, or evaluation report.

## Interaction model
- click graph element to open inspector
- hover to preview support / contradiction relations
- pin claims and evidence side by side
- switch between graph and structured table/list modes
- compare left vs right runs with semantic highlights

## UX anti-patterns
- graphs with no semantic explanation
- hiding provenance in secondary screens
- turning the UI into a generic trace dashboard
- forcing users to understand the full schema before getting value

## Success criteria
A user should be able to explain the answer path faster than by reading logs and retrieved documents manually.
