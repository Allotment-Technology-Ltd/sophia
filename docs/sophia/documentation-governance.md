---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

# Documentation Governance

## Why this exists

SOPHIA accumulated multiple overlapping strategy, roadmap, architecture, and delivery documents across different phases. That created conflicting instructions for both human contributors and AI coding agents.

This governance file defines how to keep the documentation set small, current, and safe to use.

## Classification rules

Every documentation file should be classified as one of:

- `active`: current authoritative guidance for a specific topic
- `reference`: supporting context that is still useful but not the main source of truth
- `archived`: historical material kept for traceability
- `superseded`: an older doc replaced by a newer active document

## Archive vs supersede

Archive a document when:
- it is historical
- it still has contextual value
- there is no need to keep it on the active instructional surface

Mark a document superseded when:
- it used to be active
- a newer active document now replaces it
- leaving it unmarked would confuse contributors

## Active SOPHIA source-of-truth set

These are the only active SOPHIA source-of-truth documents for major topics:

- `docs/sophia/README.md`
- `docs/sophia/current-state.md`
- `docs/sophia/architecture.md`
- `docs/sophia/product-role.md`
- `docs/sophia/roadmap.md`
- `docs/sophia/domain-expansion.md`
- `docs/sophia/changelog.md`
- `docs/sophia/documentation-governance.md`

## Relationship to Restormel docs

Use `docs/restormel/` for:
- platform strategy
- modularisation and package boundaries
- cross-product product definitions
- ecosystem-wide monetisation, marketplace, and delivery guidance

Use `docs/sophia/` for:
- the showcase app's current role
- the live SOPHIA architecture and current state
- the active SOPHIA roadmap
- current domain status in SOPHIA itself

Use `docs/reference/` for:
- supporting API, schema, prompt, runbook, copy, accessibility, and pedagogy references
- implementation detail that should remain maintained but should not compete with active source-of-truth docs

Use `docs/archive/` for:
- historical material that should be preserved without staying operationally active

## Update rule during pivots

When SOPHIA changes role, architecture, or domain scope:
- update the active `docs/sophia/` document for that topic
- update the relevant Restormel doc if the platform boundary also changed
- archive or supersede the old plan rather than leaving both active

Do not create a parallel roadmap or architecture narrative unless it replaces the current one and the older one is explicitly marked.

## Why this matters for AI coding agents

AI coding agents follow whichever docs look current. If multiple documents disagree, they will act on stale or conflicting instructions.

The governance goal is therefore practical:
- keep the active set small
- make replacement paths explicit
- preserve history without letting history look operational

## Automation and freshness scope

Documentation automation should treat the full documentation tree as in scope:
- `docs/sophia/`
- `docs/restormel/`
- `docs/reference/`
- `docs/archive/`

Expected automation behaviour:
- lint front matter and required metadata for maintained docs
- report stale docs across active and reference surfaces
- avoid treating archived docs as current source-of-truth guidance
- ensure documentation changes consider active, reference, and archive cross-links when moving files

If automation syncs work into external systems such as Linear, it must not ignore the rest of the documentation tree. Active and reference docs should both be considered during freshness checks, while archive docs should be excluded from “current guidance” outputs unless explicitly requested.
