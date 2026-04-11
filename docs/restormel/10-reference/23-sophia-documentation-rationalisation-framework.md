---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting reference only.

# SOPHIA Documentation Rationalisation Framework

## Purpose

This framework defines how to rationalise the existing documentation inside the SOPHIA repository so that:

- historical material is preserved without remaining operationally active
- conflicting or outdated product, strategy, delivery, and architecture guidance is reduced
- a smaller active document set becomes the current source of truth
- SOPHIA can evolve as the showcase/reference application without accumulating contradictory documentation over time

---

## Strategic Goal

Move the SOPHIA repository from:

- many partially overlapping documents
- mixed historical and active guidance
- ambiguous sources of truth
- stale implementation and architecture instructions

to:

- a clearly separated archive
- a clearly separated active Restormel platform documentation set
- a clearly separated active SOPHIA showcase documentation set
- lightweight governance rules that keep the active set current

---

## Core Principles

### 1. One active source of truth per topic
For any major topic, there should be one clearly active document.

Examples:
- current SOPHIA role
- current SOPHIA architecture
- current roadmap
- current platform architecture
- current package strategy

All other documents on the same topic should be marked as:
- reference
- archived
- superseded

### 2. Preserve history without letting it instruct
Historical documents should be kept where useful, but should not remain mixed into the active operating surface of the repo.

### 3. Keep the active set small
The active documentation set should be intentionally small and legible enough for:
- humans
- AI coding agents
- future contributors

### 4. Archive rather than silently erase
When a document has historical value, archive or supersede it rather than deleting it without trace.

### 5. Current-state docs must be updated during pivots
When architecture, product role, or domain focus changes, the current-state docs should be updated rather than replaced by another parallel planning document.

---

## Classification Model

Every documentation file should be assigned one of these statuses:

### Active
The document is currently authoritative and should be treated as live guidance.

### Reference
The document is not the main source of truth, but is still useful supporting context.

### Archived
The document is historical and retained for posterity or traceability.

### Superseded
The document used to be active but has been replaced by a newer source-of-truth document.

---

## Metadata Model

Use simple front matter where practical.

### Active
```yaml
---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---
```

### Reference
```yaml
---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---
```

### Archived
```yaml
---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---
```

### Superseded
```yaml
---
status: superseded
owner: adam
source_of_truth: false
replaced_by: docs/sophia/architecture.md
last_reviewed: 2026-03-13
---
```

If a document is archived or superseded, it should ideally include a short note near the top explaining:
- why it is no longer active
- what document replaces it if relevant

---

## Target Structure

The repo should evolve toward this structure:

```text
docs/
  restormel/
    ... active platform docs ...
  sophia/
    README.md
    current-state.md
    architecture.md
    product-role.md
    roadmap.md
    domain-expansion.md
    changelog.md
  archive/
    strategy/
    architecture/
    delivery/
    product/
    experiments/
```

### Meaning of each area

#### `docs/restormel/`
Active platform documentation for:
- strategy
- architecture
- packaging
- product
- delivery
- marketplace
- monetisation

#### `docs/sophia/`
Active documentation specifically for SOPHIA as the showcase/reference app.

#### `docs/archive/`
Historical material preserved for traceability, learning, and context.

---

## Active SOPHIA Source-of-Truth Set

Keep the active SOPHIA set intentionally small.

### `docs/sophia/README.md`
Purpose:
- front door to SOPHIA documentation
- explains what SOPHIA is now
- explains its role in the Restormel ecosystem
- links to active docs

### `docs/sophia/current-state.md`
Purpose:
- the single best “where are we now?” doc
- current product state
- current technical state
- live priorities
- what is real vs experimental

### `docs/sophia/architecture.md`
Purpose:
- current live architecture only
- no historical versions mixed in
- current dependencies, modules, flows, and platform relationships

### `docs/sophia/product-role.md`
Purpose:
- defines SOPHIA’s role as:
  - showcase app
  - reference implementation
  - dogfooding environment
  - domain experience layer

### `docs/sophia/roadmap.md`
Purpose:
- active roadmap only
- no obsolete plans or abandoned directions mixed in

### `docs/sophia/domain-expansion.md`
Purpose:
- records current and proposed domain expansions
- each expansion should be marked as:
  - exploratory
  - active
  - parked
  - archived

### `docs/sophia/changelog.md`
Purpose:
- high-level record of meaningful product/documentation shifts
- especially helpful during pivots

---

## Archive Rules

Archive a document when:
- it is no longer active guidance
- it still has historical or contextual value
- it may be useful for future retrospectives or architectural understanding

Mark a document superseded when:
- a newer active document clearly replaces it
- it risks confusing contributors if left unmarked

Delete only when:
- it is clearly redundant
- contains no useful historical value
- and is fully subsumed elsewhere

Default toward archive over deletion.

---

## Rationalisation Workflow

### Phase 1: Inventory
Create a full inventory of documentation files in the SOPHIA repo.

For each file capture:
- path
- title
- topic
- classification candidate
- likely replacement doc if any
- recommended action

### Phase 2: Classification
Assign each file one of:
- active
- reference
- archived
- superseded

### Phase 3: Synthesis
Create the new active SOPHIA source-of-truth set by combining the best and most current information from older docs.

Important:
This is not just moving files around.
It is producing a cleaner active set.

### Phase 4: Redirect
For any superseded or archived doc:
- add front matter
- add replacement path where relevant
- move to archive if needed

### Phase 5: Index and Navigation Cleanup
Update README and index documents so:
- active docs are easy to find
- archive is clearly separate
- contributors are routed to the right documents

### Phase 6: Governance
Introduce lightweight rules so the repo remains clean after this pass.

---

## Governance Rules After Rationalisation

### Rule 1
Every active doc must have:
- owner
- status
- last_reviewed

### Rule 2
Every superseded doc must point to the document that replaced it.

### Rule 3
Every major architecture or product pivot must update:
- `docs/sophia/current-state.md`
- `docs/sophia/architecture.md` if affected
- `docs/sophia/roadmap.md` if affected

### Rule 4
Do not create a new parallel “current” planning doc if the topic already has an active source-of-truth document.

### Rule 5
Archive historical documents rather than leaving them mixed among active docs.

---

## Review Checklist for Old Documents

For each document, ask:

1. Is this still actively true?
2. Is it the best current source on this topic?
3. Does it conflict with a newer document?
4. Would an AI coding agent be misled by this file?
5. Should it be:
   - kept active
   - kept as reference
   - archived
   - marked superseded
   - deleted

If there is doubt, prefer:
- reference
- archived
over deletion.

---

## AI-Agent Safety Objective

This rationalisation exists partly to make the repo safer for AI-assisted engineering.

After rationalisation, an AI agent should be able to locate:
- one current architecture doc
- one current roadmap doc
- one current SOPHIA role definition
- one current package/platform strategy
- one active delivery surface

without being confused by multiple outdated versions.

---

## Desired End State

After this work:
- historical material is still accessible
- active guidance is visibly current
- SOPHIA’s role in the ecosystem is explicit
- platform docs and showcase docs are clearly separated
- future pivots can be absorbed by updating a small set of active documents
